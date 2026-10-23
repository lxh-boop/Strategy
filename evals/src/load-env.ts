import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * 装载 server 的 .env（ZHIPU_API_KEY / ZHIPU_MODEL / ZHIPU_BASE_URL）到 process.env。
 * 只在未设置时填充（外部显式设置的优先）；值保留 #（与 dotenv 对引号外 # 的注释语义不同——
 * 本仓库曾踩过密码含 # 的坑，这里宁可原样保留）。
 */
export function loadServerEnv(): void {
  const envPath = path.resolve(__dirname, '..', '..', 'factor-agent-server', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
}
