# 因子智投后端（factor-agent-server）技术说明文档

> 版本：v0.2　更新日期：2026-09-24
> 关联文档：前端接口契约 [factor-agent-react/docs/backend-api.md](../../factor-agent-react/docs/backend-api.md)、快速上手 [README.md](../README.md)

---

## 1. 项目概述

本服务是「因子智投（AlphaSage）多因子选股智能体」平台的前后端分离架构中的**后端**，职责：

1. 提供前端所需的全部 REST 接口（会话 / 策略 / 回测 / 筛选 / 因子库 / 用户，共 20 个端点）；
2. 基于大模型（智谱 GLM）的对话智能体，负责理解用户意图、生成回复文案，并产出三种结构化报告卡片；
3. 本地模拟回测引擎，按确定性算法生成演示口径的净值曲线、绩效指标与持仓。

### 技术选型

| 层 | 技术 | 版本 | 选型理由 |
| --- | --- | --- | --- |
| 运行时 | Node.js | 24.19 | LTS，原生 fetch / Web Streams |
| Web 框架 | NestJS（Express 适配器） | 11.2.6 | 模块化 / DI / 装饰器路由 / 全局管道与过滤器，便于按业务域拆模块 |
| 语言 | TypeScript（strict 部分） | 5.9.3 | 前后端同构类型，`src/types.ts` 与前端 `types.ts` 一一对应 |
| 智能体编排 | @langchain/langgraph | 1.4.17 | 状态图（StateGraph）编排意图路由 → 卡片构建 → 文案生成，后续可加工具节点/记忆/多智能体 |
| LLM 接入 | @langchain/openai | 1.5.13 | `ChatOpenAI` 走智谱 OpenAI 兼容端点，零适配成本，可随时换其他兼容厂商 |
| 参数校验 | class-validator / class-transformer | 0.14.4 / 0.5.1 | DTO 声明式校验，全局 ValidationPipe |

### 明确不做的事（当前阶段边界）

- **不做持久化**：数据在内存（`core/store.service.ts`），重启恢复种子数据；接口契约已定型，后续平滑换数据库，前端无感；
- **不接真实行情**：回测/筛选为演示口径的模拟引擎；真实引擎就位后只替换 `core/backtest.service.ts` 与 `core/screen.service.ts`；
- **不做鉴权**：契约预留 `Authorization: Bearer <token>`，当前无登录态。

---

## 2. 系统架构

```
┌────────────────────────────────────────────────────────────┐
│ 接入层  main.ts：CORS · 全局 ValidationPipe · 全局 ApiErrorFilter │
├────────────────────────────────────────────────────────────┤
│ 控制器层（路由薄壳，只做参数绑定与响应）                          │
│   ConversationsController   StrategiesController             │
│   MarketController          UserController   AppController   │
├────────────────────────────────────────────────────────────┤
│ 业务服务层                                                    │
│   ConversationsService   发消息编排（上下文/标题/消息落库）      │
│   StrategiesService      策略 CRUD + 保存即回测                │
│   AgentService ★         LangGraph 智能体（意图路由/卡片/文案） │
├────────────────────────────────────────────────────────────┤
│ 领域共享层 core（@Global）                                     │
│   StoreService(内存存储+种子) BacktestService(模拟回测)        │
│   ScreenService(选股筛选)                                    │
├────────────────────────────────────────────────────────────┤
│ 外部服务：智谱 GLM（编码套餐走 /api/coding/paas/v4）           │
│   主链路经 LangChain ChatOpenAI；zhipu/ 目录为直连备用客户端     │
└────────────────────────────────────────────────────────────┘
```

分层约定：控制器不写业务；业务服务不直接操作 Map/算法；数据与算法集中在 core；智能体只依赖 core 的服务接口，不关心数据来源（为接真实引擎预留）。

### 目录结构

