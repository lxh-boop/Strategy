# src/agent — 智能体模块

```text
agent/
├── agent.module.ts               # 模块装配
├── agent.service.ts              # 智能体抽象接口（chat 流式入口）
└── implementations/
    ├── langgraph-agent.service.ts   # LangGraph 编排实现：意图/工具循环/确认门 interrupt/卡片通道/记忆与滚动摘要；
    │                                #   token 减负（prompt 分支）：GLM usage 日志 + 喂模型边界投影
    │                                #   （表目录仅首轮注入、旧行回执摘要化，图状态保持全量）
    └── tool-specs.ts                # 12 个工具 schema；描述规范：工具一句话、用法归参数、跨参数约束去重
```
