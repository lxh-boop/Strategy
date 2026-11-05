# Notes

- 教学语言：中文；代码示例用 TypeScript/NestJS 形态（用户的技术母语）。
- 一切尽量对照用户真实项目（factor-agent：NestJS + MySQL 直连 + 进程内 LRU 缓存 + p-queue 资源闸）——这位学习者对"进程内方案"理解很深，用"Redis 能做到而进程内做不到什么"切入效果好，抽象泛讲效果差。
- 开发机是 Windows：本地 Redis 需 WSL2/Docker；前几课动手统一用官方沙盒（redis.io/try/sandbox），装本地实例放到后续课再决定。
- 用户是有经验的后端开发者：连接池、TTL、LRU、并发闸、限流退避等概念无需解释，直接当类比起点。
- 工作区放在仓库子目录 `learn-redis/`，避免污染 factor-agent 仓库根目录；整目录可 gitignore，等用户表态。
- 2026-10-31 首课：`0001-redis-vs-in-process-cache.html`，切入点 = 项目里 MysqlFactorDataService 的 LRU Map 单实例 vs 多实例的反差。
- 2026-10-31：用户追问"实例是什么"暴露部署拓扑词汇盲区（LR-0002）——已建 `reference/glossary.html`，此后每课都链接它；涉及部署词汇须先锚定定义。
- 2026-10-31：用户问"是否该先学多实例部署"——定调：不作为前置课，部署概念按需嵌入课程。课程图：0001 命令面（已建）→ 0002 本地 Docker 跑 Redis + node-redis 改缓存层 → 0003「第二个实例到来的那天」多实例坏点地图（缓存/资源闸/检查点/记忆文件 × 各自修法）→ 之后 BullMQ 任务队列。
- 2026-10-31（晚些）：部署三件套另立工作区 `../learn-deploy/`（见 LR-0003）。两轨会合点：Docker 前置（Redis 0002 一并安装，装一次两条轨都用）；Redis 0003 坏点地图 × deploy 0002 双实例实操互为表里。
- 2026-10-31 用户披露（见 deploy 轨 LR-0004）：有 Docker 单实例全栈部署经验——Redis 轨不受影响（Redis 本身仍是全新领域），但 §"装 Docker" 环节可以从简。
