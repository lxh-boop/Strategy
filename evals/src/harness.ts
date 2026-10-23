import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { LangGraphAgentService } from '../../factor-agent-server/src/agent/implementations/langgraph-agent.service';
import { AGENT_TOOL_SPECS } from '../../factor-agent-server/src/agent/implementations/tool-specs';
import { FactorDataService } from '../../factor-agent-server/src/core/factor-data.service';
import { StrategyBacktestService } from '../../factor-agent-server/src/core/strategy-backtest.service';
import { FactorAnalysisService } from '../../factor-agent-server/src/core/factor-analysis.service';
import { MemoryUserStoreService } from '../../factor-agent-server/src/core/implementations/memory-user-store.service';
import { MemoryFileStoreService } from '../../factor-agent-server/src/core/implementations/memory-file-store.service';
import { ApiException } from '../../factor-agent-server/src/common/api.exception';
import type { AgentCard, Conversation } from '../../factor-agent-server/src/types';
import { loadServerEnv } from './load-env';
import type { CapturedRound, CapturedToolCall, RunTrajectory, TurnRecord } from './types';

/* ==========================================================
   测评 harness：装配"真 GLM + 真图 + mock 引擎桩"的智能体。

   装配口径与 server 的真图测试（langgraph-agent.service.spec.ts）同源：
   - 手动 new LangGraphAgentService（绕过 Nest 容器，DI 参数直传）；
   - 三个引擎依赖（回测/因子分析/因子取数）换成录制版 mock 桩——
     GLM 看到的工具 schema 与执行链路是真的，只有引擎输出是确定性的假数据；
   - 池句柄（screen_stock_pool）、长期记忆走真实现（MemoryUserStore/MemoryFileStore 临时目录），
     行业/指数解析走真实引擎 B 数据（只读零副作用）；
   - 轨迹采集：构造后重建图——用与构造时相同的 bindTools 产物外包一层录制代理
     （记录每轮输入消息数、输出正文、完整 tool_calls 原始参数、token 用量），
     再替换 service.app。replyStream 的生产路径（runGraph/pendingConfirms/确认门恢复）原样生效。
   ========================================================== */

/** mock 引擎的确定性输出（形态对齐 server 各引擎接口的实收字段） */
const FAKE_BACKTEST_CARD: AgentCard = {
  type: 'backtest',
  title: '测评回测',
  tag: '',
  curve: [100, 101.2, 100.8, 103.5, 105.1],
  benchCurve: [100, 100.4, 100.2, 101.0, 101.6],
  metrics: [],
};

const FAKE_BACKTEST_OUTPUT = {
  card: FAKE_BACKTEST_CARD,
  summary: { ok: true, 年化收益: '+21.9%', 最大回撤: '-11.8%', 年化换手单边: '12.4倍' },
  metrics: { annual: 0.219, drawdown: -0.118, sharpe: 1.24, winRate: 55 },
};

const FAKE_RANK_OUTPUT = {
  icSeries: [{ date: 20240102, ic: 0.08 }, { date: 20240115, ic: 0.11 }],
  icMean: 0.09,
  icPositiveProb: 82,
  icIR: 0.5,
  segmentMeanReturnPct: [3.1, 1.2, 0.4, -0.6, -1.8],
  segmentCumulativePct: [12.4, 4.8, 1.6, -2.4, -7.2],
  segmentPeriodReturnsPct: [[3.1], [1.2], [0.4], [-0.6], [-1.8]],
  longShortSeries: [4.9, 5.2],
  monotonicityR2: 0.96,
  longShortSpreadPct: 4.9,
  periodCount: 24,
  icDecay: [0.09, 0.07, 0.05],
};

const FAKE_CORR_OUTPUT = {
  factors: ['equ_factor_obos.REVS20', 'equ_factor_obos.BIAS20'],
  matrix: [
    [null, 0.42],
    [0.42, null],
  ],
  periodCount: 24,
};

const FAKE_DAILY_SCREEN = {
  date: '2026-10-22',
  rawPoolSize: 154,
  survivedCount: 30,
  stocks: [{ code: '600519.XSHG', score: 92 }, { code: '000858.XSHE', score: 88 }],
  sortFactors: [{ table: 'equ_factor_obos', field: 'REVS20', direction: 1 as const }],
  usedDefaultSort: true,
  entryFilters: [],
};

