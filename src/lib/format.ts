// 对 textarea 选区应用「富文本」格式，底层产出 Markdown。
// 纯函数：输入当前文本与选区，返回新文本与新选区，便于复用与测试。

export type FmtAction =
  | "bold"
  | "italic"
  | "strike"
  | "code"
  | "h1"
  | "h2"
  | "h3"
  | "p"
  | "ul"
  | "ol"
  | "quote"
  | "link"
  | "hr";

export interface FmtResult {
  value: string;
  start: number;
  end: number;
}

// 行内包裹：加粗/斜体/删除线/行内代码
function wrap(value: string, start: number, end: number, mark: string, placeholder: string): FmtResult {
  const selected = value.slice(start, end);
  const inner = selected || placeholder;
  // 若已被同样的标记包裹，则取消（toggle）
  const before = value.slice(Math.max(0, start - mark.length), start);
  const after = value.slice(end, end + mark.length);
  if (selected && before === mark && after === mark) {
    const value2 = value.slice(0, start - mark.length) + selected + value.slice(end + mark.length);
    return { value: value2, start: start - mark.length, end: end - mark.length };
  }
  const value2 = value.slice(0, start) + mark + inner + mark + value.slice(end);
  return { value: value2, start: start + mark.length, end: start + mark.length + inner.length };
}

// 按行处理：标题/列表/引用
function lineOp(value: string, start: number, end: number, fn: (lines: string[]) => string[]): FmtResult {
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  let lineEnd = value.indexOf("\n", end);
  if (lineEnd < 0) lineEnd = value.length;
  const block = value.slice(lineStart, lineEnd);
  const newBlock = fn(block.split("\n")).join("\n");
  const value2 = value.slice(0, lineStart) + newBlock + value.slice(lineEnd);
  return { value: value2, start: lineStart, end: lineStart + newBlock.length };
}

const stripHeading = (l: string) => l.replace(/^#{1,6}\s+/, "");
const stripList = (l: string) => l.replace(/^(\s*([-*+]|\d+\.)\s+)/, "");
const stripQuote = (l: string) => l.replace(/^>\s?/, "");

export function applyFormat(value: string, start: number, end: number, action: FmtAction): FmtResult {
  switch (action) {
    case "bold":
      return wrap(value, start, end, "**", "加粗文字");
    case "italic":
      return wrap(value, start, end, "*", "斜体文字");
    case "strike":
      return wrap(value, start, end, "~~", "删除线");
    case "code":
      return wrap(value, start, end, "`", "代码");

    case "h1":
    case "h2":
    case "h3": {
      const prefix = { h1: "# ", h2: "## ", h3: "### " }[action];
      return lineOp(value, start, end, (lines) => lines.map((l) => prefix + stripHeading(stripQuote(l))));
    }
    case "p":
      return lineOp(value, start, end, (lines) => lines.map((l) => stripHeading(stripQuote(l))));

    case "ul":
      return lineOp(value, start, end, (lines) => {
        const allMarked = lines.every((l) => /^\s*[-*+]\s+/.test(l) || l.trim() === "");
        return lines.map((l) => (l.trim() === "" ? l : allMarked ? stripList(l) : "- " + stripList(l)));
      });
    case "ol":
      return lineOp(value, start, end, (lines) => {
        const allMarked = lines.every((l) => /^\s*\d+\.\s+/.test(l) || l.trim() === "");
        let n = 0;
        return lines.map((l) => {
          if (l.trim() === "") return l;
          if (allMarked) return stripList(l);
          n++;
          return `${n}. ` + stripList(l);
        });
      });
    case "quote":
      return lineOp(value, start, end, (lines) => {
        const allMarked = lines.every((l) => /^>\s?/.test(l) || l.trim() === "");
        return lines.map((l) => (l.trim() === "" ? l : allMarked ? stripQuote(l) : "> " + l));
      });

    case "link": {
      const selected = value.slice(start, end) || "链接文字";
      const ins = `[${selected}](https://)`;
      const value2 = value.slice(0, start) + ins + value.slice(end);
      // 选中 url 占位，方便直接粘贴链接
      const urlStart = start + selected.length + 3; // [ + text + ](
      return { value: value2, start: urlStart, end: urlStart + "https://".length };
    }
    case "hr": {
      const ins = "\n\n---\n\n";
      const value2 = value.slice(0, start) + ins + value.slice(end);
      const pos = start + ins.length;
      return { value: value2, start: pos, end: pos };
    }
    default:
      return { value, start, end };
  }
}
