# ADR-071：服务端本地认证路由模块

## 状态

已接受（2026-08-20）。

## 决策

- 通过 `src/local-auth-routes.mjs` 集中 `/api/auth/session`、`settings`、`setup`、`login` 和 `logout` 的路径匹配与响应编排。
- 认证对象、请求体读取器和 JSON 响应器均由 `server.mjs` 注入；模块不创建认证实现、不保存密码/token。
- `startServer()` 继续负责监听地址、认证初始化、非回环安全门禁、生命周期和非认证 API 分发。

## 验收

- 路由专项测试验证登录、首次设置、保护开关、会话、退出、401 和未匹配路径。
- 原有真实 HTTP 认证集成测试继续保留并通过。
