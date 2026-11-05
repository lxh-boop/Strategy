# 多实例部署（面试向）Resources

## Knowledge

- [Docker 官方文档](https://docs.docker.com/)
  Get Started / Storage / Network / Dockerfile reference / Compose reference。Use for: 面试答案的事实底座——本工作区所有八股答案都按官方文档核对过出处。
- [Dockerfile 官方参考](https://docs.docker.com/reference/dockerfile/)
  CMD/ENTRYPOINT 覆盖语义、shell/exec 形式与信号、ADD vs COPY、HEALTHCHECK 默认参数。Use for: 容器八股的逐字出处。
- [_Docker —— 从入门到实践_（中文开源书，持续维护）](https://docker-practice.github.io/zh-cn/latest/)
  前六章基础概念 + Dockerfile/数据卷/网络进阶。Use for: 中文系统读物；面试答案的背景阅读。
- [nginx 官方文档](https://nginx.org/en/docs/)
  location 匹配 / proxy_* 超时族 / upstream 模块（ip_hash、hash consistent、max_fails）/ limit_req 漏桶。Use for: 负载均衡八股的权威出处。
- [nginx HTTP 负载均衡官方指南](https://nginx.org/en/docs/http/load_balancing.html)
  负载均衡方法与会话保持的官方教程。Use for: 策略类问题的展开依据。
- [Docker Compose 官方参考](https://docs.docker.com/reference/compose-file/services/)
  depends_on condition / healthcheck / init / stop_grace_period。Use for: 编排题的逐字段出处。
- [Kubernetes 概念文档](https://kubernetes.io/docs/concepts/)
  Pod 生命周期 / liveness-readiness-startup 探针 / Deployment 滚动更新（maxSurge/maxUnavailable）。Use for: 高可用与 K8s 概念题（面试深度到概念层即可）。
- [Martin Fowler 的部署模式文章](https://martinfowler.com/bliki/BlueGreenDeployment.html)
  BlueGreenDeployment / CanaryRelease / ParallelChange（expand-and-contract）。Use for: 发布策略名词的标准定义。

## Wisdom (Communities)

- [r/docker](https://www.reddit.com/r/docker/)
  高流量 Docker 社区。Use for: Windows/Docker Desktop 踩坑、真实生产案例。

## Gaps

- 面试真题库（牛客/面经聚合）未核实可靠来源——先用官方文档打底，真题练习等用户提供公司/方向再补。
- Redis 八股（穿透/击穿/雪崩/分布式锁/哨兵集群）是独立大头，归 Redis 学习轨，本工作区只埋了钩子。
