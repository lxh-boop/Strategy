import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { logRootDir } from './file-console.logger';

/* ==========================================================
   前端日志落盘：浏览器端错误经 POST /api/client-logs 上报到这里，
   与后端日志分开存放（前后端日志分文件夹）。

     文件位置：logs/frontend/YYYY-MM-DD.log（目录见 logRootDir）
     行格式： [YYYY-MM-DD HH:mm:ss] [级别] 正文 @ 页面路径 | detail JSON

   与后端 logs/backend/YYYY-MM-DD.log、会话 logs/conversations/<id>.log 并存：
   排查"发送失败"类问题时先看 frontend 文件（前端报了什么、哪个接口、什么状态），
   再看 backend 文件（后端收没收到、卡在哪一步）。
   写失败静默放弃（与 FileConsoleLogger 同一原则：日志不打断业务）。
   ========================================================== */

const frontendDir = join(logRootDir(), 'frontend');
mkdirSync(frontendDir, { recursive: true });

export interface ClientLogEntry {
  level?: unknown;
  message?: unknown;
  detail?: unknown;
  page?: unknown;
}

/** 一条前端日志一行追加；字段做长度截断与形态兜底，落盘失败只放弃该条 */
export function appendClientLog(entry: ClientLogEntry): void {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const day = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  const time = `${day} ${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;

  const level = typeof entry.level === 'string' && entry.level.trim()
    ? entry.level.trim().toUpperCase().slice(0, 8)
    : 'INFO';
  const message = String(entry.message ?? '').replace(/\s+/g, ' ').trim().slice(0, 2000);
  const page = typeof entry.page === 'string' ? entry.page.slice(0, 200) : '';
  let detail = '';
  if (entry.detail !== undefined && entry.detail !== null) {
    try {
      detail = JSON.stringify(entry.detail) ?? '';
    } catch {
      detail = String(entry.detail);
    }
    detail = detail.slice(0, 4000);
  }

  const line =
    `[${time}] [${level}] ${message || '（空消息）'}` +
    (page ? ` @ ${page}` : '') +
    (detail ? ` | ${detail}` : '');
  try {
    appendFileSync(join(frontendDir, `${day}.log`), line + '\n');
  } catch {
    // 磁盘满/权限等写不进去就算了
  }
}
