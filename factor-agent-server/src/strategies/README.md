# src/strategies — 策略模块

```text
strategies/
├── dto.ts                          # 请求 DTO
├── strategies.controller.ts        # 策略 CRUD/重跑/报告/归因路由（API-08~13、27）
├── strategies.module.ts            # 模块装配
├── strategies.service.ts           # 抽象接口
└── implementations/
    └── strategies.service.impl.ts  # 实现：由回测卡创建策略、按原配置重跑、归因入口
```
