# evals/tasks — 评测任务集

```text
tasks/
├── index.ts     # 任务注册表：把 offline 任务装配进套件
├── offline/     # 离线任务（mock 引擎桩，不依赖真库）：校准/澄清/编造/确认路由等
└── online/      # 在线端到端任务（真库真引擎，二期实施，暂只有规划 README）
```
