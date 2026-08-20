# ADR-030：HTTP 协议辅助层边界

## 状态

已接受，架构六期第 36 项。

## 决策

将 `src/server.mjs` 中与业务无关的 HTTP 协议辅助函数移动到 `src/http-protocol.mjs`，并由服务入口导入使用：JSON 响应、JSON/二进制请求体读取、Content-Type 规范化、加密备份请求校验和脱敏错误构造。模块只包含 Node HTTP 请求/响应对象上的纯协议处理，不访问数据库、远端会话、设备或认证状态。

加密备份协议继续使用原有约束：密码导出请求仅接受 `application/json` 且限制为 16 KiB；容器恢复仅接受 `application/octet-stream` 或 `application/vnd.olt-manager.encrypted-backup` 且限制为 96 MiB；密码头名称、错误码、状态码和错误文案保持兼容。辅助层不记录或回显密码、token、路径和原始错误。

## 边界与回滚

本次变更不调整 `handleApi` 路由分支、数据库调用、远端会话、认证决策或业务响应字段。回滚时删除该模块、专项测试和本 ADR，并恢复 `server.mjs` 的本地辅助函数即可；不涉及数据库迁移或设备操作。

## 验证

专项测试覆盖 JSON/二进制请求体、响应 JSON、Content-Type 白名单、16 KiB/96 MiB 上限、密码头名称及错误脱敏边界。
