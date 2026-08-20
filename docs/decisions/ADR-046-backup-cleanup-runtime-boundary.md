# ADR-046：备份清理生产运行时边界

日期：2026-08-19

状态：已接受

## 决策

新增 `src/backup-cleanup-runtime.mjs`，将现有清理调度器接入服务端生命周期。服务启动后按日生成清理计划，服务关闭时停止调度；定时触发固定使用 dry-run。

## 删除门禁

- `GET /api/admin/backup/cleanup/status` 只返回稳定状态和摘要。
- `POST /api/admin/backup/cleanup/trigger` 不带 `confirmed: true` 时只生成计划。
- 只有显式 `confirmed: true` 才执行，底层会重新扫描备份目录并拒绝过期计划、路径越界、缺少加密元数据和完整性不一致的目标。
- 运行状态只保留内存中的稳定摘要，不持久化密码、token、原始 SQLite 内容或绝对路径。

## 验收

专项测试覆盖服务运行时、定时 dry-run、显式确认、路由状态查询和备份二次校验；全量测试与构建作为合并门禁。
