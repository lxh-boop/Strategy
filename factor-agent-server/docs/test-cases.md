# 测试样例（多人协作共享）

> 本文档是团队共用的**测试样例清单**：人工验收按表执行，自动化回归跑
> `npm run test:e2e`（用例代码在 `test/api.e2e-spec.ts`，与本文档一一对应）。
> 新增/修改行为时**先改这里再改代码**，两边同步更新。

## 1. 怎么跑

```bash
cd factor-agent-server
npm run test:e2e        # 20 个用例，约 4 秒，无需后端启动、无需 GLM Key、离线可跑
```

- 自动化用例**置空 `ZHIPU_API_KEY`**，智能体走"关键词规则 + 模板文案"开发模式，
  行为确定、不消耗团队套餐额度。tool-calling 主链路（真实 GLM）见 §2 的手动样例。
- 需要真实验证 GLM 时：正常启动后端（带 Key），按 §2.4 手动样例执行。

## 2. 对话测试样例（智能体）

### 2.1 意图路由（无 Key 模式，自动化已覆盖）

| # | 输入样例 | 预期意图 | 预期结果 |
|---|---|---|---|
| C1 | `你好` | chat | 纯文本回复，**无卡片**；会话标题变为"你好"（首条消息命名） |
| C2 | `帮我构建一个小盘动量策略` | report | report 卡：标题含"小盘动量增强"、tag=进攻型、因子权重合计=100、curve 30 点且起点 100、universe=中证1000 |
| C3 | 同会话追问 `回测一下它的历史表现` | backtest | backtest 卡，标题复用上一轮配置"小盘动量增强" |
| C4 | `在沪深300里筛选 ROE 大于15的股票` | stocks | stocks 卡：tag 形如"共 N 只 · 展示前 M"、M≤5、得分降序、code 为 6 位数字 |
| C5 | `谢谢` / `在吗` 等无关键词消息 | chat | 纯文本，无卡片（兜底引导文案） |
| C6 | 新建会话 | — | 自带欢迎语，title="新对话" |
| C7 | 清空会话 | — | 消息重置为欢迎语、标题还原"新对话" |
| C8 | 删除会话后再拉历史 | 404 | `{ "error": { "code": "NOT_FOUND", … } }` |

### 2.2 多轮修改样例（有 Key 模式，tool-calling 链路，手动验证）

| # | 输入样例 | 预期行为 |
|---|---|---|
| T1 | `帮我构建一个低波动加高股息的防御策略` | 先 `select_factors` 再 `run_backtest`，回复引用卡片数据（≤90 字，不编数字），附 report 卡 |
| T2 | `把低波动提到40` | 基于当前配置修改后重新选因子 + 回测 |
| T3 | `再回测一下它` | 直接 `run_backtest` 复用当前配置 |
| T4 | `今天天气怎么样` | 不调用工具，简短闲聊回复 |

### 2.3 GLM 失败样例（契约约定）

| # | 场景 | 预期结果 |
|---|---|---|
| F1 | Key 无效 / 余额不足（429）/ 无模型权限（403） | 回复仅含 `⚠️ 智能体回复生成失败：智谱 GLM 调用返回「…」…`，**不带卡片**，不静默降级模板 |

### 2.4 手动执行方式

```bash
# 建会话 → 发消息（UTF-8 body 请写入文件避免终端编码问题）
curl -s -X POST http://127.0.0.1:3000/api/conversations
curl -s -X POST http://127.0.0.1:3000/api/conversations/<id>/messages \
  -H "Content-Type: application/json" --data-binary @msg.json
```

## 3. 接口测试样例（自动化已覆盖）

### 3.1 策略模块

| # | 操作 | 预期 |
|---|---|---|
| S1 | `GET /api/strategies` | 4 个种子策略（s1~s4） |
| S2 | `POST` 新建（权重 50/40/30 合计 120） | draft；因子归一化 41.7/33.3/25.0（合计 100）；默认基准沪深300指数 |
| S3 | `PATCH` 因子权重（40/40/40） | **保存=自动重新回测**：draft→done，33.4/33.3/33.3（残差补最大项），metrics/curve/holdings 齐备 |
| S4 | 同配置 `POST :id/backtest` 两次 | 曲线与指标完全一致（种子伪随机确定性） |
| S5 | `PATCH` 权重全 0 | 400 `INVALID_ARGUMENT`，message 含"0" |
| S6 | `DELETE` 后再拉报告 | 204 → 404 `NOT_FOUND` |

### 3.2 个人中心

| # | 操作 | 预期 |
|---|---|---|
| U1 | `GET /api/user/profile` | notify/report 为 toggle（on）；**model/datasource 为 readonly 展示项**（智谱 GLM / 内部数据）；risk 为 single（4 个 choices，value=稳健型） |
| U2 | `PATCH {key:'notify', on:false}` | on 变 false |
| U3 | `PATCH {key:'risk', value:'积极型'}` | value 变积极型 |
| U4 | `PATCH {key:'datasource', …}`（只读项）/ 未知 key | 400 `INVALID_ARGUMENT` |
| U5 | `POST/GET /api/user/apikeys` | 404（密钥管理已下线，防止误恢复） |

### 3.3 行情配置与筛选

| # | 操作 | 预期 |
|---|---|---|
| M1 | `GET /api/factors` · `/api/backtest-params` | 9 个因子 / 3 项参数，字段 id·name·desc / label·value·hint |
| M2 | `POST /api/screen`（roe_ttm>15，topN 5） | total ≥ 返回数，得分降序 |
| M3 | `POST /api/screen` 缺 universe | 400 `INVALID_ARGUMENT` |

### 3.4 通用约定

- 错误格式统一 `{ "error": { "code": "MESSAGE" } }`；
- 百分比口径是 `14.6`（不是 0.146）；净值曲线起点固定 100、30 个月频点；
- 因子权重存储恒归一化合计 100（1 位小数，残差补给最大权重项）。

## 4. 怎么扩展

1. 改行为前先在 §2/§3 表格加一行样例（写清输入与预期）；
2. 在 `test/api.e2e-spec.ts` 加对应用例（保持用例名与表格编号可对应）；
3. `npm run test:e2e` 全绿后再提交。团队约定：**PR 合并前测试必须通过**。
