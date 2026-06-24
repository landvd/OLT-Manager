# Changelog

本文件记录对用户可见或对维护流程有影响的变化。格式参考 Keep a Changelog，但保持轻量。

## 1.0.5

### Changed

- 项目版本号和首页展示版本号同步升级到 `1.0.5`，用于重新发布 Apple Silicon macOS 安装包。
- 补充 macOS 未签名、未公证安装包被 Gatekeeper 提示“已损坏”时的完整性校验、quarantine 解除方法和正式签名公证要求。

## 1.0.4

### Added

- OLT 设备管理增加厂商/型号联动选择，新增 `device_profile` 适配键；中兴 C600 可录入为未支持型号，但配置方案生成会被阻止，避免误用 C300 模板。

### Changed

- macOS 发行包改为 Apple Silicon DMG，停止发布 Intel Mac 兼容包；同步 `package.json` 和首页展示版本号到 `1.0.4`。

## 1.0.3

### Added

- 增加 `ZTE 自定义 VLAN` 配置方案预览模板：复用 ZTE 内部网络命令结构，由用户输入业务 VLAN，适用于非 `100` VLAN 的其它业务。
- 增加 `Huawei 内部网络` 配置方案预览模板：固定 VLAN `100`，为 `eth1` 到 `eth4` 生成 `native-vlan ... priority 0`，并生成 `service-port vlan 100` 预览命令。
- 增加 `Huawei 自定义 VLAN` 配置方案预览模板：复用 Huawei 内部网络命令结构，由用户输入业务 VLAN，默认全选 `eth1` 到 `eth4`。
- Huawei 自营上网和内部网络配置方案增加 `eth1` 到 `eth4` 物理端口选择；自营上网默认 `eth1`，内部网络默认全选。

### Changed

- Huawei 未注册 ONT 配置方案按同 PON 已注册 ONT 最大 ID 自动生成建议 ONT ID；当无法读取最后 ONT ID 时，仅生成注册命令并提示从 `ont add` 回显获取 ONTID。
- Huawei 已注册 ONT ID 读取改为合并 `ontDescription`、`runStatus`、`rxPower`、`distance` 和 `lastOnlineTime` 多个只读 SNMP 表，提高最后 ONT ID 读取成功率。

## 1.0.2

### Changed

- 首页显示版本号更新为 `v1.0.2`。
- ZTE 未注册 ONU 配置方案不再生成 `configure terminal`，避免和内置终端自动 `con t` 重复；命令末尾增加两条只读 `show` 核查命令。
- 内置 Telnet 终端增加“粘贴剪贴板”按钮，用户手动粘贴当前配置方案时会补齐只读核查命令。

## 1.0.1

### Changed

- ONU 数据管理列表取消 500 条显示截断，统计栏显示当前显示数量和总数，并优先展示当前 OLT 的台账。
- Windows 7 x64 正式发布资产改为免安装 ZIP，从 GitHub Release 中取消 Win7 EXE/NSIS 安装包。
- 明确 `bin/win32/sqlite3.exe` 必须提交到仓库并随 Win7 ZIP 打包，避免发布包缺少 SQLite CLI 后无法启动本地服务。
- 首页快捷入口增加“打开终端”，桌面版会读取当前 OLT 的 Telnet 凭据并打开内置终端自动进入配置模式，Web 模式显示不支持提示。

### Fixed

- 修正内置 Telnet 终端按 TAB 后焦点可能跳出终端，继续按空格会触发弹窗按钮导致终端关闭的问题。

