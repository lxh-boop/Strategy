import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { AgentService } from '../agent/agent.service';
import { Strategy } from '../types';
import { UserId } from '../common/current-user.decorator';
import { StrategiesService } from './strategies.service';
import { BacktestParamsDto, CreateFromBacktestDto, CreateStrategyDto, UpdateStrategyDto } from './dto';

/** API-08 ~ API-13、API-27（M13 起需 Bearer，数据按 token 用户隔离） */
@Controller('api/strategies')
export class StrategiesController {
  constructor(
    private readonly strategies: StrategiesService,
    private readonly agent: AgentService,
  ) {}

  /** 归因分析（ADR-0010 配套）：对已保存策略重放回测 → 归因聚合 → GLM 解读 → 落库 */
  @Post(':id/attribution')
  @HttpCode(HttpStatus.OK)
  async attribution(@UserId() userId: number, @Param('id') id: string) {
    return this.agent.runStrategyAttribution(userId, id);
  }


  @Get()
  async list(@UserId() userId: number): Promise<Strategy[]> {
    return this.strategies.list(userId);
  }

  @Post()
  async create(@UserId() userId: number, @Body() dto: CreateStrategyDto): Promise<Strategy> {
    return this.strategies.create(userId, dto);
  }

  /** API-27：由 TOOL-C07 回测卡片创建策略（服务端按配置重跑等权真引擎） */
  @Post('from-backtest')
  async createFromBacktest(@UserId() userId: number, @Body() dto: CreateFromBacktestDto): Promise<Strategy> {
    return this.strategies.createFromBacktest(userId, dto);
  }

  /** 更新配置 = 保存并自动重新回测 */
  @Patch(':id')
  async update(@UserId() userId: number, @Param('id') id: string, @Body() dto: UpdateStrategyDto): Promise<Strategy> {
    return this.strategies.update(userId, id, dto);
  }

  @Post(':id/backtest')
  async backtest(@UserId() userId: number, @Param('id') id: string, @Body() dto: BacktestParamsDto): Promise<Strategy> {
    return this.strategies.backtest(userId, id, dto ?? {});
  }

  @Get(':id/report')
  async report(@UserId() userId: number, @Param('id') id: string) {
    return this.strategies.getReport(userId, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@UserId() userId: number, @Param('id') id: string): Promise<void> {
    await this.strategies.remove(userId, id);
  }
}
