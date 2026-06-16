# Changelog

本文件记录对用户可见或对维护流程有影响的变化。格式参考 Keep a Changelog，但保持轻量。

## Unreleased

### Added

- 增加 Harness Engineering 文档骨架。
- 增加需求、架构、API、数据库、时序和 ADR 文档入口。
- 增加实验记录和 Codex 工作流模板。
- 增加 Huawei 自营上网配置方案预览模板。
- 记录未注册 ONU 配置方案生成的文档设计，包括 ZTE 自营上网、内部网络和 MDU+OTT 模板规则。
- 增加 MDU+OTT 通过 ZTE service-port SNMP 表读取动态 VLAN 的只读验证记录。
- 增加 ZTE 未注册 ONU 配置方案生成接口、前端生成弹窗和配置方案核心测试。
- 增加 Huawei 自营上网配置方案接口支持和前端厂商模板过滤。
- 增加 Huawei 未注册 ONT SN 原始十六进制校验规则。
- 增加配置方案弹窗“打开终端”按钮：复制命令后打开本机 Terminal，仍由人工粘贴确认。
- 增加轻量 Terminal 自动登录器：从本地 SQLite 读取 Telnet 凭据，自动登录当前 OLT 并按厂商进入配置模式。
- 增加 `ADR-005`，明确 Terminal 登录器不是自动下发器。

### Changed

- 增加 `pnpm test` 脚本，用 Node 内置测试运行最小配置方案测试。

### Fixed

- 修正 Huawei 自营上网 `sn-auth` 取值：使用原始十六进制 SN，而不是 `ZTEG-030C0914` 这类可读格式。
- 修正内嵌浏览器中 Clipboard API 被拦截时“复制命令”失败的问题，增加隐藏文本域复制兜底。

### Security

- 明确项目仍处于 OLT 只读管理阶段，禁止设备写操作。

## 0.1.0

### Added

- Vue 3 + Element Plus 前端。
- Node.js HTTP API。
- SQLite 本地 OLT 与 PON 台账。
- SNMP v2c 只读采集。
- ZTE ONU 固定 show 查询能力。
