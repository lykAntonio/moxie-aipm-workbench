import type { Block, ImageScene } from "./types";

export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

// 统计中文为主的字数（去掉 markdown 符号与空白）
export function countWords(blocks: Block[]): number {
  const text = blocks
    .filter((b): b is Extract<Block, { type: "markdown" }> => b.type === "markdown")
    .map((b) => b.content)
    .join("\n")
    .replace(/[#>*`\-\|!\[\]()]/g, "")
    .replace(/\s+/g, "");
  return text.length;
}

export function countImages(blocks: Block[]): number {
  return blocks.filter((b) => b.type === "image").length;
}

/**
 * 把整篇 markdown 按段落切成 3 段（约 30%/30%/40%），
 * 并在每段之后插入一个 image 占位 block（对应 开头/中间/结尾 三张图）。
 */
export function buildBlocks(article: string, scenes: ImageScene[]): Block[] {
  const paras = article
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (paras.length === 0) {
    return [{ id: uid(), type: "markdown", content: article }];
  }

  const lens = paras.map((p) => p.length);
  const total = lens.reduce((a, b) => a + b, 0);

  // 找到累计长度首次越过 30% 和 60% 的段落下标作为切点
  const cut: number[] = [];
  const targets = [0.3, 0.6];
  let acc = 0;
  let ti = 0;
  for (let i = 0; i < paras.length && ti < targets.length; i++) {
    acc += lens[i];
    if (acc / total >= targets[ti]) {
      cut.push(i + 1); // 在第 i 段之后切
      ti++;
    }
  }
  // 兜底切点
  while (cut.length < 2) {
    cut.push(Math.min(paras.length, Math.round((paras.length * (cut.length + 1)) / 3)));
  }

  const seg1 = paras.slice(0, cut[0]).join("\n\n");
  const seg2 = paras.slice(cut[0], cut[1]).join("\n\n");
  const seg3 = paras.slice(cut[1]).join("\n\n");

  const mkImg = (s: ImageScene | undefined, pos: string): Block => ({
    id: uid(),
    type: "image",
    url: "",
    caption: s?.scene?.slice(0, 24) || pos,
    scene: s?.scene || "",
    position: pos,
    status: "pending",
  });

  const blocks: Block[] = [];
  if (seg1) blocks.push({ id: uid(), type: "markdown", content: seg1 });
  blocks.push(mkImg(scenes[0], "开头"));
  if (seg2) blocks.push({ id: uid(), type: "markdown", content: seg2 });
  blocks.push(mkImg(scenes[1], "中间"));
  if (seg3) blocks.push({ id: uid(), type: "markdown", content: seg3 });
  blocks.push(mkImg(scenes[2], "结尾"));
  return blocks;
}

// 组装最终 Markdown（图片用 ![caption](url)）
export function blocksToMarkdown(blocks: Block[], title?: string): string {
  const parts: string[] = [];
  if (title) parts.push(`# ${title}\n`);
  for (const b of blocks) {
    if (b.type === "markdown") {
      parts.push(b.content);
    } else if (b.type === "image" && b.url) {
      parts.push(`![](${b.url})`);
    }
  }
  return parts.join("\n\n");
}

// 移动 block（上移/下移）
export function moveBlock(blocks: Block[], id: string, dir: -1 | 1): Block[] {
  const i = blocks.findIndex((b) => b.id === id);
  if (i < 0) return blocks;
  const j = i + dir;
  if (j < 0 || j >= blocks.length) return blocks;
  const next = blocks.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

export function removeBlock(blocks: Block[], id: string): Block[] {
  return blocks.filter((b) => b.id !== id);
}
