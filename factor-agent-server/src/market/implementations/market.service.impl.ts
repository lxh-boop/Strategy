import { Injectable } from '@nestjs/common';
import { BtParamItem, FactorLibItem } from '../../types';
import { StoreService } from '../../core/store.service';
import { MarketService } from '../market.service';

/* ==========================================================
   市场数据业务实现：汇聚存储（配置型数据）。
   历史上的"选股筛选"（POST /api/screen，16 只演示股）已随 mock 一起下线。
   ========================================================== */

@Injectable()
export class MarketServiceImpl extends MarketService {
  constructor(
    private readonly store: StoreService,
  ) {
    super();
  }

  listFactors(): FactorLibItem[] {
    return this.store.getFactorLib();
  }

  listBtParams(): BtParamItem[] {
    return this.store.getBtParams();
  }
}
