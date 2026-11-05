# Mission: Redis

## Why
用户是 factor-agent（NestJS + MySQL 因子回测平台）的后端开发者。项目当前单实例直连 MySQL（进程内 LRU 缓存 + p-queue 资源闸），Redis 在《并发治理方案》里被明确列为将来多实例化时的演进路径（缓存共享 / BullMQ 任务队列 / 检查点外置）。目标：能独立判断"什么时候该引 Redis、引哪一部分"，并在项目扩容时亲手把它接进去——而不是只在方案文档里见过这个词。

## Success looks like
- 能熟练操作 5 种基础数据类型，说清每种的适用场景与时间复杂度
- 能把项目里 `MysqlFactorDataService` 的进程内 LRU 缓存迁移为 Redis 实现并说清取舍（序列化、网络往返、跨实例共享）
- 能用 BullMQ 设计一个替代进程内 p-queue 的回测任务队列，理解失败重试与幂等
- 能在生产语境下回答：TTL 策略、maxmemory 淘汰策略、RDB/AOF 持久化、缓存穿透/击穿/雪崩

## Constraints
- Windows 开发机：本地跑 Redis 需 WSL2/Docker，前几课用官方浏览器沙盒零安装
- 单课 15–30 分钟可完成，必须绑定项目真实场景
- 中文教学，代码示例用 TypeScript/NestJS 形态

## Out of scope
- Redis Stack 模块（Search / TimeSeries / Vector Sets）——演进路径用不到
- 集群 / 哨兵运维细节——单实例部署形态下为时过早
- Memcached 等其他缓存系统的横向对比
- 多实例部署的运维专题（网关配置 / 负载均衡 / 容器编排）——2026-10-31 用户决定正式学习，另立平行工作区 `../learn-deploy/`；本 workspace 只保留 Redis 视角的最小必要概念（0003 坏点地图）
