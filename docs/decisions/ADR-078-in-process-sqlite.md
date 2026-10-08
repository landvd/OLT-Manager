# ADR-078：主数据库改用进程内 node:sqlite

## 状态

已接受（2026-10-08）。

## 背景

`src/sqlite-repository.mjs` 原先每执行一次 SQL 都 `spawn` 一个 `sqlite3` CLI 子进程，通过 stdin 传入 SQL、解析 `-json` 输出。这带来三个问题：

- 每次查询都有进程启动开销，Windows 上更明显；合并 ONU 同步进度每 500ms 轮询也会持续创建进程。
- 输出按 `Buffer` 分块直接 `+=` 拼接，大结果集分块边界会切断中文 UTF-8 字节。现场数据副本实测：全库 34 张表中有 44 个中文字段被读成 `�`（例如“在线”“厚街镇”）。
- SQL 只能字符串拼接，主库运行依赖包内 `sqlite3.exe` 路径探测。

项目要求 Node ≥ 22.13，Electron 44.4.2 主进程内置 Node 24.21 / SQLite 3.53.4，均提供 `node:sqlite` 的 `DatabaseSync`。

## 决策

- `createSqliteRepository` 改为进程内执行：主库连接常驻并懒加载，备份校验、恢复候选等其他路径每次打开、执行后立即关闭。
- 对外接口不变（`runSqlImmediate` / `runSql` / `queueDatabaseTask` / `query` / `exec`），保留串行队列；新增 `closeDatabase()`，恢复备份替换主库文件前后必须调用。
- 为兼容既有多语句脚本：
  - 按 `sqlite3_complete` 规则拆分语句（跳过字符串、标识符、注释，`CREATE TRIGGER` 主体到 `END;` 为止）后逐条执行，因为 `prepare` 只编译第一条语句并静默丢弃其余部分；
  - 行首点命令只接受 `.bail` / `.timeout` 并忽略，其他点命令直接报错；
  - 任一语句失败即停止并回滚未提交事务，等价于旧脚本的 `.bail on` 加进程退出回滚；
  - 连接参数与 CLI 默认一致：不强制外键、允许双引号字符串字面量、`busy_timeout` 10 秒；
  - JSON 模式返回所有结果行；文本模式按列顺序输出 CLI list 格式（`PRAGMA integrity_check` 仍得到 `ok`）；
  - 整数按 BigInt 读取后转 Number，与旧 `JSON.parse` 行为一致，不因超出安全整数范围抛错。

## 后果

- 现场数据副本实测：小查询约 5.4ms → 0.05ms，分页 50 行约 5.5ms → 0.2ms，全表 14876 行与旧实现持平（约 65ms），中文乱码消失；34 张表除旧实现乱码外逐值一致。
- 查询在主线程同步执行，超大结果集会短暂阻塞事件循环；当前最大表全表读取约 60ms，可接受。
- 主库运行不再需要 `sqlite3` CLI。`bin/win32/sqlite3.exe` 与 `OLT_MANAGER_SQLITE_BIN` 绑定暂时保留：`scripts/export-seed-sample.mjs` 和 `electron/cc-switch-provider-discovery.cjs` 仍调用 CLI，移除打包文件需单独评估并更新发行文档。
