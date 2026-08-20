# ADR-015: 多源合并同步 manifest 与恢复 seam

## Status

Accepted

## Context

network 与 NMSE 两个只读来源目前可以被直接传入合并函数，但调用者没有统一表达采集时间窗、源 revision、目标 OLT 集合和行数的方式。这样会把不同时间窗或不同目标集合的数据误合并，也无法为后续跨进程恢复提供稳定的运行标识。

## Decision

- 新增 `src/merged-onu-manifest.mjs` 作为纯模块 seam，提供 source manifest、merged input manifest 的创建、校验、序列化/反序列化和兼容性判定。
- 时间使用固定 UTC ISO 8601 格式 `YYYY-MM-DDTHH:mm:ss.sssZ`；采集结束时间不能早于开始时间，时间窗结束时间不能早于开始时间。
- `sourceRevision`、`targetOltIds`、`runId`、`idempotencyKey` 和 checkpoint cursor 只接受字母、数字、点、下划线、冒号和连字符组成的受限安全字符，不保存凭据、Cookie、token 或远端原始响应。
- network 与 nmse 只有在两个源均为 `complete`、时间窗完全一致、目标 OLT 集合完全一致时才可合并。不兼容时返回显式 `reason`，当前至少包括 `window_mismatch`、`target_olt_mismatch`、`source_not_complete`。
- `runId`、`idempotencyKey` 和 `checkpoint` 仅作为可序列化恢复状态的预留字段；当前没有数据库或跨进程持久化实现。
- `createManifestRegistry()` 只提供明确标注的进程内幂等 key 去重，用于当前进程防重复；不能把它当作跨进程锁或持久化幂等存储。
- `syncMergedOnuDataset` 只新增可选 `manifest` 参数。传入时先校验 manifest，并核对 network/nmse 行数；不传入时保留旧调用行为。数据库表结构和服务端路由留待后续阶段接入。

## Consequences

- 纯函数测试可以先覆盖时间窗、目标集合、revision、序列化和幂等语义，不需要修改 SQLite 或服务端。
- 现阶段不会自动恢复中断任务，也不会跨进程识别重复 key；后续必须新增持久化 adapter，并定义 checkpoint 的提交顺序、租约和过期策略后再接入 server/db。
- 旧同步调用继续可用，但只有显式传入 merged input manifest 时才会获得输入一致性保护。