```
factor-agent-server/
├── src/
│   ├── main.ts                  # 入口：端口、CORS、全局管道/过滤器
│   ├── app.module.ts            # 根模块（装配以下模块）
│   ├── app.controller.ts        # GET /api/health
│   ├── types.ts                 # 共享类型（与前端 src/types.ts 对齐）
│   ├── common/                  # ApiException + 全局错误过滤器
│   ├── config/configuration.ts  # 环境变量装载
│   ├── core/                    # 领域共享层（全局模块）
│   │   ├── store.service.ts     # 内存存储、种子数据、会话/策略仓储
│   │   ├── backtest.service.ts  # 模拟回测引擎 + 权重归一化
│   │   └── screen.service.ts    # 选股筛选
│   ├── agent/agent.service.ts   # ★ LangGraph 智能体
│   ├── conversations/           # 会话模块（controller/service/dto/module）
│   ├── strategies/              # 策略模块
│   ├── market/                  # 因子库/回测参数/筛选
│   ├── user/                    # 个人中心
│   └── zhipu/                   # 智谱直连客户端（health 探测与备用）
├── docs/technical.md            # 本文档
└── .env / .env.example
```

---

## 3. 智能体设计（LangGraph + LangChain，tool-calling）★

### 3.1 架构：两工具的工具循环

```
START → agent(GLM，绑定 2 个工具) ⇄ tools(执行工具) → END（最终文案）
          │ select_factors  选因子：抽取因子/权重/股票池/调仓/命名，记录策略配置
          │ run_backtest    回测：对当前配置执行回测，产出报告卡片
```

- 模型：智谱 GLM（LangChain `ChatOpenAI` 走 OpenAI 兼容端点；**团队 Token/编码套餐须用
  `https://open.bigmodel.cn/api/coding/paas/v4`，充值 Key 用 `…/api/paas/v4`**），
  `bindTools([select_factors, run_backtest])`；
- LangGraph 状态：`{ conversationId, userText, messages(累积), card }`；`agent` 节点产出工具调用
  或最终文本，`tools` 节点按工具名分发执行、把结果以 `ToolMessage` 回填，循环到模型输出纯文本；
- 工具绑定用 OpenAI function 格式，**执行在图内 tools 节点**（能拿到会话上下文做种子/记忆）。

### 3.2 两个工具

| 工具 | 参数 | 职责 | 返回 |
| --- | --- | --- | --- |
| `select_factors` | `factors[{name,weight}]`（必填）、`universe?`、`rebalance?`、`name?`、`tag?` | 校验 + 归一化权重，写入会话级"当前策略配置"（lastReport） | 配置确认 JSON（提示继续回测）；参数不合法/权重全 0 返回 error JSON 由模型自纠 |
| `run_backtest` | 无 | 读取当前配置 → 模拟回测引擎 → 生成 report 卡片 | 报告摘要 JSON（指标为展示字符串）+ 卡片 |

- **会话记忆**：lastReport 注入 system prompt → 支撑"再回测一下它"（直接重跑回测）、
  "把低波动提到 40"（修改后重新选因子+回测）等多轮交互；
- **因子知识库**：`docs/factors.md` 是因子知识唯一数据源（因子定义/指标/权重区间/风格搭配/
  模型传参规则）。每次组装提示词时由 `agent/factor-knowledge.ts` 读取全文注入 system prompt，
  按 mtime 缓存（编辑保存即生效，无需重启）；文档缺失时回退内置短名清单并告警一次。
  `/api/factors`（FACTOR_LIB）下发给前端的因子库需与该文档人工保持一致；
- **确定性**：回测种子 = 会话ID+配置，同一配置永远同一份报告（模型会说"与上次一致"）；
- **LLM 不生成数值**：曲线/指标/持仓全部来自引擎，模型只组织文案（≤90 字、只能引用工具数据、
  结尾免责），从根上杜绝编造数据；
- **非工具分支**：筛选/ROE/估值/白酒 → 规则分支走 ScreenService 出 stocks 卡片（演示功能）；
  问候/闲聊 → 模型不调工具直接纯文本回复（无卡片）。

### 3.3 降级与错误语义

| 场景 | 行为 |
| --- | --- |
| 未配置 Key（开发模式） | 关键词规则路由 + 本地引擎卡片 + 模板文案（README 承诺"不填也能跑"） |
| 配置 Key 但 GLM 失败（429 余额不足 / 403 无权限 / 超时 / 空返回） | 抛 `LlmTextError`，回复**仅含失败原因**（如「⚠️ 智能体回复生成失败：智谱 GLM 调用返回「429 …」」），**不带卡片**，不静默降级，接口不 5xx |
| 推理模型 token 预算 | `maxTokens 2048`：glm-5.3-flash 的 reasoning_content 与工具调用 JSON 都计入 max_tokens |

