# API Design

后端入口为 `src/server.mjs`，默认监听 `http://127.0.0.1:8787`。API 返回 JSON，当前没有独立认证层，因此不应暴露到不可信网络。

## 通用约定

- 成功响应使用 HTTP `200`。
- 客户端错误使用 HTTP `400` 或 `404`。
- 服务端错误使用 HTTP `500`。
- 设备访问失败时，优先返回结构化错误，不把敏感凭据写入响应。
- 本地工具缺失时返回可读错误，例如缺少 `sqlite3`、`snmpget` 或 `snmpbulkwalk`，提示用户安装或配置对应环境变量。
- SNMP 工具缺失时，服务端可回退到内置 Node SNMP v2c 只读 GET/GETBULK 客户端；失败时继续返回脱敏诊断。

## 运行环境约定

- Web 服务默认只监听 `127.0.0.1`。
- Electron 桌面版启动同一套 HTTP API，并通过随机本机端口加载窗口。
- 运行数据目录由 `OLT_MANAGER_DATA_DIR` 控制；桌面版应指向用户数据目录。
- 静态文件目录可由 `OLT_MANAGER_STATIC_DIR` 控制；生产桌面包加载 `dist/`。
- 外部工具路径可由 `OLT_MANAGER_SQLITE_BIN`、`OLT_MANAGER_SNMPGET_BIN`、`OLT_MANAGER_SNMPWALK_BIN`、`OLT_MANAGER_SNMPBULKWALK_BIN`、`OLT_MANAGER_EXPECT_BIN` 指定。
- Windows 桌面版如果检测到包内 `resources/app/bin/win32/sqlite3.exe` 或 `resources/bin/win32/sqlite3.exe`，Electron 主进程会在启动 HTTP API 前自动设置 `OLT_MANAGER_SQLITE_BIN`，因此安装版不要求 SQLite 在系统 PATH 中。

## 核心接口

### GET `/api/bootstrap`

返回前端启动所需数据。

包含：

- `version`：应用版本号，来自 `package.json`。
- OLT 列表
- PON 台账
- 公开 OID profile

### GET `/api/status`

返回 OLT 状态摘要、SNMP 可达性和台账数量。

当 SNMP 读取失败时，响应仍保留 `snmpState: "mock/offline"` 作为兼容状态，同时返回 `diagnostics.snmp`：

- `check`：检测项，例如 `sysDescr`、`sysUpTime`。
- `tool`：实际解析到的 `snmpget` 路径。
- `target`：目标 `OLT_IP:端口`。
- `oid`：本次只读检测 OID。
- `error`：脱敏后的工具错误、退出码或超时信息。

诊断信息不得包含 SNMP community。
当外部 `snmpget` 缺失且内置 SNMP fallback 也失败时，`error` 会同时包含工具缺失和 fallback 失败摘要。

### GET `/api/onus`

查询 ONU 列表。

常见查询参数：

- `oltId`
- `chassis`：槽，可省略并按厂商默认。
- `board`：板卡。
- `slot`：兼容别名，等同 `board`。
- `pon`
- `q`

### GET `/api/unregistered-onus`

查询未注册 ONU/ONT。

返回字段包含：

- `chassis`：槽。
- `board`：板卡；`slot` 保留为兼容别名。
- `pon`：PON 口。
- `address`：从本地 PON 台账按 `OLT IP + 槽/板卡/PON` 匹配出的地址；未匹配时为空。
- `serial`：ONU/ONT 序列号。
- `discoveredAt`：发现时间。
- `status`：展示状态。

### GET `/api/config-templates`

列出本地配置方案模板。

返回字段应包含：

- `id`：模板 ID，例如 `zte-self-operated-internet`、`zte-custom-vlan`、`huawei-self-operated-internet`、`huawei-link-booth`、`huawei-custom-vlan`。
- `name`：展示名称，例如 `ZTE 自营上网`、`ZTE 自定义 VLAN`、`Huawei 自营上网`、`Huawei 内部网络`、`Huawei 自定义 VLAN`。
- `vendor`：厂商，例如 `zte`、`huawei`。
- `deviceProfiles`：模板适用的设备 profile，例如 `zte-c300`、`huawei-ma5800`。
- `businessType`：业务类型，例如 `self-operated-internet`、`link-booth`、`custom-vlan`、`mdu-ott`。
- `vlanRules`：固定 VLAN 与动态 VLAN 来源说明。
- `portRules`：物理口选择或固定映射说明。

### POST `/api/config-templates/import-docx`

导入 Word 配置文档，生成配置模板草稿。

当前实现状态：返回 `501`，提示 DOCX 模板导入尚未实现；系统先提供内置 ZTE 自营上网、内部网络、自定义 VLAN、MDU+OTT 和 Huawei 自营上网、内部网络、自定义 VLAN 模板。

安全要求：

- 只解析文档内容，不执行文档中的任何命令。
- 真实账号、密码、community 和现场敏感信息不得写入可提交文件。
- 解析结果必须作为草稿展示，由用户确认后才保存到本地模板。

### POST `/api/unregistered-onus/:id/config-plan`

基于未注册 ONU 和配置模板生成命令预览。

请求体包含：

- `oltId`
- `chassis`
- `board`
- `slot`：兼容别名，等同 `board`。
- `pon`
- `serial`
- `templateId`
- `ethPorts`
- `customVlan`：可选，仅 ZTE/Huawei 自定义 VLAN 模板使用；缺失时阻止生成。

响应包含：

- `blocked`：是否阻止生成。
- `warnings`：需要人工确认的提示。
- `variables`：ONU ID、VLAN、物理口和来源。
- `commands`：只展示/复制用的命令文本。

规则：

