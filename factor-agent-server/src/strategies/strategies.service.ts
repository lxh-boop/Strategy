import { Injectable } from '@nestjs/common';
import { BacktestParamsDto, CreateStrategyDto, UpdateStrategyDto } from './dto';
import { Strategy } from '../types';

/* ==========================================================
   策略业务接口（B-INT-02，契约层）—— strategies.controller 的依赖。
   M13 起全部方法带 userId 首参（来自 JWT，实现按用户隔离数据）。
   实现：implementations/strategies.service.impl.ts
   ========================================================== */

type StrategyReport = Pick<Strategy, 'metrics' | 'curve' | 'benchCurve' | 'holdings'>;

@Injectable()
export abstract class StrategiesService {
  abstract list(userId: number): Promise<Strategy[]>;
  abstract create(userId: number, dto: CreateStrategyDto): Promise<Strategy>;

  /** 更新配置并自动重新回测（契约：保存 = 重新回测，同一动作） */
  abstract update(userId: number, id: string, dto: UpdateStrategyDto): Promise<Strategy>;
  abstract remove(userId: number, id: string): Promise<void>;
  abstract backtest(userId: number, id: string, params: BacktestParamsDto): Promise<Strategy>;
  abstract getReport(userId: number, id: string): Promise<StrategyReport>;
}
