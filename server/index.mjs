// 墨写 后端代理服务（Node 内置 http，零额外运行时依赖，仅用 dotenv 读 .env）
// 职责：① 转发 DeepSeek 写文 ② 调用 article-illustrator/generate.py 出图 ③ 托管图片
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(ROOT, ".env") });

const PORT = Number(process.env.PORT || 8787);
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || "";
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const TAVILY_KEY = process.env.TAVILY_API_KEY || ""; // 联网检索（选填）

// article-illustrator skill 路径
const SKILL_DIR = path.join(os.homedir(), ".claude", "skills", "article-illustrator");
const GENERATE_PY = path.join(SKILL_DIR, "scripts", "generate.py");
const ILLUSTRATIONS_DIR = path.join(ROOT, "illustrations");

// 公众号自动发布 skill 路径（可用环境变量 WECHAT_SKILL_DIR 覆盖）
const WECHAT_SKILL_DIR =
  process.env.WECHAT_SKILL_DIR || path.resolve(ROOT, "..", "..", "公众号自动发布");
const WECHAT_API_PY = path.join(WECHAT_SKILL_DIR, "scripts", "wechat_api.py");
const WECHAT_MD2HTML_PY = path.join(WECHAT_SKILL_DIR, "scripts", "md2html.py");

// 固定手绘插画风格前缀（来自 article-illustrator skill，请勿更改）
const STYLE_PREFIX =
  "手绘漫画插画风格，温暖、亲和、有故事感；柔和的色调与自然松弛的线条笔触；不要写实摄影感、不要赛博朋克、不要冷硬的科技感、不要 3D 渲染或 AI 塑料感。画面干净整洁，主体清晰突出，背景简洁不杂乱、留白得当，适合内容平台正文配图。画面中如出现任何文字、招牌、标语、标签，一律使用规范的简体中文，文字简洁、无错别字、无乱码、无外文。";

/* ---------- 工具 ---------- */
function sendJSON(res, code, obj) {
  const body = Buffer.from(JSON.stringify(obj), "utf-8");
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

/* ---------- prompt 组装 ---------- */
const LENGTH_MAP = {
  short: "800-1200 字（短文）",
  medium: "1500-2500 字（中篇）",
  long: "3000 字以上（长文）",
};
const PLATFORM_NOTE = {
  wechat:
    "目标平台是【微信公众号】：标题可带一点吸引力但不浮夸；开头三句内抛出钩子；段落短、多换行、适当使用 emoji 和加粗；小标题清晰；结尾有金句或引导互动。",
  woshipm:
    "目标平台是【人人都是产品经理】：偏专业社区，标题朴实务实；逻辑严谨、结构化强（多用小标题、有序列表、表格）；少用 emoji；重视方法论、案例和可迁移的结论。",
};

// 事实接入：把检索/抓取到的真实资料包成"强约束"指令，杜绝幻觉
function groundingBlock(context) {
  if (!context || !context.trim()) return "";
  return `
【重要 · 事实依据（必须严格遵守）】
下面是为本文检索 / 提供的真实资料。请严格依据这些资料中的事实写作，尤其是：时间、日期、数字、版本号、产品与机构名称、事件经过、人物言论。
- 资料中没有依据的具体事实（特别是日期与数据）一律不得编造；
- 若某处缺乏资料支撑，用概括表述或直接省略，宁可不写也不要虚构；
- 不要照抄原文，用你自己的话组织，但事实必须忠于资料。

===参考资料开始===
${context}
===参考资料结束===
`;
}

function strategyBlock(p) {
  const questions = Array.isArray(p.probeQuestions)
    ? p.probeQuestions.filter(Boolean).map((q, i) => `${i + 1}. ${q}`).join("\n")
    : "";
  return `
【人的观点工作台（必须作为写作主线）】
核心观点：${p.viewpoint || "未填写"}
真实观察 / 项目经验：${p.experience || "未填写"}
仍不确定的问题：${p.uncertainty || "未填写"}
生成前 AI 追问：
${questions || "未生成"}
用户补充回答：${p.reflection || "未填写"}

写作边界：
- 这篇文章不是 AI 代写稿，而是围绕“人的观点、人的经验、人的疑问”进行结构化表达；
- 必须保留合理的不确定性，不要把推测写成事实；
- 能从参考资料中支撑的内容写成事实，人的判断写成观点，逻辑延展写成推论；
- 如果人的经验不足以支撑某个强结论，请降低措辞强度，并提示读者继续观察。
`;
}

function buildMessages(p, context = "") {
  const lengthDesc = LENGTH_MAP[p.length] || LENGTH_MAP.medium;
  const platformNote = PLATFORM_NOTE[p.platform] || PLATFORM_NOTE.wechat;
  const sys =
    "你是资深内容主笔「墨写」，擅长为内容平台撰写高质量中文文章。" +
    "若用户提供了参考资料，你必须严格基于资料中的事实写作，绝不编造时间、数字与名称。" +
    "你必须只输出一个 JSON 对象，不要任何额外解释或 markdown 代码围栏。";
  const user = `请根据以下要求创作一篇文章。

- 标题：${p.title}
- 发布平台：${platformNote}
- 文章类型：${p.type}
- 目标读者：${p.audience}
- 语气风格：${p.tone}
- 文章长度：${lengthDesc}
${strategyBlock(p)}
${groundingBlock(context)}
写作要求：
1. 用规范、地道的简体中文；结构清晰，有小标题（使用 ## 二级标题），可用列表、表格、引用增强可读性。
2. 开头要先交代“我为什么会有这个判断”，体现人的观察，而不是上来泛泛解释概念。
3. 正文用 Markdown，但【不要】在正文里插入任何图片。
4. 另外给出 3 个用于配图的画面场景，分别对应文章的开头、中间、结尾，要求是“具体、可画”的画面（谁/在做什么/在什么环境/什么情绪），不要抽象词。

只输出如下 JSON（不要代码围栏）：
{
  "title": "最终文章标题",
  "article": "完整 Markdown 正文（不含图片，不要重复标题作为一级标题）",
  "image_scenes": [
    { "position": "开头", "scene": "具体画面描述" },
    { "position": "中间", "scene": "具体画面描述" },
    { "position": "结尾", "scene": "具体画面描述" }
  ]
}`;
  return [
    { role: "system", content: sys },
    { role: "user", content: user },
  ];
}

/* ---------- DeepSeek 调用 ---------- */
async function callDeepSeek(messages, json = true, key) {
  const useKey = key || DEEPSEEK_KEY;
  if (!useKey) {
    const err = new Error(
      "未配置 DeepSeek Key。请点右上角「⚙️ 设置」填入你自己的 DeepSeek Key（或在 .env 配置）。"
    );
    err.code = "NO_KEY";
    throw err;
  }
  const body = {
    model: DEEPSEEK_MODEL,
    messages,
    temperature: 1.0,
    max_tokens: 8000,
  };
  if (json) body.response_format = { type: "json_object" };
  const resp = await fetch(DEEPSEEK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${useKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`DeepSeek ${resp.status}: ${text.slice(0, 500)}`);
  }
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content || "";
  if (!json) return content.trim();
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    // 兜底：尝试剥离可能的代码围栏
    const m = content.match(/\{[\s\S]*\}/);
    parsed = m ? JSON.parse(m[0]) : { title: "", article: content, image_scenes: [] };
  }
  return parsed;
}

