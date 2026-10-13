import { Controller, Get } from '@nestjs/common';
import { BtParamItem, FactorLibItem } from '../types';
import { Public } from '../common/public.decorator';
import { MarketService } from './market.service';

/** API-14/15 市场数据（公开：公共配置数据，无用户维度） */
@Public()
@Controller('api')
export class MarketController {
  constructor(private readonly market: MarketService) {}

  /** 因子库（配置型数据由后端下发，UI 数据驱动渲染） */
  @Get('factors')
  factors(): FactorLibItem[] {
    return this.market.listFactors();
  }

  /** 回测参数配置项（后续新增参数项前端无需改代码） */
  @Get('backtest-params')
  backtestParams(): BtParamItem[] {
    return this.market.listBtParams();
  }
}
