# HTTP 接口状态（API-01 ~ API-24）

> 与 `docs/模块划分文档.md` §3.1 一一对应；API-19~24 为规划接口（待实现定义细节）；
> 状态规则见 [README.md](README.md)。

## 现有接口（API-01 ~ API-18）

| 编号 | 接口 | 说明 | 负责人 | 状态 | 完成提交/日期 |
|---|---|---|---|---|---|
| API-01 | GET `/api/health` | 健康检查：`zhipuConfigured`、`defaultModel` | 待认领 | ⬜ 未实现 | |
| API-02 | GET `/api/conversations` | 会话列表（含全部消息，按更新时间倒序） | 待认领 | ⬜ 未实现 | |
| API-03 | POST `/api/conversations` | 新建会话（后端自动带欢迎语） | 待认领 | ⬜ 未实现 | |
| API-04 | DELETE `/api/conversations/:id` | 删除会话 | 待认领 | ⬜ 未实现 | |
| API-05 | POST `/api/conversations/:id/clear` | 清空会话（保留会话，恢复欢迎语、标题重置） | 待认领 | ⬜ 未实现 | |
| API-06 | GET `/api/conversations/:id/messages` | 拉取历史消息（列表已带全量，留给分页场景） | 待认领 | ⬜ 未实现 | |
| API-07 | POST `/api/conversations/:id/messages` | **发消息（核心链路）**：调智能体，返回 `{userMessage, agentMessage}`，agent 消息可含卡片；M11 将改造为 SSE 流式 | 待认领 | ⬜ 未实现 | |
| API-08 | GET `/api/strategies` | 策略列表（含曲线、指标、持仓） | 待认领 | ⬜ 未实现 | |
| API-09 | POST `/api/strategies` | 创建策略（草稿）；对话卡片"保存为我的策略"也走此接口 | 待认领 | ⬜ 未实现 | |
| API-10 | PATCH `/api/strategies/:id` | 更新配置 = **保存并自动重新回测**，返回更新后完整 Strategy | 待认领 | ⬜ 未实现 | |
| API-11 | POST `/api/strategies/:id/backtest` | 重新回测（可带 period/topK/feeRate，缺省用默认值） | 待认领 | ⬜ 未实现 | |
| API-12 | GET `/api/strategies/:id/report` | 回测报告详情 `{metrics, curve, benchCurve, holdings}` | 待认领 | ⬜ 未实现 | |
| API-13 | DELETE `/api/strategies/:id` | 删除策略 | 待认领 | ⬜ 未实现 | |
| API-14 | GET `/api/factors` | 因子库 9 项 `{id, name, desc}`（UI 数据驱动） | 待认领 | ⬜ 未实现 | |
| API-15 | GET `/api/backtest-params` | 回测参数项 `{label, value, hint}`（UI 自动渲染） | 待认领 | ⬜ 未实现 | |
| API-16 | POST `/api/screen` | 选股筛选 `{universe?, filters[], topN?}` → `{stocks, total}` | 待认领 | ⬜ 未实现 | |
| API-17 | GET `/api/user/profile` | 用户信息 + 因子偏好雷达 + 设置项（模型/数据来源为 readonly 展示） | 待认领 | ⬜ 未实现 | |
| API-18 | PATCH `/api/user/settings` | 更新设置项，仅 notify/report/risk 可配置（toggle 传 `on`、single 传 `value`），其余 key 400 | 待认领 | ⬜ 未实现 | |

## 规划接口（API-19 ~ API-24，M12~M16 认领后细化定义）

| 编号 | 接口 | 说明 | 负责人 | 状态 | 完成提交/日期 |
|---|---|---|---|---|---|
| API-19 | GET `/api/strategies/:id/backtest/status` | 回测进度查询（轮询） | 待认领 | ⬜ 未实现 | |
| API-20 | GET `/api/strategies/:id/report/export` | 回测报告导出 PDF | 待认领 | ⬜ 未实现 | |
| API-21 | POST `/api/auth/register` | 用户注册 | 待认领 | ⬜ 未实现 | |
| API-22 | POST `/api/auth/login` | 登录，签发 token | 待认领 | ⬜ 未实现 | |
| API-23 | POST `/api/auth/logout` | 登出 | 待认领 | ⬜ 未实现 | |
| API-24 | GET `/api/auth/me` | 当前登录用户信息 | 待认领 | ⬜ 未实现 | |

> **预留编号段**：API-25 起为新接口追加位，新增接口按序顺延，不回收、不复用。
