# factor-agent-server

因子智投（AlphaSage）后端服务。按前端契约文档 `factor-agent-react/docs/backend-api.md` 实现的接口，
智能体基于 **LangChain + LangGraph** 编排，大模型接入**智谱 GLM**。

> 📖 **技术说明文档**（架构、智能体设计、算法口径、接口明细、扩展路线）：[docs/technical.md](docs/technical.md)

- 技术栈：NestJS 11 + TypeScript + LangChain/LangGraph（JS 版）
- 大模型：智谱 GLM（OpenAI 兼容协议，经 `@langchain/openai` 的 `ChatOpenAI` 接入）
- 端口：**3000**（`.env` 可改；注意本机 8000 已被一个 Python uvicorn 服务占用）

## 快速开始

```bash
npm install
# 编辑 .env，填写 ZHIPU_API_KEY（不填也能跑：文案回退为内置模板）
npm run start:dev    # http://127.0.0.1:3000
```

验证：`GET http://127.0.0.1:3000/api/health` 返回 `"zhipuConfigured": true` 即 Key 已生效。

前端（Vite）联调：在 `factor-agent-react/vite.config.ts` 加代理（前端侧改动）：

```ts
server: { port: 5173, proxy: { "/api": "http://localhost:3000" } }
```

> ✅ **前后端已打通**（2026-09-24）：React 前端全部数据走本服务，联调过程与验证记录见
> `factor-agent-react/docs/integration.md`。2026-09-28 按产品决策调整：**模型统一智谱 GLM、
> 数据统一使用内部数据**，个人中心移除 API 密钥与数据源配置，设置项仅保留
> notify / report / risk 可配置（`model` / `datasource` 为只读展示项）。

## 目录结构

```
src/
├── main.ts                    # 入口：CORS、全局校验管道、统一错误过滤器
├── app.module.ts / app.controller.ts
├── types.ts                   # 与前端 src/types.ts 一致的共享类型
├── common/
│   ├── api.exception.ts       # ApiException(code, status, message)
│   └── api-error.filter.ts    # 全局异常 → { "error": { "code", "message" } }
├── config/configuration.ts    # 环境变量
├── core/                      # 领域共享层（全局模块）
│   ├── store.service.ts       # 内存存储 + 种子数据（与前端 mock 对齐）
│   ├── backtest.service.ts    # 模拟回测引擎（种子伪随机，确定性）
│   └── screen.service.ts      # 选股筛选
├── agent/                     # 智能体（LangGraph 状态图）
│   └── agent.service.ts
├── conversations/             # 会话模块（6 个接口）
├── strategies/                # 策略模块（6 个接口）
├── market/                    # 因子库 / 回测参数 / 选股筛选
├── user/                      # 个人中心
└── zhipu/                     # 智谱直连客户端（health 探测与备用，主链路走 LangChain）
```

## 智能体（LangGraph + LangChain tool-calling）

```
START → agent(GLM，绑定 2 个工具) ⇄ tools(执行工具) → 最终文案
          │ select_factors  选因子：抽取因子/权重/股票池/调仓/命名，记录策略配置
          │ run_backtest    回测：对当前配置执行回测，产出报告卡片
```

- **两个工具构成"选因子 → 回测"流程，由 GLM 自主决定调用时序与参数**：构建策略时模型先调
  `select_factors` 再调 `run_backtest`；"再回测一下它"直接复用会话级配置重跑回测；
  "把低波动提到 40" = 基于当前配置修改后重新选因子 + 回测。
- **非工具分支**：筛选/ROE/估值类消息走规则分支产出 stocks 卡片（演示功能）；问候/闲聊不调用
  工具，纯文本回复，不生成卡片。
- **卡片数据**：全部由本地模拟回测引擎生成（回测种子 = 会话+配置 → 同一配置永远同一份报告），
  LLM 不接触数值生成，不会编造数据；权重归一化算法与前端 `normalizeWeights` 完全一致。
- **因子知识库（LLM 的因子来源）**：`docs/factors.md` 是因子知识**唯一数据源**——9 个因子的
  定义/指标/权重区间/风格搭配 + 给模型的传参规则。服务每次组装提示词时自动读取全文注入给模型
  （按文件修改时间缓存，**编辑保存后下一次请求即生效，无需重启**）；`/api/factors` 下发给前端的
  因子库应与该文档保持一致。文档缺失时自动回退内置短名清单并告警。
