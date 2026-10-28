# src/core/implementations — 核心域实现

```text
implementations/
├── account-backtest-execution.service.impl.ts   # 基于 Account 原语的回测执行实现
├── factor-analysis.service.impl.ts              # 因子分析实现
├── memory-file-store.service.ts                 # 记忆的文件存储实现（memories/<uid>/）
├── memory-user-store.service.ts                 # 内存桩实现（开发/测试用）
├── mysql-factor-data.service.ts                 # 因子数据 MySQL 实现：交易日/截面/区间读取、字典列类型分流
├── mysql-user-store.service.ts                  # 用户数据 MySQL 实现：策略/会话/记忆/回测存档
├── strategy-backtest.service.impl.ts            # 策略回测实现：信号预计算→逐日事件内核→卡片产出
└── trigger-backtest.service.impl.ts             # 触发式回测实现
```
