import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'node:path';
import { FactorDataService } from './factor-data.service';
import { StrategyBacktestService } from './strategy-backtest.service';
import { BacktestExecutionService } from './backtest-execution.service';
import { UserStoreService } from './user-store.service';
import { MemoryStoreService } from './memory-store.service';
import { MemoryUserStoreService } from './implementations/memory-user-store.service';
import { MysqlFactorDataService } from './implementations/mysql-factor-data.service';
import { MysqlUserStoreService } from './implementations/mysql-user-store.service';
import { MemoryFileStoreService } from './implementations/memory-file-store.service';
import { StrategyBacktestServiceImpl } from './implementations/strategy-backtest.service.impl';
import { TriggerBacktestService } from './trigger-backtest.service';
import { TriggerBacktestServiceImpl } from './implementations/trigger-backtest.service.impl';
import { FactorAnalysisService } from './factor-analysis.service';
import { FactorAnalysisServiceImpl } from './implementations/factor-analysis.service.impl';
import { AccountBacktestExecutionService } from './implementations/account-backtest-execution.service.impl';

/**
 * 领域共享层：接口（token）→ 实现类 的装配点。
 *   用户库 UserStoreService → MysqlUserStoreService（USER_DB_HOST 已配置时）
 *                           / MemoryUserStoreService（未配置时开发兜底）
 *   因子取数 FactorDataService → MysqlFactorDataService（MySQL herms_data 库）
 *   策略回测 StrategyBacktestService → StrategyBacktestServiceImpl（日频事件内核，经 FactorDataService 取数）
 *   回测执行层 BacktestExecutionService → AccountBacktestExecutionService（TS 内核包装，dolp 形状输出；
 *                                       将来切 DolphinDB 插件时换同契约实现）
 * 换实现只改这一处，上层（B/C）零改动。
 */
@Global()
@Module({
  providers: [
    {
      provide: UserStoreService,
      // .env 配了 USER_DB_HOST 走共享 MySQL 用户库，否则内存兜底（本地无库联调）
      useFactory: (config: ConfigService) =>
        config.get('userDb.host') ? new MysqlUserStoreService(config) : new MemoryUserStoreService(),
      inject: [ConfigService],
    },
    { provide: FactorDataService, useClass: MysqlFactorDataService },
    {
      provide: MemoryStoreService,
      // 长期记忆落本地 md 文件（ADR-0007，刻意不进数据库）：缺省 <运行目录>/memories
      useFactory: (config: ConfigService) =>
        new MemoryFileStoreService(config.get<string>('memories.dir') || path.join(process.cwd(), 'memories')),
      inject: [ConfigService],
    },
    { provide: StrategyBacktestService, useClass: StrategyBacktestServiceImpl },
    { provide: TriggerBacktestService, useClass: TriggerBacktestServiceImpl },
    { provide: BacktestExecutionService, useClass: AccountBacktestExecutionService },
    { provide: FactorAnalysisService, useClass: FactorAnalysisServiceImpl },
  ],
  exports: [
    UserStoreService,
    MemoryStoreService,
    FactorDataService,
    StrategyBacktestService,
    BacktestExecutionService,
    FactorAnalysisService,
  ],
})
export class CoreModule {}
