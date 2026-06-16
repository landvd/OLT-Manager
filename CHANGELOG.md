# Changelog

本文件记录对用户可见或对维护流程有影响的变化。格式参考 Keep a Changelog，但保持轻量。

## Unreleased

### Added

- 增加 Harness Engineering 文档骨架。
- 增加需求、架构、API、数据库、时序和 ADR 文档入口。
- 增加实验记录和 Codex 工作流模板。
- 记录未注册 ONU 配置方案生成的文档设计，包括 ZTE 自营上网、内部网络和 MDU+OTT 模板规则。
- 增加 MDU+OTT 通过 ZTE service-port SNMP 表读取动态 VLAN 的只读验证记录。
- 增加 ZTE 未注册 ONU 配置方案生成接口、前端生成弹窗和配置方案核心测试。

### Changed

- 增加 `pnpm test` 脚本，用 Node 内置测试运行最小配置方案测试。

### Fixed

- 暂无。

### Security

- 明确项目仍处于 OLT 只读管理阶段，禁止设备写操作。

## 0.1.0

### Added

- Vue 3 + Element Plus 前端。
- Node.js HTTP API。
- SQLite 本地 OLT 与 PON 台账。
- SNMP v2c 只读采集。
- ZTE ONU 固定 show 查询能力。
