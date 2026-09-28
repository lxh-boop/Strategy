import { Injectable } from '@nestjs/common';
import { ApiException } from '../common/api.exception';
import { ScreenFilter, ScreenResult, ScreenResultStock } from '../types';
import { STOCK_POOL, StockMeta } from './store.service';

/** 支持的筛选字段 → StockMeta 属性名 */
const FIELD_MAP: Record<string, keyof StockMeta> = {
  roe_ttm: 'roeTtm',
  pe_percentile: 'pePct',
  dividend_yield: 'divYield',
  volatility: 'vol',
  momentum_20d: 'mom20',
};

const OP_MAP: Record<string, (a: number, b: number) => boolean> = {
  '>': (a, b) => a > b,
  '<': (a, b) => a < b,
  '>=': (a, b) => a >= b,
  '<=': (a, b) => a <= b,
  '==': (a, b) => a === b,
};

@Injectable()
export class ScreenService {
  /** 按股票池 + 条件筛选，按综合因子得分降序（演示数据） */
  screen(options: { universe?: string; filters: ScreenFilter[]; topN?: number }): ScreenResult {
    const { universe, filters, topN = 5 } = options;

    let pool: StockMeta[] = STOCK_POOL;
    if (universe && universe !== '全市场') {
      pool = pool.filter((s) => s.universes.includes(universe));
    }

    for (const f of filters) {
      const key = FIELD_MAP[f.field];
      const op = OP_MAP[f.op];
      if (!key) throw new ApiException('INVALID_ARGUMENT', 400, `不支持的筛选字段: ${f.field}（支持：${Object.keys(FIELD_MAP).join('、')}）`);
      if (!op) throw new ApiException('INVALID_ARGUMENT', 400, `不支持的比较符: ${f.op}（支持：>、<、>=、<=、==）`);
      pool = pool.filter((s) => op(s[key] as number, f.value));
    }

    const sorted = [...pool].sort((a, b) => b.baseScore - a.baseScore);
    const stocks: ScreenResultStock[] = sorted.slice(0, Math.max(1, topN)).map((s) => ({
      code: s.code,
      name: s.name,
      score: s.baseScore,
      weight: null,
    }));
    return { stocks, total: sorted.length };
  }
}
