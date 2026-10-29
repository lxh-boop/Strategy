import { Injectable } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ConversationSummary, MemoryEntry, MemoryQueue, MemoryStoreService, memoryStamp } from '../memory-store.service';
import { todayStr } from '../../common/time';

/* ==========================================================
   长期记忆队列文件实现（ADR-0013，唯一实现）：
   <root>/<userId>/memory.md —— frontmatter(summary/foldedCount/updated) + 条目块：
     ## [YYYY-MM-DD HH:MM] 标题
     内容一到两句……
   追加 = 尾部插块；折叠 = 重写文件（新 summary + 剩余条目）；
   旧 <slug>.md 条目文件（ADR-0007 格式）首次读取时一次性迁移导入队尾后清除。
   读写全部同步 fs；解析只认自家写入格式 + 容忍人手微调，坏块跳过不炸。
   ========================================================== */

const QUEUE_FILE = 'memory.md';
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const THREADS_DIR = '_threads';

@Injectable()
export class MemoryFileStoreService extends MemoryStoreService {
  /** @param rootDir 记忆根目录；测试注入临时目录，生产由 CoreModule 工厂按 MEMORIES_DIR 装配 */
  constructor(private readonly rootDir: string) {
    super();
  }

  /* ----- 记忆队列 ----- */

  async readQueue(userId: number): Promise<MemoryQueue> {
    const raw = this.readFile(this.queuePath(userId));
    if (raw === null) return this.migrateLegacy(userId); // 无队列文件 → 尝试旧条目迁移
    return parseQueue(raw);
  }

  async appendEntry(userId: number, input: { title: string; content: string }): Promise<MemoryEntry> {
    const queue = await this.readQueue(userId);
    const entry: MemoryEntry = {
      time: memoryStamp(),
      title: input.title.trim(),
      content: input.content.trim(),
    };
    queue.entries.push(entry);
    queue.updated = memoryStamp();
    this.writeQueueFileSync(userId, queue);
    return entry;
  }

  async writeQueue(userId: number, queue: MemoryQueue): Promise<void> {
    queue.updated = memoryStamp();
    this.writeQueueFileSync(userId, queue);
  }

  /* ----- 会话滚动摘要缓存（历史滚动窗口，ADR-0007 修订） ----- */

  async readSummary(userId: number, conversationId: string): Promise<ConversationSummary | null> {
    const raw = this.readFile(this.summaryPath(userId, conversationId));
    if (raw === null) return null;
    return parseSummaryFile(raw);
  }

