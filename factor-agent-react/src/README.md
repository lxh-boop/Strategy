# factor-agent-react/src — 前端源码

```text
src/
├── App.tsx            # 应用根组件：页面路由切换、全局数据流（策略/会话/归因 handler）
├── api.ts             # 后端 REST 封装（fetch + Bearer）
├── config.tsx         # 运行时配置上下文（因子库等）
├── main.tsx           # 入口：挂载 React 根节点
├── types.ts           # 前端类型：卡片（回测/归因等）、策略、会话
├── vite-env.d.ts      # Vite 环境类型声明
├── components/        # 通用组件：图表、卡片表格、弹窗、markdown 渲染
├── data/              # 演示用 mock 数据
├── hooks/             # 自定义 hooks（会话流）
├── pages/             # 页面：对话 / 策略 / 个人中心
├── styles/            # 全局样式
└── utils/             # 格式化工具（日期、百分比、涨跌色）
```
