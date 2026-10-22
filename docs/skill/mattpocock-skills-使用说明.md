# mattpocock-skills-zh-CN 使用说明

> 来源：[vinvcn/mattpocock-skills-zh-CN](https://github.com/vinvcn/mattpocock-skills-zh-CN)（mattpocock/skills 的简体中文本地化版）
> 安装位置：`C:\Users\PC\.zcode\skills\`（用户级，所有项目可用），2026-10-16 安装，共 31 个技能
> 安装方式：克隆仓库后复制 `skills/` 下 engineering / productivity / misc 三个分类（`in-progress` 未装）

## 这套技能是什么

把"聊想法 → 定方案 → 拆任务 → 写代码 → 复盘"变成有固定产物的流水线：中间每一环的产出都是**落盘文件**（spec、ticket、GLOSSARY、ADR、复盘报告），不靠聊天记录传话。核心理念是深模块设计（deep modules）：小接口藏大实现，目标是可测试性和 AI 可导航性。

## 两种调用方式

| 方式 | 说明 | 识别特征 |
|---|---|---|
| 手动调用 | 对话里输入 `/<技能名>`，如 `/grill-me` | SKILL.md 标了 `disable-model-invocation: true`，模型不会自己启动 |
| 模型自动触发 | 描述匹配当前对话就自动挂载，无需记命令 | 没有 `disable-model-invocation` 标记的技能 |

新安装后需要**新开会话**技能才会被发现。

## 第 0 步：一次性配置（每个仓库一次）

```
/setup-matt-pocock-skills
```

配置三件事，后续所有 engineering 技能都依赖它：

1. **Issue tracker**——spec/ticket 的落盘位置。本项目是 Gitea，**选 local markdown 模式**（本地 markdown 文件），不要选 GitHub；
2. **Triage labels**——triage 状态机用的标签词汇；
3. **Domain docs**——`GLOSSARY.md` 与 `docs/adr/` 的位置约定。

配置完成后建议用 `/domain-modeling` 建一次 `GLOSSARY.md`（本项目现成词汇：因子、回测、确认门、授权调优、调仓期、StrategySpec、等权策略……），并把已定死的架构结论写成几条 ADR，防止以后的架构扫描反复重新建议（如"HIL 用框架 interrupt 不做两段式工具""因子全读库不在线计算"）。

## 主线工作流（手动命令链）

```
/grill-me（拷问设计）→ /to-spec（沉淀 spec）→ /to-tickets（拆票）→ /implement（实现）→ /retro（复盘）
```

| 步骤 | 命令 | 产物 | 说明 |
|---|---|---|---|
| ① 拷问 | `/grill-me` | 共同理解（design tree） | 逐轮追问直到所有决策点都有答案；`/grill-with-docs` 版本会顺手把结论写成 ADR 和词汇表 |
| ② 定稿 | `/to-spec` | 正式 spec（问题/方案/user stories/验收标准），发到 tracker | **不做访谈**，只综合已讨论内容 |
| ③ 拆票 | `/to-tickets` | 一组 tracer-bullet ticket，带阻塞关系 | 每票贯穿全层（schema→API→UI→tests）可独立验证，大小必须装进一个 fresh context window |
| ④ 实现 | `/implement` | 代码 + 提交 | 在约定 seams 上走 TDD，定期跑类型检查/单测，收尾自动 `/code-review` |
| ⑤ 复盘 | `/retro` | 对 agent 环境的改进建议 | 针对 navigation / automated checks / guardrails 三类找改进点 |

与"设计讨论 ≠ 开工令"规则的关系：①②③全是讨论和写文档，不动代码；只有 ④ 实现是你主动调用的，规则天然成立。

## 全部 31 个技能速查

### Engineering（20 个）

| 技能 | 调用方式 | 用途 |
|---|---|---|
| setup-matt-pocock-skills | 仅手动 | 每仓库一次的初始化配置（tracker/labels/docs 布局） |
| ask-matt | 仅手动 | 不知道该用哪个技能时问它，全套技能的路由器 |
| grill-me | 仅手动 | 持续追问式访谈，打磨计划或设计（入口，内部调 grilling） |
| grill-with-docs | 仅手动 | 同上，但过程中同步产出 ADR 和词汇表 |
| to-spec | 仅手动 | 把当前对话综合成 spec 发到 tracker |
| to-tickets | 仅手动 | 把 spec/plan/对话拆成带阻塞边的 tracer-bullet tickets |
| implement | 仅手动 | 基于 spec 或 tickets 实现一段工作（轻量，单人用这个） |
| implement-spec | 仅手动 | 实现整个 spec 的全部 tickets（**重型**：多 subagent 并行 + worktree，团队用，本项目暂不碰） |
| improve-codebase-architecture | 仅手动 | 扫描深化机会 → HTML 报告（before/after 图 + 推荐强度）→ 选中后 grilling 定案 |
| wayfinder | 仅手动 | 单会话装不下的大块工作 → decision tickets 共享地图，只规划不动手 |
| triage | 仅手动 | issues/外部 PR 走 triage 状态机，产出 agent-ready brief |
| retro | 仅手动 | 对一次 coding session 做复盘 |
| tdd | 自动 | 先写测试的开发循环（red-green-refactor） |
| code-review | 自动 | 从固定点按 Standards 和 Spec 两条轴并行审查变更 |
| codebase-design | 自动 | 深模块设计共享词汇（module/interface/seam/depth/leverage/locality） |
| diagnosing-bugs | 自动 | 棘手缺陷和性能回退的诊断循环 |
| domain-modeling | 自动 | 维护 GLOSSARY.md 和 ADR |
| prototype | 自动 | 搭一次性原型回答设计问题 |
| research | 自动 | 对照一手来源调研，发现存为仓库 Markdown |
| pr | 自动 | 撰写便于审阅的 PR 正文 |
| wizard | 自动 | 生成交互式 bash 向导，引导人工步骤（配 credentials/CI secrets 等） |

### Productivity（7 个）

| 技能 | 调用方式 | 用途 |
|---|---|---|
| handoff | 仅手动 | 当前会话压缩成交接文档，给下一个会话/代理续活 |
| teach | 仅手动 | 在本工作区教一个新概念 |
| wait-what | 仅手动 | 停一下：上一条消息没说清，要求重新表述 |
| to-questionnaire | 仅手动 | 把答不了的 decision 转成给他人填的问卷 |
| grilling | 自动 | 持续追问的压力测试（grill-me 的实现体） |
| writing-for-agents | 自动 | 为 agent 写文档（skills、AGENTS.md、CLAUDE.md） |

### Misc（4 个）

| 技能 | 调用方式 | 用途 | 本项目相关度 |
|---|---|---|---|
| setup-pre-commit | 自动 | 配 Husky + lint-staged pre-commit hooks | 可用 |
| git-guardrails-claude-code | 自动 | 危险 git 命令拦截 hooks | 面向 Claude Code，需改造 |
| migrate-to-shoehorn | 自动 | 测试 `as` 断言迁移到 shoehorn 库 | 低（课程配套） |
| scaffold-exercises | 自动 | 搭课程练习目录结构 | 低（课程配套） |

## 典型场景

### A. 方案讨论定型（最常用）

适用：聊完一个改造方案（如确认门弹窗改造、授权调优参数收紧），要留痕、可执行。

```
（正常讨论收敛后）→ /to-spec        # 方案从聊天记录变成 spec 文件
```

讨论还没收敛就用 `/grill-me` 先把决策问完再 `/to-spec`。

### B. 项目重构

```
/setup-matt-pocock-skills → /domain-modeling 建 GLOSSARY/ADR（一次）
  → /improve-codebase-architecture 扫热点子系统（如 factor-agent-server/src/agent）
  → 挑 1 个 candidate → grilling 定案
  → /to-tickets 拆票
  → 逐票 /implement（每票一个新会话）
  → 下一块
```

要点：一轮只解决一个 candidate；扫描时**主动圈范围**（YAGNI 原则，只看最近在变的区域），排除 `factor-agent-ui/`、`rechk/`、`v6b/`、`tmp/`。

### C. 跨会话接续

会话要结束但活没干完 → `/handoff` 生成交接文档（存系统临时目录，含"suggested skills"指引），下个会话扔给它就能续。

### D. 大块模糊工作

一个想法太大、路径看不清（如 20+ 功能点的对标补全计划）→ `/wayfinder` 规划成 decision tickets 地图，逐个解决，路径清晰前不动手。

### E. 日常 debug

直接说"帮我查一下 xx 为什么坏了"，`diagnosing-bugs` 自动挂载给诊断方法论；与"先看 logs/ 定位根因"的项目规则叠加使用。

## 本项目使用注意

1. **Issue tracker 选 local markdown**——Gitea 环境别选 GitHub 模式；
2. **测试自己写**——`tdd` 和 `/implement` 会自动写测试，不要就在指令里说"测试留给我"，或只用链路到 `/to-tickets` 为止；
3. **`/implement-spec` 先不碰**——多 subagent/worktree 后台合并的重型机械，为团队设计，单人单仓用 `/implement`；
4. **实现前清工作区**——规划类技能读 git log 和全仓探索，无所谓脏；实现类要干净基线（当前有 PRODUCT.md 改动和 rechk/、v6b/ 未跟踪目录）；
5. **编码**——SKILL.md 是 UTF-8，GBK 控制台直接 `head` 会乱码，用编辑器或 Read 工具看正常；
6. **新技能生效**——安装/改动技能目录后需要新开会话。

## 维护

- 卸载某个技能：删 `C:\Users\PC\.zcode\skills\<技能名>\` 整个文件夹；
- 升级：重新克隆上游仓库，对照覆盖 `skills/` 下同名文件夹（内容刷新式同步，不继承 git 历史）；
- 改行为：直接编辑对应 SKILL.md，它们就是可编辑的提示词文件。