### 3.4 实测与时延（2026-09-24，团队 Key + glm-5.3-flash）

- 策略类消息（选因子+回测+文案，2~3 轮工具循环）约 15~20s；闲聊约 6s；
- 验证通过：模型自主选因子（低波动50+股息率50 / 动量60+小市值40）、自行命名策略、
  多轮"再回测一下它"复用配置、文案精准引用工具指标、闲聊不调工具。

### 3.5 与前端契约 §5（流式）的衔接

当前为同步返回（契约允许）。升级流式时：`agent` 节点的最终文本改流式输出，
`POST /api/conversations/:id/messages` 改 SSE，先推 `{"type":"text","delta"}`，
末尾推 `{"type":"card"}`；改动集中在控制器与该节点，图结构不变。

---

## 4. 核心领域算法

### 4.1 模拟回测引擎（core/backtest.service.ts）

**确定性**：种子伪随机（FNV-1a 哈希 → mulberry32），`seedKey = 策略ID|股票池|调仓|因子权重JSON`。同一配置永远生成同一份报告；权重一变（PATCH）报告即变——满足"保存=重新回测"的产品语义且结果可复现。

| 产出 | 公式（口径与前端 mock 一致） |
| --- | --- |
| 净值曲线 | 30 个月频点：`100 + i·(0.5+rand·0.5) + sin(i/3)·1.5 + (rand−0.45)·2.2`，**首点钉为 100**（契约口径） |
| 基准曲线 | `100 + (v−100)·0.45 + sin(i/4)·1.8`（β=0.45，同前端 mkBench） |
| 年化收益 | `((1+总收益)^(1/3) − 1) × 100`（3 年期） |
| 最大回撤 | 曲线逐点峰值回撤，取最小值，负数百分比 |
| 夏普 / 胜率 | `0.7+rand·0.9` / `52+rand·11`（演示口径） |
| 持仓 | 个股×因子确定性得分（60~98）按权重加权 → Top K（默认 10）→ 权重 `max(2.2, 6.2−0.45i±)`、当日涨跌随机 |

### 4.2 权重归一化（与前端 normalizeWeights 同一算法）

```
合计 Σw ≤ 0        → 非法输入，返回 400（INVALID_ARGUMENT）
合计 Σw ≠ 100      → wi' = wi × 100 / Σw，四舍五入 1 位小数
舍入残差 r=100−Σwi' → 补给最大权重项
```

后端兜底执行同样规则：**合计不为 100 不报错，静默归一化**（契约 §3.2）。

### 4.3 选股筛选（core/screen.service.ts）

- 支持字段：`roe_ttm / pe_percentile / dividend_yield / volatility / momentum_20d`（映射到股票池属性）；
- 比较符：`> < >= <= ==`；未知字段/操作符 → 400；
- 股票池 16 只演示股（含股票池归属、各指标、综合得分），沪深300/中证500/中证800/全市场过滤后按综合得分降序取 TopN；
- 演示数据经过调校：契约示例条件（ROE>15 且 PE 分位<30）的 Top5 与前端 mock 的选股卡一致（茅台/五粮液/兴业/神华/长电）。

---

## 5. 数据模型与存储

### 5.1 共享类型（src/types.ts）

与前端 `src/types.ts` 字段级一致，核心结构：

- `Conversation { id, title, updatedAt(ms), messages: ChatMessage[] }`，`ChatMessage { role: user|agent, bubble, time:"HH:mm", card? }`；
- `AgentCard` 三型：`report / backtest / stocks`（字段见契约 §2.2；`metrics[].value` 为展示字符串如 `+19.7%`，`cls` 由符号决定 up/down）；
- `Strategy { id, name, status: running|done|draft, universe, rebalance, benchmark, updatedAt:"YYYY-MM-DD", factors, metrics|null, curve, benchCurve, holdings }`；
- `UserProfile / ProfileSetting / FactorLibItem / BtParamItem / ScreenFilter / ScreenResult`。

### 5.2 存储（core/store.service.ts）

