import { ApiException } from '../common/api.exception';
import {
  LIMIT_DOWN_RATIO,
  LIMIT_UP_RATIO,
  LOT_SIZE,
  type StrategySellRule,
  type StrategyTrade,
} from './strategy-backtest.service';

/* ==========================================================
   资金账户执行原语（回测共享，模型 Ⅰ/Ⅱ 引擎通用）
   —— 现金/持仓记账、成交、估值、总仓位拉回、卖出规则判定的唯一实现；
      策略语义（目标市值、最小建仓仓位、候选排序）仍属引擎。
   ========================================================== */

/** 个股行情（引擎装载/懒加载后查表用） */
export interface Quote {
  open: number | null;
  close: number;
  preClose: number;
}

export interface Position {
  code: string;
  shares: number;
  /** 最近一次买入的成交价（补仓按股数加权；T+1 简化按整仓最近买入日锁定） */
  entryPrice: number;
  /** 最近买入日的交易日下标（当日不可卖） */
  buyDayIdx: number;
  /** 买入以来最高收盘（max_drawdown_from_entry 用，含买入日） */
  peakClose: number;
}

/** field 类卖出规则的预取数据：按日表（code → 交易日 → 值）；静态表（code → 值，与日期无关） */
export type SellFieldData = Map<string, Map<string, Map<number, number>> | Map<string, number>>;

export interface AccountConfig {
  /** 单边费率（小数，买卖各计提一次） */
  feeRate: number;
  /** 交易笔数护栏（触达即抛；触发引擎用） */
  tradeLimit?: { max: number; message: string };
}

/** 价格解析回调：返回 undefined = 该标的当日不可交易（停牌/无行情） */
type PriceOf = (code: string) => number | undefined;

export class Account {
  private cashValue: number;
  private readonly book = new Map<string, Position>();
  private readonly tradeLog: StrategyTrade[] = [];
  private readonly lastCloseBook = new Map<string, number>();
  private dayTurnover = 0;

  constructor(initialCapital: number, private readonly config: AccountConfig) {
    this.cashValue = initialCapital;
  }

  cash(): number {
    return this.cashValue;
  }

  size(): number {
    return this.book.size;
  }

  positionOf(code: string): Position | undefined {
    return this.book.get(code);
  }

  allPositions(): Position[] {
    return [...this.book.values()];
  }

  /** 内部持仓账本只读视图（引擎组装期末持仓用） */
  positionsMap(): ReadonlyMap<string, Position> {
    return this.book;
  }

  trades(): StrategyTrade[] {
    return this.tradeLog;
  }

  lastCloseMap(): ReadonlyMap<string, number> {
    return this.lastCloseBook;
  }

  lastCloseOf(code: string): number | undefined {
    return this.lastCloseBook.get(code);
  }

  /** 现金按含费成本能买起的整手股数 */
  affordableShares(price: number): number {
    return Math.floor(this.cashValue / (price * (1 + this.config.feeRate)) / LOT_SIZE) * LOT_SIZE;
  }

  /** 权益 = 现金 + Σ(持仓×价)；价格缺（停牌）回落最近有效收盘，再回落成本价 */
  equity(priceOf?: PriceOf): number {
    return this.cashValue + this.allPositions().reduce((a, pos) => {
      const px = priceOf?.(pos.code) ?? this.lastCloseBook.get(pos.code) ?? pos.entryPrice;
      return a + pos.shares * px;
    }, 0);
  }

  /** 当日成交额（换手统计用）；取走并清零 */
  takeDayTurnover(): number {
    const t = this.dayTurnover;
    this.dayTurnover = 0;
    return t;
  }

  /** 买入记账：扣费入账、加权成本、T+1 锁定按最近买入日、成交明细一行 */
  buy(code: string, shares: number, price: number, day: number, dayIdx: number, reason: string): void {
    const amount = shares * price;
    const fee = amount * this.config.feeRate;
    this.cashValue -= amount + fee;
    this.dayTurnover += amount;
    const pos = this.book.get(code);
    if (pos) {
      pos.entryPrice = (pos.entryPrice * pos.shares + price * shares) / (pos.shares + shares);
      pos.shares += shares;
      pos.buyDayIdx = dayIdx;
      pos.peakClose = Math.max(pos.peakClose, price);
    } else {
      this.book.set(code, { code, shares, entryPrice: price, buyDayIdx: dayIdx, peakClose: price });
    }
    this.tradeLog.push({ date: day, code, direction: 'buy', price, shares, amount, fee, reason });
    const limit = this.config.tradeLimit;
    if (limit && this.tradeLog.length > limit.max) {
      throw new ApiException('INVALID_ARGUMENT', 400, limit.message);
    }
  }

  sell(pos: Position, shares: number, price: number, day: number, reason: string): void {
    const amount = shares * price;
    const fee = amount * this.config.feeRate;
    this.cashValue += amount - fee;
    this.dayTurnover += amount;
    pos.shares -= shares;
    if (pos.shares <= 0) this.book.delete(pos.code);
    this.tradeLog.push({ date: day, code: pos.code, direction: 'sell', price, shares, amount, fee, reason });
  }

  sellAll(pos: Position, price: number, day: number, reason: string): void {
    this.sell(pos, pos.shares, price, day, reason);
  }

