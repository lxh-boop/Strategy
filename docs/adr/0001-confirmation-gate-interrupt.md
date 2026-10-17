# 确认门用 LangGraph interrupt + checkpointer 实现

Status: accepted（2026-10-12 实施，d464a16）

回测参数可能由智能体批量生成，执行前必须经用户确认（HIL）。决定：确认与执行拆为两个节点——confirm 节点零副作用，以 interrupt 收集决策（approve=逐组放行 / delegate=本轮全放行，边界一次问答 / feedback=拒绝回执），再以 Command(goto) 路由。interrupt 的语义是"直接结束+凭存档恢复"而非挂起等待，因此恢复时 confirm 节点从头重跑、按 interrupt 序号回放答案，节点必须幂等。

## Considered Options

- **两段式工具**（工具自身返回 pending、确认走独立接口）：否决——"HIL 是框架的事"，确认语义应由框架的持久化机制承载，不在工具层自建；该路线还会让同批 K 组回测的逐组确认退化为 O(K²) 的重复执行。
