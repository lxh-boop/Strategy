# src/core — 核心域

回测引擎、数据服务与存储契约：纯域逻辑不依赖框架，接口 + implementations 可替换。

```text
core/
├── account.ts                       # 账户原语：现金/持仓/FIFO 平仓、涨跌停闸、滑点
├── attribution.ts                   # 归因聚合纯函数：个股/规则/行为四分类/回撤窗/尾部
├── backtest-execution.service.ts    # 回测执行抽象接口
├── core.module.ts                   # 模块装配
├── factor-analysis.service.ts       # 因子分析抽象接口
├── factor-schema.ts                 # 因子表 schema 描述（供工具与校验）
├── industry-engine.ts               # 行业等权引擎
├── memory-store.service.ts          # 记忆存储抽象接口
├── metrics.ts                       # 绩效指标：年化/回撤/夏普/胜率/换手
├── strategy-backtest.service.ts     # 策略回测抽象接口与入参/出参类型
├── timing.ts                        # 择时/成交时点工具
├── trigger-backtest.service.ts      # 触发式回测抽象接口
├── user-store.service.ts            # 用户数据存储抽象接口
├── weight-functions.ts              # 权重/仓位函数库
└── implementations/                 # 上述接口的 MySQL / 文件 / 账户实现
```
