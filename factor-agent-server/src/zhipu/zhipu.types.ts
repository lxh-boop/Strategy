export type ZhipuRole = 'system' | 'user' | 'assistant';

export interface ZhipuMessage {
  role: ZhipuRole;
  content: string;
}

export interface ZhipuChatOptions {
  /** 不传则用 .env 里的 ZHIPU_MODEL */
  model?: string;
  temperature?: number;
}

export interface ZhipuUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

/** 流式返回的一个片段 */
export interface ZhipuChunk {
  delta: string;
  finishReason: string | null;
  usage: ZhipuUsage | null;
}

export interface ZhipuChatResult {
  content: string;
  model: string;
  usage: ZhipuUsage | null;
}
