# Architecture

OLT Manager 是一个本地运行的只读 GPON OLT 管理原型。它把现场 OLT 数据读取、PON 台账、ONU 查询和配置片段展示放在一个轻量 Web 应用里，目标是帮助维护人员快速定位 ONU、PON、VLAN、地址和注册状态。

## OltDataGateway

`src/olt-data-gateway.mjs` 是 Feishu 子系统使用的内部只读数据服务。它把 SQLite 用户快照、PON 台账、OLT inventory 与现有厂商只读采集隐藏在七个稳定 Interface 后：`status`、`listOlts`、`queryUsers`、`readOnuStatus`、`queryUserLiveStatus`、`queryPons`、`readPonStatuses`。Feishu 单聊查询由应用层自动传入全部已启用 OLT 的 identity；Gateway 仍校验非空、已知且启用的 OLT ID。PON 地址查询先按这些 OLT ID 过滤本地台账再返回最多 100 个候选，并仅对查询词末尾 `村`、台账备注省略 `村` 的情况做受限兼容。PON 状态查询只返回精确 PON 口内最多 128 个 ONU 的坐标、快照姓名、在线状态和光功率。`status` 返回持久化、opaque、非敏感的 `datasetRevision`；完整用户快照替换、导入、清空或会改变用户资料的本机清洗会轮换该版本，使内置 Feishu 子系统能够使旧的数据集确认失效，但不能从版本反推出任何用户字段。该服务不再通过独立 HTTP Gateway、端口或 bearer token 对外暴露。

Feishu 运行实现位于 `src/feishu/`。`gateway-contract.mjs` 只校验和投影进程内 `OltDataGateway` 的结果，不复制查询规则；`state.mjs` 保留历史授权字段以兼容既有加密备份，但当前查询不再读取 Operator、Authorized Chat 或 Access Request；`subsystem.mjs` 负责默认关闭、显式启用、状态持久化、启动重连和故障隔离；`language-interpretation.mjs` 提供版本化 Language Interpretation 合同和仅限 Synthetic Dataset Attestation 的确定性测试 provider；`production-language-provider.mjs` 只向用户配置的兼容接口发送当前消息与白名单 intent，严格解析 query/clarification JSON，API Key 只从操作系统加密凭据引用读取；桌面端 `cc-switch-provider-discovery.cjs` 只返回 CC Switch 中的供应商名称、接口地址、模型和格式，不把密钥导入前端或状态。`application.mjs` 只接受飞书单聊，自动使用全部已启用 OLT，并在 Language Interpretation 之后、Gateway 查询之前执行严格合同校验；短中文姓名/地址在姓名查询无结果时保守回退到 PON 地址查询；候选绑定为进程内一次性随机 token，五分钟过期，候选卡片每页 5 条并通过回调翻页，详情回调再次校验当前启用 OLT 后才调用只读 Gateway；唯一 ONU 详情读取失败时先降级到通用实时状态，若 OLT 仍未返回该坐标，则保留并展示本地用户快照资料，明确标注实时 ONU 数据未返回。`production-runtime.cjs` 负责 Feishu SDK 的消息/卡片传输和事件规范化，不能绕过应用或直接访问 OLT。

桌面端 `electron/combined-backup.cjs` 提供版本化的 SQLite + Feishu 加密文件组合备份：只封装密文文件，不导出解密后的 App Secret、模型密钥或操作系统密钥；恢复前校验 manifest、SQLite 完整性、Feishu 状态/凭据引用，并在数据库恢复失败时回滚 Feishu 文件。

旧 Feishu ONU Query 状态已完成迁移；当前桌面端不再提供旧目录选择、预览或应用入口，也不会读取 `local-administration.json`。历史迁移模块和加密状态字段仅作为代码/备份兼容材料保留，不参与当前授权。

单聊查询在模块内重新读取已启用 OLT，空列表在读取用户快照前失败；群聊在语言解析前拒绝。候选先按启用 OLT ID 与明确字段过滤，再计数并限制为最多 100 条；飞书卡片每页渲染 5 条，翻页和选择都重新校验聊天与 OLT 范围。投影不包含主机地址、数据库字段、凭据、会话、项目、配置方案或审计，也没有任何写操作。

桌面壳使用固定的本机回环端口 `8787` 加载 OLT Manager 页面；Feishu 子系统与只读数据服务在 Electron 主进程内直接连接，不需要端口配置、bearer token 或额外 HTTP 暴露面。

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
  |-- NMSE-PON fixed read-only HTTP client
  |-- Feishu optional subsystem (in-process read-only data service, encrypted state, SDK transport)
  v
