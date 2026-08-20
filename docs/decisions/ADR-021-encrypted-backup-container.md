# ADR-021：加密 SQLite 备份容器格式

## 状态

已接受（架构三期 26A）；本 ADR 只定义纯函数容器，不接入数据库、HTTP 或桌面运行时。

## 决策

新增 `src/database-backup-container.mjs`，提供创建、读取元数据和解密三个纯函数。调用方负责取得 SQLite 快照、选择保存位置、写盘和人工确认；容器模块不访问文件系统、不访问数据库、不打印内容，也不保存密码。

容器是 UTF-8 JSON envelope，格式标识为 `olt-manager/encrypted-backup-container`，当前版本为 `1`。字段包括用途、算法/KDF 参数、salt、nonce、认证标签、密文，以及明文 payload 的字节大小和 SHA-256 摘要。返回的容器是 `Buffer`；解密结果也是 `Buffer`，输入同时接受 `Buffer` 和 `Uint8Array`。

加密使用 AES-256-GCM，12 字节 nonce、16 字节认证标签；密钥使用 scrypt 派生，固定 `N=16384,r=8,p=1`、32 字节密钥和 16 字节 salt，与现有 `src/oss-credential-crypto.mjs` 的约束一致。用途必须是受限 ASCII 标识，并参与版本化 AAD：`olt-manager/encrypted-backup-container/v1/purpose/<purpose>`。因此用途、版本和算法边界被认证，不能在不知密码的情况下改换用途。

创建和解密均限制 payload 为 64 MiB、容器为 96 MiB。格式、参数、摘要、大小、Base64 长度或认证校验任一失败都拒绝继续；错误密码、篡改和格式错误均 fail-closed。元数据读取只返回有限的非敏感摘要，不返回 salt、nonce、标签、密文或密码。

## 安全边界

- 主密码只作为函数调用期间的输入，永不进入 envelope、元数据结果或错误消息。
- 模块不记录原始 SQLite、密码、凭据、Cookie、token 或远端响应。
- SHA-256 是明文 payload 的一致性元数据；机密性和篡改防护由 GCM 认证提供，摘要不替代认证标签。
- 该格式保护“导出层提供的 SQLite 字节快照”，不负责验证 SQLite schema、`integrity_check`、备份文件名或保留策略。

## 后续集成要求与风险

导出层接入前必须先完成 SQLite 一致性快照和 `integrity_check`，再调用创建函数并以安全写盘方式保存；导入层必须先解密并验证摘要/大小，再在人工确认和事务性替换边界内校验 SQLite。还需要定义容器文件命名、临时文件权限、原子 rename、失败清理、密码输入生命周期和密钥轮换策略。当前专项测试未覆盖真实 SQLite、磁盘故障、跨进程并发、内存擦除、密码尝试限速或真实备份目录验收。
