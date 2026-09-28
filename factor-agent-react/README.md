# 因子智投 · 多因子选股智能体（React 版）

多因子选股智能体的前端，技术栈：**React 18 + TypeScript + Vite**。
**前后端已打通**：数据全部来自 NestJS 后端（[factor-agent-server](../factor-agent-server)，
智能体基于 LangGraph + 智谱 GLM），联调做法见 **[docs/integration.md](docs/integration.md)**。

## 启动（需先启动后端）

```bash
# 终端 1：后端（端口 3000）
cd ../factor-agent-server && npm install && npm run start:dev

# 终端 2：前端（端口 5173）
npm install
npm run dev        # 开发预览，默认 http://localhost:5173（/api 已代理到 3000）
npm run build      # 产物输出到 dist/
npm run preview    # 本地预览构建产物
```

## 功能

- **对话选股**：多会话管理（新建/切换/删除/清空，数据存后端）、多轮上下文；
  智能体（LangGraph 意图路由）返回「策略构建 report / 回测 backtest / 选股筛选 stocks」
  三种结构化卡片，报告卡可一键保存为策略
- **我的策略**：统计总览、策略卡片（收益曲线/指标）、详情弹窗（因子权重滑杆、
  当前持仓、回测参数）、新建策略；保存权重 = 后端自动归一化并重新回测
- **个人中心**：用户信息、因子偏好雷达图、偏好设置（开关/数据源/风险偏好）、
  API 密钥管理（后端存储、界面只显示脱敏值）

## 目录结构

```
src/
├── api.ts                后端接口统一封装（fetch + ApiError 错误约定）
├── config.tsx            配置型数据 Context（因子库/回测参数由后端下发）
├── types.ts              全局类型（与后端 src/types.ts 对齐）
├── data/mock.ts          快捷指令文案 + 后端不可达时的兜底数据
├── hooks/useConversations.ts   多会话状态（会话接口 + 乐观更新/回滚）
├── components/
│   ├── charts.tsx        Sparkline / 回测净值曲线 / 区间收益条 / 雷达图（纯 SVG）
│   ├── ui.tsx            Modal / Toast / 指标网格 / 回测参数块
│   └── icons.tsx         内联 SVG 图标
└── pages/
    ├── ChatPage.tsx      对话选股
    ├── StrategiesPage.tsx 我的策略（含三个弹窗）
    └── ProfilePage.tsx   个人中心
```

## 文档

- **[docs/integration.md](docs/integration.md)** — 前后端联调打通说明（架构、改动清单、
  各链路做法、启动验证、遗留事项）
- **[docs/backend-api.md](docs/backend-api.md)** — 后端接口契约（接口清单、请求/响应示例、
  数据口径）

## 打包 APP（后续）

当前为标准 Web 应用，后续接入 [Capacitor](https://capacitorjs.com/) 即可打包成
iOS / Android 应用，前端代码零改动：

```bash
npm i @capacitor/core @capacitor/cli
npx cap init
npm run build && npx cap add android   # 或 ios
```
