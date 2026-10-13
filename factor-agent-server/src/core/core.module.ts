import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FactorDataService } from './factor-data.service';
import { ScreenService } from './screen.service';
import { StoreService } from './store.service';
import { StrategyBacktestService } from './strategy-backtest.service';
import { UserStoreService } from './user-store.service';
import { MemoryStoreService } from './implementations/memory-store.service';
import { MemoryUserStoreService } from './implementations/memory-user-store.service';
import { MysqlFactorDataService } from './implementations/mysql-factor-data.service';
import { MysqlUserStoreService } from './implementations/mysql-user-store.service';
import { MockScreenService } from './implementations/mock-screen.service';
import { StrategyBacktestServiceImpl } from './implementations/strategy-backtest.service.impl';

/**
 * 领域共享层：接口（token）→ 实现类 的装配点。
 *   存储   StoreService   → MemoryStoreService（内存 + 种子测试样例，公共配置数据）
 *   用户库 UserStoreService → MysqlUserStoreService（USER_DB_HOST 已配置时）
 *                           / MemoryUserStoreService（未配置时开发兜底）
 *   筛选   ScreenService   → MockScreenService（演示股票池）
 *   因子取数 FactorDataService → MysqlFactorDataService（MySQL herms_data 库）
 *   策略回测 StrategyBacktestService → StrategyBacktestServiceImpl（日频事件内核，经 FactorDataService 取数）
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
    { provide: ScreenService, useClass: MockScreenService },
    { provide: FactorDataService, useClass: MysqlFactorDataService },
    { provide: StrategyBacktestService, useClass: StrategyBacktestServiceImpl },
  ],
  exports: [StoreService, UserStoreService, ScreenService, FactorDataService, StrategyBacktestService],
})
export class CoreModule {}
