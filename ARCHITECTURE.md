# Architecture

OLT Manager 是一个本地运行的只读 GPON OLT 管理原型。它把现场 OLT 数据读取、PON 台账、ONU 查询和配置片段展示放在一个轻量 Web 应用里，目标是帮助维护人员快速定位 ONU、PON、VLAN、地址和注册状态。

## 系统边界

```text
Browser
  |
  | HTTP JSON API
  v
Node.js server
  |-- SQLite local data
  |-- SNMP get/walk through system tools or built-in read-only UDP client
  |-- Cross-platform Node Telnet read-only adapter
  |-- Config plan renderer
  |-- Electron embedded Telnet terminal
  v
OLT devices
```

系统以读取设备信息和生成配置预览为主。配置方案模块只生成前端可复制的命令预览，不自动粘贴、不自动执行、不保存。桌面版内置 Telnet 终端可自动登录并进入设备配置模式，但不会下发生成的配置命令。

桌面版通过 Electron 22 启动同一个 Node HTTP 服务并加载本地 `127.0.0.1` 页面。Electron 22 是为了保留 Windows 7 x64 legacy 包兼容性；不要在未重新评估 Win7 兼容前升级到 Electron 23+。桌面包当前关闭 `asar`，以保证 `src/server.mjs`、`src/db.mjs` 和 `src/telnet-client.mjs` 能作为真实文件被 Electron 主进程动态加载，详见 ADR-006。

## 主要模块

- `src/main.js`：Vue 3 前端入口，负责页面状态、表格、表单、对话框、PON 台账 Excel 导入导出和 API 调用。
- `src/styles.css`：前端样式。
- `src/server.mjs`：HTTP API、静态文件服务、SNMP 调用、OID 解析和业务聚合。
- `src/snmp-client.mjs`：内置 SNMP v2c 只读 GET/GETBULK 客户端，在 `snmpget` 或 `snmpbulkwalk` 缺失时作为桌面包 fallback。
- `src/db.mjs`：SQLite 初始化、台账读写、操作日志和 SNMP 测试历史。
- `src/runtime-paths.mjs`：运行时路径解析，支持桌面版用户数据目录、包内工具和外部工具路径配置。
- `src/snmp-parsers.mjs`：SNMP OID 索引纯解析函数，优先承载可用 Node test 复现的现场样例。
- `src/telnet-client.mjs`：跨平台 Telnet IAC 协商、自动登录状态机、交互会话和只读命令执行。
- `src/zte-telnet.mjs`：ZTE ONU 只读配置查询封装。
- `electron/main.cjs`：Electron 主进程，设置用户数据目录，启动本地服务，管理内置 Telnet 会话并通过 IPC 推送终端事件。
- 配置方案渲染：根据未注册 ONU、模板、ONU ID 建议、VLAN 解析结果和用户选择的物理口生成命令文本，仅返回给前端展示和复制。Huawei 自营上网模板会把可读 SN 转换为 `sn-auth` 所需的原始十六进制 SN。桌面版可打开内置 Telnet 终端并自动登录当前 OLT，但不粘贴、不执行生成的配置命令。
- `data/*.example.json`：可提交示例 seed，可通过 `pnpm run reset:data` 重置本地调试数据。
- `data/*.json`、`data/*.sqlite*`：本地运行数据，不提交。
- `bin/win32/sqlite3.exe`：Windows 7 x64 发行包内置 SQLite CLI，GitHub Release 构建时准备并打入安装包。Electron 启动时会把安装目录中的包内绝对路径绑定到 `OLT_MANAGER_SQLITE_BIN`；NSIS 包同时通过 `extraResources` 保留 `resources/bin/win32/sqlite3.exe` 作为安装版兜底路径。

## 数据流

1. 前端请求 `/api/bootstrap` 获取 OLT、PON 台账和公开 OID profile。
2. 用户发起状态、ONU、未注册 ONU 或配置查询。
3. 后端读取 SQLite 中的 OLT 配置和台账。
4. 后端优先通过 SNMP 只读命令采集设备数据；工具缺失时回退到内置 UDP SNMP 只读客户端。
5. 对 ZTE ONU 配置查询，后端调用固定白名单 Telnet show 命令。
6. 后端解析输出并返回 JSON。
7. 前端展示 ONU 数据、未注册 ONU、PON 台账和只读配置片段。

## 配置方案数据流

1. 用户在未注册 ONU 列表点击生成配置方案。
2. 前端提交 OLT、slot、pon、临时 ONU 标识、序列号、模板类型和物理口选择。
3. 后端读取同 PON 已配置 ONU 列表，按最大 ONU ID + 1 建议新 ONU ID；当最大值达到 128 时阻止生成并返回 PON 口已满提示。
4. 自营上网和内部网络使用固定 VLAN 规则；MDU+OTT 从同 PON 已配置样板 ONU 的 service-port SNMP 表读取动态 VLAN。
5. 后端渲染命令预览并返回变量来源、告警和命令文本。
6. 前端只展示和复制命令，桌面版可打开内置 Telnet 终端并自动登录 OLT 方便人工粘贴。
7. 内置 Telnet 终端按厂商进入配置模式：ZTE 发送 `con t`，Huawei 发送 `enable` 和 `config`。