type BacktestMock = {
  preflight: jest.Mock;
  checkRange: jest.Mock;
  runStrategyBacktest: jest.Mock;
  runDailyScreen: jest.Mock;
};

export type EngineMocks = {
  backtest: BacktestMock;
  factorAnalysis: { runRankAnalysis: jest.Mock; runFactorCorrelation: jest.Mock };
  factorData: { readTable: jest.Mock };
};

/** 引擎 mock 的私有字段访问口径（与 server 真图测试同款） */
interface ServiceInternals {
  llm: { bindTools(specs: unknown[]): { invoke(messages: unknown): Promise<unknown> } } | null;
  buildGraph(agent: unknown): unknown;
  app: unknown;
  pendingConfirms: Map<string, string>;
}

export class EvalHarness {
  readonly service: LangGraphAgentService;
  readonly mocks: EngineMocks;
  private readonly rounds: CapturedRound[] = [];
  private readonly toolCalls: CapturedToolCall[] = [];
  private readonly memoryRoot: string;

  private constructor(service: LangGraphAgentService, mocks: EngineMocks, memoryRoot: string) {
    this.service = service;
    this.mocks = mocks;
    this.memoryRoot = memoryRoot;
  }

  /** 装配一套带真 GLM 的智能体。ZHIPU_API_KEY 缺失时抛可读错误 */
  static create(opts: { failFirstBacktests?: number } = {}): EvalHarness {
    loadServerEnv();
    if (!(process.env.ZHIPU_API_KEY ?? '').trim()) {
      throw new Error('缺少 ZHIPU_API_KEY：evals 用真实 GLM 驱动真图，请在 factor-agent-server/.env 或环境变量提供');
    }
    let failLeft = opts.failFirstBacktests ?? 0;
    const backtest: BacktestMock = {
      preflight: jest.fn(),
      checkRange: jest.fn().mockResolvedValue({ dates: [20240102, 20261231], min: 20200102, max: 20261231 }),
      runStrategyBacktest: jest.fn(async () => {
        if (failLeft > 0) {
          failLeft -= 1;
          throw new ApiException('BACKTEST_FAILED', 500, '模拟引擎失败：区间超出数据范围，请调整区间后重试');
        }
        return FAKE_BACKTEST_OUTPUT;
      }),
      runDailyScreen: jest.fn().mockResolvedValue(FAKE_DAILY_SCREEN),
    };
    const mocks: EngineMocks = {
      backtest,
      factorAnalysis: {
        runRankAnalysis: jest.fn().mockResolvedValue(FAKE_RANK_OUTPUT),
        runFactorCorrelation: jest.fn().mockResolvedValue(FAKE_CORR_OUTPUT),
      },
      factorData: { readTable: jest.fn().mockResolvedValue([{ SECURITY_ID: '600519.XSHG', CLOSE: '1700.0' }]) },
    };

    const config = {
      get: (key: string): unknown =>
        ({
          'zhipu.apiKey': process.env.ZHIPU_API_KEY ?? '',
          'zhipu.model': process.env.ZHIPU_MODEL ?? 'glm-4-flash',
          'zhipu.baseUrl': process.env.ZHIPU_BASE_URL ?? 'https://open.bigmodel.cn/api/paas/v4',
          'zhipu.thinking': 'disabled',
          'chat.timeoutMs': 60_000,
        })[key],
      // 用 server 构造函数自身的参数类型做 cast：跨包 ConfigService 私有属性不同源，直接 as 会报错
    } as unknown as ConstructorParameters<typeof LangGraphAgentService>[0];

    const memoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evals-mem-'));
    const service = new LangGraphAgentService(
      config,
      mocks.factorData as unknown as FactorDataService,
      mocks.backtest as unknown as StrategyBacktestService,
      mocks.factorAnalysis as unknown as FactorAnalysisService,
      new MemoryUserStoreService(),
      new MemoryFileStoreService(memoryRoot),
    );

    const harness = new EvalHarness(service, mocks, memoryRoot);
    harness.rebuildGraphWithRecorder();
    return harness;
  }

