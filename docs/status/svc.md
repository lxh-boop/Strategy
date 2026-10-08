# 进程内服务接口状态（SVC / TOOL / C-INT / EXT）

> 与 `docs/模块划分文档.md` §3.3 / §3.4 一一对应；状态规则见 [README.md](README.md)。

## 智能体引擎（模块 C 提供）

| 编号 | 接口 | 说明 | 负责人 | 状态 | 完成提交/日期 |
|---|---|---|---|---|---|
| SVC-C01 | `AgentService.reply(conversation, userText, routeText): Promise<AgentReply>`；`replyStream(…, onProgress)` 流式形态 | 智能体唯一公开方法。出参 `{ text, card? }`：text 为文案（GLM 失败时=失败原因）；card 在本次执行跑成等权回测时为净值卡片（TOOL-C07，卡片绕过 LLM 直达前端），其余场景无卡片。routeText 参数保留、当前未使用。replyStream 默认委托 reply；LangGraph 实现经图状态 onProgress 通道推节点级事件（AgentProgressEvent：start/tool_call/tool_result/error，无推理流式） | chenhaotao | ✅ 已实现 | 345a98f 重写（2026-09-29） |
| TOOL-C01 | `select_factors(factors[], universe?, rebalance?, name?, tag?)` | **已废弃（2026-09-29）**：旧"选风格因子"工具，随 mock 回测链路下线，由 TOOL-C05+TOOL-C06 取代 | chenhaotao | ➖ 废弃 | 345a98f（2026-09-29） |
| TOOL-C02 | `run_backtest()` | **已废弃（2026-09-29）**：旧 mock 回测工具，真库链路无回测 | chenhaotao | ➖ 废弃 | 345a98f（2026-09-29） |
| TOOL-C03 | `query_factors(...)` | **规划取消**：原单工具因子查询演化为 TOOL-C04~C06 三个按需工具 | chenhaotao | ➖ 废弃 | 345a98f（2026-09-29） |
| TOOL-C04 | `list_factor_tables()` | LLM 工具：返回 `SQL/tables.md` 表目录（表名/中文名/说明/唯一键）；选取因子前必须先调用 | chenhaotao | ✅ 已实现 | 345a98f（2026-09-29） |
| TOOL-C05 | `list_factor_fields(tables[])` | LLM 工具：按表名列表（可多表）返回字段明细（字段名/中文名/类型/可空/描述）；表名必须来自 TOOL-C04，非法表进 notFound 并附可用表 | chenhaotao | ✅ 已实现 | 345a98f（2026-09-29） |
| TOOL-C06 | `read_factor_data(table, fields[], date, security)` | LLM 工具：调 SVC-D22 查库并把行 JSON 回给模型；显式四参数，格式/白名单由 SVC-D22 校验 | chenhaotao | ✅ 已实现 | 345a98f（2026-09-29） |
| TOOL-C07 | `run_equal_weight_backtest(factors[], startDate, endDate, frequency, everyNTd?, topK?, benchmark?)` | LLM 工具：选完因子后直接**多因子等权合成**回测出净值卡片（各因子截面分位数等权平均成综合分，按综合分 Top-K；每因子可带 order 方向；无需先用 TOOL-C06 抽样验证数据）。调 SVC-D24；卡片走图状态 card 通道绕过 LLM，模型只拿指标摘要**frequency 必填无默认值**（weekly/biweekly/monthly/quarterly/semiannual/annual/custom+everyNTd 5~120），缺失时返回澄清指引给模型、由模型向用户追问（非错误转述） | chenhaotao | ✅ 已实现 | ae87773（2026-09-29）；2026-09-30 多次回测登记 card_N，模型【展示卡片:card_N】择优指定展示哪次（默认=最后一次成功，标记行剔除不展示，中间尝试仅留日志审计，卡片仍绕过 LLM 直传） |
| C-INT-01 | `loadFactorKnowledge(): string` | **已废弃（2026-09-29）**：`docs/factors.md` 删除，因子知识改由 `SQL/` 字典 + SVC-D22 配套解析按需加载（TOOL-C04/C05） | chenhaotao | ➖ 废弃 | 345a98f（2026-09-29） |

