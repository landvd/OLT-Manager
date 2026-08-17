# 调查结论

- `oss_resource_config` 当前只保存认证地址、网管二期地址、用户名、组织和机房名称，不保存登录密码。
- `exportDatabaseBackup()` 使用完整 SQLite 备份；因此新增的单行密文表会自然进入备份，`restoreDatabaseBackup()` 需要补齐旧备份兼容迁移。
- 不能只依赖 macOS Keychain 或 Electron `safeStorage`，因为目标包含 Win7 迁移。
- 采用 Node 内置 `scrypt` 派生密钥 + AES-256-GCM 加密；SQLite 只保存版本、KDF 参数、salt、nonce、认证标签和密文。
- 迁移主密码不写入数据库、备份、admin_events、API 响应或前端持久化状态。
- 测试使用合成密码和合成主密码，不使用现场凭据；OLT 设备边界仍保持只读。
