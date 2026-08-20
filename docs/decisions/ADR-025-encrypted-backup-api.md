# ADR-025：后端加密 SQLite 备份 API seam

## 状态

已接受，架构三期 26B。

## 决策

在现有本地认证 API 边界内增加两个后端接口：

- `POST /api/admin/backup/encrypted`：仅接受 `application/json`，请求体严格为只含 `password` 的对象。服务端调用 `exportDatabaseBackup()` 后在内存中调用加密容器创建函数，返回二进制加密容器；密码不进入响应、日志或持久化数据。
- `POST /api/admin/restore-encrypted`：仅接受受支持的二进制 Content-Type，主密码只从受控请求头 `X-OLT-Manager-Backup-Password` 读取。处理顺序固定为解密、`validateDatabaseBackup`、`restoreDatabaseBackup`。

请求体分别限制为 16 KiB 和 96 MiB；未知 Content-Type、缺失密码、错误密码、格式错误和篡改统一返回稳定的脱敏错误。校验或解密失败发生在数据库替换前；数据库恢复继续使用现有临时文件和回滚语义，因此失败不会替换现有库。

旧的明文 `/api/admin/backup` 与 `/api/admin/restore` 保持兼容。本 seam 只处理本地 SQLite 文件，不增加任何 OLT 命令或设备写入能力。

## 验证与回滚

专项测试覆盖成功往返、错误密码、篡改、缺失密码、未知 Content-Type，以及失败后旧快照保持不变。回滚时删除本 ADR、专项测试和 `src/server.mjs` 中对应接口代码即可，不涉及数据库迁移。
