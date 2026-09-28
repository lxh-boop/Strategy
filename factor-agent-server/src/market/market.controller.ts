import { Controller, Get, Post, Body } from '@nestjs/common';
import { BtParamItem, FactorLibItem, ScreenResult } from '../types';
import { ScreenService } from '../core/screen.service';
import { StoreService } from '../core/store.service';
import { ScreenDto } from './dto';

@Controller('api')
export class MarketController {
  constructor(
    private readonly store: StoreService,
    private readonly screenService: ScreenService,
  ) {}

  /** 因子库（配置型数据由后端下发，UI 数据驱动渲染） */
  @Get('factors')
  factors(): FactorLibItem[] {
    return this.store.getFactorLib();
  }

  /** 回测参数配置项（后续新增参数项前端无需改代码） */
  @Get('backtest-params')
  backtestParams(): BtParamItem[] {
    return this.store.getBtParams();
  }

  /** 选股筛选 */
  @Post('screen')
  screen(@Body() dto: ScreenDto): ScreenResult {
    return this.screenService.screen(dto);
  }
}
