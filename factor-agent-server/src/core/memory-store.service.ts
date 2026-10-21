import { Injectable } from '@nestjs/common';

/* ==========================================================
   长期记忆存储接口（SVC-D24，契约层）—— ADR-0007。
   与 UserStoreService 的刻意分野：记忆不进数据库，落本地 md 文件
   （用户拍板"本地 md 文档，不写数据库"）；<userId> 一人一目录，
   一条记忆一个 md 文件，会话滚动摘要一份缓存文件。
   实现：implementations/memory-file-store.service.ts（唯一实现——
   文件天生本地可用，不做 memory 兜底双实现；测试注入临时目录）
   损坏容错口径：单文件 frontmatter 缺字段/字段非法 → 跳过该条不炸整体。
   ========================================================== */

/** 记忆条目：一条一事、带日期；更新覆盖旧值并刷 updated，不并存 */
export interface MemoryEntry {
  /** 文件名（去 .md 后缀），清洗为 [a-z0-9-]；update/delete 以此引用既有条目 */
  slug: string;
  title: string;
  content: string;
  /** 'YYYY-MM-DD'（todayStr 口径） */
  created: string;
  updated: string;
}

/** 会话滚动摘要缓存：原始 messages 永不覆盖（只追加日志），本文件只是派生缓存，
 *  删除后可随时从原文重炼；随会话删除/清空而清理，不是长期记忆 */
export interface ConversationSummary {
  /** 已被摘要覆盖的原始气泡累计字符数（整条消息边界）；注入时其后的消息原文照出——
   *  任何消息要么在摘要里、要么原文注入（无损不变式） */
  coveredChars: number;
  /** 'YYYY-MM-DD HH:MM:SS' */
  updated: string;
  summary: string;
}

@Injectable()
export abstract class MemoryStoreService {
  /* ----- 记忆条目（长期记忆本体，不随会话删除） ----- */
  abstract listEntries(userId: number): Promise<MemoryEntry[]>;
  /** 新增或更新：slug 已存在即覆盖 title/content 并刷 updated（created 沿用原值） */
  abstract saveEntry(userId: number, input: { slug: string; title: string; content: string }): Promise<MemoryEntry>;
  abstract deleteEntry(userId: number, slug: string): Promise<boolean>;

  /* ----- 会话滚动摘要（缓存，随会话删除/清空而清理） ----- */
  abstract readSummary(userId: number, conversationId: string): Promise<ConversationSummary | null>;
  abstract writeSummary(userId: number, conversationId: string, summary: string, coveredChars: number): Promise<void>;
  abstract clearSummary(userId: number, conversationId: string): Promise<void>;
}

/* ----- 纯函数（注入侧与测试复用） ----- */

/** slug 清洗：小写化、非法字符转 -、折叠连字符、去首尾、截 64；清洗后为空 → 'memo' 兜底 */
export function sanitizeSlug(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
  return cleaned || 'memo';
}

/** 注入行渲染：slug 必须可见（模型 update/delete 靠它引用既有条目） */
export function renderMemoryLine(entry: MemoryEntry): string {
  return `- [${entry.slug}] ${entry.title}（${entry.updated}）：${entry.content}`;
}

/** 注入预算选择：按 updated 降序（新者先留），条数与字数预算先到为准；
 *  首条必收（超预算也保底一条，避免零注入死角） */
export function selectWithinBudget(entries: MemoryEntry[], maxEntries: number, maxChars: number): MemoryEntry[] {
  const sorted = [...entries].sort((a, b) =>
    a.updated === b.updated ? a.slug.localeCompare(b.slug) : a.updated < b.updated ? 1 : -1,
  );
  const picked: MemoryEntry[] = [];
  let chars = 0;
  for (const entry of sorted) {
    if (picked.length >= maxEntries) break;
    const line = renderMemoryLine(entry).length;
    if (picked.length > 0 && chars + line > maxChars) break;
    picked.push(entry);
    chars += line;
  }
  return picked;
}
