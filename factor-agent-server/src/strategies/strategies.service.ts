import { Injectable } from '@nestjs/common';
import { BacktestParamsDto, CreateStrategyDto, UpdateStrategyDto } from './dto';
import { Strategy } from '../types';

/* ==========================================================
   策略业务接口（B-INT-02，契约层）—— strategies.controller 的依赖。
   实现：implementations/strategies.service.impl.ts
   ========================================================== */

type StrategyReport = Pick<Strategy, 'metrics' | 'curve' | 'benchCurve' | 'holdings'>;

@Injectable()
export abstract class StrategiesService {
  abstract list(): Strategy[];
  abstract create(dto: CreateStrategyDto): Strategy;

  /** 更新配置并自动重新回测（契约：保存 = 重新回测，同一动作） */
  abstract update(id: string, dto: UpdateStrategyDto): Strategy;
  abstract remove(id: string): void;
  abstract backtest(id: string, params: BacktestParamsDto): Strategy;
  abstract report(id: string): StrategyReport;
}
