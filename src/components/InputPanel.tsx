import { useState } from "react";
import { probeStrategy } from "../lib/api";
import type { GenParams, Platform, ProbeReport } from "../lib/types";

const PLATFORMS: { value: Platform; label: string }[] = [
  { value: "wechat", label: "微信公众号" },
  { value: "woshipm", label: "人人都是产品经理" },
];
const TYPES = ["干货教程", "观点分析", "案例拆解", "经验复盘"];
const AUDIENCES = ["产品经理", "运营人员", "创业者", "职场新人"];
const TONES = ["专业严谨", "通俗易懂", "互动亲切", "犀利深刻"];
const LENGTHS: { value: GenParams["length"]; label: string }[] = [
  { value: "short", label: "短文 800-1200 字" },
  { value: "medium", label: "中篇 1500-2500 字" },
  { value: "long", label: "长文 3000 字以上" },
];

interface Props {
  loading: boolean;
  onGenerate: (p: GenParams) => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onOpenSettings: () => void;
}

export default function InputPanel({ loading, onGenerate, theme, onToggleTheme, onOpenSettings }: Props) {
  const [title, setTitle] = useState("");
  const [platform, setPlatform] = useState<Platform>("wechat");
  const [type, setType] = useState(TYPES[0]);
  const [audience, setAudience] = useState(AUDIENCES[0]);
  const [tone, setTone] = useState(TONES[1]);
  const [length, setLength] = useState<GenParams["length"]>("medium");
  const [viewpoint, setViewpoint] = useState("");
  const [experience, setExperience] = useState("");
  const [uncertainty, setUncertainty] = useState("");
  const [reflection, setReflection] = useState("");
  const [probe, setProbe] = useState<ProbeReport | null>(null);
  const [probing, setProbing] = useState(false);
  const [reference, setReference] = useState("");
  const [webSearch, setWebSearch] = useState(false);

  function buildParams(): GenParams {
    return {
      title: title.trim(),
      platform,
      type,
      audience,
      tone,
      length,
      viewpoint: viewpoint.trim(),
      experience: experience.trim(),
      uncertainty: uncertainty.trim(),
      reflection: reflection.trim(),
      probeQuestions: probe?.questions || [],
      reference: reference.trim(),
      webSearch,
    };
  }

  async function askProbe() {
    if (!title.trim() && !viewpoint.trim()) {
      alert("请先写一个标题或核心观点");
      return;
    }
    setProbing(true);
    try {
      const result = await probeStrategy(buildParams());
      setProbe(result);
    } catch (e: any) {
      alert("生成追问失败：" + (e?.message || e));
    } finally {
      setProbing(false);
    }
  }

  function submit() {
    if (!title.trim()) {
      alert("请先输入文章标题");
      return;
    }
    if (!viewpoint.trim() || !experience.trim() || !uncertainty.trim()) {
      alert("请先补全「核心观点」「真实观察 / 经验」和「不确定的问题」。墨写会把你的判断放在生成前面。");
      return;
    }
    onGenerate(buildParams());
  }

  const Chips = <T extends string>(opts: { value: T; label: string }[] | T[], cur: T, set: (v: T) => void) => (
    <div className="chips">
      {(opts as any[]).map((o) => {
        const v = typeof o === "string" ? o : o.value;
        const l = typeof o === "string" ? o : o.label;
        return (
          <button key={v} className={"chip" + (cur === v ? " active" : "")} onClick={() => set(v)} type="button">
            {l}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="panel input-panel">
      <div className="panel-head">
        <span className="brand">墨<span className="brand-accent">写</span></span>
        <span className="brand-sub">观点工作台</span>
        <button className="theme-toggle" onClick={onOpenSettings} title="设置 API Key">
          ⚙️
        </button>
        <button
          className="theme-toggle"
          onClick={onToggleTheme}
          title={theme === "light" ? "切换到夜间模式" : "切换到日间模式"}
        >
          {theme === "light" ? "🌙 夜间" : "☀️ 日间"}
        </button>
      </div>

      <label className="field-label">文章标题</label>
      <input
        className="text-input"
        placeholder="例如：AI 时代，产品经理如何重构竞争力"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />

      <div className="strategy-box">
        <div className="strategy-title">观点工作台</div>
        <div className="strategy-desc">先写你的判断，再让 AI 帮你组织、检验和表达。</div>

        <label className="field-label compact">我的核心观点</label>
        <textarea
          className="text-input strategy-text"
          placeholder="例如：AI 产品经理的竞争力不在会写提示词，而在能把不确定的模型能力转成稳定的用户价值。"
          value={viewpoint}
          onChange={(e) => setViewpoint(e.target.value)}
        />

        <label className="field-label compact">我的真实观察 / 项目经验</label>
        <textarea
          className="text-input strategy-text"
          placeholder="写你亲眼见过的现象、做过的项目、踩过的坑，哪怕很小也可以。"
          value={experience}
          onChange={(e) => setExperience(e.target.value)}
        />

        <label className="field-label compact">我还不确定的问题</label>
        <textarea
          className="text-input strategy-text"
          placeholder="例如：这个判断是否只适用于内容类产品？在 B 端场景是否成立？"
          value={uncertainty}
          onChange={(e) => setUncertainty(e.target.value)}
        />

        <button className="probe-btn" type="button" onClick={askProbe} disabled={loading || probing}>
          {probing ? "追问中…" : "生成 3 个追问"}
        </button>

        {probe && (
          <div className="probe-card">
            <div className="probe-head">AI 追问</div>
            <ol>
              {probe.questions.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ol>
            {probe.evidenceNeeds.length > 0 && (
              <>
                <div className="probe-head muted">建议补充的证据</div>
                <ul>
                  {probe.evidenceNeeds.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}

        <label className="field-label compact">我的补充回答</label>
        <textarea
          className="text-input strategy-text"
          placeholder="可以回答上面的追问，也可以记录你临时想到的反例、边界和取舍。"
          value={reflection}
          onChange={(e) => setReflection(e.target.value)}
        />
      </div>

      <label className="field-label">发布平台</label>
      {Chips(PLATFORMS, platform, setPlatform)}

      <label className="field-label">文章类型</label>
      {Chips(TYPES, type, setType)}

      <label className="field-label">目标读者</label>
      {Chips(AUDIENCES, audience, setAudience)}
      <input
        className="text-input small"
        placeholder="或自定义目标读者…"
        onChange={(e) => e.target.value && setAudience(e.target.value)}
      />

      <label className="field-label">语气风格</label>
      {Chips(TONES, tone, setTone)}

      <label className="field-label">文章长度</label>
      {Chips(LENGTHS, length, setLength)}

      <label className="field-label">
        参考资料 / 事实
        <span style={{ fontWeight: 400, color: "var(--text-2)", fontSize: 12 }}>（选填，可填文字或链接）</span>
      </label>
      <textarea
        className="text-input"
        style={{ width: "100%", minHeight: 78, resize: "vertical", lineHeight: 1.5 }}
        placeholder="写新闻/时事类文章时，把真实资料粘进来，或贴新闻链接（自动抓取）。AI 会严格依据这些事实写，不再瞎编时间和数据。"
        value={reference}
        onChange={(e) => setReference(e.target.value)}
      />
      <label className="checkbox-row" style={{ display: "flex", alignItems: "center", gap: 8, margin: "10px 0 2px", cursor: "pointer", fontSize: 13 }}>
        <input type="checkbox" checked={webSearch} onChange={(e) => setWebSearch(e.target.checked)} />
        <span>🌐 联网检索实时新闻<span style={{ color: "var(--text-2)" }}>（需在 ⚙️ 设置填 Tavily Key）</span></span>
      </label>

      <button className="primary-btn" onClick={submit} disabled={loading}>
        {loading ? "正在生成…" : "✦ 生成可信文章"}
      </button>
      <p className="hint-text">生成文字后，可在中间区点「为文章配图」补 3 张插画。</p>
    </div>
  );
}