OLT devices
```

系统以读取设备信息和生成配置预览为主。配置方案模块只生成前端可复制的命令预览，不自动粘贴、不自动执行、不保存。桌面版内置 Telnet 终端可自动登录并进入设备配置模式，但不会下发生成的配置命令。

桌面版通过 Electron 22 启动同一个 Node HTTP 服务并加载本地 `127.0.0.1` 页面。Electron 22 是为了保留 Windows 7 x64 legacy 包兼容性；不要在未重新评估 Win7 兼容前升级到 Electron 23+。桌面包当前关闭 `asar`，以保证 `src/server.mjs`、`src/db.mjs` 和 `src/telnet-client.mjs` 能作为真实文件被 Electron 主进程动态加载，详见 ADR-006。macOS 当前只发布 Apple Silicon DMG，且未使用 Apple Developer ID 签名、未经过 Apple 公证；浏览器下载后的 quarantine 属性可能触发 Gatekeeper“已损坏”提示，此限制属于发行信任链，不代表应用业务数据或 DMG 必然损坏。

用户资源管理通过固定白名单的 NMSE-PON HTTP 路径登录、发现 OLT、读取 ONU 用户与 SVLAN/CVLAN；它不代理任意 URL，也不执行远端写操作。资源管理密码仅保存在本机 SQLite，token/Cookie 仅存在 Node 进程内存。NMSE 配置快照与 SNMP 设备运行态数据分别标记来源；SVLAN 同步只更新匹配 PON 的本地台账。

## 主要模块

- `src/main.js`：Vue 3 前端入口，负责页面状态、表格、表单、对话框、PON 台账 Excel 导入导出和 API 调用。
- `src/styles.css`：前端样式。
- `src/server.mjs`：HTTP API、静态文件服务、SNMP 调用、OID 解析和业务聚合。
- `src/cli.mjs`、`src/cli-tools.mjs`：面向大模型的只读命令行入口和工具白名单；每次调用在 `127.0.0.1` 随机端口启动临时 HTTP 服务，复用既有 API 后立即关闭。
- `src/snmp-client.mjs`：内置 SNMP v2c 只读 GET/GETBULK 客户端，在 `snmpget` 或 `snmpbulkwalk` 缺失时作为桌面包 fallback。
- `src/db.mjs`：SQLite 初始化、台账读写、操作日志和 SNMP 测试历史。
- `src/runtime-paths.mjs`：运行时路径解析，支持桌面版用户数据目录、包内工具和外部工具路径配置。
- `src/snmp-parsers.mjs`：SNMP OID 索引纯解析函数，优先承载可用 Node test 复现的现场样例。
- `src/resource-user-sync.mjs`：当前 OLT 用户资源完整同步、调试检查点和运行时进度的深度 module；HTTP 路径只负责会话/OLT 解析与响应映射，NMSE 读取和 SQLite 快照作为可替换 adapter 注入。
- `src/telnet-client.mjs`：跨平台 Telnet IAC 协商、自动登录状态机、交互会话和只读命令执行。
- `src/zte-telnet.mjs`：ZTE ONU 只读配置查询封装。
- `electron/main.cjs`：Electron 主进程，设置用户数据目录，启动本地服务，管理内置 Telnet 会话并通过 IPC 推送终端事件。
- 项目管理：维护本地项目、项目 VLAN、联系人和后续项目-ONU 关联。项目只写入本地 SQLite，不绑定单台 OLT，不对应 OLT 实机对象，不触发 SNMP 或 Telnet 设备命令。
- 配置方案渲染：根据未注册 ONU、模板、ONU ID 建议、VLAN 解析结果和用户选择的物理口生成命令文本，仅返回给前端展示和复制。Huawei 自营上网模板会把可读 SN 转换为 `sn-auth` 所需的原始十六进制 SN。桌面版可打开内置 Telnet 终端并自动登录当前 OLT，但不粘贴、不执行生成的配置命令。
- `data/*.example.json`：可提交示例 seed，可通过 `pnpm run reset:data` 重置本地调试数据。
- `data/*.json`、`data/*.sqlite*`：本地运行数据，不提交。
- `bin/win32/sqlite3.exe`：Windows 7 x64 发行包内置 SQLite CLI，GitHub Release 构建时准备并打入安装包。Electron 启动时会把安装目录中的包内绝对路径绑定到 `OLT_MANAGER_SQLITE_BIN`；NSIS 包同时通过 `extraResources` 保留 `resources/bin/win32/sqlite3.exe` 作为安装版兜底路径。

## 数据流

1. 前端请求 `/api/bootstrap` 获取应用版本、OLT、PON 台账和公开 OID profile；应用版本以 `package.json` 为唯一来源。
2. 用户发起状态、ONU、未注册 ONU 或配置查询。
3. 后端读取 SQLite 中的 OLT 配置和台账。
4. 后端优先通过 SNMP 只读命令采集设备数据；工具缺失时回退到内置 UDP SNMP 只读客户端。
5. 对 ZTE ONU 配置查询，后端调用固定白名单 Telnet show 命令。
6. 后端解析输出并返回 JSON。
7. 前端展示 ONU 数据、未注册 ONU、PON 台账和只读配置片段。

CLI 不建立第二套业务实现。`olt-manager call` 将严格校验后的工具参数映射到同一 HTTP API，返回统一 JSON 信封；工具列表不包含 OLT、项目或 PON 台账写入，也不包含终端输入和任意设备命令。

ONU/ONT 坐标统一使用 `chassis/board/pon/onuId` 四元组，对应中文 `槽/板卡/PON口/ID`。ZTE 命令格式为 `gpon-onu_<槽>/<板卡>/<PON>:<ONU ID>`；Huawei 板槽端口格式如 `0/1/0:1`，表示 `0` 槽、`1` 板卡、`0` PON、`1` ONT ID。API 暂时保留 `slot=board` 兼容别名。

## 配置方案数据流

1. 用户在未注册 ONU 列表点击生成配置方案。
2. 前端提交 OLT、slot、pon、临时 ONU 标识、序列号、模板类型、物理口选择和可选的自定义 VLAN。
3. 后端读取同 PON 已配置 ONU 列表，按最大 ONU ID + 1 建议新 ONU ID；当最大值达到 128 时阻止生成并返回 PON 口已满提示。
4. 自营上网和内部网络使用固定 VLAN 规则；ZTE 和 Huawei 自定义 VLAN 使用用户输入的业务 VLAN；项目模板使用本地项目 VLAN；MDU+OTT 从同 PON 已配置样板 ONU 的 service-port SNMP 表读取动态 VLAN。
5. 后端渲染命令预览并返回变量来源、告警和命令文本。
6. 前端只展示和复制命令，桌面版可打开内置 Telnet 终端并自动登录 OLT 方便人工粘贴。
7. 内置 Telnet 终端按厂商进入配置模式：ZTE 发送 `con t`，Huawei 发送 `enable` 和 `config`。

## 页面与台账能力

- 首页是运维概览，展示当前 OLT、SNMP 状态、未注册 ONU、LOS/断电/离线、台账健康、快捷入口和最近状态；桌面版快捷入口可打开内置 Telnet 终端并自动登录当前 OLT。
- `ONU 安装查询` 展示未注册 ONU/ONT。ZTE 未注册 ONU 的槽/板卡/PON 从 SNMP 索引解析，地址从本地 PON 台账按 `OLT IP + 槽/板卡/PON` 匹配。
- `ONU 数据查询` 展示已注册 ONU 状态、光功率、距离和地址，统计条使用轻量主题样式。
- `项目管理` 维护本地项目资料，支持项目新建、编辑、搜索和删除；项目名称全局唯一，项目 VLAN 为 `1-4094` 范围内的单个 VLAN。删除项目只删除本地项目和项目-ONU 关联，不删除本地 ONU 台账，不删除 OLT 实机 ONU。
- `ONU 数据管理` 维护本地 PON 台账，支持新增、页面编辑、搜索、完整列表展示、Excel 导入导出、外层 VLAN 刷新和保存台账；无搜索时只渲染当前选择 OLT 的台账，输入关键字后全局搜索全部台账并优先展示当前 OLT 匹配结果。外层 VLAN 刷新按当前选择 OLT 执行，不做全局刷新。

## 配置方案模板

- OLT 厂商和型号在后台按固定选项录入；系统使用 `device_profile` 作为配置模板适配键，例如 `zte-c300`、`zte-c600`、`huawei-ma5800`。只有已验证支持的 profile 会显示配置模板并允许生成命令预览。
- ZTE 自营上网：内层 VLAN 固定为 `3301`，外层 VLAN为 PON 口 `OUTERVLAN`，物理口由用户选择单口或 `eth_0/1` 到 `eth_0/4`。
- ZTE 内部网络：VLAN 固定为 `100`，不使用外层 VLAN，包含 `sn-bind disable`，物理口由用户选择。
- ZTE 自定义 VLAN：复用内部网络命令结构，不使用外层 VLAN，VLAN 由用户在生成方案时输入，包含 `sn-bind disable`，物理口由用户选择。
- ZTE 项目模板：由本地项目动态生成，展示为 `项目:项目名称(VLAN号:xxx)`，复用 ZTE 内部网络/自定义 VLAN 命令结构，VLAN 来自项目 VLAN，用户不需要再输入业务 VLAN。
- ZTE MDU+OTT：`86` 为直播 VLAN，`90` 为默认 VLAN，`100` 为内网 VLAN；内层 VLAN、外层 VLAN、互动 VLAN 动态读取。
- Huawei 自营上网：内层 VLAN 固定为 `3301`，line profile 和 service profile 固定为 `300`，gemport 固定为 `0`，物理口可选择 `eth1` 到 `eth4`，默认 `eth1`；`sn-auth` 使用未注册 ONT 原始十六进制 SN。
- Huawei 内部网络：VLAN 固定为 `100`，line profile 和 service profile 固定为 `300`，gemport 固定为 `0`，物理口可选择 `eth1` 到 `eth4`，默认全选，为所选端口生成 `native-vlan ... priority 0`，并生成 `service-port vlan 100`；`sn-auth` 使用未注册 ONT 原始十六进制 SN。
- Huawei 自定义 VLAN：复用 Huawei 内部网络命令结构，不使用外层 VLAN，VLAN 由用户在生成方案时输入，物理口可选择 `eth1` 到 `eth4`，默认全选；`sn-auth` 使用未注册 ONT 原始十六进制 SN。
- Huawei 项目模板：由本地项目动态生成，展示为 `项目:项目名称(VLAN号:xxx)`，复用 Huawei 内部网络/自定义 VLAN 命令结构，VLAN 来自项目 VLAN，用户不需要再输入业务 VLAN。
- ZTE C600 当前可以录入为设备型号，但未绑定配置方案模板；系统会阻止生成配置预览，避免误用 C300 命令。

## 安全边界

- 不暴露任意命令执行接口。
- 不支持 `snmpset`。
- 不支持 ONU 注册、授权、删除、重启、恢复出厂。
- 不自动注册、授权、删除、重启、恢复出厂。
- 不自动保存配置、提交配置。
- ZTE Telnet 只允许根据 `chassis/board/pon/onuId` 生成固定 show 命令，`slot` 仅作为 `board` 兼容别名。
- 配置方案接口只返回文本，不允许接收或执行任意 CLI。
- 桌面内置 Telnet 终端只读取当前 OLT 的本地 Telnet 凭据，不接收配置命令文本、不粘贴、不执行生成的配置方案。
- Huawei `display ont autofind all` 只用于人工或只读实验验证；系统当前不提供 Huawei 任意 Telnet 执行入口。
- 项目管理只读写本地 SQLite 项目资料和项目-ONU 关联，不连接 OLT、不执行 SNMP 写入、不执行 Telnet 配置命令。
- Excel 导入导出只读写本地 SQLite 台账，不产生任何设备侧命令。
- 首页待处理事项只做只读统计和页面跳转，不自动处理 ONU。
- Windows 7 x64 和 macOS 桌面版默认共用 Electron 内置 Telnet 终端，不依赖系统 Terminal、Expect 或系统 telnet。
- 默认服务监听 `127.0.0.1`，不假设已经具备公网暴露安全性。
- CLI 临时服务固定监听 `127.0.0.1` 随机端口，并在每次调用结束、中断或超时后关闭；CLI 输出不得包含 community、Telnet 用户名或密码。

## 技术约束

- 当前后端是原生 Node HTTP 服务，不依赖 Express。
- NMSE-PON 客户端优先使用运行时 `fetch`；Electron 22 内置 Node 16 不提供全局 `fetch` 时，回退到 Node 原生 `http/https`，保持固定白名单、超时和 Cookie 会话规则。
- SQLite 通过 `sqlite3` CLI 调用，路径可由 `OLT_MANAGER_SQLITE_BIN` 指定；Windows 桌面包启动时优先把包内 `resources/app/bin/win32/sqlite3.exe` 或 `resources/bin/win32/sqlite3.exe` 的绝对路径写入该环境变量，用户无需把 SQLite 加入 PATH。桌面版数据目录由 `OLT_MANAGER_DATA_DIR` 指定。
- SNMP 优先使用 `snmpget`、`snmpbulkwalk`，路径可由 `OLT_MANAGER_SNMPGET_BIN`、`OLT_MANAGER_SNMPBULKWALK_BIN` 指定；当工具缺失时，桌面版可回退到内置 Node UDP SNMP v2c GET/GETBULK 只读客户端。
- ZTE Telnet 查询使用内置 Node Telnet 客户端，仍只允许内部生成的白名单 show 命令。
- Excel 导入导出由前端 `xlsx` 依赖完成，后端仍只接收规范化后的 JSON 台账行。
- 本地开发和 GitHub Actions 使用 Node `>=22.13.0`，以兼容 pnpm 11 和 Vite 7。
- Electron 打包当前使用 `asar: false`；如需恢复 `asar`，必须配套 `asarUnpack` 并重新验证桌面启动。
- macOS 正式公开分发前需补齐 Developer ID 签名、hardened runtime、Apple 公证和 staple 验收；当前未签名包只用于可信来源的内部测试。

## 可演进方向

- 继续将 SNMP/OID 解析从 `src/server.mjs` 拆成可测试模块。
- 增加最小认证或本机代理部署文档。
- 为 Huawei MA5800 建立更多只读样例和解析测试。
- 将 API 合约、数据库迁移和解析函数纳入自动化测试。
