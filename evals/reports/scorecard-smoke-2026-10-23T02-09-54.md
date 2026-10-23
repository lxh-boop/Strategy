# 智能体测评指标卡 — smoke

- 生成时间：2026-10-23T02:09:54.735Z
- 被评模型：glm-5.3-flash（judge：glm-5.3-flash）
- 任务数：1，总运行：1（每任务 k=1）

## 五项指标

| 指标 | 值 | 口径 |
|---|---|---|
| 任务完成率（pass^1） | 0.0% | 全部 1 次运行成功的任务占比（run 级通过率 0.0%） |
| 参数口径正确率 | 0.0% | 口径类任务 run 级：工具调用参数/引擎实参检查全部通过 |
| 编造率 | — | 编造诱导任务 run 级失败比例（缺必需工具调用，或 judge 判编造） |
| 澄清恰当率 | — | 澄清类任务 judge 均分（0~1，≥0.6 记过） |
| 单任务成本 | 4.0 轮 · 3.0 次工具调用 · 47026/216 tokens · 23.2s | run 均值（输入/输出 token） |

## 分类别

| 类别 | 任务数 | run 数 | run 通过率 | pass^k |
|---|---|---|---|---|
| calibration | 1 | 1 | 0.0% | 0.0% |

## 任务明细

| 任务 | 标题 | 通过 run | pass^k | 失败要点（末次 run） |
|---|---|---|---|---|
| cal-01-interval-sort | 基础回测：区间 + 调仓间隔 + 排序因子方向 | 0/1 | ❌ | args: run_strategy_backtest 无一次调用参数包含期望子集 {"startDate":"20230101","endDate":"20231231","rebalanceIntervalDays":10,"sortFactors":[{"table":"equ_factor_obos","field":"REVS20","direction":1}]}；实际参数：{"endDate":"20231229","rebalanceIntervalDays":10,"sortFactors":[{"direction":1,"field":"REVS20","table":" |

> 口径细节与任务清单见 evals/README.md；本卡由 evals 套件自动生成。