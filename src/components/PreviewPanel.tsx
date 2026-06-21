import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Block } from "../lib/types";
import { copyRich, downloadMarkdown, exportLongImage } from "../lib/exporters";

interface Props {
  title: string;
  blocks: Block[];
  wordCount: number;
  imageCount: number;
  createdAt: number | null;
  onToast: (msg: string) => void;
}

function fmtTime(ts: number | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(
    d.getHours()
  ).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

type View = "desktop" | "mobile";

export default function PreviewPanel({ title, blocks, wordCount, imageCount, createdAt, onToast }: Props) {
  const hasContent = blocks.length > 0;
  const [view, setView] = useState<View>("desktop");
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [broken, setBroken] = useState<Set<string>>(new Set());
  const articleRef = useRef<HTMLElement>(null);

  async function doExport(kind: "rich" | "md" | "image") {
    setMenuOpen(false);
    const el = articleRef.current;
    if (!el && kind !== "md") return;
    setBusy(true);
    try {
      if (kind === "md") {
        downloadMarkdown(blocks, title);
        onToast("已导出 Markdown 文件");
      } else if (kind === "rich") {
        await copyRich(el!, blocks, title);
        onToast("已复制富文本，可直接粘贴到公众号 / Word");
      } else {
        await exportLongImage(el!, title);
        onToast("已导出长图 PNG");
      }
    } catch (e: any) {
      onToast("导出失败：" + (e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  const articleBody = (
    <article className="wx-article" ref={articleRef}>
      {title && <h1 className="wx-title">{title}</h1>}
      {blocks.map((b) =>
        b.type === "markdown" ? (
          <ReactMarkdown key={b.id} remarkPlugins={[remarkGfm]}>
            {b.content}
          </ReactMarkdown>
        ) : b.url ? (
          <figure key={b.id} className="wx-figure">
            {broken.has(b.id) ? (
              <div className="img-missing">🖼️ 图片缺失（文件已不存在，可在中间区「重新生成」）</div>
            ) : (
              <img
                src={b.url}
                alt={b.caption}
                onError={() => setBroken((s) => new Set(s).add(b.id))}
              />
            )}
          </figure>
        ) : null
      )}
    </article>
  );

  return (
    <div className="panel preview-panel">
      <div className="panel-bar">
        <span className="panel-title">预览 · 阅读效果</span>
        <div className="bar-right">
          {hasContent && (
            <div className="export-wrap">
              <button className="ghost-btn" disabled={busy} onClick={() => setMenuOpen((v) => !v)}>
                {busy ? "处理中…" : "⤓ 导出 ▾"}
              </button>
              {menuOpen && (
                <div className="export-menu" onMouseLeave={() => setMenuOpen(false)}>
                  <button onClick={() => doExport("rich")}>📋 复制富文本（粘到公众号）</button>
                  <button onClick={() => doExport("image")}>🖼 导出长图 PNG</button>
                  <button onClick={() => doExport("md")}>📄 导出 Markdown 文件</button>
                </div>
              )}
            </div>
          )}
          <div className="view-switch">
            <button className={"seg" + (view === "desktop" ? " on" : "")} onClick={() => setView("desktop")}>
              🖥 桌面
            </button>
            <button className={"seg" + (view === "mobile" ? " on" : "")} onClick={() => setView("mobile")}>
              📱 手机
            </button>
          </div>
        </div>
      </div>

      <div className="preview-substat">
        <span>📝 {wordCount} 字</span>
        <span>🎨 {imageCount} 图</span>
        <span>🕒 {fmtTime(createdAt)}</span>
      </div>

      {!hasContent ? (
        <div className="preview-scroll">
          <div className="empty">
            <div className="empty-icon">📰</div>
            <div className="empty-title">预览区</div>
            <div className="empty-desc">生成文章后这里显示阅读效果，可切换桌面 / 手机视图</div>
          </div>
        </div>
      ) : view === "desktop" ? (
        <div className="preview-scroll">{articleBody}</div>
      ) : (
        <div className="preview-scroll mobile-stage">
          <div className="phone-frame">
            <div className="phone-notch" />
            <div className="phone-screen wx-mobile">{articleBody}</div>
            <div className="phone-bar" />
          </div>
        </div>
      )}
    </div>
  );
}