  /** 结算：按当日收盘逐仓估值（收盘缺失 = 停牌，按最近有效收盘），更新最近收盘与持仓峰值，返回当日权益 */
  settle(closeOf: PriceOf): number {
    let marketValue = 0;
    for (const pos of this.book.values()) {
      const close = closeOf(pos.code);
      if (close !== undefined) {
        this.lastCloseBook.set(pos.code, close);
        pos.peakClose = Math.max(pos.peakClose, close);
        marketValue += pos.shares * close;
      } else {
        marketValue += pos.shares * (this.lastCloseBook.get(pos.code) ?? pos.entryPrice);
      }
    }
    return this.cashValue + marketValue;
  }

  /**
   * 总仓位拉回：目标总仓位 = 权益 × targetPct%，偏离超 bandPct% 才动作。
   * 减仓按市值占比分摊、只卖未 T+1 锁定仓；加仓按市值占比整手、现金封顶；
   * 停牌/涨跌停顺延。模型 Ⅰ 择时缩放块与模型 Ⅱ 偏离带再平衡同源于此。
   */
  rebalanceToTotal(
    targetPct: number,
    bandPct: number,
    day: number,
    dayIdx: number,
    labels: { trim: string; add: string },
    ctx: {
      priceOf: PriceOf;
      /** 可卖判定（跌停为 false） */
      canSell: (code: string, price: number) => boolean;
      /** 可买判定（涨停为 false） */
      canBuy: (code: string, price: number) => boolean;
    },
  ): void {
    const equity0 = this.equity(ctx.priceOf);
    const invested = equity0 - this.cashValue;
    const targetMvAll = (equity0 * targetPct) / 100;
    if (!(equity0 > 0) || Math.abs(targetMvAll - invested) <= equity0 * (bandPct / 100)) return;
    if (targetMvAll < invested) {
      // 减仓：need = 超出目标的市值；按持仓市值占比分摊到各未锁定仓
      const need = invested - targetMvAll;
      const unlocked = this.allPositions().filter((pos) => pos.buyDayIdx < dayIdx);
      const unlockMv = unlocked.reduce((a, pos) => {
        const px = ctx.priceOf(pos.code);
        return a + (px !== undefined ? pos.shares * px : 0);
      }, 0);
      for (const pos of unlocked) {
        const price = ctx.priceOf(pos.code);
        if (price === undefined) continue; // 停牌顺延
        if (!ctx.canSell(pos.code, price)) continue; // 跌停顺延
        const mv = pos.shares * price;
        let shares = Math.floor(((mv / (unlockMv || 1)) * need) / price / LOT_SIZE) * LOT_SIZE;
        if (shares > pos.shares) shares = pos.shares; // 最后一仓允许整仓卖出
        shares = Math.floor(shares / LOT_SIZE) * LOT_SIZE;
        if (shares < LOT_SIZE) continue; // 不足一手顺延（下一交易日继续收敛）
        this.sell(pos, shares, price, day, labels.trim);
      }
    } else if (this.cashValue > 0 && invested > 0) {
      // 加仓：按持仓市值占比整手买入，现金封顶
      const add = Math.min(targetMvAll - invested, this.cashValue / (1 + this.config.feeRate));
      for (const pos of this.allPositions()) {
        const price = ctx.priceOf(pos.code);
        if (price === undefined) continue; // 停牌顺延
        if (!ctx.canBuy(pos.code, price)) continue; // 涨停顺延
        const mv = pos.shares * price;
        let shares = Math.floor(((mv / invested) * add) / price / LOT_SIZE) * LOT_SIZE;
        const affordable = this.affordableShares(price);
        if (shares > affordable) shares = affordable;
        if (Number.isFinite(shares) && shares >= LOT_SIZE) this.buy(pos.code, shares, price, day, dayIdx, labels.add);
      }
    }
  }
}

/** 卖出规则逐条检查（信号用当日收盘），返回第一条命中的原因描述 */
export function matchSellRule(
  pos: Position,
  close: number,
  dayIdx: number,
  day: number,
  rules: StrategySellRule[],
  sellFieldSeries: SellFieldData,
  staticSellRefs: Set<string>,
): string | null {
  for (const rule of rules) {
    switch (rule.kind) {
      case 'stop_profit':
        if (pos.entryPrice > 0 && close / pos.entryPrice - 1 >= rule.pct / 100) return `止盈+${rule.pct}%`;
        break;
      case 'stop_loss':
        if (pos.entryPrice > 0 && close / pos.entryPrice - 1 <= -rule.pct / 100) return `止损-${rule.pct}%`;
        break;
      case 'max_drawdown_from_entry':
        if (pos.peakClose > 0 && (pos.peakClose - close) / pos.peakClose >= rule.pct / 100) return `回撤止盈${rule.pct}%`;
        break;
      case 'max_hold_days':
        if (dayIdx - pos.buyDayIdx >= rule.days) return `持有满${rule.days}个交易日`;
        break;
      case 'field': {
        const key = `${rule.table}.${rule.field}`;
        const series = sellFieldSeries.get(key);
        const value = staticSellRefs.has(key)
          ? (series as Map<string, number>).get(pos.code)
          : (series as Map<string, Map<number, number>>).get(pos.code)?.get(day);
        if (value !== undefined && (rule.op === '>' ? value > rule.value : value < rule.value)) {
          return `${rule.field}${rule.op}${rule.value}触发`;
        }
        break;
      }
      case 'rank_out':
        break; // 仅调仓日在调仓信号中处理（排名跌出 → 调仓卖出）
    }
  }
  return null;
}
