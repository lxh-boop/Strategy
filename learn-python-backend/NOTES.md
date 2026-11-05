# Notes

## 继承的教学纪律（同一学习者，出处见 ../learn-deploy/learning-records/）

- 新名词先说它属于哪一类（规范 / 框架 / 服务器 / 库 / 解释器机制），再说它干什么（LR-0005、LR-0008）。Python 里尤其要分清：WSGI/ASGI 是规范，Django/Flask/FastAPI 是框架，gunicorn/uvicorn 是服务器。
- 讲"写 / 存 / 状态"类概念时，先说清谁在写、写到哪、什么时候写（LR-0007）。
- 凡说"经典坑 / 踩过"，配机制 + 1 分钟复现代码（LR-0009）。Python 复现成本极低：每个陷阱题都附可运行片段，**先在本机 3.12 跑通再写进卡片**。
- 底层知识点标面试优先级：必须会 / 认识名字 / 知道有就行。
- 项目故事诚实红线：用户的项目是 NestJS，不能写成"我在 Python 项目里做过"。统一用迁移讲法："我在 Node 项目里这样做，换到 Python 对应的是……"。
- 用户强项是 TS/Node：异步、事件循环、装饰器、依赖注入、数据校验、连接池、并发闸都可以直接类比（见下表）。

## Node 项目 → Python 对应（项目故事素材，Node 侧均已在 factor-agent 代码中核实）

| factor-agent（NestJS）里的真实做法 | Python 对应 |
|---|---|
| Node 事件循环 + async/await | asyncio 事件循环 + async/await |
| p-queue 限 GLM 并发 = 2 | asyncio.Semaphore / 线程池 max_workers |
| GLM 429 退避重试 10 次 | 手写指数退避 / 第三方库 tenacity |
| class-validator + zod 校验 DTO | Pydantic |
| NestJS 依赖注入容器 | FastAPI Depends |
| NestJS 拦截器、异常过滤器 | Starlette / Django 中间件、异常处理器 |
| mysql2 连接池（上限 20） | SQLAlchemy QueuePool / Django 数据库连接配置 |
| SSE + X-Accel-Buffering: no | FastAPI StreamingResponse |
| 进程内 LRU + TTL 缓存 | functools.lru_cache（无 TTL）/ 第三方 cachetools.TTLCache |
| （规划中）BullMQ 任务队列 | Celery / RQ |

## 课程地图

- 0001 语言核心 → 0002 并发与异步 → 0003 Web 框架与工程化
- 2026-11-02 建工作区：三个子代理并行核实 Python 版本敏感事实（语言核心 16 项 / 并发 12 项 / Web 与部署 15 项），课件只用核实过的说法。
- 2026-11-02 三课完成（共 54 题：41 必考 + 12 进阶 + 11 场景）。**所有复现代码先在本机 3.12.10 实测再写进卡片**（含 GIL 计时、竞态、asyncio 阻塞对比、Semaphore 节奏、gather vs TaskGroup、Pydantic/SQLAlchemy 实测、WSGI 最小应用、N+1 计数）。写作中发现三处 UTF-8 写入乱码，已用脚本修复；后续每次写完都跑 U+FFFD 扫描。
- **核实出的高价值纠错点（面经普遍过时）**：① 小整数缓存范围 3.15 文档已改为 -5~1024（3.14 前是 -5~256），且只是实现细节；② 3.14.0 的两代增量 GC 在 3.14.5 被回退，当前三代；③ 自由线程版 3.14 起官方支持（PEP 779）但非默认，单线程慢 5–10%；④ 线程池默认数 3.13 起用 os.process_cpu_count()（min(32, n+4)）；⑤ forkserver 3.14 起 Linux 默认（spawn 仍是 Windows/macOS 默认）；⑥ gather 出错不取消其他任务（TaskGroup 才会）；⑦ 本机 3.12 实测：裸写 n+=1 400 万次不丢，但中间插一次函数调用就丢一大半——竞态演示要选对写法并强调"没丢是运气"；⑧ uvicorn.workers 已弃用改 uvicorn-worker 包；⑨ gunicorn 域名迁至 gunicorn.org；⑩ Django 6.1 弃用无参 select_related；原生连接池仅 PostgreSQL。
- 卡片实测数字（写死在卡片里，来自本机）：列表 100 万元素 getsizeof 8448728 vs 生成器 192；in list 1.0067s vs in set 0.000038s；GIL 计时 串行 3.12 / 两线程 2.90 / 两进程 1.85（4000 万次×2）；竞态 naive 4000000（碰巧）、n+=one() 1813320、sleep(0) 版 1155/4000；Semaphore 5 任务限 2 → 0.0/0.0/1.0/1.0/2.0；SQLAlchemy N+1 4→1（joinedload）→2（selectinload）；tracemalloc 定位 16.6 MiB 到行。
- **LR-0002 待办（用户输入后处理）**：用户的 Python 熟练度 / 目标岗位 / 面试时间未确认——已写进 MISSION 约束，下次对话自然带出即可，不要专门问。
