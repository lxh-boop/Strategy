# 前后端联调打通说明

> 本文记录 2026-09-24 前后端打通的**完整做法**：改了哪些文件、为什么改、数据怎么流、
> 如何启动验证。接口字段口径见 [backend-api.md](backend-api.md)（契约），后端架构见
> `factor-agent-server/docs/technical.md`。
>
> 🔄 **2026-09-28 更新**：按产品决策，模型统一智谱 GLM、数据统一使用平台内部数据；
> 个人中心已移除 API 密钥管理与数据源配置，`model` / `datasource` 为只读展示项。
> 文中涉及密钥/数据源的段落为当时的历史记录，现状以契约文档为准。

---

## 1. 打通后的整体架构

```
浏览器
  │  http://localhost:5173
  ▼
Vite Dev Server（factor-agent-react）
  │  代理：/api → http://localhost:3000   ← 唯一的跨域解法，前端代码不感知端口
  ▼
NestJS 后端（factor-agent-server，端口 3000）
  │  ├─ /api/conversations/**   会话 + 智能体（LangGraph 编排）
  │  ├─ /api/strategies/**      策略 + 模拟回测引擎
  │  ├─ /api/factors · /api/backtest-params · /api/screen
  │  └─ /api/user/**            个人中心（profile / settings）
  ▼
智谱 GLM（compose_text/chat_reply 节点生成回复文本；调用失败时回复仅含报错信息，不带卡片，不静默降级）
```

- **开发期跨域**：走 Vite 代理（见 §3），前端所有请求都写相对路径 `/api/...`，
  将来生产同域部署（或用 Nginx 反代）前端一行代码都不用改。
- **后端 CORS** 已放开（`main.ts` 的 `enableCors`），直连 `http://localhost:3000` 也可以，
  但前端统一走代理，不依赖 CORS。

## 2. 改动清单

### 2.1 前端 factor-agent-react

| 文件 | 改动 | 说明 |
|---|---|---|
| `vite.config.ts` | **加代理** | `proxy: { "/api": "http://localhost:3000" }`，联调的关键一行 |
| `src/api.ts` | **新增** | 统一接口层：全部后端调用、错误封装 `ApiError`、卡片 id 补齐 |
| `src/config.tsx` | **新增** | `ConfigProvider`：因子库/回测参数由后端下发（契约 §3.5），UI 数据驱动 |
| `src/hooks/useConversations.ts` | **重写** | localStorage → 会话接口；发消息「乐观插入 + 回执替换 + 失败回滚」 |
| `src/App.tsx` | **重写** | 策略状态改为接口加载；新增 `getHealth` 驱动侧边栏状态灯；报告卡保存走接口 |
| `src/pages/StrategiesPage.tsx` | **改造** | 新建/保存权重/重回测/删除全部调接口；因子库改用后端下发 |
| `src/pages/ProfilePage.tsx` | **重写** | profile/settings/apikeys 全部走接口；密钥只显示服务端脱敏值 |
| `src/pages/ChatPage.tsx` | **小改** | 回测参数用后端下发的；加会话加载占位；修 2 个遗留类型错误 |
| `src/components/ui.tsx` | **小改** | `ParamsBlock` 从 ConfigContext 取参数 |
| `src/agent.ts` | **删除** | 模拟路由/假回测/假持仓全部由后端 LangGraph 智能体与回测引擎替代 |
| `src/data/mock.ts` | **精简** | 只留快捷指令文案 + 后端不可达时的兜底数据 |
| `src/types.ts` | **对齐** | `ProfileSetting` 加 `on: boolean|null`、`value?`；新增 `FactorLibItem`/`BtParamItem`；`UserProfile` 加 `apiKeys` |

### 2.2 后端 factor-agent-server（补齐契约缺口）

对接时发现后端相对契约 §3.6 缺了个人中心的**密钥管理**，且设置项缺 `type/choices`
字段（前端 UI 需要靠它们渲染开关/多选/单选），已按契约补上：

| 文件 | 改动 |
|---|---|
| `src/types.ts` | `ProfileSetting` 加 `type`/`choices`；`UserProfile` 加 `apiKeys` |
| `src/core/store.service.ts` | 种子数据补 type/choices/密钥；`getProfile()` 出参脱敏（`jq_5****4f01`）；新增 `addApiKey`/`removeApiKey` |
| `src/user/user.controller.ts` | 新增 `POST /api/user/apikeys`（重名 409）、`DELETE /api/user/apikeys/:name` |
| `src/user/dto.ts` | `UpdateSettingDto` 加 `values?: string[]`（multi 型）；新增 `CreateApiKeyDto` |

> `PATCH /api/user/settings` 的入参按设置项类型区分：toggle 传 `{key, on}`，
> single 传 `{key, value}`，multi 传 `{key, values: [...]}`（后端拼成 `" + "` 展示值）。

## 3. 关键做法（每条链路怎么接的）

### 3.1 会话与智能体（`useConversations.ts`）

- **加载**：进入页面 `GET /api/conversations`；后端为空则 `POST /api/conversations`
  自动建会话（欢迎语由后端下发，前端不再内置 `WELCOME_TEXT`）。
  列表本身携带全量 messages，无需再拉 `GET :id/messages`（该接口保留给分页场景）。
- **发消息（乐观更新）**：点发送 → 立即把用户消息上屏并显示打字动画 →
  `POST /api/conversations/:id/messages` → 用响应里的 `{userMessage, agentMessage}`
  **替换**掉乐观插入的那条（以对象引用定位）→ 失败则按引用回滚并 Toast 提示。
  收到卡片后调 `withCardId()` 补一个会话内唯一 id，用于「保存为我的策略」的已保存态。
