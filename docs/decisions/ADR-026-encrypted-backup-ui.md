# ADR-026：加密备份页面密钥交互

## 状态

已接受（架构三期 26C）

## 决策

备份页面新增独立的加密 SQLite 导出/导入区域。用户输入主密码和确认密码后，renderer 只在当前 Vue 状态和当前请求期间暂存密码；请求结束或失败后立即清空密码字段，不写入 `localStorage`、SQLite、URL、日志或 API 响应。

加密导出调用本地认证后的 `POST /api/admin/backup/encrypted`；加密导入仅识别 `.sqlite.enc` 或版本化 MIME 类型，并通过 `X-OLT-Manager-Backup-Password` 调用 `POST /api/admin/restore-encrypted`。旧 `.sqlite` 导入、桌面组合备份和 Electron IPC 恢复路径保持原行为。

## 边界

页面不会保存或恢复密码，也不会提供忘记密码的旁路。密码生命周期由用户负责；后续若要支持系统密钥链或密码管理器，必须另行设计跨平台恢复和迁移策略。
