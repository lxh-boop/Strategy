import { Injectable } from '@nestjs/common';
import { ApiException } from '../../common/api.exception';
import { ScreenFilter, ScreenResult } from '../../types';
import { STOCK_POOL, StockMeta } from '../store.service';
import { FIELD_MAP, OP_MAP, ScreenService } from '../screen.service';

/* ==========================================================
   筛选实现：演示股票池（16 只测试样例股，含各指标属性）
   数据经过调校：契约示例条件（ROE>15 且 PE 分位<30）的 Top5
   与前端 mock 的选股卡一致（茅台/五粮液/兴业/神华/长电）。
   ========================================================== */

@Injectable()
export class MockScreenService extends ScreenService {
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
    const stocks = sorted.slice(0, Math.max(1, topN)).map((s) => ({
      code: s.code,
      name: s.name,
      score: s.baseScore,
      weight: null,
    }));
    return { stocks, total: sorted.length };
  }
}
