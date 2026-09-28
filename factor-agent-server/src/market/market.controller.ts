import { Body, Controller, Get, Post } from '@nestjs/common';
import { BtParamItem, FactorLibItem, ScreenResult } from '../types';
import { MarketService } from './market.service';
import { ScreenDto } from './dto';

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

  /** 选股筛选 */
  @Post('screen')
  screen(@Body() dto: ScreenDto): ScreenResult {
    return this.market.screen(dto);
  }
}
