# factor-agent-server/src — 后端源码

NestJS 模块化布局：每个业务模块一个目录（controller/service/module/dto + implementations/），
接口放抽象类、实现放 implementations，便于测试替换。

```text
src/
├── main.ts               # 启动入口
├── app.module.ts         # 根模块：装配全部业务模块
├── app.controller.ts     # 健康检查等根路由
├── types.ts              # 全局领域类型（卡片、策略、配置）
├── agent/                # 智能体模块：LangGraph 图、工具编排、确认门
├── auth/                 # 认证模块：注册/登录/JWT
├── common/               # 横切：异常过滤器、访问日志、JWT 守卫、客户端日志
├── config/               # 配置装载（.env → configuration）
├── conversations/        # 会话模块：会话与消息持久化、SSE 流式
├── core/                 # 核心域：回测引擎、因子数据服务、账户原语、归因、存储契约
├── market/               # 行情模块：指数/大盘行情查询
├── strategies/           # 策略模块：策略 CRUD、重新回测、归因端点
├── user/                 # 用户模块：资料与偏好
└── zhipu/                # 智谱 GLM 客户端：chat / chatStream
```
