import { Global, Module } from '@nestjs/common';
import { StoreService } from './store.service';
import { BacktestService } from './backtest.service';
import { ScreenService } from './screen.service';

/** 领域共享服务：内存存储 / 模拟回测 / 选股筛选 */
@Global()
@Module({
  providers: [StoreService, BacktestService, ScreenService],
  exports: [StoreService, BacktestService, ScreenService],
})
export class CoreModule {}
