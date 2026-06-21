import { useState } from "react";
import type { HistoryItem, Source } from "../lib/types";

interface Props {
  items: HistoryItem[];
  activeId: string | null;
  sources: Source[];
  onRestore: (item: HistoryItem) => void;
  onDelete: (id: string) => void;
  onCleanup: () => void;
}

const PLATFORM_LABEL: Record<string, string> = { wechat: "公众号", woshipm: "人人都是PM" };

function ago(ts: number): string {
  const d = (Date.now() - ts) / 1000;
  if (d < 60) return "刚刚";
  if (d < 3600) return Math.floor(d / 60) + " 分钟前";
  if (d < 86400) return Math.floor(d / 3600) + " 小时前";
  const x = new Date(ts);
  return `${x.getMonth() + 1}/${x.getDate()}`;
}

export default function HistoryPanel({ items, activeId, sources, onRestore, onDelete, onCleanup }: Props) {
  const [tab, setTab] = useState<"history" | "sources">("history");
  const sourceCount = sources.filter((s) => s.type !== "error").length;

  return (
    <div className="history">
      <div className="library-tabs">
        <button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>
          历史记录 <span>{items.length}</span>
        </button>
        <button className={tab === "sources" ? "active" : ""} onClick={() => setTab("sources")}>
          事实来源 <span>{sourceCount}</span>
        </button>
      </div>

      {tab === "history" ? (
        <>
          <div className="history-head">
            历史文章
            <button className="cleanup-btn" onClick={onCleanup} title="删除服务器上未被任何记录引用的配图文件">
              清理无用图
            </button>
          </div>
          {items.length === 0 && <div className="history-empty">暂无历史，生成后自动保存</div>}
          <div className="history-list">
            {items.map((it) => (
              <div
                key={it.id}
                className={"history-item" + (activeId === it.id ? " active" : "")}
                onClick={() => onRestore(it)}
              >
                <div className="history-main">
                  <div className="history-title">{it.title || "（无标题）"}</div>
                  <div className="history-meta">
                    <span className="tag">{PLATFORM_LABEL[it.platform] || it.platform}</span>
                    <span>{it.wordCount}字 · {it.imageCount}图</span>
                    <span>{ago(it.createdAt)}</span>
                  </div>
                </div>
                <button
                  className="history-del"
                  title="删除"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(it.id);
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="history-head">
            本文事实来源 <span className="count">{sourceCount}</span>
          </div>
          <div className="sources-note">
            撰稿前实际抓取/检索到的资料，点链接可自行核对真伪。
          </div>
          {sources.length === 0 ? (
            <div className="history-empty">暂无来源。填写参考链接或开启联网检索后会显示在这里。</div>
          ) : (
            <ol className="sources-list">
              {sources.map((s, i) => (
                <li key={i} className={s.type === "error" ? "error" : ""}>
                  <span className="source-icon">
                    {s.type === "search" ? "🌐" : s.type === "link" ? "🔗" : s.type === "note" ? "📝" : "⚠️"}
                  </span>
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
          )}
        </>
      )}
    </div>
  );
}
