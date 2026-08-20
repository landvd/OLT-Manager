# ADR-065：Web 备份请求适配器

- 状态：已接受
- 日期：2026-08-20

## 决策

Web 普通 SQLite 导出、加密导出、加密还原和普通 SQLite 还原请求统一通过
`src/backup-api.mjs` 发出。适配器集中固定端点、Content-Type、密码头和错误合同，
不记录密码、不处理桌面 IPC，也不决定用户确认。

`main.js` 继续负责组合备份 IPC、桌面数据库恢复 IPC、文件识别、确认提示、密码校验、
密码清理和页面刷新；因此 Web 与 Electron 的生命周期差异仍由入口显式控制。

## 取舍

本期只移动 HTTP 请求合同，不合并 Web 和 Electron 的恢复流程，避免把桌面端 Feishu
组合备份能力错误地暴露到 Web 适配器。