- ONU ID 使用同 PON 已注册 ONU ID 最大值 + 1。
- 不复用 ONU ID 空洞。
- 当同 PON 最大 ONU ID 达到 `128` 时返回 `blocked=true`。
- 配置方案按 OLT `deviceProfile` 判断模板适用性；未支持的设备型号，例如当前 `zte-c600`，返回阻止提示，不生成命令预览。
- 未注册 ONU 自身没有 service-port，MDU+OTT 动态 VLAN 必须来自同 PON 已配置样板 ONU 或台账。
- ZTE 和 Huawei 自定义 VLAN 模板复用各自内部网络命令结构，业务 VLAN 来自请求体 `customVlan`，不从设备自动读取。
- Huawei 自营上网模板会把 `ZTEG-030C0914` 这类可读 SN 转换成 `5A544547030C0914` 这类原始十六进制 `sn-auth`。
- 坐标模型统一为 `槽/板卡/PON/ID`；ZTE 命令使用 `gpon-onu_<槽>/<板卡>/<PON>:<ONU ID>`，Huawei 板槽端口如 `0/1/0:1` 表示 `0` 槽、`1` 板卡、`0` PON、`1` ONT ID。
- Huawei 已注册 ONT 序列号来自只读 SNMP `1.3.6.1.4.1.2011.6.128.1.1.2.46.1.30.<PON ifIndex>.<ONT ID>`，页面展示原始 16 位十六进制 SN。
- Huawei 自营上网、内部网络和自定义 VLAN 模板接受 `ethPorts`，只允许 `eth1` 到 `eth4`；自营上网默认 `eth1`，内部网络和自定义 VLAN 默认全选，空选择或非法端口会阻止生成。
- Huawei 内部网络模板固定 VLAN `100`，Huawei 自定义 VLAN 使用请求体 `customVlan`，为所选端口生成 `ont port native-vlan ... priority 0`，并生成对应 `service-port vlan ... tag-transform translate`。
- 接口不登录 OLT、不进入配置模式、不执行、不保存。

### POST `/api/open-terminal-login`

兼容接口。桌面版默认通过 Electron IPC 打开内置 Telnet 终端；该 HTTP 接口保留给旧 macOS Terminal 登录辅助或非桌面环境的兼容提示。

Electron IPC：

- `terminal:create`：主进程读取当前 OLT Telnet 凭据，创建内置 Telnet 会话，自动登录并按厂商进入配置模式；调用入口包括首页快捷入口和配置方案弹窗。
- `terminal:input`：发送用户在 xterm 中输入的内容。
- `terminal:resize`：同步终端窗口大小。
- `terminal:close`：关闭会话。
- `terminal:event`：推送连接、登录、数据、错误和断开事件。

请求来源：

- `oltId` 查询参数或请求体字段。

响应包含：

- `ok`：是否成功创建登录辅助流程。
- `error`：失败原因。

安全要求：

- 只读取当前 OLT 的本地 Telnet 凭据。
- `terminal:create` 不接收命令文本。
- `terminal:input` 只转发用户在终端中键入或主动粘贴的内容；系统不自动粘贴、不自动执行、不保存任何 OLT 命令。
- ZTE 登录后发送 `con t`。
- Huawei 登录后发送 `enable` 和 `config`。
- 如果设备要求 enable 二次密码，交给人工处理。
- Windows 7 x64 和 macOS 桌面版默认使用内置 Telnet 终端，不调用系统 Terminal、Expect 或系统 telnet。

### GET `/api/onu-config`

查询 ONU 详情和只读配置片段。

参数：

- `oltId`
- `chassis`
- `board`
- `slot`：兼容别名，等同 `board`。
- `pon`
- `onuId`

安全要求：

- 只允许已知 OLT。
- 只允许合法数字坐标。
- ZTE 查询只生成固定 show 命令。
- 不接受任意 CLI 文本。
- ZTE Telnet 只读查询使用内置 Node Telnet 客户端，macOS 和 Windows 7 x64 共用同一套逻辑。

### POST `/api/admin/snmp-test`

执行只读 SNMP 测试。

允许：

- `get`
- `walk`

禁止：

- `set`
- `clear`
- `delete`
- `reboot`
- `reset`
- `save`
- `write`
- `commit`
- 其他任何设备写操作或危险操作名。

### GET `/api/admin/pon-ports`

读取本地 PON 台账。

返回字段：

- `oltIp`
- `chassis`
- `board`
- `pon`
- `slot`：兼容别名，等同 `board`。
- `ponPort`：兼容字段，规范格式为 `槽/板卡/PON`，例如 ZTE `1/9/16`、Huawei `0/1/0`。
- `outerVlan`
- `address`

### POST `/api/admin/import-pon-ports`

整表保存本地 PON 台账。前端的页面编辑和 Excel 导入最终都会转换成该接口需要的 JSON 行。

请求体：

- `rows`：台账行数组，每行包含 `oltIp`、`chassis`、`board`、`pon`、`ponPort`、`outerVlan`、`address`；旧两段 `ponPort=板卡/PON` 会按 OLT 厂商补齐默认槽。

响应：

- `ok`
- `count`

安全要求：

- 只写本地 SQLite。
- 不连接 OLT。
- 不执行 SNMP 或 Telnet 命令。
- 不保存账号、密码、community。

### POST `/api/admin/refresh-pon-vlans`

按当前 OLT 只读刷新本地 PON 台账外层 VLAN。该接口只使用 SNMP 读取，不写设备。

响应：

- `ok`
- `count`
- `results`
- `ponPorts`

## API 演进规则

- 新增接口前先写清楚用途、输入、输出和失败行为。
- 涉及设备命令时必须说明只读证明。
- 涉及敏感数据时必须说明脱敏和不落库策略。
- 前端依赖的字段变更要同步更新 `src/main.js` 和本文件。