## 页面与台账能力

- 首页是运维概览，展示当前 OLT、SNMP 状态、未注册 ONU、LOS/断电/离线、台账健康、快捷入口和最近状态；桌面版快捷入口可打开内置 Telnet 终端并自动登录当前 OLT。
- `ONU 安装查询` 展示未注册 ONU/ONT。ZTE 未注册 ONU 的槽位/PON 从 SNMP 索引解析，地址从本地 PON 台账按 `OLT IP + 槽位/PON` 匹配。
- `ONU 数据查询` 展示已注册 ONU 状态、光功率、距离和地址，统计条使用轻量主题样式。
- `ONU 数据管理` 维护本地 PON 台账，支持新增、页面编辑、搜索、完整列表展示、Excel 导入导出、外层 VLAN 刷新和保存台账；无搜索时默认把当前 OLT 的台账排在前面。

## 配置方案模板

- ZTE 自营上网：内层 VLAN 固定为 `3301`，外层 VLAN为 PON 口 `OUTERVLAN`，物理口由用户选择单口或 `eth_0/1` 到 `eth_0/4`。
- ZTE 内部网络：VLAN 固定为 `100`，不使用外层 VLAN，包含 `sn-bind disable`，物理口由用户选择。
- ZTE MDU+OTT：`86` 为直播 VLAN，`90` 为默认 VLAN，`100` 为内网 VLAN；内层 VLAN、外层 VLAN、互动 VLAN 动态读取。
- Huawei 自营上网：内层 VLAN 固定为 `3301`，line profile 和 service profile 固定为 `300`，gemport 固定为 `0`，物理口固定为 `eth 1`；`sn-auth` 使用未注册 ONT 原始十六进制 SN。

## 安全边界

- 不暴露任意命令执行接口。
- 不支持 `snmpset`。
- 不支持 ONU 注册、授权、删除、重启、恢复出厂。
- 不自动注册、授权、删除、重启、恢复出厂。
- 不自动保存配置、提交配置。
- ZTE Telnet 只允许根据 `slot/pon/onuId` 生成固定 show 命令。
- 配置方案接口只返回文本，不允许接收或执行任意 CLI。
- 桌面内置 Telnet 终端只读取当前 OLT 的本地 Telnet 凭据，不接收配置命令文本、不粘贴、不执行生成的配置方案。
- Huawei `display ont autofind all` 只用于人工或只读实验验证；系统当前不提供 Huawei 任意 Telnet 执行入口。
- Excel 导入导出只读写本地 SQLite 台账，不产生任何设备侧命令。
- 首页待处理事项只做只读统计和页面跳转，不自动处理 ONU。
- Windows 7 x64 和 macOS 桌面版默认共用 Electron 内置 Telnet 终端，不依赖系统 Terminal、Expect 或系统 telnet。
- 默认服务监听 `127.0.0.1`，不假设已经具备公网暴露安全性。

## 技术约束

- 当前后端是原生 Node HTTP 服务，不依赖 Express。
- SQLite 通过 `sqlite3` CLI 调用，路径可由 `OLT_MANAGER_SQLITE_BIN` 指定；Windows 桌面包启动时优先把包内 `resources/app/bin/win32/sqlite3.exe` 或 `resources/bin/win32/sqlite3.exe` 的绝对路径写入该环境变量，用户无需把 SQLite 加入 PATH。桌面版数据目录由 `OLT_MANAGER_DATA_DIR` 指定。
- SNMP 优先使用 `snmpget`、`snmpbulkwalk`，路径可由 `OLT_MANAGER_SNMPGET_BIN`、`OLT_MANAGER_SNMPBULKWALK_BIN` 指定；当工具缺失时，桌面版可回退到内置 Node UDP SNMP v2c GET/GETBULK 只读客户端。
- ZTE Telnet 查询使用内置 Node Telnet 客户端，仍只允许内部生成的白名单 show 命令。
- Excel 导入导出由前端 `xlsx` 依赖完成，后端仍只接收规范化后的 JSON 台账行。
- 本地开发和 GitHub Actions 使用 Node `>=22.13.0`，以兼容 pnpm 11 和 Vite 7。
- Electron 打包当前使用 `asar: false`；如需恢复 `asar`，必须配套 `asarUnpack` 并重新验证桌面启动。

## 可演进方向

- 继续将 SNMP/OID 解析从 `src/server.mjs` 拆成可测试模块。
- 增加最小认证或本机代理部署文档。
- 为 Huawei MA5800 建立更多只读样例和解析测试。
- 将 API 合约、数据库迁移和解析函数纳入自动化测试。