/* ---------- DeepSeek 流式（用于进度展示）---------- */
function buildStreamMessages(p, context = "") {
  const lengthDesc = LENGTH_MAP[p.length] || LENGTH_MAP.medium;
  const platformNote = PLATFORM_NOTE[p.platform] || PLATFORM_NOTE.wechat;
  const sys =
    "你是资深内容主笔「墨写」，擅长为内容平台撰写高质量中文文章。" +
    "若用户提供了参考资料，你必须严格基于资料中的事实写作，绝不编造时间、数字与名称。" +
    "严格按用户给定的格式输出，不要任何额外解释，不要使用代码围栏。";
  const user = `请根据以下要求创作一篇文章。

- 标题：${p.title}
- 发布平台：${platformNote}
- 文章类型：${p.type}
- 目标读者：${p.audience}
- 语气风格：${p.tone}
- 文章长度：${lengthDesc}
${strategyBlock(p)}
${groundingBlock(context)}
【输出格式，必须严格按顺序，不要多余内容】
第一行：TITLE: 这里写一个吸引人的最终标题
第二行单独写：===ARTICLE===
然后是完整的 Markdown 正文（用 ## 二级标题，可用列表/表格/引用增强可读性；不要插入任何图片；不要再重复标题；开头要体现人的观察与判断来源）
正文结束后，单独一行写：===IMAGE_SCENES===
最后输出一个 JSON 数组（仅一行），包含 3 个字符串，分别是文章开头、中间、结尾的配图画面描述，要求“具体、可画”（谁/在做什么/在什么环境/什么情绪），例如：["...","...","..."]`;
  return [
    { role: "system", content: sys },
    { role: "user", content: user },
  ];
}

