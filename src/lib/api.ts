import type { ArticleAnalysis, GenParams, ImageScene, ProbeReport, Source } from "./types";

// 用户自己的 key（存浏览器本地，随请求发给后端；后端无则回退 .env）
export const KEY_DEEPSEEK = "moxie_deepseek_key";
export const KEY_APIMART = "moxie_apimart_key";
export const KEY_TAVILY = "moxie_tavily_key";
export function getKeys() {
  return {
    deepseekKey: localStorage.getItem(KEY_DEEPSEEK) || "",
    apimartKey: localStorage.getItem(KEY_APIMART) || "",
    tavilyKey: localStorage.getItem(KEY_TAVILY) || "",
  };
}

export interface GenerateResult {
  title: string;
  article: string;
  image_scenes: ImageScene[];
  sources?: Source[];
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `请求失败 (${res.status})`);
  return data as T;
}

export function generateArticle(params: GenParams) {
  return post<GenerateResult>("/api/generate", params);
}

export function probeStrategy(params: GenParams) {
  return post<ProbeReport>("/api/probe", { ...params, ...getKeys() });
}

export function analyzeArticle(params: {
  title: string;
  article: string;
  platform: GenParams["platform"];
  strategy: Pick<GenParams, "viewpoint" | "experience" | "uncertainty" | "reflection" | "reference" | "probeQuestions">;
  sources: Source[];
}) {
  return post<ArticleAnalysis>("/api/analyze", { ...params, ...getKeys() });
}

export interface IllustrateResult {
  images: { index: number; position: string; url: string; caption: string }[];
}

export function illustrate(scenes: string[]) {
  return post<IllustrateResult>("/api/illustrate", { scenes, ...getKeys() });
}

export type RewriteMode = "spoken" | "concise" | "expand" | "polish" | "humanize";
export function rewrite(text: string, mode: RewriteMode) {
  return post<{ text: string }>("/api/rewrite", { text, mode, ...getKeys() });
}

export function cleanup(keep: string[]) {
  return post<{ removed: number }>("/api/cleanup", { keep });
}

export async function getEgressIp(): Promise<string> {
  const res = await fetch("/api/egress-ip");
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "查询失败");
  return data.ip as string;
}

// NDJSON 流：逐行 yield 后端推送的事件
export async function* streamNDJSON(
  url: string,
  body: unknown,
  signal?: AbortSignal
): AsyncGenerator<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    let msg = `请求失败 (${res.status})`;
    try {
      msg = (await res.json())?.error || msg;
    } catch {}
    throw new Error(msg);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) yield JSON.parse(line);
    }
  }
  if (buf.trim()) yield JSON.parse(buf.trim());
}

// 从流式原文里实时抽取“正文”部分用于打字预览
export function extractArticleLive(raw: string): string {
  let s = raw;
  const ai = s.indexOf("===ARTICLE===");
  if (ai >= 0) s = s.slice(ai + "===ARTICLE===".length);
  else return ""; // 还没开始写正文
  const si = s.indexOf("===IMAGE_SCENES===");
  if (si >= 0) s = s.slice(0, si);
  return s.replace(/^\s*TITLE:.*\n?/, "").trim();
}
