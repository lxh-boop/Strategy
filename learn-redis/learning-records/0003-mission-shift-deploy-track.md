# Mission 扩展：部署三件套另立平行工作区

用户在听完"部署不作为前置课"的建议后，仍明确要求学习网关配置、负载均衡、容器编排——这是 mission 边界的正式扩展（用户推翻了教师建议，教师尊重）。按"一工作区一 mission"原则立为平行工作区 `learn-deploy/`，不在 Redis workspace 内展开。

Evidence: 2026-10-31 用户原话"网关配置、负载均衡、容器编排，我都学一学"。
Implications: Redis 轨的 0003（多实例坏点地图）保留——它仍以 Redis 视角讲"什么会坏"；动手部署内容全部归 deploy 轨。两轨共享 Docker 前置（Redis 0002 一并安装）与术语表（`reference/glossary.html`）。
