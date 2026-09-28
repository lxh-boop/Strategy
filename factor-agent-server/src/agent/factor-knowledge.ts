import { readFileSync, statSync } from 'fs';
import * as path from 'path';
import { Logger } from '@nestjs/common';

/** 因子知识库文档路径：<项目根>/docs/factors.md（dist/agent 编译产物向上两级） */
const DOC_PATH = path.resolve(__dirname, '..', '..', 'docs', 'factors.md');

/** 文档缺失/不可读时的内置兜底：保证模型至少拿到合法的因子短名 */
const FALLBACK = [
  '可用因子短名（必须使用这些短名）：价值 / 成长 / 动量 / 质量 / 低波动 / 股息率 / 流动性 / 小市值 / 情绪。',
  '风格参考：进攻型=动量+小市值为主；防御型=股息率+低波动为主；均衡型=成长+质量+动量。',
].join('\n');

let cache: { mtimeMs: number; content: string } | null = null;
let warned = false;
const logger = new Logger('FactorKnowledge');

/**
 * 读取因子知识库 markdown（docs/factors.md）。
 * 按 mtime 缓存：编辑文档保存后下一次请求即生效，无需重启服务。
 * 文档缺失时不阻塞服务：返回内置兜底清单并告警一次。
 */
export function loadFactorKnowledge(): string {
  try {
    const mtimeMs = statSync(DOC_PATH).mtimeMs;
    if (!cache || cache.mtimeMs !== mtimeMs) {
      cache = { mtimeMs, content: readFileSync(DOC_PATH, 'utf-8') };
      warned = false;
    }
    return cache.content;
  } catch (error) {
    if (!warned) {
      warned = true;
      logger.warn(`因子知识库不可读（${(error as Error).message.slice(0, 120)}），使用内置兜底清单: ${DOC_PATH}`);
    }
    return FALLBACK;
  }
}
