import { Global, Module } from '@nestjs/common';
import { BacktestService } from './backtest.service';
import { EqualWeightBacktestService } from './equal-weight-backtest.service';
import { FactorDataService } from './factor-data.service';
import { ScreenService } from './screen.service';
import { StoreService } from './store.service';
import { EqualWeightBacktestServiceImpl } from './implementations/equal-weight-backtest.service.impl';
import { MemoryStoreService } from './implementations/memory-store.service';
import { MysqlFactorDataService } from './implementations/mysql-factor-data.service';
import { MockBacktestService } from './implementations/mock-backtest.service';
import { MockScreenService } from './implementations/mock-screen.service';

/**
 * 领域共享层：接口（token）→ 实现类 的装配点。
 *   存储   StoreService   → MemoryStoreService（内存 + 种子测试样例）
 *   回测   BacktestService → MockBacktestService（随机数据，确定性可复现）
 *   筛选   ScreenService   → MockScreenService（演示股票池）
 *   因子取数 FactorDataService → MysqlFactorDataService（MySQL hems_data 库）
 *   等权回测 EqualWeightBacktestService → EqualWeightBacktestServiceImpl（经 FactorDataService 取数的纯编排）
 * 换实现只改 useClass，上层（B/C）零改动。
 */
@Global()
@Module({
  providers: [
    { provide: StoreService, useClass: MemoryStoreService },
    { provide: BacktestService, useClass: MockBacktestService },
    { provide: ScreenService, useClass: MockScreenService },
    { provide: FactorDataService, useClass: MysqlFactorDataService },
    { provide: EqualWeightBacktestService, useClass: EqualWeightBacktestServiceImpl },
  ],
  exports: [StoreService, BacktestService, ScreenService, FactorDataService, EqualWeightBacktestService],
})
export class CoreModule {}