- `Map<id, Strategy>`（预置 4 个种子策略，与前端 MOCK_STRATEGIES 相同曲线/持仓）、`Map<id, Conversation>`（启动为空）、`Map<convId, LastReport>`（会话级智能体记忆）、用户资料单例；
- 会话列表按 `updatedAt` 倒序；会话标题 = 首条用户消息前 16 字（超出加 `…`）；清空会话恢复欢迎语并重置标题；
- **生命周期**：进程内存态，重启即恢复种子。迁移路径：StoreService 换 TypeORM/Prisma 实现同接口即可，上层无感。

---

## 6. API 详细说明

Base URL `http://127.0.0.1:3000/api`。请求/响应 JSON（UTF-8）。完整字段契约以前端 `docs/backend-api.md` 为准，此处列实现要点：

| 方法 路径 | 说明 | 要点 |
| --- | --- | --- |
| GET /health | 健康检查 | 返回 `zhipuConfigured`、`defaultModel` |
| GET /conversations | 会话列表 | 按更新时间倒序 |
| POST /conversations | 新建会话 | 自动带欢迎语消息 |
| DELETE /conversations/:id | 删除 | 204；不存在→404 |
| POST /conversations/:id/clear | 清空 | 恢复欢迎语、标题重置 |
| GET /conversations/:id/messages | 历史消息 | `ChatMessage[]` |
| POST /conversations/:id/messages | 发消息 | body `{text}`；返回 `{userMessage, agentMessage}`；agentMessage 可含 card |
| GET /strategies | 策略列表 | 含 4 个种子策略（含曲线/持仓） |
| POST /strategies | 新建草稿 | status=draft、metrics=null、归一化因子 |
| PATCH /strategies/:id | 更新配置 | **= 保存并自动重新回测**，直接返回新报告；draft→done |
| POST /strategies/:id/backtest | 重新回测 | 可选 body `{period{start,end}, topK, feeRate}`，缺省用默认值 |
| GET /strategies/:id/report | 报告详情 | `{metrics, curve, benchCurve, holdings}` |
| DELETE /strategies/:id | 删除 | 204 |
| GET /factors | 因子库 | 9 项（后端下发，UI 数据驱动） |
| GET /backtest-params | 回测参数配置 | label/value/hint 三项（区间/TopK/费率） |
| POST /screen | 选股筛选 | `{universe?, filters[], topN?}` → `{stocks, total}` |
| GET /user/profile | 用户资料 | 含因子偏好雷达、设置项（notify/report/risk 三项） |
| PATCH /user/settings | 更新设置项 | `{key, on?, value?}` → 返回更新后完整 profile |

> **产品边界（2026-09-28）**：大模型统一智谱 GLM、行情数据统一使用平台内部数据，均由服务端
> `.env` 配置，不向终端用户暴露模型/数据源配置项。个人中心设置项仅 notify / report / risk
> 可配置；模型与数据来源由平台统一提供，不作为设置项下发（DTO 白名单校验，传其他 key 返回 400）。

### 发消息完整时序（核心链路）

```
POST /conversations/:id/messages {text}
  1. 校验会话存在（404 兜底）
  2. routeText = 最近2条用户消息 + 当前text 拼接（上下文消歧用）
  3. LangGraph invoke：
     route(意图) → build_*_card(回测引擎/筛选引擎出数据) → compose_text(GLM；失败则回复仅含报错、无卡片)；chat 意图 → chat_reply(纯文本，无卡片)；lastReport 在报告卡真正展示后才记录
  4. userMessage/agentMessage 落库，首条消息更新会话标题
  5. 同步返回 {userMessage, agentMessage}（GLM 正常时总耗时约 1~3s，未配 Key <50ms）
```

---

## 7. 错误处理

全局 `ApiErrorFilter` 把一切异常收敛为契约 §1 的格式：`{ "error": { "code": "...", "message": "..." } }`。

| HTTP | code | 触发场景 |
| --- | --- | --- |
| 400 | INVALID_ARGUMENT | DTO 校验失败、权重全 0、未知筛选字段 |
| 404 | NOT_FOUND | 会话/策略不存在、未知设置项 |
| 500 | INTERNAL_ERROR | 未捕获异常（兜底） |

说明：LLM 调用失败**不产生 5xx**——在 compose_text 节点内捕获并降级为模板文案（记 WARN 日志），前端拿到的是正常响应。

