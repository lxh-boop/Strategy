import { Injectable } from '@nestjs/common';
import { ScreenFilter, ScreenResult } from '../types';
import { StockMeta } from './store.service';

/* ==========================================================
   选股筛选接口（契约层）—— 定义"按条件筛股票能做什么"。
   实现：implementations/mock-screen.service.ts（演示股票池）
   ========================================================== */

/** 支持的筛选字段 → StockMeta 属性名（筛选条件 DSL，契约的一部分） */
export const FIELD_MAP: Record<string, keyof StockMeta> = {
  roe_ttm: 'roeTtm',
  pe_percentile: 'pePct',
  dividend_yield: 'divYield',
  volatility: 'vol',
  momentum_20d: 'mom20',
};

/** 支持的比较符（筛选条件 DSL，契约的一部分） */
export const OP_MAP: Record<string, (a: number, b: number) => boolean> = {
  '>': (a, b) => a > b,
  '<': (a, b) => a < b,
  '>=': (a, b) => a >= b,
  '<=': (a, b) => a <= b,
  '==': (a, b) => a === b,
};

/** 选股筛选接口：按股票池 + 条件过滤，按综合因子得分降序取 TopN */
@Injectable()
export abstract class ScreenService {
  abstract screen(options: { universe?: string; filters: ScreenFilter[]; topN?: number }): ScreenResult;
}
