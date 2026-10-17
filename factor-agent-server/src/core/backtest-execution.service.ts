import { Injectable } from '@nestjs/common';
import { AgentProgressSink } from '../types';
import { StrategyBacktestInput } from './strategy-backtest.service';

/* ==========================================================
   回测执行层契约（DolphinDB Backtest 风格命名与数据形状）
   —— 编排层/确认门/卡片只依赖本契约，不感知具体引擎。
      当前实现：AccountBacktestExecutionService（TS 自研内核，
      Account 记账 + 模型 Ⅰ/Ⅱ 日频事件内核）。
      将来切换 DolphinDB Backtest 插件：新增同契约实现
      （Node API 驱动插件 + 官方日频组合教程脚本模板），
      core.module 装配点一行替换，调用方零改动。
   字段口径与 dolp get* 接口对照：
     returnSummary        ↔ Backtest::getReturnSummary
     dailyTotalPortfolios ↔ Backtest::getDailyTotalPortfolios
     tradeDetails         ↔ Backtest::getTradeDetails
     dailyPositions       ↔ Backtest::getDailyPosition
   百分比字段沿用项目口径（14.6 即 14.6%）；日期沿用 YYYYMMDD 数字。
   ========================================================== */

/** 绩效总览；dolp 侧有而本项目不产的字段（beta/alpha/annualVolatility 等）不设 */
export interface ReturnSummary {
  /** 区间累计收益 %（净值末/首-1） */
  totalReturn: number;
  /** 年化收益 % */
  annualReturn: number;
  /** 最大回撤 % */
  maxDrawdown: number;
  sharpeRatio: number;
  /** 胜率 % */
  winRate: number;
  /** 年化换手（单边）%；历史存量数据无此字段时缺省 */
  turnoverRate?: number;
}

/** 每日权益行（净值曲线数据源） */
export interface DailyTotalPortfolioRow {
  /** 交易日 YYYYMMDD */
  tradeDate: number;
  /** 组合净值（起点 100） */
  netValue: number;
}

/** 成交明细一行；direction 沿用 dolp 枚举：1 买开 / 3 卖平 */
export interface TradeDetailRow {
  /** 证券代码 000001.XSHE */
  symbol: string;
  direction: 1 | 3;
  /** 交易日 YYYYMMDD（dolp 为 TIMESTAMP，实现层负责换算） */
  tradeDate: number;
  tradePrice: number;
  tradeQty: number;
  amount: number;
  totalFee: number;
  /** 下单备注（项目内为触发原因，如 调仓建仓/止损-5%/择时减仓） */
  label: string;
}

/** 每日持仓行（预留：果仁 P0-1 每期持仓明细落地后产出） */
export interface DailyPositionRow {
  symbol: string;
  tradeDate: number;
  longPosition: number;
  avgPrice: number;
}

export interface BacktestExecutionOutput {
  returnSummary: ReturnSummary;
  dailyTotalPortfolios: DailyTotalPortfolioRow[];
  tradeDetails: TradeDetailRow[];
  /** TS 内核暂不产出逐日持仓序列，当前实现缺省 */
  dailyPositions?: DailyPositionRow[];
}

export interface BacktestExecutionInput {
  /** 策略规格 StrategySpec v1（原始入参，归一化由实现层负责）；调仓/触发两模式同入口 */
  input: StrategyBacktestInput;
  /** 过程事件（SSE 进度条），透传底层引擎 */
  onProgress?: AgentProgressSink;
}

/**
 * 回测执行层：输入策略规格，输出 dolp 形状的净值/成交/绩效结果。
 * 上层只依赖本抽象；换实现不改调用方（数据源与执行引擎均解耦于此）。
 */
@Injectable()
export abstract class BacktestExecutionService {
  abstract run(input: BacktestExecutionInput): Promise<BacktestExecutionOutput>;
}
