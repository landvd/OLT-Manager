# Scripts

本目录用于放可重复执行的维护脚本。当前暂不新增脚本逻辑，避免在没有测试边界时扩大行为面。

## 可接受脚本

- 数据脱敏脚本。
- fixture 生成脚本。
- SQLite schema 检查脚本。
- 本地只读健康检查脚本。
- 构建和语法检查聚合脚本。

## 不接受脚本

- `snmpset` 或任何设备写操作。
- 任意 Telnet/SSH 命令执行器。
- ONU 注册、删除、重启、恢复出厂。
- 自动保存或提交 OLT 配置。

## 命名建议

- `check-local.mjs`
- `sanitize-fixture.mjs`
- `verify-schema.mjs`
