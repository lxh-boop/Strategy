import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { logRootDir } from './file-console.logger';

/* ==========================================================
   会话级日志：智能体每轮图执行的完整节点轨迹按会话落盘。

     文件位置：logs/conversations/<会话id>.log（目录见 logRootDir）
     行格式： [HH:mm:ss] 正文；同一会话多轮提问追加续写，"提问:" 行天然分隔各轮

   与全局 logs/app-YYYY-MM-DD.log 并存：全局文件看运维全貌，
   会话文件看单次对话的完整链路（提问 → 工具调用 → 读数形状 → 回复）。
   写失败静默放弃（与 FileConsoleLogger 同一原则：日志不打断业务）。
   ========================================================== */

const conversationDir = join(logRootDir(), 'conversations');
mkdirSync(conversationDir, { recursive: true });

/** 会话 id → 安全文件名：只保留字母数字-_，其余替换为 _，防路径拼接意外 */
function safeFileName(conversationId: string): string {
  return conversationId.replace(/[^A-Za-z0-9_-]/g, '_');
}

/** 向会话文件追加一行（自带 HH:mm:ss 时间前缀） */
export function appendConversationLog(conversationId: string, text: string): void {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const time = `${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;
  try {
    appendFileSync(join(conversationDir, `${safeFileName(conversationId)}.log`), `[${time}] ${text}\n`);
  } catch {
    // 磁盘满/权限等写不进去就算了
  }
}
