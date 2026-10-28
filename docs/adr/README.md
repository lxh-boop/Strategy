# docs/adr — 架构决策记录（ADR）

每个 ADR 一份定案：背景、取舍、结论。编号递增，定稿后不改历史、只追加新 ADR 推翻旧 ADR。

```text
adr/
├── 0001-confirmation-gate-interrupt.md            # 回测执行前的确认门（LangGraph interrupt）
├── 0002-exclude-range-frozen-valuation.md         # 剔除区间冻结估值口径
├── 0003-keep-rule-protection-matrix.md            # 不卖条件（keep rules）保护矩阵
├── 0004-dual-data-engine-dictionary-routing.md    # 双数据引擎与字典路由
├── 0005-weight-position-functions.md              # 权重与仓位函数化
├── 0006-pool-screen-tool-and-handle.md            # 股票池筛选工具与句柄
├── 0007-cross-conversation-memory.md              # 跨对话记忆与上下文压缩
├── 0008-position-maintenance-and-limit-updown-skip.md   # 仓位维持与涨跌停跳过
├── 0009-limit-gate-global-and-official-tiers.md   # 涨跌停总开关 + 官方分档价
├── 0010-conversation-scoped-backtest-card-registry.md   # 回测卡会话级注册表
├── 0011-field-based-pool-screening.md             # 字段化股票池筛选
└── 0012-agent-evals-suite.md                      # 智能体自建测评套件
```
