# Python 后端（面试向）Resources

## Knowledge

- [Python 官方教程（中文版）](https://docs.python.org/zh-cn/3/tutorial/)
  语言核心的事实出处：作用域与闭包、默认参数警告、类与装饰器。Use for: 语言类八股的权威依据；中文版与英文版同步。
- [Python 官方标准库文档](https://docs.python.org/3/library/)
  asyncio / threading / multiprocessing / concurrent.futures / logging / gc / tracemalloc / copy / functools。Use for: 并发与工程化题目的逐条出处。
- [Python 术语表（GIL 条目）](https://docs.python.org/3/glossary.html#term-global-interpreter-lock)
  GIL 的官方定义：同一时刻一个线程执行字节码、I/O 时释放。Use for: "GIL 是什么"的标准答案出处。
- [PEP 索引](https://peps.python.org/)
  PEP 703（自由线程）、PEP 779（自由线程转正式支持）、PEP 3333（WSGI）。Use for: 版本演进类问题（"无 GIL 进展如何"）的一手出处。
- [Python 下载页 / What's New](https://www.python.org/downloads/) · [3.15 What's New](https://docs.python.org/3/whatsnew/3.15.html)
  当前稳定版与版本差异（lazy imports、自由线程状态、JIT）。Use for: 报版本号之前先查；版本敏感题的时效核对。
- [FastAPI 官方文档](https://fastapi.tiangolo.com/)
  async/并发说明（def 与 async def 路由的执行方式）、Depends 依赖注入、StreamingResponse。Use for: FastAPI 题的出处；中文版可用。
- [Pydantic v2 文档](https://docs.pydantic.dev/)
  BaseModel 校验、Field 约束、pydantic-settings。Use for: 数据校验题。
- [Django 官方文档](https://docs.djangoproject.com/)
  ORM（select_related/prefetch_related）、中间件洋葱模型、事务（atomic）、测试（assertNumQueries）。Use for: Django 题；注意看当前版本（无参 select_related 已弃用）。
- [SQLAlchemy 2.0 连接池文档](https://docs.sqlalchemy.org/en/20/core/pooling.html)
  QueuePool 默认参数、pool_pre_ping 语义。Use for: 连接池题（gone away 排查）的出处。
- [Gunicorn 文档](https://gunicorn.org/)（旧域名 docs.gunicorn.org 会跳转）
  worker 数公式 (2×核数)+1、worker 类型、timeout 默认 30 秒杀无心跳 worker。Use for: 部署题；注意 2026 年域名已迁移。
- [Uvicorn 部署文档](https://uvicorn.dev/deployment/)
  --workers、uvicorn.workers 弃用改用 uvicorn-worker 包。Use for: ASGI 部署题的新说法。
- [Celery 文档](https://docs.celeryq.dev/)
  acks_late 与幂等要求、Redis visibility_timeout 默认 1 小时、autoretry_for/retry_backoff。Use for: 任务队列丢/重复题的出处。
- [uv 文档](https://docs.astral.sh/uv/)
  Rust 写的极速包与项目管理器，uv.lock 锁文件。Use for: 工程化问题（"依赖怎么管"）的现代答案。
- [_Python Cookbook_（3rd ed, David Beazley & Brian Jones）]
  数据结构、并发、元编程的深度食谱，含大量 GIL/生成器的机制讲解。Use for: 深挖原理时的课外读物（有中文版《Python Cookbook（第3版）中文版》）。

## Wisdom (Communities)

- [Python 官方 Discourse 论坛](https://discuss.python.org/)
  核心开发者聚集地，版本行为变化（如 GC 回退）的一手讨论。Use for: 版本敏感问题求证。
- [Real Python](https://realpython.com/)
  高质量的英文教程站（asyncio、装饰器、并发专题）。Use for: 系统补某一块知识。

## Gaps

- 国内面试真题聚合（牛客等）未核实——等用户提供目标公司/方向再补。
- pandas/numpy 等数据栈不在本 mission 范围（见 MISSION.md Out of scope），量化岗若需要再立子目标。