  /** 用录制代理重建图：代理记录每轮 agent 调用的完整输入/输出（原始 tool_calls + token），再委托真 GLM。
   *  替换发生在构造之后、任何轮次之前——runGraph 的生产路径（确认门/并发闸）原样生效 */
  private rebuildGraphWithRecorder(): void {
    const internals = this.service as unknown as ServiceInternals;
    if (!internals.llm) throw new Error('GLM 客户端未建立（zhipu.apiKey 为空）');
    const raw = internals.llm.bindTools([...AGENT_TOOL_SPECS]);
    const recorder = {
      invoke: async (messages: unknown): Promise<unknown> => {
        const out = (await raw.invoke(messages)) as {
          content?: unknown;
          tool_calls?: { name: string; args: unknown }[];
          usage_metadata?: { input_tokens?: number; output_tokens?: number };
        };
        const round: CapturedRound = {
          inputMessageCount: Array.isArray(messages) ? messages.length : 0,
          text: typeof out.content === 'string' ? out.content : '',
          toolCalls: (out.tool_calls ?? []).map((c) => ({ name: c.name, args: c.args })),
          inputTokens: out.usage_metadata?.input_tokens,
          outputTokens: out.usage_metadata?.output_tokens,
        };
        this.rounds.push(round);
        for (const tc of round.toolCalls) {
          this.toolCalls.push({ round: this.rounds.length - 1, name: tc.name, args: tc.args });
        }
        return out;
      },
    };
    internals.app = internals.buildGraph(recorder);
  }

  /** 新开一个会话对象（id 全局唯一，避免 pendingConfirms/池句柄跨任务串线） */
  newConversation(taskId: string, runIndex: number, seed?: { role: 'user' | 'agent'; bubble: string }[]): Conversation {
    return {
      id: `eval-${taskId}-r${runIndex}`,
      title: '',
      updatedAt: 0,
      userId: 990_001,
      messages: (seed ?? []).map((s) => ({ role: s.role, bubble: s.bubble, time: '00:00' })),
    };
  }

  /** 该会话的确认门是否挂起（生产字段 pendingConfirms，私有访问口径同上） */
  hasPendingConfirm(conversationId: string): boolean {
    return (this.service as unknown as ServiceInternals).pendingConfirms.has(conversationId);
  }

  /** 跑一轮：走生产入口 replyStream（SSE 回调仅收 keepalive/进度，不参与结果），
   *  会话消息按生产口径追加（bubble 只进上下文，卡片不进） */
  async runTurn(conversation: Conversation, userText: string): Promise<TurnRecord> {
    const t0 = Date.now();
    const reply = await this.service.replyStream(conversation, userText, userText, () => undefined);
    conversation.messages.push(
      { role: 'user', bubble: userText, time: '00:00' },
      { role: 'agent', bubble: reply.text, time: '00:00' },
    );
    return {
      userText,
      replyText: reply.text,
      cardType: reply.card?.type,
      confirmPending: this.hasPendingConfirm(conversation.id),
      durationMs: Date.now() - t0,
    };
  }

  /** 汇总本次装配全程的轨迹（一个 harness 只跑一次任务的 k 个 run 之一） */
  trajectory(taskId: string, runIndex: number, wallMs: number, error?: string): RunTrajectory {
    const calls = this.mocks;
    const record = (mock: string, method: string, fn: jest.Mock) =>
      fn.mock.calls.map((c) => ({ mock, method, args: c[0] }));
    return {
      taskId,
      runIndex,
      rounds: this.rounds,
      turns: [],
      engineCalls: [
        ...record('backtest', 'runStrategyBacktest', calls.backtest.runStrategyBacktest),
        ...record('backtest', 'runDailyScreen', calls.backtest.runDailyScreen),
        ...record('factorAnalysis', 'runRankAnalysis', calls.factorAnalysis.runRankAnalysis),
        ...record('factorAnalysis', 'runFactorCorrelation', calls.factorAnalysis.runFactorCorrelation),
        ...record('factorData', 'readTable', calls.factorData.readTable),
      ],
      wallMs,
      error,
    };
  }

  dispose(): void {
    fs.rmSync(this.memoryRoot, { recursive: true, force: true });
  }
}
