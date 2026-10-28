# src/conversations — 会话模块

```text
conversations/
├── conversations.controller.ts    # 会话 CRUD 与 SSE 流式问答路由
├── conversations.module.ts        # 模块装配
├── conversations.service.ts       # 抽象接口
├── dto.ts                         # 请求 DTO
└── implementations/
    └── conversations.service.impl.ts   # 实现：会话/消息持久化、流式回复组装与卡片落库
```
