# evals — 因子智投智能体自建测评套件

真 GLM 驱动真 LangGraph 图（mock 引擎桩），产出标准指标卡：
**任务完成率 pass^k / 参数口径正确率 / 编造率 / 澄清恰当率 / 单任务成本**。

- 方案：`docs/智能体测评体系方案.md`
- 被评对象 = LangGraph 智能体整体（GLM + 提示词 + 工具定义 + 确认门），不是 GLM 模型本身。

## 跑法

```bash
cd evals
npm install

# 全量离线层基线（50 任务 × 4 次，约 20-60 分钟 + GLM token）
npm run eval

# 快速冒烟：单任务单次
EVAL_K=1 EVAL_TASKS=cal-01 npm run eval

# 换标签跑一轮对比（改提示词/换模型前后各跑一次）
EVAL_LABEL=after-prompt-change npm run eval

# 单测与类型检查
npx jest --config jest.config.js src/match.spec.ts
npm run typecheck
```

环境：GLM Key 从 `factor-agent-server/.env` 读取（`ZHIPU_API_KEY` / `ZHIPU_MODEL` / `ZHIPU_BASE_URL`），
也可用同名环境变量覆盖。judge 模型可用 `ZHIPU_JUDGE_MODEL` 指定更高档位（建议）。

## 指标口径

| 指标 | 口径 |
|---|---|
| 任务完成率 pass^k | 同一任务独立跑 k 次**全部成功**才算通过（τ²-bench 口径）；成功 = 脚本协议无偏差 + 全部检查通过 + judge（若有）达标 |
| 参数口径正确率 | 口径类任务 run 级：模型原始工具调用参数与引擎实参的检查全部通过 |
| 编造率 | 编造诱导任务 run 级失败比例（缺必需工具调用，或 judge 判凭记忆编造） |
| 澄清恰当率 | 澄清类任务 judge 均分（0~1，≥0.6 记过） |
| 单任务成本 | run 均值：LLM 轮数、工具调用次数、token、墙钟秒 |

判分纪律：**硬项一律轨迹断言**（断言点 = 模型提出的原始 tool_calls 参数与 mock 引擎实收参数，
不是回复文案）；judge 只管"澄清是否恰当 / 是否凭记忆编造"两个软项。

## 结构

```
src/
  types.ts      任务/轨迹/检查类型（tasks-schema）
  harness.ts    装配：真 GLM + 真图 + mock 引擎桩（与 server 真图测试同款手动 new），
                构造后用录制代理重建图采集每轮完整 tool_calls 与 token
  runner.ts     跑批器：脚本化步骤（含确认门答复协议）→ 检查 → judge；单任务失败隔离
  match.ts      期望参数子集匹配器（{$type}/{$contains} 标记）
  metrics.ts    指标聚合（五项指标）
  report.ts     指标卡渲染（md + json，写入 reports/）
  judges.ts     LLM-as-judge（澄清/编造两套 rubric）
  eval.spec.ts  入口（jest 仅作 TS 执行器）
tasks/
  offline/      口径 20 / 防编造 10 / 澄清 10 / 确认路由 10（共 50）
  online/       端到端真库任务（二期）
reports/        历次指标卡（md + json，入 git 看趋势）
```

## 工程约束（重要）

- **依赖双副本的边界纪律**：evals 自装 `@langchain/*`（server 也有一份）。双副本安全的前提是
  server 侧对象从不由 evals 构造后传入 server——harness 的录制代理只透传 server 自建的消息对象、
  `ApiException` 一律从 server 文件导入（保证 `instanceof` 同源）、judge 是自包含子树。
  不要把 evals 侧 new 出来的 langchain 对象塞进 service 的任何入口。
  （也不能反向把 `@langchain/*` 映射到 server 的 node_modules：mapper 指向包根会绕过
  package.json exports 拿到 ESM shim，jest 直接语法错误。）
- server 侧**零改动**：harness 只 import（私有成员访问用 `as unknown as` 口径，
  与 `factor-agent-server/test/core/implementations/langgraph-agent.service.spec.ts` 相同）。
- 跑批必须 `--runInBand`（GLM 顺序请求 + industry.duckdb 文件锁）。
- mock 引擎桩是确定性假数据；`screen_stock_pool` / 池句柄 / 长期记忆走真实现
  （MemoryUserStore + 临时目录），行业解析走真实引擎 B 只读数据。
- 会话日志会写入 server 的 `logs/conversations/eval-*.log`（复用生产日志管道，可对照排查）。

## 指标卡的用法

改提示词 / 换 GLM 版本 / 加工具 → 各跑一轮（不同 `EVAL_LABEL`）→ 对比 reports/ 下相邻两张卡。
第一张卡即基线；token 实际开销以第一轮为准记录。
