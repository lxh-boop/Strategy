# 后端对接文档（API 契约）

> 本文档是前端（React + TS）对后端的**接口需求契约**。后端按此实现后，前端只需替换
> `src/agent.ts` 与 `src/hooks/useConversations.ts` 中的模拟逻辑即可完成对接。
> 推荐后端同样使用 TypeScript，并直接复用 `src/types.ts` 中的类型定义。

---

## 1. 通用约定

| 项目 | 约定 |
|---|---|
| Base URL | `/api`（开发期前端走 Vite 代理，见下文 §7） |
| 数据格式 | 请求/响应均为 JSON（UTF-8） |
| 鉴权 | `Authorization: Bearer <JWT>`（M13 起实施）；公开接口 API-01/14/15/16/21/22，其余未带或无效 token → 401 `AUTH_REQUIRED` |
| 时间字段 | 统一 ISO 8601（如 `2026-09-23T15:00:00+08:00`），由前端格式化展示 |
| 错误格式 | `{ "error": { "code": "BACKTEST_FAILED", "message": "…" } }`，HTTP 状态码区分 |
| 数值单位 | 见 §2.6「数值口径」，重要：百分比是 `14.6` 而不是 `0.146` |

### 7.x 开发期跨域（前端已预留）

在 `vite.config.ts` 中加代理即可，前端代码不需要改：

```ts
server: {
  port: 5173,
  proxy: { "/api": "http://localhost:8000" },  // 指向后端服务
}
```

---

## 2. 共享数据模型（与 src/types.ts 一致）

### 2.1 策略 Strategy

```ts
interface Strategy {
  id: string;
  name: string;
  status: "running" | "done" | "draft";   // 运行中 / 回测完成 / 草稿
  universe: string;                        // 股票池，如 "沪深300 + 中证500"
  rebalance: string;                       // 调仓频率，如 "每月调仓"
  benchmark: string;                       // 业绩基准指数名
  updatedAt: string;                       // ISO 时间
  factors: { name: string; weight: number }[];  // 因子权重，存储时恒归一化为合计 = 100
  metrics: {                               // 未回测时为 null
    annual: number;      // 年化收益 %，如 14.6
    drawdown: number;    // 最大回撤 %，负数，如 -8.3
    sharpe: number;      // 夏普比率
    winRate: number;     // 胜率 %，如 63.5
  } | null;
  curve: number[];                         // 组合净值曲线，起点 100，30 个点（月频）
  benchCurve: number[];                    // 基准净值曲线，口径同上
  holdings: {                              // 当前持仓
    code: string;        // 股票代码，如 "600036"
    name: string;        // 股票名称
    score: number;       // 综合因子得分（0-100）
    weight: number;      // 持仓权重 %
    change: number;      // 当日涨跌 %（带符号）
  }[];
}
```

### 2.2 智能体回复卡片 AgentCard（三种）

智能体回复除文本外可携带一张结构化卡片，**后端负责按以下结构输出**：

```ts
// ① report —— 策略构建结果（框架 + 回测报告，不含个股明细）
{
  type: "report",
  title: "小盘动量增强 · 回测报告",
  tag: "进攻型",                          // 风格标签：进攻型/均衡型/防御型
  factors: [{ name: "动量", weight: 45 }, ...],
  curve: number[], benchCurve: number[],
  benchName: "中证1000指数",
  metrics: [{ label: "年化收益", value: "+19.7%", cls: "up" }, ...],  // value 为展示字符串
  rawMetrics: { annual: 19.7, drawdown: -5.7, sharpe: 0.92, winRate: 54.4 },
  universe: "中证1000",
  rebalance: "每周调仓",
  note: "股票池与调仓：…"
}

// ② backtest —— 纯回测报告
{ type: "backtest", title, tag, curve, benchCurve, benchName, metrics, note }

// ③ stocks —— 选股筛选结果
{
  type: "stocks",
  title: "沪深300 · 高ROE低估值筛选结果",
  tag: "共 12 只 · 展示前 5",
  stocks: [{ code: "600519", name: "贵州茅台", score: 91.2, weight: null }, ...],
  note: "…"
}
```

`metrics[].cls` 取值 `"up" | "down" | ""`，由数值正负决定（前端红涨绿跌渲染）。

### 2.3 会话 Conversation

```ts
interface Conversation {
  id: string;
  title: string;            // 取首条用户消息前 16 字，或 "新对话"
  updatedAt: number;        // 时间戳 ms
  messages: {
    role: "user" | "agent";
    bubble: string;         // 消息文本（纯文本 + \n 换行）
    time: string;           // "HH:mm"
    card?: AgentCard;       // agent 消息可携带结构化卡片
  }[];
}
```

