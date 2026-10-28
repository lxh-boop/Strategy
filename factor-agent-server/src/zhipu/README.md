# src/zhipu — 智谱 GLM 客户端

```text
zhipu/
├── implementations/
│   └── http-zhipu.service.ts   # HTTP 实现：OpenAI 兼容协议调 chat/completions（流式/非流式）
├── zhipu.module.ts             # 模块装配
├── zhipu.service.ts            # 抽象接口（chat / chatStream / configured）
└── zhipu.types.ts              # 消息/选项/分块类型
```
