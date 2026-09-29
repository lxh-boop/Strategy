# HTTP 接口状态（API-01 ~ API-24）

> 与 `docs/模块划分文档.md` §3.1 一一对应；API-19~20 为规划接口，API-21~24 进行中（M13 登录鉴权）；
> 状态规则见 [README.md](README.md)。
> 已实现接口在状态列按三段写：**功能**（大概做什么）/ **参数**（入参结构）/ **依赖接口**（依赖哪一个接口）。

## 现有接口（API-01 ~ API-18）

| 编号 | 接口 | 说明 | 负责人 | 状态 | 完成提交/日期 |
|---|---|---|---|---|---|
| API-01 | GET `/api/health` | 健康检查：`zhipuConfigured`、`defaultModel` | 待认领 | ✅ 已实现<br>**功能**：健康检查，探测服务存活与智谱 Key 配置状态<br>**参数**：无<br>**依赖接口**：SVC-Z01（`ZhipuService.configured` / `defaultModel`） | f0388f2（2026-09-28） |
| API-02 | GET `/api/conversations` | 会话列表（含全部消息，按更新时间倒序） | 待认领 | ✅ 已实现<br>**功能**：会话列表，含全部消息，按更新时间倒序<br>**参数**：无<br>**依赖接口**：B-INT-01（list）→ SVC-D05 | f0388f2（2026-09-28） |
| API-03 | POST `/api/conversations` | 新建会话（后端自动带欢迎语） | 待认领 | ✅ 已实现<br>**功能**：新建会话，后端自动带欢迎语<br>**参数**：无<br>**依赖接口**：B-INT-01（create）→ SVC-D07 | f0388f2（2026-09-28） |
| API-04 | DELETE `/api/conversations/:id` | 删除会话 | 待认领 | ✅ 已实现<br>**功能**：删除会话，成功返回 204<br>**参数**：路径参数 `id`<br>**依赖接口**：B-INT-01（remove）→ SVC-D08 | f0388f2（2026-09-28） |
| API-05 | POST `/api/conversations/:id/clear` | 清空会话（保留会话，恢复欢迎语、标题重置） | 待认领 | ✅ 已实现<br>**功能**：清空会话：保留会话本体、恢复欢迎语、标题重置<br>**参数**：路径参数 `id`<br>**依赖接口**：B-INT-01（clear）→ SVC-D09 | f0388f2（2026-09-28） |
| API-06 | GET `/api/conversations/:id/messages` | 拉取历史消息（列表已带全量，留给分页场景） | 待认领 | ✅ 已实现<br>**功能**：拉取会话历史消息<br>**参数**：路径参数 `id`<br>**依赖接口**：B-INT-01（getMessages）→ SVC-D06 | f0388f2（2026-09-28） |
| API-07 | POST `/api/conversations/:id/messages` | **发消息（核心链路）**：调智能体，返回 `{userMessage, agentMessage}`，agent 消息可含卡片；M11 将改造为 SSE 流式 | 待认领 | ✅ 已实现<br>**功能**：发消息核心链路：校验 → 调智能体 → 落库命名，返回 `{userMessage, agentMessage}`，可含 report/backtest/stocks 卡片<br>**参数**：路径 `id` + Body `{ text }`（必填，≤2000 字）<br>**依赖接口**：B-INT-01（sendMessage）→ SVC-C01（智能体）+ SVC-D10 / SVC-D11（落库 / 命名） | f0388f2（2026-09-28） |
| API-08 | GET `/api/strategies` | 策略列表（含曲线、指标、持仓） | 待认领 | ✅ 已实现<br>**功能**：策略列表，含曲线、指标、持仓<br>**参数**：无<br>**依赖接口**：B-INT-02（list）→ SVC-D01 | f0388f2（2026-09-28） |
| API-09 | POST `/api/strategies` | 创建策略（草稿）；对话卡片"保存为我的策略"也走此接口 | 待认领 | ✅ 已实现<br>**功能**：创建策略（草稿）<br>**参数**：Body `{ name（必填）; factors ≥1 项 [{name, weight≥0}]（必填）; universe? / rebalance? / benchmark?（可选）}`<br>**依赖接口**：B-INT-02（create）→ SVC-D03 | f0388f2（2026-09-28） |
| API-10 | PATCH `/api/strategies/:id` | 更新配置 = **保存并自动重新回测**，返回更新后完整 Strategy | 待认领 | ✅ 已实现<br>**功能**：更新配置 = 保存并自动重新回测，返回更新后完整 Strategy<br>**参数**：路径 `id` + Body 全部可选 `{ name? / universe? / rebalance? / benchmark? / factors?（≥1 项）}`<br>**依赖接口**：B-INT-02（update）→ SVC-D03 + SVC-D19（回测）+ SVC-D21（normalizeWeights） | f0388f2（2026-09-28） |
| API-11 | POST `/api/strategies/:id/backtest` | 重新回测（可带 period/topK/feeRate，缺省用默认值） | 待认领 | ✅ 已实现<br>**功能**：重新回测，返回更新后 Strategy<br>**参数**：路径 `id` + Body 可选 `{ period? {start, end} / topK?（≥1）/ feeRate?（≥0）}`，缺省用默认值<br>**依赖接口**：B-INT-02（backtest）→ SVC-D19 | f0388f2（2026-09-28） |
| API-12 | GET `/api/strategies/:id/report` | 回测报告详情 `{metrics, curve, benchCurve, holdings}` | 待认领 | ✅ 已实现<br>**功能**：回测报告详情<br>**参数**：路径参数 `id`<br>**依赖接口**：B-INT-02（getReport）→ SVC-D02 + SVC-D19 回测产物 | f0388f2（2026-09-28） |
| API-13 | DELETE `/api/strategies/:id` | 删除策略 | 待认领 | ✅ 已实现<br>**功能**：删除策略，成功返回 204<br>**参数**：路径参数 `id`<br>**依赖接口**：B-INT-02（remove）→ SVC-D04 | f0388f2（2026-09-28） |
| API-14 | GET `/api/factors` | 因子库 9 项 `{id, name, desc}`（UI 数据驱动） | 待认领 | ✅ 已实现<br>**功能**：因子库 9 项下发，前端数据驱动渲染<br>**参数**：无<br>**依赖接口**：B-INT-03（listFactors）→ SVC-D14 | f0388f2（2026-09-28） |
| API-15 | GET `/api/backtest-params` | 回测参数项 `{label, value, hint}`（UI 自动渲染） | 待认领 | ✅ 已实现<br>**功能**：回测参数项下发，前端自动渲染<br>**参数**：无<br>**依赖接口**：B-INT-03（listBtParams）→ SVC-D15 | f0388f2（2026-09-28） |
| API-16 | POST `/api/screen` | 选股筛选 `{universe?, filters[], topN?}` → `{stocks, total}` | 待认领 | ✅ 已实现<br>**功能**：选股筛选，返回 `{stocks, total}`<br>**参数**：Body `{ universe?; filters ≥1 项 [{field ∈ roe_ttm/pe_percentile/dividend_yield/volatility/momentum_20d, op ∈ > / < / >= / <= / ==, value: number}]; topN?（默认 5）}`<br>**依赖接口**：B-INT-03（screen）→ SVC-D20 | f0388f2（2026-09-28） |
| API-17 | GET `/api/user/profile` | 用户信息 + 因子偏好雷达 + 设置项（模型/数据来源为 readonly 展示） | 待认领 | ✅ 已实现<br>**功能**：用户信息 + 因子偏好雷达 + 设置项展示<br>**参数**：无<br>**依赖接口**：B-INT-04（getProfile）→ SVC-D17 | f0388f2（2026-09-28） |
| API-18 | PATCH `/api/user/settings` | 更新设置项，仅 notify/report/risk 可配置（toggle 传 `on`、single 传 `value`），其余 key 400 | 待认领 | ✅ 已实现<br>**功能**：更新设置项，白名单外 key 返回 400<br>**参数**：Body `{ key ∈ notify/report/risk; on?（boolean，toggle 项）; value?（string，single 项）}`<br>**依赖接口**：B-INT-04（updateSetting）→ SVC-D18 | f0388f2（2026-09-28） |

