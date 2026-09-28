import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { Strategy } from '../types';
import { StrategiesService } from './strategies.service';
import { BacktestParamsDto, CreateStrategyDto, UpdateStrategyDto } from './dto';

@Controller('api/strategies')
export class StrategiesController {
  constructor(private readonly strategies: StrategiesService) {}

  @Get()
  list(): Strategy[] {
    return this.strategies.list();
  }

  @Post()
  create(@Body() dto: CreateStrategyDto): Strategy {
    return this.strategies.create(dto);
  }

  /** 更新配置 = 保存并自动重新回测 */
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateStrategyDto): Strategy {
    return this.strategies.update(id, dto);
  }

  @Post(':id/backtest')
  backtest(@Param('id') id: string, @Body() dto: BacktestParamsDto): Strategy {
    return this.strategies.backtest(id, dto ?? {});
  }

  @Get(':id/report')
  report(@Param('id') id: string) {
    return this.strategies.report(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): void {
    this.strategies.remove(id);
  }
}