- **新建/删除/清空**：一一对应 `POST`、`DELETE :id`、`POST :id/clear`；
  删空后自动重建一个会话，保证聊天页永远有会话。
- 会话标题改名逻辑前后端一致（首条消息前 16 字），本地乐观改名 + 服务端兜底。

### 3.2 策略（`App.tsx` + `StrategiesPage.tsx`）

- 列表：`GET /api/strategies`，App 挂载时加载，侧边栏计数随之显示。
- 新建：弹窗只产出 `{name, universe, rebalance, factors}`（`NewStrategyInput`），
  `POST /api/strategies` 由后端补全 id/状态/基准等字段并归一化权重，返回草稿。
- **保存权重 = 重新回测**（契约的产品语义）：详情弹窗把滑杆权重**原样**提交
  `PATCH /api/strategies/:id`，后端归一化（合计 ≠100 按比例折算、残差补给最大项）
  并自动回测，返回更新后的完整 Strategy 直接替换本地状态；draft 保存后自动变 done。
  前端不再需要 `normalizeWeights`（已随 `agent.ts` 删除）。
- 重新回测：`POST /api/strategies/:id/backtest`；删除：`DELETE /api/strategies/:id`。
- **报告卡 → 保存策略**：`POST /api/strategies`（卡片里的因子/股票池/调仓）+
  `POST :id/backtest` 出正式报告，两步后策略出现在「我的策略」。

### 3.3 个人中心（`ProfilePage.tsx`）

- `GET /api/user/profile` 渲染全部内容；先用内置兜底数据渲染、接口返回后覆盖
  （后端不可达时页面依旧可用，Toast 会提示）。
- 开关/多选/单选：**乐观更新 + 失败回滚**，请求按类型分别传 `on` / `values` / `value`，
  后端返回更新后的完整 profile 直接覆盖状态。
- 密钥：列表显示**服务端返回的脱敏值**；添加 `POST /api/user/apikeys`、
  删除 `DELETE /api/user/apikeys/:name`，每次操作立即落后端，重名返回 409 并提示。

### 3.4 配置型数据后端下发（`config.tsx`）

因子库（`GET /api/factors`）与回测参数（`GET /api/backtest-params`）进 `ConfigProvider`，
`NewStrategyModal` 的因子勾选、卡片/详情里的「回测参数」块都从 Context 读。
**后端以后加参数项、加因子，前端零改动。**

### 3.5 后端健康状态（侧边栏）

App 挂载时 `GET /api/health`：在线 → 绿点 +「智能体在线 / GLM 已接入 · 模型名」；
后端没起 → 红点 +「后端离线 / 请启动 factor-agent-server」。任何接口的网络错误
（`ApiError: NETWORK_ERROR`）都会 Toast 提示启动后端。

### 3.6 错误约定

`api.ts` 把非 2xx 的 `{ "error": { "code", "message" } }` 统一抛成 `ApiError`；
页面层 catch 后直接 `notify(err.message)` 展示后端文案（如「因子权重合计为 0」
「已存在同名密钥」），fetch 网络异常单独给出「无法连接后端服务」提示。

## 4. 怎么跑起来

```bash
# 终端 1：后端（端口 3000）
cd factor-agent-server
npm install
npm run start:dev          # .env 里配 ZHIPU_API_KEY；GET /api/health 验证

# 终端 2：前端（端口 5173）
cd factor-agent-react
npm install
npm run dev                # 打开 http://localhost:5173
```

验证要点（本次已全部实测通过）：

1. 侧边栏出现「智能体在线 · GLM 已接入 · glm-5.3-flash」→ 代理与健康检查通了；
2. 发「帮我构建一个低波动+高股息的防御策略」→ 返回 report 卡（防御型/股息率35/低波动30…）；
   发「筛选 ROE…」→ stocks 卡；对上一轮追问「回测」→ backtest 卡并复用上下文；
3. 「保存为我的策略」→ 「我的策略」列表 +1，更新日期为今天；
4. 详情弹窗把权重调到合计 130% 保存 → 自动折算 100%（46.1/38.5/15.4）并出新报告；
5. 个人中心改开关/数据源/风险偏好/密钥 → 刷新页面仍是新值（数据在后端）。

## 5. 已知边界与遗留

- **GLM 已真实调通**（2026-09-24）：项目用的是智谱**编码套餐团队 Token**，必须走编码专用
  端点 `https://open.bigmodel.cn/api/coding/paas/v4`（`.env` 的 `ZHIPU_BASE_URL`）；
  标准端点 `…/api/paas/v4` 对套餐模型返回 403「No permission to access model」/ 429「余额不足或
  无可用资源包」。`glm-5.3-flash` 是推理模型，`maxTokens` 已提到 1024（reasoning 计入
  max_tokens）。此前"余额不足"问题即端点用错所致，充值与否无关。
  失败处理：LLM 调用失败时回复仅含 ⚠️ 报错信息、不带卡片（不静默降级）。
- **存储为内存态**：后端重启恢复种子数据（会话/策略/设置都会重置），换数据库前
  这是预期行为。
- **回测为模拟引擎**：口径与前端演示一致，接真实行情只需替换后端
  `core/backtest.service.ts` 与 `core/screen.service.ts`。
- 会话快捷指令（`CHAT_SUGGESTIONS`）、报告卡「已保存」标记（`savedCardIds`）、
  侧边栏用户名「陈研究员」仍是前端本地状态/文案，待登录体系建立后收编。
- 端口备忘：本机 8000 被 Python 服务占用（后端因此用 3000）；5173 上若有一个
  旧 dev server 残留，Vite 会自动换 5174，建议关掉旧的避免混淆。
