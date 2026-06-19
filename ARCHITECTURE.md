# Architecture

OLT Manager 是一个本地运行的只读 GPON OLT 管理原型。它把现场 OLT 数据读取、PON 台账、ONU 查询、常用命令检索和配置片段展示放在一个轻量 Web 应用里，目标是帮助维护人员快速定位 ONU、PON、VLAN、地址和注册状态。

## 系统边界

```text
Browser
  |
  | HTTP JSON API
  v
Node.js server
  |-- SQLite local data
  |-- SNMP get/walk through system tools
  |-- ZTE read-only Expect/Telnet adapter
  |-- Config plan renderer
  |-- Local Terminal Telnet login helper
  v
OLT devices
```

系统以读取设备信息和生成配置预览为主。配置方案模块只生成前端可复制的命令预览，不自动粘贴、不自动执行、不保存。Terminal 登录辅助可进入设备配置模式，但不会下发生成的配置命令。

## 主要模块

- `src/main.js`：Vue 3 前端入口，负责页面状态、表格、表单、对话框、常用命令检索、PON 台账 Excel 导入导出和 API 调用。
- `src/styles.css`：前端样式。
- `src/server.mjs`：HTTP API、静态文件服务、SNMP 调用、OID 解析和业务聚合。
- `src/db.mjs`：SQLite 初始化、台账读写、操作日志和 SNMP 测试历史。
- `src/zte-telnet.mjs`：ZTE ONU 只读配置查询封装。
- `src/zte-readonly.expect`：Expect 脚本，只执行内部生成的白名单 show 命令。
- 配置方案渲染：根据未注册 ONU、模板、ONU ID 建议、VLAN 解析结果和用户选择的物理口生成命令文本，仅返回给前端展示和复制。Huawei 自营上网模板会把可读 SN 转换为 `sn-auth` 所需的原始十六进制 SN。前端可请求后端打开本机 Terminal 并自动 Telnet 登录当前 OLT，但不粘贴、不执行生成的配置命令。
- `data/*.example.json`：可提交示例 seed。
- `data/*.json`、`data/*.sqlite*`：本地运行数据，不提交。

## 数据流

1. 前端请求 `/api/bootstrap` 获取 OLT、PON 台账和公开 OID profile。
2. 用户发起状态、ONU、未注册 ONU 或配置查询。
3. 后端读取 SQLite 中的 OLT 配置和台账。
4. 后端通过 SNMP 只读命令采集设备数据。
5. 对 ZTE ONU 配置查询，后端调用固定白名单 Telnet show 命令。
6. 后端解析输出并返回 JSON。
7. 前端展示 ONU 数据、未注册 ONU、PON 台账、常用命令和只读配置片段。

## 配置方案数据流

1. 用户在未注册 ONU 列表点击生成配置方案。
2. 前端提交 OLT、slot、pon、临时 ONU 标识、序列号、模板类型和物理口选择。
3. 后端读取同 PON 已配置 ONU 列表，按最大 ONU ID + 1 建议新 ONU ID；当最大值达到 128 时阻止生成并返回 PON 口已满提示。
4. 自营上网和内部网络使用固定 VLAN 规则；MDU+OTT 从同 PON 已配置样板 ONU 的 service-port SNMP 表读取动态 VLAN。
5. 后端渲染命令预览并返回变量来源、告警和命令文本。
6. 前端只展示和复制命令，可打开本机 Terminal 并自动登录 OLT 方便人工粘贴。
7. Terminal 登录器按厂商进入配置模式：ZTE 发送 `con t`，Huawei 发送 `enable` 和 `config`。

## 页面与台账能力

- 首页是运维概览，展示当前 OLT、SNMP 状态、未注册 ONU、LOS/断电/离线、台账健康、快捷入口和最近状态。
- 常用命令是独立页面，按厂商分组展示中兴 C300 / 华为 MA5800 命令，支持按中文用途或命令片段模糊搜索，仅用于查看和复制。
- `ONU 安装查询` 展示未注册 ONU/ONT。ZTE 未注册 ONU 的槽位/PON 从 SNMP 索引解析，地址从本地 PON 台账按 `OLT IP + 槽位/PON` 匹配。
- `ONU 数据查询` 展示已注册 ONU 状态、光功率、距离和地址，统计条使用轻量主题样式。
- `ONU 数据管理` 维护本地 PON 台账，支持新增、页面编辑、Excel 导入导出、外层 VLAN 刷新和保存台账。

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
- 本机 Terminal 登录辅助接口只读取当前 OLT 的本地 Telnet 凭据，不接收配置命令文本、不粘贴、不执行生成的配置方案。
- Huawei `display ont autofind all` 只用于人工或只读实验验证；系统当前不提供 Huawei 任意 Telnet 执行入口。
- Excel 导入导出只读写本地 SQLite 台账，不产生任何设备侧命令。
- 首页待处理事项只做只读统计和页面跳转，不自动处理 ONU。
- 常用命令模块只展示命令文本，不绑定执行入口。
- 默认服务监听 `127.0.0.1`，不假设已经具备公网暴露安全性。

## 技术约束

- 当前后端是原生 Node HTTP 服务，不依赖 Express。
- SQLite 通过系统 `/usr/bin/sqlite3` 调用。
- SNMP 依赖系统 `snmpget`、`snmpbulkwalk`。
- ZTE Telnet 查询依赖 `expect` 和本机 telnet。
- Excel 导入导出由前端 `xlsx` 依赖完成，后端仍只接收规范化后的 JSON 台账行。
- Vite 7 对 Node 版本要求高于 `package.json` 当前 `>=18` 的宽松声明，后续需要校准。

## 可演进方向

- 将 SNMP/OID 解析从 `src/server.mjs` 拆成可测试模块。
- 增加最小认证或本机代理部署文档。
- 为 Huawei MA5800 建立更多只读样例和解析测试。
- 将 API 合约、数据库迁移和解析函数纳入自动化测试。
