import { Injectable } from '@nestjs/common';
import { BtParamItem } from '../../types';
import { BT_PARAMS, MarketService } from '../market.service';

/* ==========================================================
   市场数据业务实现：配置型数据直读常量（历史数据源 StoreService/内存演示存储
   已随演示链清理一并下线）。
   ========================================================== */

@Injectable()
export class MarketServiceImpl extends MarketService {
  listBtParams(): BtParamItem[] {
    return BT_PARAMS;
  }
}
