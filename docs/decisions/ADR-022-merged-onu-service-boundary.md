# ADR-022：合并 ONU 领域服务边界

## 状态

已接受（2026-08-19）

## 决策

将合并 ONU 的目标选择、NMSE 用户行白名单投影，以及按 OLT 读取本地用户并转换为合并行的编排放入 `src/merged-onu-service.mjs`。本地用户读取通过依赖注入提供；服务不直接访问 SQLite，不登录或读取 OSS/NMSE，不接触凭据、Cookie、token、CUID 或原始远端响应。

`src/server.mjs` 继续负责 HTTP 路由、OSS/NMSE 登录与只读读取、SQLite 写入和合并同步主流程。

## 原因

- 缩小 `server.mjs` 中可独立验证的合并 ONU 领域边界。
- 通过白名单投影保持只读数据出口，不把上游对象泄露到合并源行。
- 通过注入读取器测试按 OLT 编排，不改变现有运行时依赖关系。