async function callDeepSeekStream(messages, onDelta, signal, key) {
  const useKey = key || DEEPSEEK_KEY;
  if (!useKey) {
    const err = new Error("未配置 DeepSeek Key。请点右上角「⚙️ 设置」填入你自己的 DeepSeek Key（或在 .env 配置）。");
    err.code = "NO_KEY";
    throw err;
  }
  const resp = await fetch(DEEPSEEK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${useKey}` },
    body: JSON.stringify({ model: DEEPSEEK_MODEL, messages, temperature: 1.0, max_tokens: 8000, stream: true }),
    signal,
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`DeepSeek ${resp.status}: ${t.slice(0, 400)}`);
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let full = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const j = JSON.parse(data);
        const d = j.choices?.[0]?.delta?.content || "";
        if (d) {
          full += d;
          onDelta(d);
        }
      } catch {
        /* 忽略心跳/非 JSON 行 */
      }
    }
  }
  return full;
}

const POS = ["开头", "中间", "结尾"];
function splitArticle(full, fallbackTitle) {
  let title = fallbackTitle;
  const tm = full.match(/TITLE:\s*(.+)/);
  if (tm) title = tm[1].trim();

  let rest = full;
  const ai = full.indexOf("===ARTICLE===");
  if (ai >= 0) rest = full.slice(ai + "===ARTICLE===".length);

  let article = rest;
  let scenesRaw = "";
  const si = rest.indexOf("===IMAGE_SCENES===");
  if (si >= 0) {
    article = rest.slice(0, si);
    scenesRaw = rest.slice(si + "===IMAGE_SCENES===".length);
  }
  if (ai < 0) article = article.replace(/^\s*TITLE:.*\n?/, "");
  article = article.trim();

  let scenes = [];
  if (scenesRaw) {
    const m = scenesRaw.match(/\[[\s\S]*\]/);
    if (m) {
      try {
        scenes = JSON.parse(m[0]).map((s, i) => ({ position: POS[i] || "配图", scene: String(s) }));
      } catch {
        /* ignore */
      }
    }
  }
  return { title, article, scenes };
}

/* ---------- 局部 AI 改写 ---------- */
const REWRITE_MODES = {
  spoken: "把它改写得更口语、更亲切自然，像在跟读者聊天，但不丢失信息。",
  concise: "把它改写得更精炼有力，删掉冗余和空话，保留核心信息与关键数据。",
  expand: "在不偏题的前提下适当扩写，补充细节、例子或解释，让论述更充实。",
  polish: "在保持原意和结构的前提下润色文字，让表达更流畅、专业。",
  humanize:
    "先诊断表达中的模板感、空泛词和缺少证据的强判断，再直接给出改写后的版本。具体要求：" +
    "① 删除空泛的填充语与开场白（如'值得注意的是''总的来说''在当今……的时代'）；" +
    "② 打破公式化结构，避免三段排比、刻意的二元对比、强行升华与金句；" +
    "③ 去掉夸大意义的措辞（如'标志着''彰显了''奠定了基础''深刻反映'）；" +
    "④ 把抽象判断尽量落到具体场景、人的观察或可验证事实上；" +
    "⑤ 该直说就直说，保留人的判断和不确定性。保持原意与信息完整，只输出改写后的正文。",
};

async function rewriteText(text, mode, key) {
  const instruction = REWRITE_MODES[mode] || REWRITE_MODES.polish;
  const messages = [
    {
      role: "system",
      content:
        "你是中文文字编辑。只输出改写后的正文本身，保持 Markdown 格式（标题/列表/加粗等）不变，" +
        "不要添加任何解释、前后缀或代码围栏。",
    },
    { role: "user", content: `${instruction}\n\n原文：\n${text}` },
  ];
  return callDeepSeek(messages, false, key);
}

/* ---------- 事实接入：联网检索 + 参考链接抓取（杜绝幻觉）---------- */
// 从一段文本里提取 http(s) 链接
function extractUrls(text) {
  if (!text) return [];
  const re = /https?:\/\/[^\s)）"'】]+/g;
  const list = (text.match(re) || []).map((u) => u.replace(/[.,;。，；、]+$/, ""));
  return [...new Set(list)];
}

// 抓取网页正文（纯 Node，轻量去标签，不引第三方依赖）
async function fetchUrlText(url, maxChars = 4000) {
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; MoxieResearchBot/1.0)" },
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) return `【链接】${url}\n（抓取失败：HTTP ${r.status}）`;
    let html = await r.text();
    html = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ");
    const titleM = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const pageTitle = titleM ? titleM[1].replace(/\s+/g, " ").trim() : "";
    let text = html
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#3[49];/g, "'")
      .replace(/\s+/g, " ")
      .trim();
    if (text.length > maxChars) text = text.slice(0, maxChars) + "…";
    return `【链接】${url}\n【标题】${pageTitle}\n【正文摘录】${text}`;
  } catch (e) {
    return `【链接】${url}\n（抓取异常：${String(e.message || e).slice(0, 100)}）`;
  }
}

// Tavily 联网搜索
async function tavilySearch(query, key, maxResults = 5) {
  const r = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: key,
      query,
      search_depth: "advanced",
      max_results: maxResults,
      include_answer: true,
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`Tavily ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  const parts = [];
  if (j.answer) parts.push(`【检索摘要】${j.answer}`);
  const results = j.results || [];
  for (const it of results) {
    parts.push(`【来源】${it.title || ""}\n${it.url || ""}\n${(it.content || "").slice(0, 800)}`);
  }
  return {
    text: parts.join("\n\n"),
    results: results.map((r) => ({ title: r.title || "", url: r.url || "" })),
    answer: j.answer || "",
  };
}

// 汇总事实上下文：用户参考资料（文字）+ 参考链接抓取 + 联网检索；onPhase 上报进度
// 返回 { context: 给模型的事实文本, sources: 供前端展示/核对的来源清单 }
async function buildResearch(p, onPhase) {
  const chunks = [];
  const sources = []; // { type: link|search|note|error, title, url }
  const ref = String(p.reference || "").trim();
  const urls = extractUrls(ref);
  const refText = ref.replace(/https?:\/\/[^\s)）"'】]+/g, "").trim();
  if (refText) {
    chunks.push(`【用户提供的资料】\n${refText}`);
    sources.push({ type: "note", title: `手动参考资料（${refText.length} 字）`, url: "" });
  }

  if (urls.length) {
    onPhase?.(`抓取参考链接（${urls.length} 条）…`);
    const picked = urls.slice(0, 5);
    const fetched = await Promise.all(picked.map((u) => fetchUrlText(u)));
    chunks.push(...fetched);
    for (let i = 0; i < picked.length; i++) {
      const m = fetched[i].match(/【标题】(.*)/);
      const ok = !/（抓取(失败|异常)/.test(fetched[i]);
      sources.push({ type: ok ? "link" : "error", title: (m && m[1].trim()) || picked[i], url: picked[i] });
    }
  }

  const tkey = p.tavilyKey || TAVILY_KEY;
  if (p.webSearch) {
    if (tkey) {
      onPhase?.("联网检索实时新闻…");
      try {
        const tv = await tavilySearch(p.searchQuery || p.title, tkey);
        chunks.push("【联网检索结果】\n" + tv.text);
        for (const r of tv.results) sources.push({ type: "search", title: r.title, url: r.url });
        if (!tv.results.length) sources.push({ type: "error", title: "联网检索未返回结果", url: "" });
      } catch (e) {
        const msg = String(e.message || e).slice(0, 120);
        chunks.push(`（联网检索失败：${msg}）`);
        sources.push({ type: "error", title: "联网检索失败：" + msg, url: "" });
      }
    } else {
      chunks.push("（已勾选联网检索，但未配置 Tavily Key：请在 ⚙️ 设置填入，或在 .env 配 TAVILY_API_KEY）");
      sources.push({ type: "error", title: "未配置 Tavily Key，联网检索已跳过", url: "" });
    }
  }
  return { context: chunks.join("\n\n---\n\n").slice(0, 12000), sources };
}

/* ---------- 观点追问 + 内容评估 ---------- */
async function probeThinking(p, key) {
  const messages = [
    {
      role: "system",
      content:
        "你是 AI 产品经理的内容教练。你的任务不是替用户写文章，而是在写作前逼近更清晰的判断。" +
        "只输出 JSON，不要代码围栏。",
    },
    {
      role: "user",
      content: `请基于下面的写作意图，提出能帮助用户深化观点的追问。

标题：${p.title || ""}
核心观点：${p.viewpoint || ""}
真实观察 / 项目经验：${p.experience || ""}
仍不确定的问题：${p.uncertainty || ""}
参考资料：${String(p.reference || "").slice(0, 2000)}

要求：
1. 问题要尖锐、具体，避免“请补充更多细节”这种空话；
2. 至少有一个问题关注反例或边界条件；
3. 至少有一个问题关注事实证据或用户场景；
4. 至少有一个问题关注读者能获得什么新判断；
5. evidenceNeeds 写需要补充的证据类型，不要虚构事实。

只输出如下 JSON：
{
  "questions": ["问题1", "问题2", "问题3"],
  "evidenceNeeds": ["还需要补充的证据1", "还需要补充的证据2", "还需要补充的证据3"],
  "angles": ["可以展开的角度1", "可以展开的角度2", "可以展开的角度3"]
}`,
    },
  ];
  const out = await callDeepSeek(messages, true, key);
  return {
    questions: Array.isArray(out.questions) ? out.questions.slice(0, 3).map(String) : [],
    evidenceNeeds: Array.isArray(out.evidenceNeeds) ? out.evidenceNeeds.slice(0, 4).map(String) : [],
    angles: Array.isArray(out.angles) ? out.angles.slice(0, 4).map(String) : [],
  };
}

function fallbackAnalysis() {
  return {
    summary: "评估结果不完整，请重新评估。",
    quality: [],
    factOpinion: [],
    expression: [],
    nextActions: ["重新运行质量评估", "补充事实来源", "人工检查关键结论"],
  };
}

async function analyzeDraft(body, key) {
  const strategy = body.strategy || {};
  const sources = Array.isArray(body.sources) ? body.sources : [];
  const sourceText = sources
    .map((s, i) => `${i + 1}. ${s.title || ""} ${s.url || ""}`.trim())
    .join("\n");
  const messages = [
    {
      role: "system",
      content:
        "你是 AI 内容产品的质量评估器，擅长检查中文专业文章的事实、推论、观点、人味和平台适配。" +
        "你要给出可执行诊断，不要夸奖式空话。只输出 JSON，不要代码围栏。",
    },
    {
      role: "user",
      content: `请评估下面这篇文章，输出质量评估、事实/推论/观点分层、表达诊断和下一步修改建议。

标题：${body.title || ""}
发布平台：${body.platform || ""}

人的观点工作台：
核心观点：${strategy.viewpoint || ""}
真实观察 / 项目经验：${strategy.experience || ""}
仍不确定的问题：${strategy.uncertainty || ""}
AI 追问：${Array.isArray(strategy.probeQuestions) ? strategy.probeQuestions.join("；") : ""}
用户补充回答：${strategy.reflection || ""}
参考资料：${strategy.reference || ""}

已展示来源：
${sourceText || "无"}

文章正文：
${String(body.article || "").slice(0, 16000)}

评分要求：
- score 统一为 1-5，5 表示表现好；
- “AI味风险控制”分数越高代表越不像模板化 AI 文；
- factOpinion 选 5-8 个关键句，不要逐句穷举；
- type 只能是 fact / inference / opinion；
- support 只能是 supported / needs_source / human_judgment；
- expression 只抓最值得改的 3-6 处。

只输出如下 JSON：
{
  "summary": "一句话总结这篇稿子的最大优势和最大风险",
  "quality": [
    {"key":"originality","label":"观点原创度","score":1,"verdict":"诊断","suggestion":"建议"},
    {"key":"factuality","label":"事实可信度","score":1,"verdict":"诊断","suggestion":"建议"},
    {"key":"logic","label":"逻辑完整度","score":1,"verdict":"诊断","suggestion":"建议"},
    {"key":"reader_value","label":"读者价值","score":1,"verdict":"诊断","suggestion":"建议"},
    {"key":"platform_fit","label":"平台适配度","score":1,"verdict":"诊断","suggestion":"建议"},
    {"key":"ai_tone","label":"AI味风险控制","score":1,"verdict":"诊断","suggestion":"建议"}
  ],
  "factOpinion": [
    {"text":"文章中的关键句","type":"fact","support":"needs_source","note":"为什么这样分类","suggestion":"如何处理"}
  ],
  "expression": [
    {"text":"有问题的表达","issue":"问题","suggestion":"改法","severity":"medium"}
  ],
  "nextActions": ["下一步行动1", "下一步行动2", "下一步行动3"]
}`,
    },
  ];
  const out = await callDeepSeek(messages, true, key);
  return {
    ...fallbackAnalysis(),
    ...out,
    quality: Array.isArray(out.quality) ? out.quality.slice(0, 6) : [],
    factOpinion: Array.isArray(out.factOpinion) ? out.factOpinion.slice(0, 8) : [],
    expression: Array.isArray(out.expression) ? out.expression.slice(0, 6) : [],
    nextActions: Array.isArray(out.nextActions) ? out.nextActions.slice(0, 5).map(String) : [],
  };
}

/* ---------- 出图：调用 generate.py --batch ---------- */
function pickSize(index) {
  return index === 2 ? "1:1" : "16:9"; // 结尾图方形，其余横向
}

function runIllustrator(scenes, onProgress, onSpawn, apimartKey) {
  return new Promise((resolve, reject) => {
    const stamp = Date.now().toString(36);
    const outDir = path.join("illustrations", stamp); // 相对 ROOT（generate.py 要求相对路径）
    fs.mkdirSync(path.join(ROOT, outDir), { recursive: true });

    const positions = ["开头", "中间", "结尾"];
    const tasks = scenes.slice(0, 3).map((scene, i) => ({
      prompt: `${STYLE_PREFIX}画面内容：${scene}。构图：${i === 2 ? "方形" : "横向"}。`,
      output: `${outDir}/0${i + 1}.png`,
      size: pickSize(i),
    }));

    const tasksFile = path.join(ROOT, `.tasks-${stamp}.json`);
    fs.writeFileSync(tasksFile, JSON.stringify(tasks), "utf-8");

    // 优先用请求自带的 Apimart Key；否则回退到 .env，再否则由 generate.py 读 skill 的 config.json
    const env = { ...process.env };
    const useApimart = apimartKey || process.env.APIMART_API_KEY;
    if (useApimart) env.APIMART_API_KEY = useApimart;

    const child = spawn("python3", [GENERATE_PY, "--batch", path.basename(tasksFile)], {
      cwd: ROOT,
      env,
    });
    if (onSpawn) onSpawn(child);
    let stdout = "";
    let stderr = "";
    let errBuf = "";
    let done = 0;
    const total = tasks.length;
    if (onProgress) onProgress({ done: 0, total, phase: "正在提交出图任务…" });
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => {
      stderr += d;
      errBuf += d.toString();
      let idx;
      while ((idx = errBuf.indexOf("\n")) >= 0) {
        const line = errBuf.slice(0, idx);
        errBuf = errBuf.slice(idx + 1);
        if (line.includes("[完成]")) {
          done++;
          if (onProgress) onProgress({ done, total, phase: `已完成 ${done}/${total} 张` });
        } else if (line.includes("[等待]") || line.includes("pending")) {
          if (onProgress && done === 0) onProgress({ done, total, phase: "模型绘制中…" });
        }
      }
    });
    child.on("error", reject);
    child.on("close", (code) => {
      try {
        fs.unlinkSync(tasksFile);
      } catch {}
      if (code !== 0) {
        return reject(new Error(`generate.py 退出码 ${code}：${stderr.slice(-600)}`));
      }
      let result;
      try {
        result = JSON.parse(stdout);
      } catch {
        return reject(new Error(`无法解析出图结果：${stdout.slice(-400)}`));
      }
      const images = (result.images || []).map((img, i) => ({
        index: i + 1,
        position: positions[i] || `位置${i + 1}`,
        // 浏览器访问路径：/images/<stamp>/0N.png
        url: "/images/" + img.output.replace(/^illustrations\//, ""),
        caption: positions[i] || "",
      }));
      resolve(images);
    });
  });
}

/* ---------- 发布到公众号（调用 公众号自动发布 skill）---------- */
// 运行一个 python 脚本，返回 {code, stdout, stderr}；可选 stdin 输入
function runPy(scriptPath, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", [scriptPath, ...args], { cwd: WECHAT_SKILL_DIR });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    if (input != null) {
      child.stdin.write(input);
      child.stdin.end();
    }
  });
}

