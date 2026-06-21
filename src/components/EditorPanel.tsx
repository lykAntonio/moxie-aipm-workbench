import { useRef, useState } from "react";
import type { Block } from "../lib/types";
import { applyFormat, type FmtAction } from "../lib/format";
import { downloadImage } from "../lib/exporters";
import type { RewriteMode } from "../lib/api";

const REWRITE_OPTS: { mode: RewriteMode; label: string }[] = [
  { mode: "spoken", label: "更口语" },
  { mode: "concise", label: "更精炼" },
  { mode: "expand", label: "扩写" },
  { mode: "polish", label: "润色" },
  { mode: "humanize", label: "表达诊断改写" },
];

const FMT_BUTTONS: { action: FmtAction; label: string; title: string; cls?: string }[] = [
  { action: "h1", label: "H1", title: "标题 1" },
  { action: "h2", label: "H2", title: "标题 2" },
  { action: "h3", label: "H3", title: "标题 3" },
  { action: "p", label: "正文", title: "恢复为正文" },
  { action: "bold", label: "B", title: "加粗", cls: "b" },
  { action: "italic", label: "I", title: "斜体", cls: "i" },
  { action: "strike", label: "S", title: "删除线", cls: "s" },
  { action: "ul", label: "• 列表", title: "无序列表" },
  { action: "ol", label: "1. 列表", title: "有序列表" },
  { action: "quote", label: "❝ 引用", title: "引用" },
  { action: "link", label: "🔗 链接", title: "插入链接" },
  { action: "code", label: "</>", title: "行内代码" },
  { action: "hr", label: "— 分割线", title: "插入分割线" },
];

interface Props {
  blocks: Block[];
  illustrating: boolean;
  busyImgId: string | null;
  busyMdId: string | null;
  genProgress: { phase: string; text: string } | null;
  imgProgress: { done: number; total: number; phase: string } | null;
  pubProgress: { done: number; total: number; phase: string } | null;
  onCancel: () => void;
  onPublish: () => void;
  onShowIp: () => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onRemove: (id: string) => void;
  onEditMarkdown: (id: string, content: string) => void;
  onAddBelow: (id: string) => void;
  onSplit: (id: string, pos: number) => void;
  onRegen: (id: string) => void;
  onRewrite: (id: string, mode: RewriteMode) => void;
  onIllustrate: () => void;
  onCopy: () => void;
  onDownloadAll: () => void;
}

