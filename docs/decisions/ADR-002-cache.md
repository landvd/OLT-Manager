# ADR-002: Cache Only After Read Semantics Are Stable

## Status

Accepted

## Context

SNMP walk 和设备 show 查询可能较慢。缓存可以改善体验，但 OLT 排障数据存在时效性要求，过早缓存可能让维护人员看到过期状态。

## Decision

当前不引入跨请求缓存层。允许前端保留当前页面状态，允许 SQLite 保存台账和历史日志，但设备实时状态以每次只读查询为准。

只有在满足以下条件后才引入缓存：

- API 合约稳定。
- 已明确哪些字段可缓存、缓存多久。
- 页面清楚标注数据更新时间。
- 有手动刷新能力。

## Consequences

优点：

- 避免误导维护人员。
- 简化数据一致性。
- 便于验证 OID 解析结果。

代价：

- 大表 walk 会较慢。
- 多次刷新会重复访问设备。

## Follow-up

- 为 `/api/status` 评估短 TTL 缓存。
- 为 ONU 列表评估带时间戳的本地快照。
- 在 `EXPERIMENTS.md` 记录慢查询样本。
