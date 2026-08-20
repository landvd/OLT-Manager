# ADR-013: NMSE 凭据迁移与定时任务解锁

## Status

Accepted

## Context

旧版 `resource_management_config.password` 会把 NMSE-PON 登录密码以明文写入 SQLite，并可能进入数据库备份。定时任务还会在没有解密材料时尝试自动登录，无法区分“未配置”“需要迁移”和“无法解锁”。

## Decision

- 新增单行表 `resource_management_credential`，只保存 `secret-provider` 版本化 envelope、后端和不透明引用。
- 旧数据库首次读取或保存时，如果发现旧明文，必须使用 Electron `safeStorage` 或显式迁移主密码封装后，再在同一事务中清空旧 `password` 列。
- 清空旧列前创建经过完整性校验的数据库备份，保留回滚路径；迁移重复执行时只返回已迁移状态，不重新覆盖密文。
- API 仅返回 `credentialConfigured`、`backend`、`needsMigration` 等元数据。密码和迁移主密码只接受 POST body，服务端只在进程内短暂保存纯 Node/Web 解锁所需的主密码，前端提交后立即清空输入框。
- Electron 桌面运行时优先使用系统加密存储，从而支持重启后的定时任务。纯 Node/Web 运行时没有显式解锁材料时，定时任务失败关闭，不读取空密码、不猜测密码、不绕过认证，也不自动重试重复任务。

## Consequences

- 旧版数据库需要用户完成一次迁移；错误主密码不会破坏原数据。
- 数据库和备份中不再保存 NMSE 登录密码明文，但迁移前备份仍可能包含旧明文，因此迁移备份必须按敏感数据保护。
- 纯 Node/Web 的无人值守任务需要在进程内显式解锁；未来可增加受控的外部密钥注入，但不得把主密码写入任务表、日志或 API 响应。
- 本 ADR 不改变 NMSE、SNMP、Telnet、OSS 的只读接口范围，也不引入设备写操作。