  async writeSummary(
    userId: number,
    conversationId: string,
    summary: string,
    coveredChars: number,
  ): Promise<void> {
    const dir = path.join(this.userDir(userId), THREADS_DIR);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `${this.threadName(conversationId)}.md`),
      `---\ncoveredChars: ${coveredChars}\nupdated: ${nowStamp()}\n---\n\n${summary.trim()}\n`,
      'utf8',
    );
  }

  async clearSummary(userId: number, conversationId: string): Promise<void> {
    try {
      fs.unlinkSync(this.summaryPath(userId, conversationId));
    } catch {
      /* 不存在即已清 */
    }
  }

  /* ----- 内部 ----- */

  private userDir(userId: number): string {
    return path.join(this.rootDir, String(userId));
  }

  private queuePath(userId: number): string {
    return path.join(this.userDir(userId), QUEUE_FILE);
  }

  private summaryPath(userId: number, conversationId: string): string {
    return path.join(this.userDir(userId), THREADS_DIR, `${this.threadName(conversationId)}.md`);
  }

  /** 会话 id 只允许文件名安全字符（当前为 UUID，防御性清洗） */
  private threadName(conversationId: string): string {
    const cleaned = conversationId.replace(/[^\w-]/g, '');
    return cleaned || 'conv';
  }

  private readFile(file: string): string | null {
    try {
      return fs.readFileSync(file, 'utf8');
    } catch {
      return null;
    }
  }

  private writeQueueFileSync(userId: number, queue: MemoryQueue): void {
    fs.mkdirSync(this.userDir(userId), { recursive: true });
    // summary 折成单行进 frontmatter（解析器按行读键值）
    const head =
      `---\nsummary: ${queue.summary.replace(/\s*\r?\n\s*/g, ' ')}\n` +
      `foldedCount: ${queue.foldedCount}\nupdated: ${queue.updated}\n---\n`;
    const body = queue.entries.map((e) => `## [${e.time}] ${e.title}\n${e.content}\n`).join('\n');
    fs.writeFileSync(this.queuePath(userId), `${head}\n${body}`, 'utf8');
  }

  /** 旧 ADR-0007 条目文件（<slug>.md：frontmatter title/created/updated + 正文）一次性迁移：
   *  按 updated 升序导入队尾 → 写队列文件 → 删除旧文件；无旧文件则返回空队列 */
  private migrateLegacy(userId: number): MemoryQueue {
    const dir = this.userDir(userId);
    let names: string[] = [];
    try {
      names = fs.readdirSync(dir).filter((n) => n.endsWith('.md') && n !== QUEUE_FILE);
    } catch {
      names = [];
    }
    const legacy: Array<MemoryEntry & { file: string }> = [];
    for (const name of names) {
      const raw = this.readFile(path.join(dir, name));
      if (raw === null) continue;
      const parsed = parseFrontmatter(raw);
      if (!parsed || !parsed.body) continue;
      const { title, updated } = parsed.meta;
      if (!title || !updated) continue;
      legacy.push({ time: updated.slice(0, 16), title, content: parsed.body, file: name });
    }
    legacy.sort((a, b) => (a.time < b.time ? -1 : 1));
    const queue: MemoryQueue = {
      summary: '',
      foldedCount: 0,
      updated: memoryStamp(),
      entries: legacy.map(({ time, title, content }) => ({ time, title, content })),
    };
    if (legacy.length) {
      this.writeQueueFileSync(userId, queue);
      for (const item of legacy) {
        try {
          fs.unlinkSync(path.join(dir, item.file));
        } catch {
          /* 删不掉的坏文件留在原地，下次迁移再试 */
        }
      }
    }
    return queue;
  }
}

/* ----- 解析（容错口径：字段缺失/非法 → 跳过该条，不炸整体） ----- */

/** key: value 行的宽松解析（容忍空白与首尾引号），只认自家格式不追求 YAML 全集 */
function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } | null {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) return null;
  const meta: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (kv) meta[kv[1]] = kv[2].replace(/^['"]|['"]$/g, '').trim();
  }
  return { meta, body: raw.slice(match[0].length).trim() };
}

function parseQueue(raw: string): MemoryQueue {
  const parsed = parseFrontmatter(raw);
  if (!parsed) return { summary: '', foldedCount: 0, updated: memoryStamp(), entries: [] };
  const foldedCount = Number(parsed.meta.foldedCount);
  const entries: MemoryEntry[] = [];
  let cur: MemoryEntry | null = null;
  for (const line of parsed.body.split(/\r?\n/)) {
    const header = /^## \[([^\]]+)\] (.+)$/.exec(line.trim());
    if (header) {
      if (cur) entries.push(cur);
      cur = { time: header[1], title: header[2], content: '' };
      continue;
    }
    if (cur && line.trim()) cur.content = cur.content ? `${cur.content}\n${line.trim()}` : line.trim();
  }
  if (cur) entries.push(cur);
  return {
    summary: parsed.meta.summary ?? '',
    foldedCount: Number.isFinite(foldedCount) && foldedCount >= 0 ? foldedCount : 0,
    updated: parsed.meta.updated ?? memoryStamp(),
    entries,
  };
}

function parseSummaryFile(raw: string): ConversationSummary | null {
  const parsed = parseFrontmatter(raw);
  if (!parsed) return null;
  const coveredChars = Number(parsed.meta.coveredChars);
  if (!Number.isFinite(coveredChars) || coveredChars < 0 || !parsed.meta.updated || !parsed.body) return null;
  return { coveredChars, updated: parsed.meta.updated, summary: parsed.body };
}

/** 'YYYY-MM-DD HH:MM:SS' 本地时间戳 */
function nowStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${todayStr()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
