import { Injectable } from '@nestjs/common';
import { BtParamItem, FactorLibItem } from '../types';

/* ==========================================================
   市场数据业务接口（B-INT-03，契约层）—— market.controller 的依赖。
   实现：implementations/market.service.impl.ts
   ========================================================== */

@Injectable()
export abstract class MarketService {
  /** 因子库（API-14 数据源） */
  abstract listFactors(): FactorLibItem[];

  /** 回测参数配置项（API-15 数据源） */
  abstract listBtParams(): BtParamItem[];
}