- **文案**：模型基于工具返回的 JSON 写 ≤90 字回复，只能引用给定数据；未配置 Key 时走关键词
  规则兜底 + 模板文案（开发模式）；**配置了 Key 但调用失败（429 余额不足 / 403 无模型权限 /
  超时等）时，回复仅含失败原因，不附带卡片，不静默降级**。
- **实测**（团队 Key + glm-5.3-flash）：策略类消息约 15~20s（推理模型 + 两三轮工具循环），
  闲聊约 6s；模型会自主配因子、自行命名策略并精准引用回测指标。

## 环境变量（.env）

| 变量 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- |
| `ZHIPU_API_KEY` | 否 | 空 | 智谱 API Key（https://open.bigmodel.cn → 控制台 → API Keys） |
| `ZHIPU_MODEL` | 否 | `glm-4-flash`（免费） | 可换 `glm-4-air` / `glm-4-plus` / `glm-4.5` / `glm-4.6` |
| `ZHIPU_BASE_URL` | 否 | `https://open.bigmodel.cn/api/paas/v4` | 智谱 API 地址。**团队 Token（编码套餐）必须改为 `…/api/coding/paas/v4`**，否则套餐模型报 403/429 |
|  |  |  | 充值购买的 API Key 用标准端点即可；套餐模型（glm-5.3-flash 等）在标准端点无权限 |
| `PORT` | 否 | `3000` | 服务端口（8000 被本机 Python 服务占用） |
| `CHAT_TIMEOUT_MS` | 否 | `20000` | LLM 文案生成超时 |
| `SYSTEM_PROMPT` | 否 | 内置人设 | 预留 |

## 接口清单（详见前端契约 docs/backend-api.md）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查（含 zhipuConfigured） |
| GET/POST | `/api/conversations` | 会话列表 / 新建（带欢迎语） |
| DELETE | `/api/conversations/:id` | 删除会话 |
| POST | `/api/conversations/:id/clear` | 清空会话 |
| GET | `/api/conversations/:id/messages` | 历史消息 |
| POST | `/api/conversations/:id/messages` | 发消息，返回 `{userMessage, agentMessage}`（含卡片） |
| GET/POST | `/api/strategies` | 策略列表（含 4 个种子策略）/ 新建草稿 |
| PATCH | `/api/strategies/:id` | 更新配置 = 自动重新回测 |
| POST | `/api/strategies/:id/backtest` | 重新回测（可带 period/topK/feeRate） |
| GET | `/api/strategies/:id/report` | 回测报告详情 |
| DELETE | `/api/strategies/:id` | 删除策略 |
| GET | `/api/factors` · `/api/backtest-params` | 因子库 / 回测参数（后端下发，UI 数据驱动） |
| POST | `/api/screen` | 选股筛选 `{universe, filters, topN}` |
| GET | `/api/user/profile` · PATCH `/api/user/settings` | 个人中心（模型/数据来源为 readonly 展示；toggle 传 `on`、single 传 `value`） |

错误格式统一为 `{ "error": { "code": "MESSAGE" } }`，如：

```json
{ "error": { "code": "INVALID_ARGUMENT", "message": "因子权重合计为 0，属非法输入" } }
```

## 数据口径（与契约 §2.6 一致）

- 百分比是 `14.6`（14.6%），不是 0.146；净值曲线起点固定 100，30 个月频点；
- 因子权重存储时归一化为合计 100（1 位小数，残差补给最大项；合计 0 → 400）；
- 策略 `updatedAt` 为 `YYYY-MM-DD`，消息 `time` 为 `HH:mm`，会话 `updatedAt` 为毫秒时间戳。

## 当前边界与后续规划

- **存储为内存态**（重启即恢复种子数据），接口形态已按契约定型，后续平滑换数据库；
- **回测为模拟引擎**（演示口径），接真实行情/回测后，只需替换 `core/backtest.service.ts` 与
  `core/screen.service.ts`，LangGraph 中加工具节点即可；
- 可选增强（契约 §5）：流式回复（SSE：先推 `{"type":"text","delta"}` 再推 `{"type":"card"}`）、
  回测进度、报告导出。