## 智谱直连客户端（模块 C 提供）

| 编号 | 接口 | 说明 | 负责人 | 状态 | 完成提交/日期 |
|---|---|---|---|---|---|
| SVC-Z01 | `ZhipuService.configured` / `defaultModel` | Key 是否配置、当前模型名（API-01 的数据源） | 待认领 | ⬜ 未实现 | |
| SVC-Z02 | `ZhipuService.chat(messages, options)` | 智谱直连 chat（主链路不经此，agent 用 LangChain ChatOpenAI 直连） | 待认领 | ⬜ 未实现 | |
| SVC-Z03 | `ZhipuService.chatStream(messages, options)` | 流式直连（推理 token 级），为 SSE 流式回复预留 | 待认领 | ➖ 暂缓 | 2026-09-30 拍板：流式粒度=节点级过程事件（API-25），推理流式不启用 |

## 核心领域层（模块 D 提供）

| 编号 | 接口 | 说明 | 负责人 | 状态 | 完成提交/日期 |
|---|---|---|---|---|---|
| SVC-D01 | `StoreService.listStrategies()` | 策略列表 | 待认领 | ⬜ 未实现 | |
| SVC-D02 | `StoreService.getStrategy(id)` | 单个策略 | 待认领 | ⬜ 未实现 | |
| SVC-D03 | `StoreService.saveStrategy(strategy)` | 保存/更新策略 | 待认领 | ⬜ 未实现 | |
| SVC-D04 | `StoreService.deleteStrategy(id)` | 删除策略 | 待认领 | ⬜ 未实现 | |
| SVC-D05 | `StoreService.listConversations()` | 会话列表（倒序） | 待认领 | ⬜ 未实现 | |
| SVC-D06 | `StoreService.getConversation(id)` | 单个会话 | 待认领 | ⬜ 未实现 | |
| SVC-D07 | `StoreService.newConversation()` | 新建会话（带欢迎语） | 待认领 | ⬜ 未实现 | |
| SVC-D08 | `StoreService.deleteConversation(id)` | 删除会话 | 待认领 | ⬜ 未实现 | |
| SVC-D09 | `StoreService.clearConversation(id)` | 清空会话（恢复欢迎语、重置标题） | 待认领 | ⬜ 未实现 | |
| SVC-D10 | `StoreService.appendMessages(id, msgs)` | 追加消息 | 待认领 | ⬜ 未实现 | |
| SVC-D11 | `StoreService.renameConversationFromFirstMessage(id, text)` | 按首条消息前 16 字命名会话 | 待认领 | ⬜ 未实现 | |
| SVC-D12 | `StoreService.getLastReport(convId)` | 读会话级"当前策略配置"（**当前无消费方**：C 的会话记忆随 mock 链路下线闲置，契约保留） | 待认领 | ⬜ 未实现 | |
| SVC-D13 | `StoreService.setLastReport(convId, config)` | 写会话级"当前策略配置"（**当前无消费方**，同上） | 待认领 | ⬜ 未实现 | |
| SVC-D14 | `StoreService.getFactorLib()` | 因子库 9 项（API-14 数据源） | 待认领 | ⬜ 未实现 | |
| SVC-D15 | `StoreService.getBtParams()` | 回测参数项（API-15 数据源） | 待认领 | ⬜ 未实现 | |
| SVC-D16 | `StoreService.getStockPool()` | 演示股票池 16 只 | 待认领 | ⬜ 未实现 | |
| SVC-D17 | `StoreService.getProfile()` | 用户资料（API-17 数据源） | 待认领 | ⬜ 未实现 | |
| SVC-D18 | `StoreService.updateSetting(key, patch)` | 更新设置项（API-18 数据源） | 待认领 | ⬜ 未实现 | |
| SVC-D19 | `BacktestService.runBacktest(input): BacktestOutput` | 回测：入参 `{seedKey, factors, universe, rebalance}`；曲线起点 100、百分比 `14.6`、确定性可复现 | 待认领 | ⬜ 未实现 | |
| SVC-D20 | `ScreenService.screen({universe?, filters[], topN?}): ScreenResult` | 选股筛选（字段/操作符白名单，非法 → 400） | 待认领 | ⬜ 未实现 | |
| SVC-D21 | 共享常量与工具导出 | `normalizeWeights`、`toMetricItems`、`mkBench`、`todayStr`、`nowTime`、`WELCOME_TEXT`、`BT_DEFAULTS`、`CURVE_*`、`STOCK_POOL`、`LastReport`/`StockMeta` 类型 | 待认领 | ⬜ 未实现 | |
| SVC-D22 | `FactorDataService.readTable({table, fields[], date, security})` + 字典解析 `loadTableCatalog/loadTableFieldDetails/loadTableFields/listKnownTables` | MySQL 因子取数 + 字段字典解析：白名单两道闸、防注入、值参数化；字典现读 `SQL/*.md` 改文档即生效（TOOL-C04~C06 的数据源） | chenhaotao | ✅ 已实现 | 345a98f（2026-09-29） |
| SVC-D23 | `UserStoreService`：账号 `createUser` / `findByUsername` / `findUserById` / `bumpTokenVersion` / `touchLastLogin`；用户隔离读写 `listStrategies(userId)` / `getStrategy(userId, id)` / `saveStrategy(userId, s)` / `deleteStrategy(userId, id)` / `listConversations(userId)` / `getConversation(userId, id)` / `newConversation(userId)` / `deleteConversation(userId, id)` / `clearConversation(userId, id)` / `appendMessages(userId, id, msgs)` / `renameConversationFromFirstMessage(userId, id, text)` / `getSettings(userId)` / `updateSetting(userId, key, patch)` | 用户库持久化（M13）：`alphasage_user` 库（192.168.0.30），独立连接池 `USER_DB_*`（与只读因子库 MYSQL_* 分开）；实现 `MysqlUserStoreService`（多行写入放事务、消息**一行存一次问答** ask+answer——ask 为 NULL 的行是开场欢迎语，读时拆回 ChatMessage[]，按自增 id 排序、会话列表按 updated_at 倒序）+ `MemoryUserStoreService`（未配 USER_DB 时兜底）；表结构 `docs/db/user-tables.sql`（已在共享库执行，2026-10-08 消息表合并迁移，旧数据备份 messages_bak_20261008） | CZT123526 | ✅ 已实现 | 3e0efd9（2026-09-29）；2026-10-08 消息表合行改造 |
| SVC-D24 | `EqualWeightBacktestService.runEqualWeightBacktest(input): {card, summary}`；配套 `FactorDataService` 批量方法 `readTradeDates/readCrossSection/readDailyCloses/readIndexDaily` | **多因子等权合成**回测（TOOL-C07 数据源）：调仓日按频率分组（7 档）、逐调仓日各因子全截面 → 截面分位数等权平均成综合分（因子可各自 asc/desc）→ Top-K，**逐年拉持仓并集前复权收盘**（内存峰值=一年数据）、持有期日度等权；个股日收益=前复权收盘相邻日相除（mkt_equd_adj.CLOSE_PRICE_1，含分红送转）；换手率单边口径、按实际期数年化；基准 mkt_idxd。纯编排不触库，数据全部走 SVC-D22 同池同白名单。字典新增 `SQL/mkt_equd_adj.md`、`SQL/mkt_idxd.md`（通联字典原文照录，tmp_dict/gen_backtest_tables.py 生成） | chenhaotao | ✅ 已实现 | ae87773（2026-09-29） |

## 外部接口

| 编号 | 接口 | 说明 | 负责人 | 状态 | 完成提交/日期 |
|---|---|---|---|---|---|
| EXT-01 | 智谱 GLM（OpenAI 兼容协议，chat/completions 含 tool-calling） | `.env` 配置 Key/模型/端点/超时；未配 Key 走规则+模板兜底，调用失败回复仅含原因、不静默降级 | 待认领 | ⬜ 未实现 | |
