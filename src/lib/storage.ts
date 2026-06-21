import type { HistoryItem } from "./types";

const KEY = "moxie_history_v1";

export function loadHistory(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as HistoryItem[]) : [];
  } catch {
    return [];
  }
}

export function saveHistory(items: HistoryItem[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(items.slice(0, 50)));
  } catch {
    /* 忽略配额错误 */
  }
}

export function upsertHistory(item: HistoryItem): HistoryItem[] {
  const list = loadHistory();
  const idx = list.findIndex((h) => h.id === item.id);
  if (idx >= 0) list[idx] = item;
  else list.unshift(item);
  saveHistory(list);
  return list;
}

export function deleteHistory(id: string): HistoryItem[] {
  const list = loadHistory().filter((h) => h.id !== id);
  saveHistory(list);
  return list;
}
