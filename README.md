# AgentSage（因子智投）

多因子选股智能体：对话式创建/调优选股策略，自研回测引擎 + 智能体编排 + 前端展示。

```text
D:\cht\work
├── factor-agent-react/   # 前端：React + Vite 单页应用（对话/策略/因子页，回测与归因卡片渲染）
├── factor-agent-server/  # 后端：NestJS 服务（LangGraph 智能体、自研回测引擎、MySQL 因子数据服务、REST API）
├── factor-agent-ui/      # 早期纯静态原型 UI（html/css/js），已被 factor-agent-react 取代，留作参照
├── docs/                 # 项目文档：ADR 决策记录、功能方案、智能体协作约定
├── evals/                # 智能体测评体系：评测指标记录、scorecard 报告、runner/report 脚本
├── AGENTS.md             # AI agent 工作区约定：issue tracker、triage 标签、领域文档布局
├── DESIGN.md             # 设计系统：AlphaSage 视觉/交互规范
├── GLOSSARY.md           # 领域术语表：因子/策略/回测核心概念定义
├── PRODUCT.md            # 产品说明：定位与功能边界
├── Fdata.zip             # 因子数据快照压缩包（入库存档）
├── tmp/                  # 本地临时文件（gitignore，不入库）
└── tmp_dict/             # 本地临时字典数据（gitignore，不入库）
```

> 隐藏目录 `.git` `.agents` `.codex` `.impeccable` `.tmp_fdata` 为版本库与工具链目录，无需关心。
