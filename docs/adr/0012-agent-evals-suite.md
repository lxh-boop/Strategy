# ADR-0012：智能体自建测评体系（evals/）

Status: accepted（2026-10-23 拍板实施；方案见 `docs/智能体测评体系方案.md`，一期离线层当日落地）

## Context

智能体主链路（工具循环 + 确认门 + 防编造 + 记忆）功能基本齐备后，两个需求没有数据支撑：

1. **对外说明水平**——非开发者需要"系统现在到什么水平"的可读指标；
2. **优化依据**——改提示词 / 换 GLM 版本 / 加工具后，需要可比的指标变化，而不是"单测挂没挂"的二值信息。

现成基准调研结论（2026-10-23）：BFCL / τ²-bench / SuperCLUE-Agent 测模型或通用智能体，InvestorBench / StockBench 测单标的交易决策——没有一个能测"因子研究智能体"的编排、参数口径、防编造、确认门。历史上三次编造事故（零工具调用编股票池等）与调优口径漂移事故都指向同一结论：本领域最危险的失败是**长引信式**的——引擎照常跑完、结果看似合理，错误要很久之后才暴露，回复文案完全看不出来。

## Decision

1. **自建，顶层 `evals/` 目录**（与前后端同级，独立 TS 包，jest 仅作 TS 执行器）。被评对象 = LangGraph 智能体整体，不是 GLM 模型本身。
2. **真 GLM + 真图 + mock 引擎桩**：装配口径与 server 真图测试同款（手动 `new LangGraphAgentService`，三个引擎依赖换录制版 mock 桩）；池句柄 / 长期记忆 / 行业解析走真实现。server 侧零改动。
3. **断言点 = 轨迹不是文案**：硬项全部断言模型提出的原始 tool_calls 参数与 mock 引擎实收参数（`entryFilters` / `sortFactors` / `industries` / `weightFn` / `executionTiming` 等），这是"引擎参数 = 卡片内容"原则在测评侧的延伸。judge（LLM-as-judge）只管两个软项：澄清是否恰当、是否凭记忆编造。
4. **指标卡五项**：任务完成率 pass^4（τ²-bench 口径）、参数口径正确率、编造率、澄清恰当率、单任务成本（轮数 / 工具调用 / token / 墙钟）。每轮跑批产出 `reports/scorecard-<label>-<时间>.md + .json`，入 git 看趋势。
5. **用例脚本化 + 协议校验**：任务 = 多轮用户输入（含确认门答复）+ 检查；runner 校验脚本协议（挂起时只能答确认、未挂起不能答）——协议偏差本身就是行为信号。plain「确认」为循环语义（提案被白名单快检打回、模型自纠重发后再答一次，真实用户同理），feedback / 授权调优为单次语义。
6. **合理自由度不惩罚**：日历日期期望用二选一（`$oneOf`：日历边界 ∪ 首末交易日）；相对时间只断 8 位字符串。测的是口径是否落地，不是换算路径是否唯一。
7. **与现有单测分工不替代**：mock-LLM 确定性单测继续守编排逻辑（免费、毫秒级、进 CI）；evals 测真实 GLM 行为水平（慢、花 token、非确定，手动 / 定期跑，不进 CI 门禁）。
8. **依赖双副本边界纪律**：evals 自装 `@langchain/*`（不映射到 server 副本——mapper 指向包根会绕过 package.json exports 拿到 ESM shim）。安全前提：server 侧对象（BaseMessage 等）从不由 evals 构造后传入 server；`ApiException` 一律从 server 文件导入保证 `instanceof` 同源；judge 为自包含子树。

## Considered Options

- **刷现成榜单**：否决——测的是模型不是系统；垂直系统没有榜，行业通行做法就是自建评测集 + 方法论（RSI Bench / o11y-bench / EdgeBench 皆为自建）。
- **HTTP 黑盒驱动**（对运行中的 server 发 SSE）：否决——进程边界无法 mock 工具，离线层不成立；确认门恢复也难以脚本化。
- **根 npm workspaces**：否决——动根配置影响前后端安装与脚本习惯；代价改为 tsconfig 与 server 保持一致（commonjs / ES2023 / experimentalDecorators）。
- **judge 全量评分**：否决——硬项交给 judge 会引入非确定性与同档自评偏置；judge 只兜"澄清质量 / 编造判定"两个不可结构化的软项。

## Consequences

- 一轮离线基线 ≈ 50 任务 × 4 次 × 10~20 次 LLM 调用，20~60 分钟 + 真实 token 费用；首轮基线后把实际开销记录进指标卡。
- 指标卡随提示词 / 模型 / 工具变更需重跑对比；`EVAL_LABEL` 区分轮次。
- 在线端到端层（真库真引擎）为二期：装配需要真实 MySQL / DuckDB 注入，离线基线跑通后实施。
- 50 条用例是活的资产：新事故（如新的编造手法）应固化为新用例，用例集随系统演进。