### 2.4 用户与设置

```ts
interface UserProfile {
  name: string; org: string; plan: string;
  registerDate: string; lastLogin: string;
  radar: { name: string; value: number }[];   // 因子偏好 0-100
  settings: {
    key: string;          // notify / report / model / datasource / risk
    type: "toggle" | "single";
    title: string; desc: string;
    on?: boolean;         // toggle 型开关状态
    choices?: string[];   // single 型可选项
    value?: string;       // single 型当前值（展示口径，后端下发）
  }[];
}
```

设置项语义：

| key | type | 值含义 | 用户可配置 |
|---|---|---|---|
| notify | toggle | 是否推送调仓与信号通知 | 开关 |
| report | toggle | 是否生成每日策略日报 | 开关 |
| risk | single | 风险偏好（保守/稳健/平衡/积极） | 单选 |

### 2.5 因子库 Factor

```ts
{ id: "value", name: "价值因子", desc: "EP、BP、股息率" }   // 共 9 个，见 src/data/mock.ts
```

### 2.6 数值口径（重要）

| 字段 | 口径 | 示例 |
|---|---|---|
| 收益/回撤/胜率/权重/涨跌 | 百分数数值 | `14.6` 表示 14.6%，**不是** 0.146 |
| 净值曲线 | 起点固定 100 的净值序列 | `[100, 100.8, …]` |
| 手续费率 | 小数 | `0.001` 表示双边 0.1% |
| Top K | 整数 | `50` 表示每次调仓持股 50 只 |
| 因子权重 | 百分数整数，合计 100 | `[35, 30, 20, 15]` |

---

## 3. 接口清单

### 3.1 对话模块

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/conversations` | 会话列表 |
| POST | `/api/conversations` | 新建会话 |
| DELETE | `/api/conversations/:id` | 删除会话 |
| POST | `/api/conversations/:id/clear` | 清空会话消息 |
| GET | `/api/conversations/:id/messages` | 拉取历史消息 |
| POST | `/api/conversations/:id/messages` | 发送消息并获取智能体回复 |

**发送消息请求**

```json
{ "text": "帮我构建一个小盘动量策略" }
```

**响应（同步返回；若做流式见 §5）**

```json
{
  "userMessage": { "role": "user", "bubble": "帮我构建一个小盘动量策略", "time": "14:43" },
  "agentMessage": {
    "role": "agent",
    "bubble": "好的，已按你的描述构建「小盘动量增强」策略：…",
    "time": "14:43",
    "card": { "type": "report", "…": "见 §2.2" }
  }
}
```

后端需要实现的多轮/路由逻辑（当前前端模拟的行为，即产品语义）：

1. 消息含「回测/表现/历史」→ 返回 `backtest` 卡片；
2. 消息含「筛选/ROE/估值/白酒」类筛选意图 → 返回 `stocks` 卡片；
3. 其余（构建/描述策略）→ 结合**最近 3 轮用户消息**的上下文，返回 `report` 卡片；
4. 会话标题：首条用户消息前 16 字自动命名。

### 3.2 策略模块

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/strategies` | 策略列表（含曲线与持仓） |
| POST | `/api/strategies` | 创建策略（草稿） |
| PATCH | `/api/strategies/:id` | 更新配置（因子权重等），**后端保存后应自动重新回测** |
| DELETE | `/api/strategies/:id` | 删除策略 |
| POST | `/api/strategies/:id/backtest` | 重新回测，返回更新后的完整 Strategy |
| GET | `/api/strategies/:id/report` | 回测报告详情（同 Strategy 内的 metrics/curve/holdings） |

**创建策略请求**

```json
{
  "name": "大盘价值轮动策略",
  "universe": "沪深300",
  "rebalance": "每月调仓",
  "factors": [{ "name": "价值", "weight": 60 }, { "name": "质量", "weight": 40 }]
}
```

**更新权重请求（PATCH）**——前端传入的权重**不要求合计等于 100**：

```json
{ "factors": [{ "name": "股息率", "weight": 40 }, { "name": "低波动", "weight": 25 },
              { "name": "质量", "weight": 20 }, { "name": "价值", "weight": 15 }] }
```

**归一化规则（前后端一致）**：合计 ≠ 100 时不报错，按比例折算：
`weight_i' = weight_i × 100 / Σweight`，保留 1 位小数，舍入残差补给最大权重项；
合计为 0（全部为 0）视为非法输入，返回 400。
前端已实现同一算法（`src/agent.ts` → `normalizeWeights`），后端兜底执行即可。

