import { useState } from "react";
import type { ArticleAnalysis, HistoryItem, ProcessReport, Source } from "../lib/types";

interface Props {
  analysis: ArticleAnalysis | null;
  loading: boolean;
  processReport: ProcessReport | null;
  strategy: HistoryItem["strategy"] | null;
  sources: Source[];
  onAnalyze: () => void;
  onToast: (msg: string) => void;
}

const typeLabel: Record<string, string> = {
  fact: "事实",
  inference: "推论",
  opinion: "观点",
};

const supportLabel: Record<string, string> = {
  supported: "有依据",
  needs_source: "待补证",
  human_judgment: "人的判断",
};

function scoreWidth(score: number) {
  const n = Math.max(0, Math.min(5, Number(score) || 0));
  return `${(n / 5) * 100}%`;
}

function avgScore(analysis: ArticleAnalysis | null) {
  if (!analysis?.quality.length) return null;
  const total = analysis.quality.reduce((sum, item) => sum + (Number(item.score) || 0), 0);
  return (total / analysis.quality.length).toFixed(1);
}

function escapeHtml(s: string) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeName() {
  const d = new Date();
  return `moxie-report-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}.html`;
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function buildReportText(
  analysis: ArticleAnalysis | null,
  processReport: ProcessReport | null,
  strategy: HistoryItem["strategy"] | null,
  sources: Source[]
) {
  const lines: string[] = [];
  lines.push("# 墨写 · 创作过程报告");
  lines.push("");
  if (strategy) {
    lines.push("## 你的观点输入");
    lines.push(`- 核心观点：${strategy.viewpoint || "未记录"}`);
    lines.push(`- 真实观察 / 经验：${strategy.experience || "未记录"}`);
    lines.push(`- 不确定的问题：${strategy.uncertainty || "未记录"}`);
    if (strategy.probeQuestions?.length) {
      lines.push("- AI 追问：");
      strategy.probeQuestions.forEach((q, i) => lines.push(`  ${i + 1}. ${q}`));
    }
    if (strategy.reflection) lines.push(`- 补充回答：${strategy.reflection}`);
    lines.push("");
  }
  if (processReport) {
    lines.push("## 人机协作分工");
    processReport.humanInputs.forEach((x) => lines.push(`- ${x}`));
    processReport.aiContributions.forEach((x) => lines.push(`- AI：${x}`));
    lines.push("");
    lines.push("## 决策与检查点");
    processReport.decisionPoints.forEach((x) => lines.push(`- ${x}`));
    processReport.reviewChecklist.forEach((x) => lines.push(`- 检查：${x}`));
    lines.push("");
  }
  if (analysis) {
    lines.push("## 质量评估");
    lines.push(analysis.summary);
    analysis.quality.forEach((m) => lines.push(`- ${m.label}：${m.score}/5。${m.verdict} 建议：${m.suggestion}`));
    lines.push("");
    lines.push("## 事实 / 推论 / 观点分层");
    analysis.factOpinion.forEach((item) =>
      lines.push(`- [${typeLabel[item.type] || item.type} / ${supportLabel[item.support] || item.support}] ${item.text}。${item.suggestion}`)
    );
    lines.push("");
    lines.push("## 表达诊断");
    analysis.expression.forEach((item) => lines.push(`- ${item.text}：${item.issue}。建议：${item.suggestion}`));
    lines.push("");
    lines.push("## 下一步");
    analysis.nextActions.forEach((x) => lines.push(`- ${x}`));
    lines.push("");
  }
  if (sources.length) {
    lines.push("## 事实来源");
    sources.forEach((s) => lines.push(`- ${s.title}${s.url ? `：${s.url}` : ""}`));
  }
  return lines.join("\n");
}

function list(items: string[]) {
  return `<ul>${items.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>`;
}

function buildReportHtml(
  analysis: ArticleAnalysis | null,
  processReport: ProcessReport | null,
  strategy: HistoryItem["strategy"] | null,
  sources: Source[],
  standalone = false
) {
  const body = `
    <div class="moxie-report">
      <h1>墨写 · 创作过程报告</h1>
      ${
        strategy
          ? `<section>
              <h2>你的观点输入</h2>
              <dl>
                <dt>核心观点</dt><dd>${escapeHtml(strategy.viewpoint || "未记录")}</dd>
                <dt>真实观察 / 经验</dt><dd>${escapeHtml(strategy.experience || "未记录")}</dd>
                <dt>不确定的问题</dt><dd>${escapeHtml(strategy.uncertainty || "未记录")}</dd>
              </dl>
              ${strategy.probeQuestions?.length ? `<h3>AI 追问</h3>${list(strategy.probeQuestions)}` : ""}
              ${strategy.reflection ? `<h3>补充回答</h3><p>${escapeHtml(strategy.reflection)}</p>` : ""}
            </section>`
          : ""
      }
      ${
        analysis
          ? `<section>
              <h2>质量评估</h2>
              <p class="summary">${escapeHtml(analysis.summary)}</p>
              <div class="metrics">
                ${analysis.quality
                  .map(
                    (m) => `<div class="metric">
                      <b>${escapeHtml(m.label)} <span>${escapeHtml(String(m.score))}/5</span></b>
                      <p>${escapeHtml(m.verdict)}</p>
                      <em>${escapeHtml(m.suggestion)}</em>
                    </div>`
                  )
                  .join("")}
              </div>
            </section>
            <section>
              <h2>事实 / 推论 / 观点分层</h2>
              ${analysis.factOpinion
                .map(
                  (item) => `<div class="line-item">
                    <span>${escapeHtml(typeLabel[item.type] || item.type)}</span>
                    <span>${escapeHtml(supportLabel[item.support] || item.support)}</span>
                    <p>${escapeHtml(item.text)}</p>
                    <em>${escapeHtml(item.suggestion)}</em>
                  </div>`
                )
                .join("")}
            </section>
            <section>
              <h2>表达诊断</h2>
              ${analysis.expression.length ? analysis.expression.map((item) => `<p><b>${escapeHtml(item.issue)}</b>：${escapeHtml(item.text)}<br/><em>${escapeHtml(item.suggestion)}</em></p>`).join("") : "<p>暂无明显表达问题。</p>"}
            </section>
            <section>
              <h2>下一步修改</h2>
              ${list(analysis.nextActions)}
            </section>`
          : ""
      }
      ${
        processReport
          ? `<section>
              <h2>创作过程报告</h2>
              <h3>AI 做了什么</h3>${list(processReport.aiContributions)}
              <h3>人工决策点</h3>${list(processReport.decisionPoints)}
              <h3>发布前检查</h3>${list(processReport.reviewChecklist)}
            </section>`
          : ""
      }
      ${
        sources.length
          ? `<section>
              <h2>事实来源</h2>
              <ol>${sources
                .map((s) => `<li>${s.url ? `<a href="${escapeHtml(s.url)}">${escapeHtml(s.title || s.url)}</a>` : escapeHtml(s.title)}</li>`)
                .join("")}</ol>
            </section>`
          : ""
      }
    </div>
  `;
  const styles = `
    <style>
      body { margin: 0; background: #f5f4f0; color: #2d2d2d; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
      .moxie-report { max-width: 920px; margin: 0 auto; padding: 32px; line-height: 1.75; }
      h1 { font-size: 28px; margin: 0 0 22px; }
      h2 { font-size: 18px; margin: 24px 0 12px; padding-left: 10px; border-left: 4px solid #e8734a; }
      h3 { font-size: 15px; margin: 16px 0 8px; }
      section { background: #fff; border: 1px solid #e8e6e1; border-radius: 10px; padding: 18px; margin: 14px 0; }
      dl { display: grid; grid-template-columns: 120px 1fr; gap: 8px 12px; }
      dt { color: #e8734a; font-weight: 700; }
      dd { margin: 0; }
      ul, ol { padding-left: 22px; }
      .summary { font-weight: 600; }
      .metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
      .metric, .line-item { border: 1px solid #e8e6e1; border-radius: 8px; padding: 12px; background: #fcfbf9; }
      .metric b { display: flex; justify-content: space-between; gap: 12px; }
      .metric span, .line-item span { color: #e8734a; font-weight: 700; }
      .line-item span { display: inline-block; margin: 0 6px 8px 0; padding: 2px 8px; border-radius: 999px; background: rgba(232, 115, 74, 0.08); font-size: 12px; }
      em { color: #8a8a8a; font-style: normal; }
      a { color: #2563eb; }
    </style>
  `;
  return standalone
    ? `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/><title>墨写创作过程报告</title>${styles}</head><body>${body}</body></html>`
    : `${styles}${body}`;
}

function FullAnalysis({
  analysis,
  loading,
  processReport,
  strategy,
  sources,
}: Pick<Props, "analysis" | "loading" | "processReport" | "strategy" | "sources">) {
  const hasAnything = !!analysis || !!processReport || !!strategy;

  return (
    <div className="analysis-scroll">
      {!hasAnything && !loading && (
        <div className="analysis-empty">
          生成文章后，这里会展示质量评估、事实/观点分层、表达诊断和创作过程报告。
        </div>
      )}

      {loading && (
        <div className="analysis-loading">
          <span className="spinner" />
          <span>正在检查事实、逻辑和表达风险…</span>
        </div>
      )}

      {strategy && (
        <section className="analysis-section">
          <div className="analysis-title">你的观点输入</div>
          <div className="strategy-summary">
            <div><b>观点</b>{strategy.viewpoint || "未记录"}</div>
            <div><b>经验</b>{strategy.experience || "未记录"}</div>
            <div><b>疑问</b>{strategy.uncertainty || "未记录"}</div>
          </div>
        </section>
      )}

      {analysis && (
        <>
          <section className="analysis-section">
            <div className="analysis-title">质量评估</div>
            <p className="analysis-summary">{analysis.summary}</p>
            <div className="metric-grid">
              {analysis.quality.map((m) => (
                <div className="metric-card" key={m.key || m.label}>
                  <div className="metric-head">
                    <span>{m.label}</span>
                    <b>{m.score}/5</b>
                  </div>
                  <div className="metric-bar"><span style={{ width: scoreWidth(m.score) }} /></div>
                  <div className="metric-text">{m.verdict}</div>
                  <div className="metric-suggestion">{m.suggestion}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="analysis-section">
            <div className="analysis-title">事实 / 推论 / 观点分层</div>
            <div className="fact-list">
              {analysis.factOpinion.map((item, i) => (
                <div className="fact-item" key={`${item.text}-${i}`}>
                  <div className="fact-tags">
                    <span className={`tag ${item.type}`}>{typeLabel[item.type] || item.type}</span>
                    <span className={`tag ${item.support}`}>{supportLabel[item.support] || item.support}</span>
                  </div>
                  <div className="fact-text">{item.text}</div>
                  <div className="fact-note">{item.note}</div>
                  <div className="fact-suggestion">{item.suggestion}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="analysis-section">
            <div className="analysis-title">表达诊断</div>
            <div className="issue-list">
              {analysis.expression.map((item, i) => (
                <div className={`issue-item ${item.severity}`} key={`${item.text}-${i}`}>
                  <div className="issue-text">{item.text}</div>
                  <div className="issue-meta">{item.issue}</div>
                  <div className="issue-suggestion">{item.suggestion}</div>
                </div>
              ))}
              {analysis.expression.length === 0 && <div className="analysis-empty small">暂无明显表达问题。</div>}
            </div>
          </section>

          <section className="analysis-section">
            <div className="analysis-title">下一步修改</div>
            <ol className="action-list">
              {analysis.nextActions.map((x, i) => <li key={i}>{x}</li>)}
            </ol>
          </section>
        </>
      )}

      {processReport && (
        <section className="analysis-section">
          <div className="analysis-title">创作过程报告</div>
          <div className="report-grid">
            <div>
              <b>AI 做了什么</b>
              {processReport.aiContributions.map((x, i) => <span key={i}>{x}</span>)}
            </div>
            <div>
              <b>人工决策点</b>
              {processReport.decisionPoints.map((x, i) => <span key={i}>{x}</span>)}
            </div>
            <div>
              <b>发布前检查</b>
              {processReport.reviewChecklist.map((x, i) => <span key={i}>{x}</span>)}
            </div>
          </div>
        </section>
      )}

      {sources.length > 0 && (
        <section className="analysis-section">
          <div className="analysis-title">事实来源</div>
          <ol className="sources-list in-analysis">
            {sources.map((s, i) => (
              <li key={i} className={s.type === "error" ? "error" : ""}>
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noreferrer" title={s.url}>
                    {s.title || s.url}
                  </a>
                ) : (
                  <span>{s.title}</span>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

export default function AnalysisPanel({
  analysis,
  loading,
  processReport,
  strategy,
  sources,
  onAnalyze,
  onToast,
}: Props) {
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const hasAnything = !!analysis || !!processReport || !!strategy;
  const score = avgScore(analysis);
  const summary = loading
    ? "正在检查事实、逻辑和表达风险…"
    : analysis?.summary || (hasAnything ? "已记录观点和创作过程，可展开查看可信度细节。" : "生成文章后会显示可信度评估。");

  async function copyRichReport() {
    setMenuOpen(false);
    const text = buildReportText(analysis, processReport, strategy, sources);
    const html = buildReportHtml(analysis, processReport, strategy, sources);
    try {
      if (navigator.clipboard && "write" in navigator.clipboard && typeof ClipboardItem !== "undefined") {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([html], { type: "text/html" }),
            "text/plain": new Blob([text], { type: "text/plain" }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(text);
      }
      onToast("已复制富文本报告");
    } catch {
      try {
        await navigator.clipboard.writeText(text);
        onToast("已复制纯文本报告");
      } catch {
        onToast("复制失败，请手动选择");
      }
    }
  }

  function exportHtmlReport() {
    setMenuOpen(false);
    const html = buildReportHtml(analysis, processReport, strategy, sources, true);
    saveBlob(new Blob([html], { type: "text/html;charset=utf-8" }), safeName());
    onToast("已导出 HTML 报告");
  }

  function renderReportMenu() {
    return (
      <div className="report-menu-wrap">
        <button className="ghost-btn" onClick={() => setMenuOpen((v) => !v)} disabled={!hasAnything}>
          报告 ▾
        </button>
        {menuOpen && (
          <div className="report-menu" onMouseLeave={() => setMenuOpen(false)}>
            <button onClick={copyRichReport}>复制富文本</button>
            <button onClick={exportHtmlReport}>导出 HTML</button>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="panel analysis-panel compact">
        <div className="analysis-compact-main">
          <div className="analysis-compact-title">
            <span>可信度</span>
            {score && <b>{score}/5</b>}
            {loading && <span className="spinner" />}
          </div>
          <div className="analysis-compact-text">{summary}</div>
        </div>
        <div className="analysis-compact-actions">
          <button className="ghost-btn" onClick={() => setOpen(true)} disabled={!hasAnything && !loading}>
            展开
          </button>
          <button className="ghost-btn" onClick={onAnalyze} disabled={loading}>
            {loading ? "评估中…" : "重新评估"}
          </button>
          {renderReportMenu()}
        </div>
      </div>

      {open && (
        <div className="analysis-modal-mask" onClick={() => setOpen(false)}>
          <div className="analysis-modal" onClick={(e) => e.stopPropagation()}>
            <div className="analysis-modal-head">
              <div>
                <div className="analysis-modal-title">可信度</div>
                <div className="analysis-modal-sub">{score ? `综合评分 ${score}/5` : "质量评估与创作过程"}</div>
              </div>
              <div className="analysis-modal-actions">
                <button className="ghost-btn" onClick={onAnalyze} disabled={loading}>
                  {loading ? "评估中…" : "重新评估"}
                </button>
                {renderReportMenu()}
                <button className="ghost-btn" onClick={() => setOpen(false)}>关闭</button>
              </div>
            </div>
            <FullAnalysis
              analysis={analysis}
              loading={loading}
              processReport={processReport}
              strategy={strategy}
              sources={sources}
            />
          </div>
        </div>
      )}
    </>
  );
}