## 1.0.0

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
- 增加配置方案弹窗“打开内置终端”按钮：复制命令后打开 Electron 内置 Telnet 终端，仍由人工粘贴确认。
- 增加跨平台 Telnet 自动登录器：从本地 SQLite 读取 Telnet 凭据，自动登录当前 OLT 并按厂商进入配置模式。
- 增加 ZTE Telnet 只读查询的 Node Telnet 实现，macOS 和 Windows 7 x64 不再依赖 Expect 或系统 telnet。
- 增加 SNMP 解析纯函数模块和 ZTE 未注册 ONU 索引现场样例测试。
- 增加本地调试 seed data 说明、`pnpm run seed:sample` 脱敏抽样脚本和 `pnpm run reset:data` 重置脚本。
- Windows 7 x64 发行流程增加包内 `sqlite3.exe` 准备步骤，安装包会携带 SQLite CLI。
- Windows 7 x64 包内 SQLite 改为固定 legacy Windows x86 CLI，避免新版 x64 `sqlite3.exe` 在 Win7 上以 `3221225785` 启动失败。
- 增加 Win7 x64 免安装 ZIP 构建脚本，用于在 macOS 本地生成可验证包并避开 NSIS 卸载器兼容问题。
- 增加 SNMP 离线诊断：`mock/offline` 时显示 `snmpget` 路径、目标、OID 和脱敏错误，便于排查 Win7 SNMP 工具、PATH、UDP 161 或 community/ACL 问题。
- 增加内置 SNMP v2c 只读客户端：当 Win7 包缺少 `snmpget.exe` 或 `snmpbulkwalk.exe` 时，自动回退到 Node UDP GET/GETBULK 读取。
- 增加 `ADR-005`，明确 Terminal 登录器不是自动下发器。
- 增加 `ADR-006`，记录桌面包关闭 `asar` 以保证 ESM 本地服务可启动。
- 首页改为运维概览，展示当前 OLT、SNMP 状态、待处理事项、快捷入口和最近状态。
- ONU 数据管理增加 Excel 导入导出能力。
- 增加 Electron 22 桌面壳，为 macOS DMG 和 Windows 7 x64 legacy 安装包做准备。
- 增加 GitHub Actions CI 和 tag 触发的自动发行工作流。
- 增加桌面发行说明 `docs/release.md`。
- 补充桌面启动、用户数据目录、工具路径和 GitHub 自动发行相关设计文档。

### Changed

- 增加 `pnpm test` 脚本，用 Node 内置测试运行最小配置方案测试。
- 调整侧边栏菜单：`ONU 列表` 改为 `ONU 数据查询`，`设备管理` 改为 `OLT 设备管理`，`PON 台账` 改为 `ONU 数据管理`，`采集记录` 改为 `数据采集记录`，并取消后台管理折叠分组。
- ONU 数据查询统计条改为浅色主题卡片样式。
- ONU 安装查询在 PON 后增加地址列，地址由本地 PON 台账匹配。
- SQLite、SNMP 工具和运行数据目录支持通过运行时路径配置，桌面版可使用用户数据目录保存数据库。
- 桌面发行包改为不使用 `app.asar`，保留真实目录结构以支持 Electron 主进程动态加载本地服务模块。

### Fixed

- 修正 Huawei 自营上网 `sn-auth` 取值：使用原始十六进制 SN，而不是 `ZTEG-030C0914` 这类可读格式。
- 修正内嵌浏览器中 Clipboard API 被拦截时“复制命令”失败的问题，增加隐藏文本域复制兜底。
- 修正 ZTE 未注册 ONU SNMP 索引解析，避免 PON 口错误显示为 `1`。
- 修正 Excel 导出在内嵌浏览器中点击无反应的问题，统一使用 Blob 下载并增加导出结果提示。
- 取消 ONU 数据管理的 JSON 导出按钮。
- 取消 ONU 数据管理的 Markdown/JSON 粘贴导入台账功能。
- 删除常用命令页面、侧边栏入口和首页快捷入口。
- 修正 macOS DMG 安装后本地服务启动失败的问题，避免 `app.asar/src/server.mjs` 路径被当作目录访问。
- 修正 Windows 7 安装版已携带 `sqlite3.exe` 但本地服务仍提示找不到 SQLite CLI 的启动问题。

### Security

- 明确项目仍处于 OLT 只读管理阶段，禁止设备写操作。

## 0.1.0

### Added

- Vue 3 + Element Plus 前端。
- Node.js HTTP API。
- SQLite 本地 OLT 与 PON 台账。
- SNMP v2c 只读采集。
- ZTE ONU 固定 show 查询能力。
