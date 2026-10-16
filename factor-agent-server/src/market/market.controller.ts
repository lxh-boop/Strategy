import { Controller, Get } from '@nestjs/common';
import { BtParamItem } from '../types';
import { Public } from '../common/public.decorator';
import { MarketService } from './market.service';

/** 市场数据接口（公开：公共配置数据，无用户维度） */
@Public()
@Controller('api')
export class MarketController {
  constructor(private readonly market: MarketService) {}

  /** 回测参数配置项（后续新增参数项前端无需改代码） */
  @Get('backtest-params')
  backtestParams(): BtParamItem[] {
    return this.market.listBtParams();
  }
}
