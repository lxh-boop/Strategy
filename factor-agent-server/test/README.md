# factor-agent-server/test — 单元测试

按 src 模块镜像组织；core 为重点（引擎正确性回归），各业务模块测 service 实现与 controller 契约。

```text
test/
├── auth/               # 认证模块测试
├── conversations/      # 会话模块测试
├── core/               # 核心域测试：账户涨跌停闸、schema、行业引擎、股票池、回测批次/换手/期间、择时、权重函数
├── market/             # 行情模块测试
├── strategies/         # 策略模块测试
└── user/               # 用户模块测试
```
