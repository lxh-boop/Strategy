# Mission: Python 后端（面试向）

## Why
用户在准备后端面试（与 `../learn-deploy/` 同一条求职线），要求按现有面试卡片结构做一份 Python 后端题库。用户主力栈是 TypeScript/NestJS（factor-agent 项目），Python 是第二语言。目标：把 Python 后端的八股题和场景排障题答扎实，并能用"Node 项目里的真实做法 → Python 对应方案"的迁移讲法，诚实地接住项目类追问。

## Success looks like
- 三课约 50 道高频题（语言核心 / 并发与异步 / Web 框架与工程化），每道能 30 秒口述并接住 1–2 层追问
- 版本敏感的考点答的是当前事实（GIL 与自由线程、GC 的新变化、multiprocessing 默认启动方式等），不背过时答案
- 每个"经典坑"都在本机亲手复现过（本机 Python 3.12，卡片附 1 分钟复现代码）
- 项目类追问能用"我在 NestJS 项目里做过 X，换到 Python 对应 Y"作答

## Constraints
- Windows 开发机，本机 Python 3.12.10；复现代码以 3.12 实测为准，版本差异单独标注
- 中文；答案贴合国内 Python 后端面试的常见问法
- **待用户确认**：Python 实际熟练度、目标岗位方向（Web 后端 / 量化 / AI 应用）、面试时间——会影响题目深浅和复习节奏

## Out of scope
- pandas、numpy 等数据分析与机器学习库（除非目标岗位需要）
- 算法与数据结构刷题
- Redis、部署、Nginx——分别在 `../learn-redis/` 与 `../learn-deploy/`，本工作区只交叉引用
