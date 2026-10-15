import { Injectable } from '@nestjs/common';
import { BtParamItem } from '../types';

/* ==========================================================
   市场数据业务接口（契约层）—— market.controller 的依赖。
   实现：implementations/market.service.impl.ts
   历史上的因子库下发（GET /api/factors）前端零调用已下线；
   筛选（POST /api/screen）随 mock 一起下线。
   ========================================================== */

/** 回测参数展示项（GET /api/backtest-params 下发内容） */
export const BT_PARAMS: BtParamItem[] = [
  { label: '回测区间', value: '2023-09 ~ 2026-09', hint: '历史模拟回测区间，共 3 年' },
  { label: 'Top K', value: '50 只', hint: '每次调仓选取综合因子得分最高的 K 只股票' },
  { label: '手续费率', value: '双边 0.1%', hint: '买卖均按成交额收取，含佣金与印花税' },
];

@Injectable()
export abstract class MarketService {
  /** 回测参数配置项（新增参数项前端无需改代码） */
  abstract listBtParams(): BtParamItem[];
}