## 进行中（M13 登录鉴权与多用户：API-21 ~ API-24）

| 编号 | 接口 | 说明 | 负责人 | 状态 | 完成提交/日期 |
|---|---|---|---|---|---|
| API-21 | POST `/api/auth/register` | 用户注册，注册即登录 | CZT123526 | 🚧 进行中 | |
| API-22 | POST `/api/auth/login` | 登录，签发 token | CZT123526 | 🚧 进行中 | |
| API-23 | POST `/api/auth/logout` | 登出，使旧 token 失效 | CZT123526 | 🚧 进行中 | |
| API-24 | GET `/api/auth/me` | 当前登录用户信息 | CZT123526 | 🚧 进行中 | |

> **功能**：注册/登录/登出/当前用户，JWT（7 天）鉴权，数据按用户隔离<br>
> **参数**：字段级定义见 `factor-agent-react/docs/backend-api.md` §7<br>
> **依赖接口**：B-INT-05（auth 业务）→ SVC-D23（用户库存储）；21/22 公开，23/24 及其余业务接口需 Bearer

## 规划接口（API-19 ~ API-20，M15~M16 认领后细化定义）

| 编号 | 接口 | 说明 | 负责人 | 状态 | 完成提交/日期 |
|---|---|---|---|---|---|
| API-19 | GET `/api/strategies/:id/backtest/status` | 回测进度查询（轮询） | 待认领 | ⬜ 未实现 | |
| API-20 | GET `/api/strategies/:id/report/export` | 回测报告导出 PDF | 待认领 | ⬜ 未实现 | |

> **预留编号段**：API-25 起为新接口追加位，新增接口按序顺延，不回收、不复用。
