# 先验知识基线：进程内缓存与并发治理是用户的强项区

用户在自己代码里实现了 LRU + TTL + inflight 去重缓存（`mysql-factor-data.service.ts`）与 p-queue 资源闸，并在 2026-10-31 对话中准确讨论了"单实例直连 MySQL vs 引 Redis"的取舍——缓存一致性、连接池上限、单实例/多实例边界都是其已有概念，无需教学。

Evidence: factor-agent-server 代码实现；对话中自行得出"单实例下引 Redis 无收益，Redis 价值在跨进程共享"的结论方向。
Implications: 教 Redis 以"进程内缓存做不到什么"为切入（跨进程共享、独立生命周期、命令原子性），跳过缓存基础概念；TypeScript 示例可直接用生产级形态。