产品语义：**用户保存配置后必须直接返回新的回测报告**（曲线/指标/持仓），
"保存"和"重新回测"在后端是同一个动作。

### 3.3 回测参数

当前 UI 展示并传递三项（后续从 `src/data/mock.ts` 的 `BT_PARAMS` 扩展）：

```json
{
  "period": { "start": "2023-09", "end": "2026-09" },
  "topK": 50,
  "feeRate": 0.001
}
```

参数以查询串或请求体附在回测相关接口上；后端应提供默认值。

### 3.4 选股筛选

```json
POST /api/screen
{
  "universe": "沪深300",
  "filters": [
    { "field": "roe_ttm", "op": ">", "value": 15 },
    { "field": "pe_percentile", "op": "<", "value": 30 }
  ],
  "topN": 5
}
→ { "stocks": [{ "code": "600519", "name": "贵州茅台", "score": 91.2, "weight": null }], "total": 12 }
```

### 3.5 因子库

```
GET /api/factors
→ [{ "id": "value", "name": "价值因子", "desc": "EP、BP、股息率" }, …]
```

### 3.6 用户与个人中心

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/user/profile` | 用户信息 + 因子偏好 + 设置项（notify/report/risk 三项） |
| PATCH | `/api/user/settings` | 更新设置项（toggle 传 `on`、single 传 `value`） |

**PATCH /api/user/settings 请求示例（按 key 的 type 区分）**

```json
{ "key": "notify",  "on": true }
{ "key": "risk",    "value": "积极型" }
```

> 产品边界（2026-09-28）：大模型统一智谱 GLM、行情数据统一使用平台内部数据，
> 均由服务端配置，**不提供用户级模型/数据源配置**；个人中心可配置项仅
> 可配置项：notify / report / risk。模型（统一智谱 GLM）与数据来源（平台内部数据）由平台统一提供，不作为设置项下发。

---

## 4. 前端模拟点清单（对接时逐个替换）

| 位置 | 模拟内容 | 替换为 |
|---|---|---|
| `src/agent.ts` → `findReply()` | 关键词路由 + 假回复 | `POST /api/conversations/:id/messages` |
| `src/agent.ts` → `buildStrategyReply()` | 按风格生成假策略报告 | 由对话接口返回真实 `report` 卡 |
| `src/agent.ts` → `backtestStrategy()` | 随机生成曲线/指标/持仓 | `POST /api/strategies/:id/backtest` |
| `src/agent.ts` → `genHoldings()` | 随机挑 10 只演示股 | 回测接口返回真实持仓 |
| `src/data/mock.ts` → `MOCK_STRATEGIES` | 4 个预置策略 | `GET /api/strategies` |
| `src/data/mock.ts` → `PROFILE` | 假用户资料 | `GET /api/user/profile` |
| `src/data/mock.ts` → `FACTOR_LIB` / `BT_PARAMS` / `DEMO_STOCK_POOL` | 静态字典 | `GET /api/factors` 等（参数项由后端下发后 UI 自动渲染） |
| `src/hooks/useConversations.ts` | 会话存 localStorage（key：`alphasage_conversations_react_v1`） | §3.1 会话接口，登录后数据上云 |
| `src/pages/ProfilePage.tsx` | 偏好设置存 localStorage（key：`alphasage_profile_v1`） | §3.6 用户设置接口 |

> `BT_PARAMS` / `FACTOR_LIB` 这类**配置型数据建议由后端下发**：前端 UI 是
> 数据驱动的，后端加一个参数项（如以后恢复"初始资金"）前端无需改代码。

---

## 5. 可选增强（不影响首版对接）

- **流式回复**：`POST /api/conversations/:id/messages` 改为 SSE，先推
  `{ "type": "text", "delta": "…" }` 增量文本，最后推
  `{ "type": "card", "card": { … } }`；前端目前按"打字动画 + 一次性返回"处理，
  对接流式时改动集中在 `useConversations.ts`。
- **回测进度**：重回测耗时长时可提供 `GET /api/strategies/:id/backtest/status` 轮询或 WebSocket 推送。
- **导出报告**：`GET /api/strategies/:id/report/export` 返回 PDF。

---

## 6. 前端固定行为（后端需要知道的）

1. 因子权重合计 ≠ 100 时**按比例自动归一化到 100**（前端已实现，后端兜底执行同样的归一化，不要报错）；权重全部为 0 返回 400；
2. 草稿策略（`status: "draft"`，`metrics: null`）允许存在，UI 会引导用户先回测；
3. "重新回测"会整体替换曲线、指标、持仓，历史报告如需保留由后端另行存档；
4. 涨跌颜色（红涨绿跌）、百分比格式化均由前端根据数值符号/大小渲染，后端只管数值；
5. 会话数据当前在前端 localStorage（换浏览器/清缓存会丢），接入 §3.1 后应迁移到服务端。

---

## 7. 登录鉴权与多用户（M13：API-21 ~ API-24）

> 数据落在团队共享用户库（`alphasage_user`），注册的账号任何同事的机器上都能登录，
> 策略/会话/设置跟随账号。token 为 JWT（HS256，payload `{sub: userId, ver: tokenVersion, iat, exp}`，
> 有效期 7 天；登出后 ver 自增使旧 token 全部失效）。

### 7.1 数据模型（追加到 src/types.ts）

```ts
/** 用户公开信息（任何接口都不返回密码哈希） */
interface UserPublic {
  id: number;            // 用户 id
  username: string;      // 登录名，3~24 位字母/数字/下划线
  nickname: string;      // 昵称，≤40 字
  createdAt: string;     // ISO 8601
}

