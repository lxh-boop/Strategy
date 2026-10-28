# src/auth — 认证模块

```text
auth/
├── auth.controller.ts            # 注册/登录/me 路由
├── auth.module.ts                # 模块装配
├── auth.service.ts               # 抽象接口
├── dto.ts                        # 请求 DTO
└── implementations/
    └── auth.service.impl.ts      # 实现：JWT 签发、密码校验、末次登录
```
