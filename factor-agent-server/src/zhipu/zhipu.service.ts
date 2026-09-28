import { Injectable } from '@nestjs/common';
import { ZhipuChatOptions, ZhipuChatResult, ZhipuChunk, ZhipuMessage } from './zhipu.types';

/* ==========================================================
   智谱直连客户端接口（契约层）—— OpenAI 兼容协议。
   用途：① 健康探测（configured / defaultModel，API-01 的数据源）；
        ② 备用直连 chat / 流式 chatStream（为 SSE 流式回复预留）。
   注意：智能体主链路在 agent/implementations/langgraph-agent.service.ts
   中用 LangChain ChatOpenAI 直连智谱，不经本客户端。
   实现：implementations/http-zhipu.service.ts
   ========================================================== */

@Injectable()
export abstract class ZhipuService {
  /** 是否已配置 API Key（API-01 的 zhipuConfigured 数据源） */
  abstract get configured(): boolean;

  /** 当前默认模型名（API-01 的 defaultModel 数据源） */
  abstract readonly defaultModel: string;

  /** 普通对话：一次性返回完整回复 */
  abstract chat(messages: ZhipuMessage[], options?: ZhipuChatOptions): Promise<ZhipuChatResult>;

  /** 流式对话：逐段产出内容增量 */
  abstract chatStream(messages: ZhipuMessage[], options?: ZhipuChatOptions): AsyncGenerator<ZhipuChunk>;
}
