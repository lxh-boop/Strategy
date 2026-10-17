import { ConfigService } from '@nestjs/config';
import { ApiException } from '../../../src/common/api.exception';
import { AgentProgressEvent } from '../../../src/types';
import { LangGraphAgentService } from '../../../src/agent/implementations/langgraph-agent.service';
import { FactorDataService } from '../../../src/core/factor-data.service';
import { StrategyBacktestService } from '../../../src/core/strategy-backtest.service';
import { FactorAnalysisService } from '../../../src/core/factor-analysis.service';

/* ==========================================================
   runGraph 消息级并发闸 + keepalive 保活帧单元测试。
   app 以假 invoke 替身注入（延迟可控），不建真图不调真模型：
   - 同会话第二条新消息在上一条出结果前 → 409 CONVERSATION_BUSY，不起第二个图
   - 上一条出结果后闸自动放行；不同会话互不影响
   - 流式路径按 keepaliveMs 定时经 onProgress 发保活帧，图收尾即停；同步路径不发
   ========================================================== */

/** 无 Key 配置：get 恒 undefined → 构造走开发模式分支，不创建真 LLM 与图 */
function newService(): LangGraphAgentService {
  const config = { get: () => undefined } as unknown as ConfigService;
  return new LangGraphAgentService(config, {} as FactorDataService, {} as StrategyBacktestService, {} as FactorAnalysisService);
}

/** 假图注入：绕开开发模式检查，invoke 行为由用例定制 */
function installFakeApp(svc: LangGraphAgentService, invoke: (input: { conversationId: string }) => Promise<unknown>): void {
  (svc as unknown as { app: unknown }).app = { invoke };
  (svc as unknown as { llm: unknown }).llm = {};
}

const conv = (id: string) => ({ id, title: '', messages: [], updatedAt: 0 });
/** collectReply 可收尾的最小状态：最后一条 message 带文本、无中断无卡片 */
const okState = () => ({ messages: [{ content: '好的', additional_kwargs: {} }] });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('runGraph 消息级并发闸', () => {
  it('同会话第二条新消息在执行中 → 409 CONVERSATION_BUSY，且不打进图', async () => {
    const svc = newService();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const invoke = jest.fn(async () => {
      await gate;
      return okState();
    });
    installFakeApp(svc, invoke);

    const first = svc.reply(conv('c1'), '第一条');
    await sleep(10); // 让第一条进入图执行
    const err = await svc.reply(conv('c1'), '第二条').then(
      () => {
        throw new Error('应当被并发闸拒绝');
      },
      (e) => e as ApiException,
    );
    expect(err).toBeInstanceOf(ApiException);
    expect(err.code).toBe('CONVERSATION_BUSY');
    expect(err.getStatus()).toBe(409);
    expect(invoke).toHaveBeenCalledTimes(1); // 第二条没有起第二个图
    release();
    await first;
  });

  it('上一条出结果后闸自动放行', async () => {
    const svc = newService();
    installFakeApp(svc, async () => okState());
    await svc.reply(conv('c2'), '第一条');
    const reply = await svc.reply(conv('c2'), '第二条');
    expect(reply.text).toBe('好的');
  });

  it('不同会话互不影响', async () => {
    const svc = newService();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    installFakeApp(svc, async (input) => {
      if (input.conversationId === 'c3') await gate; // 只有 c3 挂起
      return okState();
    });
    const slow = svc.reply(conv('c3'), 'A 会话慢请求');
    await sleep(10);
    const other = await svc.reply(conv('c4'), 'B 会话不受影响');
    expect(other.text).toBe('好的');
    release();
    await slow;
  });
});

describe('keepalive 保活帧', () => {
  it('流式执行期间定时发 keepalive，图收尾即停；同步路径不发', async () => {
    const svc = newService();
    (svc as unknown as { keepaliveMs: number }).keepaliveMs = 10;
    const events: AgentProgressEvent[] = [];
    installFakeApp(svc, async () => {
      await sleep(55);
      return okState();
    });

    await svc.replyStream(conv('c5'), '问题', '', (e) => events.push(e));
    const kas = events.filter((e) => e.type === 'keepalive');
    expect(kas.length).toBeGreaterThanOrEqual(3);

    await sleep(40); // 收尾后不再发
    expect(events.filter((e) => e.type === 'keepalive').length).toBe(kas.length);

    const r = await svc.reply(conv('c5'), '同步路径');
    expect(r.text).toBe('好的');
  });
});
