# B 模块内部业务接口状态（B-INT-01 ~ 04）

> 与 `docs/模块划分文档.md` §3.2 一一对应；状态规则见 [README.md](README.md)。

| 编号 | 接口（方法集） | 说明 | 负责人 | 状态 | 完成提交/日期 |
|---|---|---|---|---|---|
| B-INT-01 | `ConversationsService`：`list()` / `create()` / `remove(id)` / `clear(id)` / `getMessages(id)` / `sendMessage(id, text)` | 会话业务：编排"校验 → 拼 routeText → 调 SVC-C01 → 落库 → 命名 → 返回" | 待认领 | ⬜ 未实现 | |
| B-INT-02 | `StrategiesService`：`list()` / `create(input)` / `update(id, patch)` / `backtest(id, params?)` / `getReport(id)` / `remove(id)` | 策略业务：权重归一化（SVC-D21）、**保存=归一化+自动重新回测**（API-10 语义） | 待认领 | ⬜ 未实现 | |
| B-INT-03 | `MarketService`：`listFactors()` / `listBtParams()` / `screen(options)` | 市场数据业务：汇聚 SVC-D14/D15/D20 | 待认领 | ⬜ 未实现 | |
| B-INT-04 | `UserService`：`getProfile()` / `updateSetting(key, payload)` | 用户业务：设置项白名单校验（notify/report/risk 之外 400），汇聚 SVC-D17/D18 | 待认领 | ⬜ 未实现 | |
