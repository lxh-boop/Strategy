import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ZhipuChatOptions,
  ZhipuChatResult,
  ZhipuChunk,
  ZhipuMessage,
  ZhipuUsage,
} from './zhipu.types';

/**
 * 智谱开放平台 GLM 对话接口客户端（OpenAI 兼容协议）。
 * 文档: https://docs.bigmodel.cn/cn/guide/models
 */
@Injectable()
export class ZhipuService {
  private readonly logger = new Logger(ZhipuService.name);

  readonly apiKey: string;
  readonly defaultModel: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('zhipu.apiKey') ?? '';
    this.baseUrl = config.get<string>('zhipu.baseUrl') ?? 'https://open.bigmodel.cn/api/paas/v4';
    this.defaultModel = config.get<string>('zhipu.model') ?? 'glm-4-flash';
    this.timeoutMs = Number(config.get<number>('chat.timeoutMs') ?? 60_000);
  }

  get configured(): boolean {
    return this.apiKey.trim().length > 0;
  }

  /** 普通对话：一次性返回完整回复 */
  async chat(messages: ZhipuMessage[], options: ZhipuChatOptions = {}): Promise<ZhipuChatResult> {
    this.assertConfigured();
    const response = await this.send(this.buildBody(messages, options, false));
    if (!response.ok) throw await this.upstreamError(response);

    const data: any = await response.json();
    const content = data?.choices?.[0]?.message?.content ?? '';
    return {
      content,
      model: data?.model ?? options.model ?? this.defaultModel,
      usage: (data?.usage as ZhipuUsage) ?? null,
    };
  }

  /** 流式对话：逐段产出内容增量 */
  async *chatStream(messages: ZhipuMessage[], options: ZhipuChatOptions = {}): AsyncGenerator<ZhipuChunk> {
    this.assertConfigured();
    const response = await this.send(this.buildBody(messages, options, true));
    if (!response.ok) throw await this.upstreamError(response);
    if (!response.body) {
      throw new HttpException('智谱接口未返回数据流', HttpStatus.BAD_GATEWAY);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineAt: number;
      while ((newlineAt = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newlineAt).trim();
        buffer = buffer.slice(newlineAt + 1);
        if (!line.startsWith('data:')) continue;

        const payload = line.slice('data:'.length).trim();
        if (!payload || payload === '[DONE]') continue;

        try {
          const json: any = JSON.parse(payload);
          const choice = json?.choices?.[0];
          yield {
            delta: choice?.delta?.content ?? '',
            finishReason: choice?.finish_reason ?? null,
            usage: (json?.usage as ZhipuUsage) ?? null,
          };
        } catch {
          this.logger.warn(`无法解析上游流式数据: ${payload.slice(0, 200)}`);
        }
      }
    }
  }

  private assertConfigured(): void {
    if (!this.configured) {
      throw new HttpException(
        '未配置智谱 API Key：请在后端 .env 中填写 ZHIPU_API_KEY 后重启服务',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  private buildBody(messages: ZhipuMessage[], options: ZhipuChatOptions, stream: boolean) {
    return {
      model: options.model ?? this.defaultModel,
      messages,
      stream,
      temperature: clampTemperature(options.temperature),
    };
  }

  /** fetch 只用超时保护"拿到响应头"，流式 body 读取不受该超时影响 */
  private async send(body: unknown): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new HttpException(`请求智谱接口超时（${this.timeoutMs}ms）`, HttpStatus.GATEWAY_TIMEOUT);
      }
      this.logger.error(`请求智谱接口失败: ${error}`);
      throw new HttpException(
        `请求智谱接口失败，请检查网络或 ZHIPU_BASE_URL 配置`,
        HttpStatus.BAD_GATEWAY,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private async upstreamError(response: Response): Promise<HttpException> {
    let detail = '';
    try {
      const text = await response.text();
      try {
        const json: any = JSON.parse(text);
        detail = json?.error?.message ?? json?.msg ?? text;
      } catch {
        detail = text;
      }
    } catch {
      // ignore
    }
    this.logger.warn(`智谱接口返回 ${response.status}: ${detail.slice(0, 300)}`);

    if (response.status === 401) {
      return new HttpException('智谱 API Key 无效或未授权，请检查 .env 中的 ZHIPU_API_KEY', HttpStatus.UNAUTHORIZED);
    }
    return new HttpException(
      `智谱接口返回 ${response.status}：${detail.slice(0, 300) || '无详细信息'}`,
      HttpStatus.BAD_GATEWAY,
    );
  }
}

/** 智谱 v4 接口 temperature 要求在 (0,1) 开区间 */
function clampTemperature(value?: number): number {
  const t = Number(value ?? 0.7);
  if (!Number.isFinite(t)) return 0.7;
  return Math.min(0.99, Math.max(0.01, t));
}
