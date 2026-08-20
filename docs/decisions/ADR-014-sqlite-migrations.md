# ADR-014：SQLite 统一版本化迁移框架

## 状态

已接受（架构二期第 13 项）。

## 背景

项目此前在 `initDb()` 和 SQLite 备份还原流程中分别维护建表、补列和数据修复逻辑。两条路径容易产生漂移，失败时也无法明确知道哪些迁移已经完成。

## 决策

1. 使用 `schema_migrations` 记录整数版本、迁移名称、固定 checksum、应用时间和执行耗时。
2. 所有增量迁移通过 `src/db-migrations.mjs` 的单一 runner 执行，按版本顺序运行，并校验已应用版本的名称和 checksum。
3. 每个未应用迁移在同一个 SQLite `BEGIN IMMEDIATE` / `COMMIT` 边界内执行并写入记录；执行失败时不写入版本记录，SQLite 进程关闭前保持的事务由 SQLite 回滚。
4. 新库和旧库仍先使用现有基线 `CREATE TABLE IF NOT EXISTS` 保留表结构与数据兼容，再由 runner 记录基线并执行增量补列、数据修复。
5. 备份还原后先安装相同基线，再调用相同 runner；还原场景通过 runner 的受控选项刷新资源用户数据集 revision，保留原有缓存失效行为。
6. 不做破坏性重建、不移动现场数据、不改变只读 OLT 边界。迁移 SQL 只能处理本地 SQLite 结构和已存在的本地数据。

## 当前版本

- `1 baseline-schema`：记录现有项目基线，不重建现有表。
- `2 legacy-schema-and-data-reconciliation`：集中处理历史补列、离线原因标签修复、PON 坐标规范化，以及还原后的资源用户 revision 刷新。

## 未覆盖边界

- 本地 sqlite CLI 与真实发行版中 Electron safeStorage、Win7 legacy SQLite 的组合尚未在本机完成矩阵验证。
- 真实现场数据库应在发布前以副本执行升级演练，并核对 `schema_migrations`、`PRAGMA integrity_check` 和关键台账行数。
- 迁移备份的加密、保留期和自动清理属于后续备份治理任务，不在本 ADR 内扩大范围。