// 调用 wechat_api.py 的子命令，解析其单行 JSON 输出（失败抛出含微信报错的 Error）
async function wechatApi(args) {
  const { code, stdout, stderr } = await runPy(WECHAT_API_PY, args);
  let data;
  try {
    data = JSON.parse(stdout.trim().split("\n").pop());
  } catch {
    throw new Error((stderr || stdout || `wechat_api ${args[0]} 失败`).slice(-400));
  }
  if (!data.ok) throw new Error(data.error || `wechat_api ${args[0]} 失败`);
  return data;
}

function localPathFromUrl(url) {
  const rel = decodeURIComponent(String(url).replace(/^\/images\//, ""));
  return path.join(ILLUSTRATIONS_DIR, rel);
}

function deriveDigest(blocks) {
  const md = blocks.find((b) => b.type === "markdown" && b.content.trim());
  if (!md) return "";
  return md.content
    .replace(/[#>*`\-\[\]()!]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 110);
}

// 完整发布流水线，onProgress 上报阶段
async function publishToWechat({ title, author, digest, sourceUrl, blocks }, onProgress) {
  if (!fs.existsSync(WECHAT_API_PY)) {
    throw new Error(`未找到公众号发布 skill：${WECHAT_SKILL_DIR}（可用 .env 的 WECHAT_SKILL_DIR 指定）`);
  }
  const images = blocks.filter((b) => b.type === "image" && b.url);
  if (images.length === 0) throw new Error("公众号草稿需要封面：请先为文章配至少 1 张图");

  // 1) 正文配图逐张上传，换成微信图床链接
  const urlMap = {};
  for (let i = 0; i < images.length; i++) {
    onProgress?.({ phase: `上传正文配图 ${i + 1}/${images.length}…`, done: i, total: images.length + 2 });
    const fp = localPathFromUrl(images[i].url);
    if (!fs.existsSync(fp)) throw new Error(`配图文件缺失：${images[i].url}（可在编辑区重新生成）`);
    const r = await wechatApi(["uploadimg", fp]);
    urlMap[images[i].url] = r.url;
  }

  // 2) 封面：用第一张图作为永久素材，取 thumb_media_id
  onProgress?.({ phase: "上传封面素材…", done: images.length, total: images.length + 2 });
  const cover = await wechatApi(["addmaterial", localPathFromUrl(images[0].url), "image"]);
  const thumbMediaId = cover.media_id;

  // 3) 组装正文 markdown（标题单独承载，正文图换微信链）→ 内联 HTML
  onProgress?.({ phase: "转换公众号内联样式…", done: images.length + 1, total: images.length + 2 });
  const bodyMd = blocks
    .map((b) => (b.type === "markdown" ? b.content : b.url ? `![](${urlMap[b.url] || b.url})` : ""))
    .filter(Boolean)
    .join("\n\n");
  const md2 = await runPy(WECHAT_MD2HTML_PY, [], bodyMd);
  if (md2.code !== 0 || !md2.stdout) throw new Error("Markdown 转 HTML 失败：" + (md2.stderr || "").slice(-300));
  const contentHtml = md2.stdout;

  // 4) 建草稿
  onProgress?.({ phase: "推送到草稿箱…", done: images.length + 2, total: images.length + 2 });
  const article = {
    title,
    author: author || "",
    digest: digest || deriveDigest(blocks),
    content: contentHtml,
    thumb_media_id: thumbMediaId,
    need_open_comment: 1,
    only_fans_can_comment: 0,
  };
  if (sourceUrl) article.content_source_url = sourceUrl;
  const tmp = path.join(ROOT, `.draft-${Date.now().toString(36)}.json`);
  fs.writeFileSync(tmp, JSON.stringify(article), "utf-8");
  try {
    const r = await wechatApi(["draft", tmp]);
    return { draft_media_id: r.draft_media_id };
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {}
  }
}

/* ---------- 静态图片 ---------- */
function serveImage(res, urlPath) {
  // urlPath 形如 /images/<stamp>/0N.png
  const rel = decodeURIComponent(urlPath.replace(/^\/images\//, ""));
  const fpath = path.join(ILLUSTRATIONS_DIR, rel);
  if (!fpath.startsWith(ILLUSTRATIONS_DIR) || !fs.existsSync(fpath)) {
    return sendJSON(res, 404, { error: "image not found" });
  }
  const ext = path.extname(fpath).toLowerCase();
  const ctype =
    ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "application/octet-stream";
  const data = fs.readFileSync(fpath);
  res.writeHead(200, { "Content-Type": ctype, "Content-Length": data.length, "Cache-Control": "no-store" });
  res.end(data);
}

/* ---------- 路由 ---------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  try {
    if (req.method === "GET" && pathname === "/api/health") {
      return sendJSON(res, 200, { ok: true, hasKey: !!DEEPSEEK_KEY, model: DEEPSEEK_MODEL });
    }

    if (req.method === "GET" && pathname === "/api/egress-ip") {
      // 查询本机访问公网时的出口 IP（≈ 微信看到的 IP），多个服务兜底
      const services = ["https://api.ipify.org?format=json", "https://api.ip.sb/jsonip", "https://ipinfo.io/json"];
      for (const u of services) {
        try {
          const r = await fetch(u, { signal: AbortSignal.timeout(4000) });
          if (!r.ok) continue;
          const j = await r.json();
          const ip = j.ip || j.query;
          if (ip) return sendJSON(res, 200, { ip: String(ip).trim() });
        } catch {
          /* 试下一个 */
        }
      }
      return sendJSON(res, 502, { error: "暂时查不到出口 IP，请检查网络" });
    }

    if (req.method === "POST" && pathname === "/api/probe") {
      const p = await readBody(req);
      if (!p.title && !p.viewpoint) return sendJSON(res, 400, { error: "请先填写标题或核心观点" });
      const result = await probeThinking(p, p.deepseekKey);
      return sendJSON(res, 200, result);
    }

    if (req.method === "POST" && pathname === "/api/analyze") {
      const body = await readBody(req);
      if (!body.article || !String(body.article).trim()) return sendJSON(res, 400, { error: "缺少要评估的文章正文" });
      const result = await analyzeDraft(body, body.deepseekKey);
      return sendJSON(res, 200, result);
    }

    if (req.method === "POST" && pathname === "/api/generate") {
      const p = await readBody(req);
      if (!p.title) return sendJSON(res, 400, { error: "缺少文章标题" });
      const { context, sources } = await buildResearch(p);
      const result = await callDeepSeek(buildMessages(p, context), true, p.deepseekKey);
      return sendJSON(res, 200, {
        title: result.title || p.title,
        article: result.article || "",
        image_scenes: result.image_scenes || [],
        sources,
      });
    }

    if (req.method === "POST" && pathname === "/api/generate/stream") {
      const p = await readBody(req);
      if (!p.title) return sendJSON(res, 400, { error: "缺少文章标题" });
      res.writeHead(200, {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
      });
      const send = (o) => {
        if (!res.writableEnded) res.write(JSON.stringify(o) + "\n");
      };
      const ac = new AbortController();
      req.on("close", () => ac.abort());
      try {
        send({ type: "phase", phase: "理解主题与受众…" });
        const { context, sources } = await buildResearch(p, (ph) => send({ type: "phase", phase: ph }));
        send({ type: "sources", sources });
        const full = await callDeepSeekStream(
          buildStreamMessages(p, context),
          (d) => send({ type: "delta", text: d }),
          ac.signal,
          p.deepseekKey
        );
        const { title, article, scenes } = splitArticle(full, p.title);
        send({ type: "done", title, article, image_scenes: scenes });
      } catch (e) {
        if (e?.name !== "AbortError") send({ type: "error", error: String(e.message || e) });
      }
      return res.end();
    }

    if (req.method === "POST" && pathname === "/api/illustrate/stream") {
      const { scenes, apimartKey } = await readBody(req);
      if (!Array.isArray(scenes) || scenes.length === 0) {
        return sendJSON(res, 400, { error: "缺少配图场景 scenes" });
      }
      res.writeHead(200, {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
      });
      const send = (o) => {
        if (!res.writableEnded) res.write(JSON.stringify(o) + "\n");
      };
      let child = null;
      let aborted = false;
      req.on("close", () => {
        aborted = true;
        if (child) {
          try {
            child.kill("SIGTERM");
          } catch {}
        }
      });
      try {
        const images = await runIllustrator(
          scenes,
          (pg) => send({ type: "progress", ...pg }),
          (c) => (child = c),
          apimartKey
        );
        send({ type: "done", images });
      } catch (e) {
        if (!aborted) send({ type: "error", error: String(e.message || e) });
      }
      return res.end();
    }

    if (req.method === "POST" && pathname === "/api/publish/stream") {
      const body = await readBody(req);
      if (!body.title) return sendJSON(res, 400, { error: "缺少文章标题" });
      res.writeHead(200, {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
        Connection: "keep-alive",
      });
      const send = (o) => {
        if (!res.writableEnded) res.write(JSON.stringify(o) + "\n");
      };
      try {
        const r = await publishToWechat(body, (pg) => send({ type: "progress", ...pg }));
        send({ type: "done", ...r });
      } catch (e) {
        send({ type: "error", error: String(e.message || e) });
      }
      return res.end();
    }

    if (req.method === "POST" && pathname === "/api/rewrite") {
      const { text, mode, deepseekKey } = await readBody(req);
      if (!text || !text.trim()) return sendJSON(res, 400, { error: "缺少要改写的文本" });
      const out = await rewriteText(text, mode, deepseekKey);
      return sendJSON(res, 200, { text: out });
    }

    if (req.method === "POST" && pathname === "/api/cleanup") {
      const { keep } = await readBody(req);
      // 安全护栏 1：keep 必须是非空数组，避免任何 bug 导致“全删”
      if (!Array.isArray(keep) || keep.length === 0) {
        return sendJSON(res, 400, { error: "安全保护：未收到有效的保留列表，已取消清理" });
      }
      const used = new Set(
        keep.map((u) => String(u).match(/\/images\/([^/]+)\//)?.[1]).filter(Boolean)
      );
      // 安全护栏 2：解析不出任何有效引用时同样拒绝
      if (used.size === 0) {
        return sendJSON(res, 400, { error: "安全保护：保留列表无法解析出配图引用，已取消清理" });
      }
      const RECENT_MS = 60 * 60 * 1000; // 安全护栏 3：1 小时内新建的目录一律保留（可能还没写进历史）
      const now = Date.now();
      let removed = 0;
      if (fs.existsSync(ILLUSTRATIONS_DIR)) {
        for (const name of fs.readdirSync(ILLUSTRATIONS_DIR)) {
          const full = path.join(ILLUSTRATIONS_DIR, name);
          const st = fs.statSync(full);
          if (st.isDirectory() && !used.has(name) && now - st.mtimeMs > RECENT_MS) {
            fs.rmSync(full, { recursive: true, force: true });
            removed++;
          }
        }
      }
      return sendJSON(res, 200, { removed });
    }

    if (req.method === "POST" && pathname === "/api/illustrate") {
      const { scenes, apimartKey } = await readBody(req);
      if (!Array.isArray(scenes) || scenes.length === 0) {
        return sendJSON(res, 400, { error: "缺少配图场景 scenes" });
      }
      const images = await runIllustrator(scenes, undefined, undefined, apimartKey);
      return sendJSON(res, 200, { images });
    }

    if (req.method === "GET" && pathname.startsWith("/images/")) {
      return serveImage(res, pathname);
    }

    return sendJSON(res, 404, { error: "not found" });
  } catch (e) {
    const code = e.code === "NO_KEY" ? 400 : 500;
    return sendJSON(res, code, { error: String(e.message || e) });
  }
});

server.listen(PORT, () => {
  console.log("=".repeat(52));
  console.log("  墨写 后端服务已启动  http://localhost:" + PORT);
  console.log("  DeepSeek key: " + (DEEPSEEK_KEY ? "已配置 ✓" : "未配置 ✗（请填 .env）"));
  console.log("  模型: " + DEEPSEEK_MODEL);
  console.log("  联网检索: " + (TAVILY_KEY ? "Tavily 已配置 ✓" : "未配置（仅手动参考资料可用）"));
  console.log("  出图脚本: " + (fs.existsSync(GENERATE_PY) ? "已找到 ✓" : "未找到 ✗"));
  console.log("  公众号发布: " + (fs.existsSync(WECHAT_API_PY) ? "已找到 ✓" : "未找到 ✗ " + WECHAT_SKILL_DIR));
  console.log("=".repeat(52));
});