/** 登录/注册成功响应 */
interface AuthSuccess {
  token: string;         // JWT，前端存 localStorage，之后每个请求带 Authorization: Bearer <token>
  user: UserPublic;
}
```

### 7.2 接口定义

#### API-21 POST /api/auth/register（公开）

注册并直接登录（返回 token，前端无需再调 login）。

- 请求 Body：`{ "username": "zhangsan", "password": "abc12345", "nickname": "小张" }`
  - `username` 必填，3~24 位字母/数字/下划线，**大小写不敏感唯一**（`Zhang` 与 `zhang`
    视为同一账号，注册与登录同口径）；`password` 必填，6~64 位**可打印 ASCII**
    （bcrypt 只看前 72 字节，限 ASCII 防多字节截断）；`nickname` 可选，≤40 字，缺省用 username
- 成功 201：`AuthSuccess`
- 失败：400 `INVALID_ARGUMENT`（校验不过）；409 `USERNAME_TAKEN`（用户名已存在）

#### API-22 POST /api/auth/login（公开）

- 请求 Body：`{ "username": "zhangsan", "password": "abc12345" }`
- 成功 200：`AuthSuccess`
- 失败：401 `AUTH_FAILED`（账号不存在或密码错误，**统一文案不区分**，防撞库）

#### API-23 POST /api/auth/logout（需登录）

使当前用户全部已签发 token 失效（服务端 token_version 自增），前端同时删除本地 token。

- 成功 204，无 Body
- 失败：401 `AUTH_REQUIRED`

#### API-24 GET /api/auth/me（需登录）

- 成功 200：`{ "user": UserPublic }`
- 失败：401 `AUTH_REQUIRED`（token 无效/过期/已被登出）

### 7.3 既有接口的鉴权化改造（M13 同批完成）

| 接口 | 改造 |
|---|---|
| API-02 ~ API-13、API-17、API-18 | 需 Bearer；数据按 token 中的 userId 隔离（A 只能看到自己的策略/会话/设置） |
| API-01、API-14/15/16 | 保持公开（健康检查与公共配置数据，无用户维度） |
| 401 处理（前端约定） | `api.ts` 统一捕获 401 → 清除本地 token → 跳转登录页/弹登录框 |

### 7.4 前端改造点（对接 M13 时）

| 位置 | 改造 |
|---|---|
| `src/api.ts` | 请求封装统一注入 `Authorization` 头；新增 register/login/logout/me 四个函数；401 统一处理 |
| `src/App.tsx` | 启动时若有 token 先调 API-24 验证，失败则清 token |
| 登录/注册 UI | 新增登录页或弹窗（首版可用弹窗），成功后 `AuthSuccess` 存 localStorage |
| localStorage | token key 建议 `alphasage_token_v1`；会话/设置不再走本地缓存，全部走服务端 |

### 7.5 M13 后 API-17 profile 各字段口径（后端实现约定）

| 字段 | M13 后来源 |
|---|---|
| `name` / `nickname` | users.nickname（注册缺省取 username） |
| `org` / `plan` | 平台固定文案（`"AlphaSage 团队"` / `"团队版"`），不再 mock |
| `registerDate` | users.created_at（YYYY-MM-DD） |
| `lastLogin` | users.last_login_at（每次登录成功 UPDATE；首次注册时等于 created_at） |
| `radar` | 按该用户 strategies.factors 聚合（因子名 → 平均权重），无策略时空数组 `[]` |
| `settings` | user_settings 行：notify/report 为 toggle（on）、risk 为 single，**value 存中文显示值**（`保守型/稳健型/平衡型/积极型`，缺省 `稳健型`，口径同前端 choices） |
