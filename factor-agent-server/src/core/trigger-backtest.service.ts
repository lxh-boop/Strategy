import { Injectable } from '@nestjs/common';
import { NormalizedStrategyInput, StrategyBacktestOutput } from './strategy-backtest.service';
import { AgentProgressSink } from '../types';

/* ==========================================================
   模型 Ⅱ 条件触发引擎（契约）—— 独立于模型 Ⅰ 的 v3 内核（大盘择时重构方案 §5.3）：
   - 无调仓日历：entryFilters 逐日评估触发域，满足即次日买入；sellRules 逐日卖出；
   - 仓位偏离带 positionDeviatePct：持仓市值偏离目标总仓位超带宽时再平衡；
   - 择时叠加：与模型 Ⅰ 同一套 timing 构件（牛市满仓、熊市 bearPositionPct）；
   - 数据：逐日截面 + 触发后懒加载个股行情（内存只随触发域/持仓增长）。
   路由：StrategyBacktestInput.rebalanceIntervalDays = 0（策略回测入口按此分发）。
   ========================================================== */

/** 触发域上限：预声明的逐日监视名单（不声明 = 全市场逐日评估，成本不可控） */
export const TRIGGER_UNIVERSE_MAX = 3000;
/** 单日买入笔数上限（触发扎堆防护，压测定稿） */
export const MAX_DAILY_BUYS = 20;
/** 交易笔数硬上限（失控保护） */
export const MAX_TRADES = 20000;
/** 累计换手上限（占初始资金 %，失控保护，压测定稿） */
export const MAX_TOTAL_TURNOVER_PCT = 5000;

@Injectable()
export abstract class TriggerBacktestService {
  abstract run(p: NormalizedStrategyInput, onProgress?: AgentProgressSink): Promise<StrategyBacktestOutput>;
}
