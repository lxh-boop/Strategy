import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

/* ----- 智能体回复 Markdown 渲染（react-markdown + remark-gfm） -----
   覆盖完整 GFM：粗体/斜体/行内代码/嵌套列表/引用块/删除线/表格/任务列表。
   react-markdown 以 React 元素输出，不走 dangerouslySetInnerHTML，免疫脚本注入；
   默认不渲染原始 HTML（模型输出里的 <tag> 按文本展示）。 */
export function MiniMarkdown({ text }: { text: string }) {
  return (
    <div className="mini-md">
      <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>
    </div>
  );
}
