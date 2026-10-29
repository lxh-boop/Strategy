import { Injectable } from '@nestjs/common';

/* ==========================================================
   长期记忆存储接口（ADR-0013 记忆队列，修订 ADR-0007）。
   与历史滚动窗口的分野：摘要管"本会话聊了什么"（缓存，随会话删除清理），
   记忆管"这个用户是谁"（跨会话，不随会话删除）。

   存储形态（用户拍板）：一个用户一个 md 文件（memories/<userId>/memory.md），
   纯条目队列（无 frontmatter）——重复提及不判重、直接追加；容量超限后队头
   （最老，含旧摘要条目）折叠成一条【记忆摘要】条目写回队首。
   两个操作：新增（追加）与折叠；无更新、无删除——偏好变化=追加修正版，
   「忘掉」=追加作废声明，注入前导语"以最新为准"消歧，队头折叠时消化。
   实现：implementations/memory-file-store.service.ts（唯一实现；
   旧 <slug>.md 条目文件在首次读取时一次性迁移导入队尾）。
   损坏容错口径：解析失败/字段非法 → 跳过该条不炸整体。
   ========================================================== */

/** 记忆条目：追加记录，一条一事带时间戳；不判重，偏好变化=追加修正版 */
export interface MemoryEntry {
  /** 追加时间 'YYYY-MM-DD HH:MM'；队首摘要条目的 time = 折叠时间 */
  time: string;
  /** 一句话标题；队首折叠条目的 title 带【记忆摘要】前缀 */
  title: string;
  /** 一到两句事实；折叠条目为多行三段要点 */
  content: string;
}

/** 记忆队列 = 未折叠条目（追加序，队头最老）；折叠产物是队首的【记忆摘要】条目 */
export type MemoryQueue = MemoryEntry[];

@Injectable()
export abstract class MemoryStoreService {
  /* ----- 记忆队列（长期记忆本体，不随会话删除） ----- */
  abstract readQueue(userId: number): Promise<MemoryQueue>;
  abstract appendEntry(userId: number, input: { title: string; content: string }): Promise<MemoryEntry>;
  /** 整体写回（队头折叠重写后的队列） */
  abstract writeQueue(userId: number, entries: MemoryQueue): Promise<void>;

  /* ----- 会话滚动摘要（缓存，随会话删除/清空而清理） ----- */
  abstract readSummary(userId: number, conversationId: string): Promise<ConversationSummary | null>;
  abstract writeSummary(userId: number, conversationId: string, summary: string, coveredChars: number): Promise<void>;
  abstract clearSummary(userId: number, conversationId: string): Promise<void>;
}

/* ----- 纯函数（注入侧与测试复用） ----- */

/** 注入行渲染：时间可见（频次保活的时间锚点），无 slug 引用体系 */
export function renderQueueLine(entry: MemoryEntry): string {
  return `- [${entry.time}] ${entry.title}：${entry.content}`;
}

/** 记忆区文本（token 估算与折叠判定的口径）：全部条目行（队首摘要条目在内） */
export function queueText(entries: MemoryQueue): string {
  return entries.map((e) => renderQueueLine(e)).join('\n');
}

/** 'YYYY-MM-DD HH:MM' 本地时间戳（条目/折叠摘要条目的 time 口径） */
export function memoryStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 旧版会话滚动摘要缓存（保留类型供摘要读写路径使用） */
export interface ConversationSummary {
  /** 已被摘要覆盖的原始气泡累计字符数（整条消息边界）；注入时其后的消息原文照出——
   *  任何消息要么在摘要里、要么原文注入（无损不变式） */
  coveredChars: number;
  /** 'YYYY-MM-DD HH:MM:SS' */
  updated: string;
  summary: string;
}
