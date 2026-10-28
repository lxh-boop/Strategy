# src/agent — 智能体模块

```text
agent/
├── agent.module.ts               # 模块装配
├── agent.service.ts              # 智能体抽象接口（chat 流式入口）
└── implementations/
    ├── langgraph-agent.service.ts   # LangGraph 编排实现：意图/工具循环/确认门 interrupt/卡片通道/记忆与滚动摘要
    └── tool-specs.ts                # 工具 schema 定义（名称、描述、参数约束）
```
