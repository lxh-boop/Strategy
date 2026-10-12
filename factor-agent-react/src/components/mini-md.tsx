import type { ReactNode } from "react";

/* ----- 轻量 Markdown 渲染（受限子集，零依赖） -----
   智能体回复固定产出这个子集：**粗体** / `行内代码` / - 无序列表 / 1. 有序列表 /
   ### 小标题 / GFM 表格。直接映射为 React 元素（不走 dangerouslySetInnerHTML），天然免疫注入。 */

/** 行内：**粗体** `code` *斜体* */
function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*)/g;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const token = m[0];
    if (token.startsWith("**")) parts.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith("`")) parts.push(<code key={key++}>{token.slice(1, -1)}</code>);
    else parts.push(<em key={key++}>{token.slice(1, -1)}</em>);
    last = m.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_DIVIDER = /^\s*\|[\s:|-]+\|\s*$/;
const UL_ITEM = /^\s*[-*]\s+/;
const OL_ITEM = /^\s*\d+[.、]\s+/;
const HEADING = /^#{1,4}\s+(.*)$/;
const BLOCK_START = /^\s*([-*]\s+|\d+[.、]\s+|#{1,4}\s+|\|)/;

export function MiniMarkdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    // GFM 表格：表头行 + 分隔行 + 数据行
    if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_DIVIDER.test(lines[i + 1])) {
      const header = line.split("|").slice(1, -1).map((s) => s.trim());
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && TABLE_ROW.test(lines[i])) {
        rows.push(lines[i].split("|").slice(1, -1).map((s) => s.trim()));
        i++;
      }
      blocks.push(
        <div className="md-table-wrap" key={key++}>
          <table className="md-table">
            <thead><tr>{header.map((h, k) => <th key={k}>{inline(h)}</th>)}</tr></thead>
            <tbody>
              {rows.map((r, k) => (
                <tr key={k}>{r.map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // 无序 / 有序列表
    if (UL_ITEM.test(line) || OL_ITEM.test(line)) {
      const ordered = OL_ITEM.test(line);
      const items: string[] = [];
      const pattern = ordered ? OL_ITEM : UL_ITEM;
      while (i < lines.length && pattern.test(lines[i])) {
        items.push(lines[i].replace(pattern, ""));
        i++;
      }
      const ListTag = ordered ? "ol" : "ul";
      blocks.push(
        <ListTag key={key++}>{items.map((it, k) => <li key={k}>{inline(it)}</li>)}</ListTag>,
      );
      continue;
    }

    // 小标题
    const heading = line.match(HEADING);
    if (heading) {
      blocks.push(<div className="md-heading" key={key++}>{inline(heading[1])}</div>);
      i++;
      continue;
    }

    // 段落：连续普通行合并（保留换行）
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !BLOCK_START.test(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(<p key={key++}>{inline(para.join("\n"))}</p>);
  }

  return <div className="mini-md">{blocks}</div>;
}