export default function EditorPanel({
  blocks,
  illustrating,
  busyImgId,
  busyMdId,
  genProgress,
  imgProgress,
  pubProgress,
  onCancel,
  onPublish,
  onShowIp,
  onMove,
  onRemove,
  onEditMarkdown,
  onAddBelow,
  onSplit,
  onRegen,
  onRewrite,
  onIllustrate,
  onCopy,
  onDownloadAll,
}: Props) {
  const cursor = useRef<Record<string, number>>({});
  const taRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const [rwMenu, setRwMenu] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const hasContent = blocks.length > 0;
  const hasImages = blocks.some((b) => b.type === "image" && b.url);

  function fmt(id: string, action: FmtAction) {
    const ta = taRefs.current[id];
    if (!ta) return;
    const r = applyFormat(ta.value, ta.selectionStart, ta.selectionEnd, action);
    onEditMarkdown(id, r.value);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(r.start, r.end);
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight, 420) + "px";
    });
  }
  const pendingImages = blocks.some((b) => b.type === "image" && b.status === "pending");

  return (
    <div className="panel editor-panel">
      <div className="panel-bar">
        <span className="panel-title">编辑 · Blocks</span>
        <div className="bar-actions">
          <button className="ghost-btn" onClick={onIllustrate} disabled={!hasContent || illustrating}>
            {illustrating ? "配图中…" : pendingImages ? "🎨 配图" : "🎨 重新配图"}
          </button>
          <button className="ghost-btn publish" onClick={onPublish} disabled={!hasContent || !!pubProgress}>
            {pubProgress ? "发布中…" : "📤 发布"}
          </button>
          <div className="more-wrap">
            <button
              className="ghost-btn"
              onClick={() => setMoreOpen((v) => !v)}
              disabled={!hasContent}
              title="更多操作"
            >
              ⋯
            </button>
            {moreOpen && (
              <div className="more-menu" onMouseLeave={() => setMoreOpen(false)}>
                <button
                  onClick={() => {
                    setMoreOpen(false);
                    onCopy();
                  }}
                >
                  ⧉ 复制 Markdown
                </button>
                <button
                  disabled={!hasImages}
                  onClick={() => {
                    setMoreOpen(false);
                    onDownloadAll();
                  }}
                >
                  ⬇ 下载全部图片
                </button>
                <button
                  onClick={() => {
                    setMoreOpen(false);
                    onShowIp();
                  }}
                >
                  🌐 查看公众号出口 IP
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="blocks-scroll">
        {genProgress && (
          <div className="progress-card">
            <div className="progress-head">
              <span className="spinner" />
              <span className="progress-phase">{genProgress.phase}</span>
              {genProgress.text && <span className="progress-count">{genProgress.text.length} 字</span>}
              <button className="stop-btn" onClick={onCancel} title="停止生成">
                ■ 停止
              </button>
            </div>
            <pre
              className="progress-stream"
              ref={(el) => {
                if (el) el.scrollTop = el.scrollHeight;
              }}
            >
              {genProgress.text || "正在与 DeepSeek 对话，构思中…"}
              <span className="caret">▍</span>
            </pre>
          </div>
        )}

        {imgProgress && (
          <div className="progress-card img">
            <div className="progress-head">
              <span className="spinner" />
              <span className="progress-phase">🎨 {imgProgress.phase}</span>
              <span className="progress-count">
                {imgProgress.done}/{imgProgress.total}
              </span>
              <button className="stop-btn" onClick={onCancel} title="停止配图">
                ■ 停止
              </button>
            </div>
            <div className="progress-bar">
              <div
                className="progress-bar-fill"
                style={{ width: `${(imgProgress.done / imgProgress.total) * 100}%` }}
              />
            </div>
            <div className="progress-dots">
              {Array.from({ length: imgProgress.total }).map((_, i) => (
                <span
                  key={i}
                  className={"dot" + (i < imgProgress.done ? " done" : i === imgProgress.done ? " active" : "")}
                >
                  {i < imgProgress.done ? "✓" : i + 1}
                </span>
              ))}
            </div>
          </div>
        )}

        {pubProgress && (
          <div className="progress-card img">
            <div className="progress-head">
              <span className="spinner" />
              <span className="progress-phase">📤 {pubProgress.phase}</span>
              <span className="progress-count">
                {pubProgress.done}/{pubProgress.total}
              </span>
            </div>
            <div className="progress-bar">
              <div
                className="progress-bar-fill"
                style={{ width: `${(pubProgress.done / Math.max(1, pubProgress.total)) * 100}%` }}
              />
            </div>
          </div>
        )}

        {!hasContent && !genProgress && (
          <div className="empty">
            <div className="empty-icon">✎</div>
            <div className="empty-title">还没有内容</div>
            <div className="empty-desc">在左侧先写观点和经验，再生成可信文章</div>
          </div>
        )}

        {blocks.map((b, i) => (
          <div key={b.id} className={"block-card " + b.type}>
            {b.type === "markdown" ? (
              <>
                <div className="block-tag-row">
                  <div className="block-tag">MD · 可编辑</div>
                  <div className="rw-wrap">
                    <button
                      className="rw-btn"
                      disabled={busyMdId === b.id || !b.content.trim()}
                      onClick={() => setRwMenu(rwMenu === b.id ? null : b.id)}
                    >
                      {busyMdId === b.id ? "改写中…" : "✨ AI 改写"}
                    </button>
                    {rwMenu === b.id && (
                      <div className="rw-menu" onMouseLeave={() => setRwMenu(null)}>
                        {REWRITE_OPTS.map((o) => (
                          <button
                            key={o.mode}
                            onClick={() => {
                              setRwMenu(null);
                              onRewrite(b.id, o.mode);
                            }}
                          >
                            {o.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="fmt-toolbar">
                  {FMT_BUTTONS.map((btn) => (
                    <button
                      key={btn.action}
                      className={"fmt-btn" + (btn.cls ? " " + btn.cls : "")}
                      title={btn.title}
                      onMouseDown={(e) => e.preventDefault() /* 保持选区不丢失 */}
                      onClick={() => fmt(b.id, btn.action)}
                    >
                      {btn.label}
                    </button>
                  ))}
                </div>
                <textarea
                  className="md-edit"
                  value={b.content}
                  spellCheck={false}
                  onChange={(e) => onEditMarkdown(b.id, e.target.value)}
                  onSelect={(e) => (cursor.current[b.id] = e.currentTarget.selectionStart)}
                  onKeyUp={(e) => (cursor.current[b.id] = e.currentTarget.selectionStart)}
                  onClick={(e) => (cursor.current[b.id] = e.currentTarget.selectionStart)}
                  onInput={(e) => {
                    const t = e.currentTarget;
                    t.style.height = "auto";
                    t.style.height = Math.min(t.scrollHeight, 420) + "px";
                  }}
                  ref={(el) => {
                    taRefs.current[b.id] = el;
                    if (el) {
                      el.style.height = "auto";
                      el.style.height = Math.min(el.scrollHeight, 420) + "px";
                    }
                  }}
                />
                <div className="block-toolbar">
                  <button
                    className="mini-btn wide"
                    onClick={() => onSplit(b.id, cursor.current[b.id] ?? b.content.length)}
                    title="在光标处把本块拆成两块"
                  >
                    ✂ 从光标拆分
                  </button>
                  <button className="mini-btn wide" onClick={() => onAddBelow(b.id)} title="在下方插入新文字块">
                    ＋ 下方加块
                  </button>
                  <button className="mini-btn" onClick={() => onMove(b.id, -1)} disabled={i === 0} title="上移">
                    ↑
                  </button>
                  <button
                    className="mini-btn"
                    onClick={() => onMove(b.id, 1)}
                    disabled={i === blocks.length - 1}
                    title="下移"
                  >
                    ↓
                  </button>
                  <button className="mini-btn danger" onClick={() => onRemove(b.id)} title="删除此块">
                    ✕
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="block-tag img">图 · {b.position}</div>
                <div className="img-block-body">
                  {b.url && busyImgId !== b.id ? (
                    <img
                      className="thumb"
                      src={b.url}
                      alt={b.caption}
                      onError={(e) => {
                        const el = e.currentTarget;
                        el.style.display = "none";
                        const ph = el.nextElementSibling as HTMLElement | null;
                        if (ph) ph.style.display = "flex";
                      }}
                    />
                  ) : null}
                  {b.url && busyImgId !== b.id && (
                    <div className="thumb placeholder missing" style={{ display: "none" }}>
                      图片缺失
                    </div>
                  )}
                  {!(b.url && busyImgId !== b.id) && (
                    <div className={"thumb placeholder" + (illustrating || busyImgId === b.id ? " loading" : "")}>
                      {illustrating || busyImgId === b.id ? "生成中…" : "待生成"}
                    </div>
                  )}
                  <div className="img-meta">
                    <div className="img-scene">{b.scene || "（无场景描述）"}</div>
                    <div className="img-actions">
                      <button
                        className="mini-btn wide"
                        onClick={() => onRegen(b.id)}
                        disabled={illustrating || busyImgId === b.id || !b.scene}
                        title="只重新生成这一张图"
                      >
                        ⟳ 重新生成
                      </button>
                      <button
                        className="mini-btn"
                        onClick={() => downloadImage(b.url, `${b.position || "图"}.png`)}
                        disabled={!b.url}
                        title="下载这张图"
                      >
                        ⬇
                      </button>
                      <button className="mini-btn" onClick={() => onMove(b.id, -1)} disabled={i === 0} title="上移">
                        ↑
                      </button>
                      <button
                        className="mini-btn"
                        onClick={() => onMove(b.id, 1)}
                        disabled={i === blocks.length - 1}
                        title="下移"
                      >
                        ↓
                      </button>
                      <button className="mini-btn danger" onClick={() => onRemove(b.id)} title="删除图片">
                        ✕
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