---

## 8. 配置项（.env）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `ZHIPU_API_KEY` | 空 | 智谱 API Key；空 = 文案走模板兜底（开发模式） |
| `ZHIPU_MODEL` | glm-4-flash | 免费模型；可换 glm-4-air / glm-4-plus / glm-4.5 / glm-4.6 |
| `ZHIPU_BASE_URL` | https://open.bigmodel.cn/api/paas/v4 | 智谱 OpenAI 兼容端点；编码套餐团队 Token 须改为 `…/api/coding/paas/v4` |
| `PORT` | **3000** | 注意：本机 8000 被另一 Python uvicorn 服务占用，故默认 3000 |
| `CHAT_TIMEOUT_MS` | 20000 | LLM 文案生成超时（超时→回复正文展示失败原因） |
| `SYSTEM_PROMPT` | 内置人设 | 预留覆盖口 |

跨域：`enableCors({ origin: true })` 全放开，开发期前端可直连或走 Vite 代理（`proxy: {"/api": "http://localhost:3000"}`，前端侧配置）。

---

## 9. 数据口径规范（契约 §2.6，后端已实现并自测）

1. 百分比数值口径：`14.6` 表示 14.6%（非 0.146）；涨跌/胜率/权重同；
2. 净值曲线：起点固定 100、30 个月频点，保留 1 位小数；
3. 因子权重：存储恒归一化合计=100（1 位小数，残差补最大项），全 0 拒绝；
4. 时间字段：策略 `updatedAt`="YYYY-MM-DD"，消息 `time`="HH:mm"，会话 `updatedAt`=毫秒时间戳；
5. `metrics[].cls`：由数值符号决定（正 up / 负 down / 无符号空），前端红涨绿跌渲染，后端只管数值与展示字符串。

---

## 10. 测试与验证

构建：`npm run build`（nest build，tsc 严格模式子集）。手工自测路径（2026-09-24 已全量跑通）：

```bash
node dist/main.js                        # 启动
curl http://127.0.0.1:3000/api/health    # zhipuConfigured 检查
# 建会话 → 发三类消息验证路由 → PATCH 策略验证归一化+自动回测 → /api/screen → 错误格式
```

已验证场景：三种卡片路由正确（含当前消息优先消歧）、风格多轮切换、backtest 卡复用上一轮策略配置、权重归一化/全 0 报 400、筛选结果与前端 mock 对齐、统一错误格式、假 Key 下 GLM 链路真实请求智谱（401）并把失败原因展示在回复正文（2026-09-24 起不再静默回退模板）。

---

## 11. 扩展路线

| 方向 | 方案 | 改动点 |
| --- | --- | --- |
| **因子数据库 + 读库工具**（已规划，**暂不实现**，当前用随机数据） | 因子主数据迁入数据库（定义/衡量指标/历史 IC·IR/收益统计等），给智能体加第三个工具 `query_factors`（按需查库，配合"上千因子"的检索化演进，见 §3.2 备注）。**过渡期数据实现方式 = 随机生成**（种子伪随机回测引擎 + docs/factors.md 手写知识注入） | 新增 factor-db 模块 + agent 加一个工具；接口契约与现有两工具不变 |
| 真实回测/行情 | 实现同接口的真实引擎 | 替换 `core/backtest.service.ts`；LangGraph 加工具节点供 LLM 调用 |
| 流式回复（契约 §5） | compose_text 改流式，接口改 SSE | 控制器 + 该节点，图结构不变 |
| 数据落库 | StoreService 换 TypeORM/Prisma 同接口实现 | 仅 core 一层 |
| 会话记忆增强 | langgraph MemorySaver/checkpoint 或 lastReport 扩展 | agent 模块 |
| 登录鉴权 | Guard + JWT，契约已预留 Bearer 头 | 新增 auth 模块 |
| 模型切换 | `.env` 改 `ZHIPU_MODEL` | 无代码改动 |

> 数据现状速查（2026-09-24）：回测曲线/指标/持仓得分 = 种子伪随机（同配置同结果）；筛选股票池及
> 其 ROE/PE 属性 = 手写演示数据；因子定义知识 = `docs/factors.md` 手写注入提示词。均非真实数据。
