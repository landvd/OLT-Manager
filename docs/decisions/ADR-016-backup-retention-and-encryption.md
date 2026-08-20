# ADR-016：备份加密元数据与保留策略基础

## 状态

已接受；加密 SQLite 容器、加密导出/导入和安全 dry-run 清理基础已接入，默认无人值守删除仍关闭。

## 背景

OLT Manager 的完整 SQLite 备份可能包含本地业务数据、加密凭据密文和设备台账。现有备份流程需要在接入自动清理前先明确保留数量、过期时间、人工保护和加密状态，避免把“文件存在”误判为“安全备份”，也避免清理逻辑直接删除错误对象。

## 决策

- `src/backup-policy.mjs` 只负责纯策略计算，不打开、创建、删除、重命名或加密任何文件。
- 默认策略为保留 30 天、最多 20 个备份、至少保留 3 个备份，并要求自动清理范围内的备份具有可识别的加密元数据。
- `normalizeBackupPolicy()` 严格校验保留天数、最大数量、最小数量和受保护备份 ID；最小数量不得大于最大数量。
- 完整 SQLite 备份如果 `encrypted !== true`，永远不能被标记为安全备份。即使调用方暂时允许未加密的非 SQLite 工件，完整 SQLite 的未加密元数据仍然无效。
- `validateBackupSecurityMetadata()` 只返回结构化安全状态，不执行解密。加密状态未知、算法未知、格式版本非法或完整 SQLite 未加密时，候选选择必须 fail-closed。
- `selectBackupCleanupCandidates()` 只返回候选摘要，优先按过期和超出数量判断；受保护备份不会进入候选；同一时间戳按不透明 ID 稳定排序。返回值只含规范化文件名，不返回原始路径、凭据、Cookie、token、远端响应或设备数据。
- `src/backup-runtime.mjs` 只接受调用方明确提供的绝对 `backupsRoot`，只枚举普通文件、支持的 SQLite 文件名和同目录 metadata sidecar；不接受相对路径，也不跟随符号链接作为清理目标。
- 运行时清理先规范化 metadata、校验加密状态、算法、格式版本、保护 ID、文件大小、SHA-256 和 SQLite integrity metadata。未知、未加密或完整性不匹配的完整 SQLite 只进入 blocked 摘要，不进入候选，整个路径 fail-closed。
- `planBackupCleanup()` 默认是 dry-run；`executeBackupCleanup()` 必须接收同一进程产生的计划对象和 `confirmed: true`，执行前会重新枚举并只删除仍满足策略的候选文件及其 sidecar。单个目标失败不会阻止其它候选继续处理。
- `db.mjs` 只提供固定内部 `data/backups` 的规划和显式执行包装，不把用户路径传入运行时，也不把现有未加密 SQLite 备份标记为安全。
- 默认自动执行、跨进程清理计划恢复、持久化清理锁和真实现场目录验收仍需后续发行门禁；加密容器和加密导出/导入已由独立模块与 API/UI 接入。

## 接口边界

- `normalizeBackupPolicy(input)`：返回冻结的规范化策略，非法策略抛出 `BackupPolicyError`。
- `normalizeBackupMetadata(input, options)`：规范化不透明 ID、文件名、大小、时间和安全元数据；不会保留原始路径字段。
- `validateBackupSecurityMetadata(input, options)`：返回 `valid`、`isSafeBackup`、状态和有限原因码；不访问文件系统。
- `selectBackupCleanupCandidates(backups, options)`：返回候选列表，不执行任何删除或写入；遇到无法安全判断的元数据时抛出 `BACKUP_SECURITY_FAIL_CLOSED`。

## 后续接入要求

1. `db.mjs` 接入前必须先创建并校验完整 SQLite 备份，且不能把迁移前明文凭据备份误标为安全备份。
2. 运行时只能把模块返回的候选 ID 映射到内部已枚举且再次校验过的本地文件；不得直接使用用户输入路径。
3. 自动清理应具备 dry-run、审计摘要、失败保留和可恢复回滚策略，并在真实用户数据目录上做单独验收。
4. 保留期和数量策略变化应记录版本或审计事件，不能静默改变已有人工保护标记。

## 当前明确未完成

当前没有启用默认自动删除；跨进程清理计划恢复、持久化锁和真实现场目录验收仍未完成。加密 SQLite 容器、加密导出/导入、密码生命周期清理和失败回滚已经完成，自动清理仍保持 dry-run/显式确认边界。
