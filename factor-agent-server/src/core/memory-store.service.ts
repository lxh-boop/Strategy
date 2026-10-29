import { Injectable } from '@nestjs/common';

/* ==========================================================
   长期记忆存储接口（ADR-0013 记忆队列，修订 ADR-0007）。
   与历史滚动窗口的分野：摘要管"本会话聊了什么"（缓存，随会话删除清理），
   记忆管"这个用户是谁"（跨会话，不随会话删除）。

   存储形态（用户拍板）：一个用户一个 md 文件（memories/<userId>/memory.md），
   追加日志队列——重复提及不判重、直接追加；容量超限后队头（最老）条目折叠成
   记忆摘要（压缩次数=年龄，频次=追加即保活，折叠兼去重）。
   实现：implementations/memory-file-store.service.ts（唯一实现；
   旧 <slug>.md 条目文件在首次读取时一次性迁移导入队尾）。
   损坏容错口径：解析失败/字段非法 → 跳过该条不炸整体。
   ========================================================== */

/** 记忆条目：追加记录，一条一事带时间戳；不判重，偏好变化=追加修正版 */
export interface MemoryEntry {
  /** 追加时间 'YYYY-MM-DD HH:MM' */
  time: string;
  /** 一句话标题（「忘掉」的匹配锚点） */
  title: string;
  /** 一到两句事实 */
  content: string;
}

/** 记忆队列：折叠摘要 + 未折叠条目（追加序） */
export interface MemoryQueue {
  /** 队头折叠摘要；'' = 尚无折叠 */
  summary: string;
  /** 已折叠条目数 */
  foldedCount: number;
  /** 'YYYY-MM-DD HH:MM' */
  updated: string;
  /** 未折叠条目（最老 → 最新） */
  entries: MemoryEntry[];
}

@Injectable()
export abstract class MemoryStoreService {
  /* ----- 记忆队列（长期记忆本体，不随会话删除） ----- */
  abstract readQueue(userId: number): Promise<MemoryQueue>;
  abstract appendEntry(userId: number, input: { title: string; content: string }): Promise<MemoryEntry>;
  /** 整体写回（队头折叠重写、忘掉删除后的写回） */
  abstract writeQueue(userId: number, queue: MemoryQueue): Promise<void>;

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

/** 记忆区文本（token 估算与折叠判定的口径）：摘要段 + 全部条目行 */
export function queueText(queue: MemoryQueue): string {
  return [
    ...(queue.summary ? [queue.summary] : []),
    ...queue.entries.map((e) => renderQueueLine(e)),
  ].join('\n');
}

/** 'YYYY-MM-DD HH:MM' 本地时间戳（条目/队列的 time 口径） */
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
