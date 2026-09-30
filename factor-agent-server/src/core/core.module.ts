import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BacktestService } from './backtest.service';
import { EqualWeightBacktestService } from './equal-weight-backtest.service';
import { FactorDataService } from './factor-data.service';
import { ScreenService } from './screen.service';
import { StoreService } from './store.service';
import { EqualWeightBacktestServiceImpl } from './implementations/equal-weight-backtest.service.impl';
import { UserStoreService } from './user-store.service';
import { MemoryStoreService } from './implementations/memory-store.service';
import { MemoryUserStoreService } from './implementations/memory-user-store.service';
import { MysqlFactorDataService } from './implementations/mysql-factor-data.service';
import { MysqlUserStoreService } from './implementations/mysql-user-store.service';
import { MockBacktestService } from './implementations/mock-backtest.service';
import { MockScreenService } from './implementations/mock-screen.service';

/**
 * 领域共享层：接口（token）→ 实现类 的装配点。
 *   存储   StoreService   → MemoryStoreService（内存 + 种子测试样例，公共配置数据）
 *   用户库 UserStoreService → MysqlUserStoreService（USER_DB_HOST 已配置时）
 *                           / MemoryUserStoreService（未配置时开发兜底）
 *   回测   BacktestService → MockBacktestService（随机数据，确定性可复现）
 *   筛选   ScreenService   → MockScreenService（演示股票池）
 *   因子取数 FactorDataService → MysqlFactorDataService（MySQL herms_data 库）
 *   等权回测 EqualWeightBacktestService → EqualWeightBacktestServiceImpl（经 FactorDataService 取数的纯编排）
 * 换实现只改这一处，上层（B/C）零改动。
 */
@Global()
@Module({
  providers: [
    { provide: StoreService, useClass: MemoryStoreService },
    {
      provide: UserStoreService,
      // .env 配了 USER_DB_HOST 走共享 MySQL 用户库，否则内存兜底（本地无库联调）
      useFactory: (config: ConfigService) =>
        config.get('userDb.host') ? new MysqlUserStoreService(config) : new MemoryUserStoreService(),
      inject: [ConfigService],
    },
    { provide: BacktestService, useClass: MockBacktestService },
    { provide: ScreenService, useClass: MockScreenService },
    { provide: FactorDataService, useClass: MysqlFactorDataService },
    { provide: EqualWeightBacktestService, useClass: EqualWeightBacktestServiceImpl },
  ],
  exports: [StoreService, UserStoreService, BacktestService, ScreenService, FactorDataService, EqualWeightBacktestService],
})
export class CoreModule {}
