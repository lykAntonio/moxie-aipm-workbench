import html2canvas from "html2canvas";
import type { Block } from "./types";
import { blocksToMarkdown } from "./blocks";

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

const safeName = (s: string) => (s || "墨写文章").replace(/[\\/:*?"<>|\n]/g, "_").slice(0, 50);

// 导出 .md 文件
export function downloadMarkdown(blocks: Block[], title: string) {
  const md = blocksToMarkdown(blocks, title);
  saveBlob(new Blob([md], { type: "text/markdown;charset=utf-8" }), `${safeName(title)}.md`);
}

// 图片 URL → dataURL（用于富文本粘贴，让图片随文带走）
async function toDataURL(url: string): Promise<string> {
  const res = await fetch(url);
  const blob = await res.blob();
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onloadend = () => resolve(r.result as string);
    r.readAsDataURL(blob);
  });
}

// 复制富文本（可直接粘贴到公众号 / Word），图片内联为 dataURL
export async function copyRich(articleEl: HTMLElement, blocks: Block[], title: string) {
  const clone = articleEl.cloneNode(true) as HTMLElement;
  const imgs = Array.from(clone.querySelectorAll("img"));
  await Promise.all(
    imgs.map(async (img) => {
      try {
        img.src = await toDataURL(img.src);
        img.removeAttribute("loading");
      } catch {
        /* 单图失败不阻断 */
      }
    })
  );
  const html = `<div>${clone.innerHTML}</div>`;
  const plain = blocksToMarkdown(blocks, title);
  if (navigator.clipboard && "write" in navigator.clipboard && typeof ClipboardItem !== "undefined") {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([plain], { type: "text/plain" }),
      }),
    ]);
  } else {
    await navigator.clipboard.writeText(plain);
  }
}

// 导出整篇为长图 PNG
export async function exportLongImage(articleEl: HTMLElement, title: string) {
  const dark = document.documentElement.dataset.theme === "dark";
  const canvas = await html2canvas(articleEl, {
    backgroundColor: dark ? "#16161b" : "#ffffff",
    scale: 2,
    useCORS: true,
    logging: false,
  });
  await new Promise<void>((resolve) =>
    canvas.toBlob((blob) => {
      if (blob) saveBlob(blob, `${safeName(title)}.png`);
      resolve();
    }, "image/png")
  );
}

// 下载单张图片
export async function downloadImage(url: string, name: string) {
  const res = await fetch(url);
  const blob = await res.blob();
  saveBlob(blob, name);
}

// 下载全部图片
export async function downloadAllImages(blocks: Block[], title: string) {
  const imgs = blocks.filter((b) => b.type === "image" && b.url) as Extract<Block, { type: "image" }>[];
  let i = 0;
  for (const b of imgs) {
    i++;
    await downloadImage(b.url, `${safeName(title)}-${String(i).padStart(2, "0")}-${b.position || ""}.png`);
    await new Promise((r) => setTimeout(r, 250)); // 间隔，避免浏览器拦截批量下载
  }
  return imgs.length;
}
