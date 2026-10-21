import { Injectable } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ConversationSummary,
  MemoryEntry,
  MemoryStoreService,
  sanitizeSlug,
} from '../memory-store.service';
import { todayStr } from '../../common/time';

/* ==========================================================
   长期记忆文件实现（ADR-0007，唯一实现）：
   条目   <root>/<userId>/<slug>.md       —— frontmatter(title/created/updated) + 正文
   摘要   <root>/<userId>/_threads/<conversationId>.md —— frontmatter(coveredChars/updated) + 正文
   读写全部同步 fs（几十个文件的目录扫描同表目录量级，微秒级现读现拼）；
   解析只认自家写入格式 + 容忍人手微调（键值行、引号、空白），坏文件跳过不炸。
   ========================================================== */

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const THREADS_DIR = '_threads';

@Injectable()
export class MemoryFileStoreService extends MemoryStoreService {
  /** @param rootDir 记忆根目录；测试注入临时目录，生产由 CoreModule 工厂按 MEMORIES_DIR 装配 */
  constructor(private readonly rootDir: string) {
    super();
  }

  /* ----- 记忆条目 ----- */

  async listEntries(userId: number): Promise<MemoryEntry[]> {
    const dir = this.userDir(userId);
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return []; // 目录不存在 = 该用户还没有任何记忆
    }
    const entries: MemoryEntry[] = [];
    for (const name of names) {
      if (!name.endsWith('.md')) continue;
      const slug = name.slice(0, -3);
      const raw = this.readFile(path.join(dir, name));
      if (raw === null) continue;
      const entry = parseEntryFile(slug, raw);
      if (entry) entries.push(entry);
    }
    return entries;
  }

  async saveEntry(
    userId: number,
    input: { slug: string; title: string; content: string },
  ): Promise<MemoryEntry> {
    const slug = sanitizeSlug(input.slug);
    const dir = this.userDir(userId);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${slug}.md`);
    const existing = parseEntryFile(slug, this.readFile(file) ?? '');
    const today = todayStr();
    const entry: MemoryEntry = {
      slug,
      title: input.title.trim(),
      content: input.content.trim(),
      created: existing?.created ?? today,
      updated: today,
    };
    fs.writeFileSync(
      file,
      `---\ntitle: ${entry.title}\ncreated: ${entry.created}\nupdated: ${entry.updated}\n---\n\n${entry.content}\n`,
      'utf8',
    );
    return entry;
  }

  async deleteEntry(userId: number, slug: string): Promise<boolean> {
    try {
      fs.unlinkSync(path.join(this.userDir(userId), `${sanitizeSlug(slug)}.md`));
      return true;
    } catch {
      return false; // ENOENT = 条目本就不存在
    }
  }

  /* ----- 会话滚动摘要缓存 ----- */

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
}

/* ----- 解析（容错口径：字段缺失/非法 → 返回 null，调用方跳过） ----- */

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

function parseEntryFile(slug: string, raw: string): MemoryEntry | null {
  const parsed = parseFrontmatter(raw);
  if (!parsed) return null;
  const { title, created, updated } = parsed.meta;
  if (!title || !created || !updated || !parsed.body) return null;
  return { slug, title, content: parsed.body, created, updated };
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
