import { Module } from '@nestjs/common';
import { MarketController } from './market.controller';
import { MarketService } from './market.service';
import { MarketServiceImpl } from './implementations/market.service.impl';

/** 市场数据模块：接口 token → 实现 */
@Module({
  controllers: [MarketController],
  providers: [{ provide: MarketService, useClass: MarketServiceImpl }],
})
export class MarketModule {}
