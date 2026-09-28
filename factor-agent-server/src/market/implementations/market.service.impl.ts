import { Injectable } from '@nestjs/common';
import { BtParamItem, FactorLibItem, ScreenResult } from '../../types';
import { ScreenService } from '../../core/screen.service';
import { StoreService } from '../../core/store.service';
import { ScreenDto } from '../dto';
import { MarketService } from '../market.service';

/* ==========================================================
   市场数据业务实现：汇聚存储（配置型数据）与筛选引擎
   ========================================================== */

@Injectable()
export class MarketServiceImpl extends MarketService {
  constructor(
    private readonly store: StoreService,
    private readonly screenService: ScreenService,
  ) {
    super();
  }

  listFactors(): FactorLibItem[] {
    return this.store.getFactorLib();
  }

  listBtParams(): BtParamItem[] {
    return this.store.getBtParams();
  }

  screen(dto: ScreenDto): ScreenResult {
    return this.screenService.screen(dto);
  }
}
