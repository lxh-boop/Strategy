# evals/src — 测评套件源码

```text
src/
├── harness.ts      # 评测骨架：装配被评智能体（真 GLM + LangGraph 图 + mock 引擎桩）并驱动任务
├── runner.ts       # 批量跑任务、汇总指标、落指标卡报告
├── judges.ts       # LLM judge：对开放式输出判分（编造率、澄清恰当率等）
├── metrics.ts      # 指标计算：任务完成率 pass^k、参数口径正确率、编造率等
├── match.ts        # 数值/文本断言匹配器（口径比较、容差）
├── report.ts       # 指标卡渲染（md + json 双格式）
├── types.ts        # 评测对象与结果的类型定义
├── load-env.ts     # 评测环境变量装载
├── eval.spec.ts    # 骨架自身测试
└── match.spec.ts   # 匹配器测试
```
