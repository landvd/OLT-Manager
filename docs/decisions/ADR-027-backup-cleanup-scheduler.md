# ADR-027：备份清理调度器基础

## 状态

已接受（架构四期 31）；本 ADR 只定义宿主无关的调度器基础，不代表已接入自动清理。

## 决策

- 新增 `src/backup-cleanup-scheduler.mjs`，通过依赖注入接收 `planCleanup`、`executeCleanup`、`clock`、`setTimer` 和 `clearTimer`；模块不读取文件、不访问数据库、不依赖 Electron 或服务器。
- `trigger()` 默认只调用规划函数并保持 dry-run。只有一次性显式调用 `trigger({ confirmed: true })`，才会把同一次规划结果交给执行函数，并显式传递 `confirmed: true`。
- 同一时刻只允许一个规划/执行流程。运行中的重复触发返回稳定的 `RUN_IN_PROGRESS` 摘要，不启动第二个流程。
- `start()`、`stop()` 和 `trigger()` 均为显式调用方接口。`start()` 只创建下一次 dry-run 定时触发；即使调用方传入 `confirmed: true` 也会拒绝，防止无人值守自动删除。只有一次性 `trigger({ confirmed: true })` 才能执行。`stop()` 会清理当前计时器。计时器清理可重复调用且不会重复清理同一句柄。
- `status()` 返回稳定的只读状态：运行状态、是否运行、是否启动、确认模式、上次运行时间、下一次运行时间、有限状态码和执行摘要。错误原文、路径、密码、token 和原始元数据不进入状态。
- `confirmed` 只在一次性显式执行进行中短暂为 `true`；执行结束后恢复为 `false`，不会让后续已排程的 dry-run 看起来仍处于确认删除模式。
- 失败状态只保留受限错误码；对外抛出统一的 `BACKUP_CLEANUP_SCHEDULER_RUN_FAILED`，避免把注入实现的错误文本传播到宿主边界。

## 未决边界

- 本阶段不在任何宿主中创建调度器，不修改 `server`、`db`、`main`、`electron` 或 `package.json`。
- 本阶段不启用默认确认删除，不实现跨进程锁、持久化状态、恢复策略、审计存储或真实备份目录验收。
- 调度器只负责调用顺序和生命周期；备份候选的安全校验、计划签发和删除边界继续由备份策略/运行时模块负责。

## 验证

专项测试覆盖默认 dry-run、显式确认边界、并发防重入、`start`/`stop`、计时器清理幂等和失败状态脱敏。
