# API Design

后端入口为 `src/server.mjs`，默认监听 `http://127.0.0.1:8787`。API 返回 JSON，当前没有独立认证层，因此不应暴露到不可信网络。

面向大模型的 CLI 入口为 `src/cli.mjs`。CLI 只通过白名单工具映射调用本文已有接口，不新增任意设备命令接口；完整命令和工具清单见 `docs/design/cli.md`。

## OLT Data Gateway v1

以下接口只用于本机 Feishu ONU Query 集成，均要求 `Authorization: Bearer <opaque token>`。桌面版优先读取“飞书查询 Gateway”界面中由 OS 加密保存的 token 和端口；服务端模式也可使用 `OLT_MANAGER_GATEWAY_TOKEN`。Token 不写入仓库，未配置时返回 `503`。

- `GET /api/gateway/v1/status`：返回 `contractVersion: "1"`、`readOnly: true`、能力清单与非空 `datasetRevision`。`datasetRevision` 是持久化的 opaque 数据版本，完整用户快照变化时轮换；它不包含用户资料、数据库路径或凭据。
- `GET /api/gateway/v1/olts`：只返回 `oltId`、名称、厂商、型号和启停状态，不返回管理地址或凭据。
- `POST /api/gateway/v1/users/query`：请求 `{ intent, value, oltIds, limit }`。`oltIds`、`value` 必须非空；支持姓名、电话、地址、LOID、MAC、ONU 坐标。响应在授权范围过滤后返回 `authorizedCount` 与最多 10 个候选。
- `POST /api/gateway/v1/users/live-status`：请求 `{ intent, value, oltIds }`。只在 Authorized OLT Scope 内恰好命中一个用户时读取并返回 `candidate + liveStatus`；零命中返回 `404`，多命中返回 `409`，两者都不访问 OLT。
- `POST /api/gateway/v1/onus/live-status`：请求一个 `oltId` 和完整 `{ chassis, board, pon, onuId }`，只返回该坐标的实时只读状态。
- `POST /api/gateway/v1/pons/live-status`：请求一个 `oltId` 和完整 PON `{ chassis, board, pon }`，只返回该 PON 口最多 128 个 ONU 的坐标、`phase` 与 `rxPower`；不返回用户资料、SN、设备地址或凭据。

该接口不提供用户全量列表、同步触发、数据库下载、设备/NMSE 凭据、配置方案、项目或审计数据。

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

返回字段包含：

- `project`：所属项目摘要；未归属时为 `null`。已归属时包含 `id`、`name`、`vlan`。
- `projectId`、`projectName`：所属项目兼容展示字段；未归属时为空字符串。

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
- `name`：展示名称，例如 `ZTE 自营上网`、`ZTE 自定义 VLAN`、`Huawei 自营上网`、`Huawei 内部网络`、`Huawei 自定义 VLAN`；项目模板展示为 `项目:项目名称(VLAN号:xxx)`。
- `vendor`：厂商，例如 `zte`、`huawei`。
- `deviceProfiles`：模板适用的设备 profile，例如 `zte-c300`、`huawei-ma5800`。
- `businessType`：业务类型，例如 `self-operated-internet`、`link-booth`、`custom-vlan`、`mdu-ott`。
- `vlanRules`：固定 VLAN 与动态 VLAN 来源说明。
- `portRules`：物理口选择或固定映射说明；`labels` 用于前端中文展示，例如 ZTE `eth_0/1` 显示为 `网口1`、Huawei `eth1` 显示为 `网口1`，提交和命令生成仍使用设备原始端口值。
- `projectId`、`projectName`、`vlan`：仅项目模板返回，项目模板由本地项目表动态生成，不写入 OLT。

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
- 项目模板 `templateId` 格式为 `project:<projectId>:zte` 或 `project:<projectId>:huawei`，复用对应厂商自定义 VLAN/内部网络命令结构，业务 VLAN 来自本地项目 `vlan`，不要求提交 `customVlan`。
- 项目模板响应会返回项目名称、项目 VLAN 和项目 ID；接口仍只返回命令预览，不登录、不粘贴、不执行、不保存到 OLT。
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

### GET `/api/admin/projects`

读取本地项目列表，可按项目名称、地址、联系人或 VLAN 搜索。

查询参数：

- `q` 或 `search`：可选搜索关键字。

响应：

- `rows`：项目数组。

项目字段：

- `id`：项目 ID。
- `name`：项目名称，全局唯一，大小写不敏感。
- `vlan`：项目 VLAN，`1-4094` 范围内的单个 VLAN。
- `address`：项目地址，可为空。
- `contactName`：联系人姓名，可为空。
- `contactPhone`：联系人电话，可为空。
- `contactNote`：联系人备注，可为空。
- `createdAt`：创建时间。
- `updatedAt`：更新时间。

### POST `/api/admin/projects`

新建本地项目。

请求体：

- `name`：必填，项目名称，全局唯一，大小写不敏感。
- `vlan`：必填，项目 VLAN，必须为 `1-4094` 范围内的单个 VLAN。
- `address`：可选，项目地址。
- `contactName`：可选，联系人姓名。
- `contactPhone`：可选，联系人电话。
- `contactNote`：可选，联系人备注。

响应：

- `ok`
- `project`

错误：

- 项目名称为空、重复或 VLAN 无效时返回 `400`。

安全要求：

- 只写本地 SQLite。
- 不绑定 OLT。
- 不连接 OLT。
- 不执行 SNMP、Telnet 或任何设备命令。

### PUT `/api/admin/projects/:id`

编辑本地项目资料。修改项目 VLAN 只影响以后生成的新配置方案，不回写历史方案。

请求体同 `POST /api/admin/projects`。

响应：

- `ok`
- `project`

错误：

- 项目不存在时返回 `404`。
- 项目名称为空、重复或 VLAN 无效时返回 `400`。

安全要求：

- 只写本地 SQLite。
- 不连接 OLT。
- 不执行 SNMP、Telnet 或任何设备命令。

### DELETE `/api/admin/projects/:id`

删除本地项目。

响应：

- `ok`

错误：

- 项目不存在时返回 `404`。

安全要求：

- 只删除本地项目和本地项目-ONU 关联。
- 不删除本地 ONU 台账。
- 不删除 OLT 实机 ONU。
- 不执行 SNMP 写入、Telnet 配置命令、ONU 删除、重启或保存配置。

### POST `/api/admin/projects/:id/onus`

把 `ONU 数据查询` 中的已注册 ONU 加入本地项目。

请求体：

- `oltId`：必填，OLT 逻辑 ID。
- `chassis`：必填，槽。
- `board` 或 `slot`：必填，板卡。
- `pon`：必填，PON 口。
- `onuId`：必填，ONU/ONT ID。
- `serial`：可选，加入项目时保存的序列号快照。
- `address`：可选，加入项目时保存的地址快照。
- `vlan`：可选，加入项目时保存的 VLAN 快照。
- `note`：可选，项目 ONU 备注。

响应：

- `ok`
- `onu`：本地项目 ONU 关联。

错误：

- 项目不存在时返回 `404`。
- 缺少 `oltId + chassis + board + pon + onuId` 任一唯一身份字段时返回 `400`。
- 同一个 ONU 已属于其它项目时返回 `400`，提示先从原项目移除后再添加，不自动转移。

安全要求：

- 只写本地 SQLite 项目-ONU 关联。
- 不删除本地 ONU 台账。
- 不删除 OLT 实机 ONU。
- 不执行 SNMP 写入、Telnet 配置命令、ONU 删除、重启或保存配置。

### GET `/api/admin/projects/:id/onus`

读取项目详情中的本地项目 ONU 列表，并尽量通过现有 ONU 查询逻辑刷新当前状态。

响应：

- `ok`
- `rows`：项目 ONU 数组。

项目 ONU 字段：

- `id`：本地项目 ONU 关联 ID。
- `oltId`、`oltName`、`oltHost`：关联 OLT 信息。
- `chassis`、`board`、`slot`、`pon`、`onuId`：`槽/板卡/PON/ID` 坐标。
- `serial`：刷新成功时为当前 SN；刷新失败时保留加入项目时的 SN 快照。
- `phase`：当前在线状态；刷新失败时为空。
- `rxPower`：当前光功率；刷新失败时为空。
- `distance`：当前距离；刷新失败时为空。
- `address`：刷新成功时优先使用当前 ONU 查询匹配地址；刷新失败时保留加入项目时的地址快照。
- `vlan`：加入项目时保存的 VLAN 快照。
- `note`：项目 ONU 备注。
- `createdAt`、`updatedAt`：本地关联时间。
- `refreshError`：刷新失败或未读取到当前状态时的提示；刷新成功时为空字符串。

安全要求：

- 状态刷新只使用现有只读 ONU 查询能力。
- 刷新失败不得丢弃本地快照。
- 不删除本地 ONU 台账。
- 不删除 OLT 实机 ONU。
- 不执行 SNMP 写入、Telnet 配置命令、ONU 删除、重启或保存配置。

### PUT `/api/admin/projects/:id/onus/:onuAssociationId`

编辑项目 ONU 备注。

请求体：

- `note`：项目 ONU 备注，可为空。

响应：

- `ok`
- `onu`：更新后的本地项目 ONU 关联。

错误：

- 项目 ONU 关联不存在时返回 `404`。

安全要求：

- 只更新本地 SQLite `project_onus.note`。
- 不连接 OLT。
- 不执行 SNMP、Telnet 或任何设备命令。

### DELETE `/api/admin/projects/:id/onus/:onuAssociationId`

从项目详情中移除项目 ONU。

响应：

- `ok`

错误：

- 项目 ONU 关联不存在时返回 `404`。

安全要求：

- 只删除本地项目-ONU 关联。
- 不删除本地 ONU 台账。
- 不删除 OLT 实机 ONU。
- 不执行 SNMP 写入、Telnet 配置命令、ONU 删除、重启或保存配置。

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

请求体：

- `oltIp`：可选；指定后只刷新该 OLT 的本地 PON 台账。该 SNMP 运行态接口不再由前端“ONU 数据管理”的按钮调用；该按钮改用资源管理 `POST /api/admin/resource-management/sync-vlans`。
- `ponPort`：可选；指定后只刷新该 OLT 下某一个 `槽/板卡/PON`。

响应：

- `ok`
- `count`
- `results`
- `ponPorts`

ZTE 外层 VLAN 解析规则：

- 只读读取 `zteVlanIfConfVlan` 表。
- 同一 PON 口可能返回单个 VLAN，也可能返回逗号分隔 VLAN 列表。
- 解析时展开列表中的全部 VLAN 候选，优先选择 `1000-1999` 范围内出现次数最多的 VLAN；若没有该范围候选，再从大于等于 `1000` 的候选中选择出现次数最多的值。
- 没有实际业务条目的空 PON 可能返回 `No Such Instance`；这表示运行态 MIB 中没有可读取的 VLAN 实例，不表示人工规划台账中一定没有外层 VLAN。
- 未取得直接值时，只允许使用同一 PON 分组中至少重复两次的候选值做保守推断；不得按端口编号规律猜测 VLAN。
- 直接读取和保守推断都没有结果时跳过该 PON，不用空值覆盖本地已经人工填写的外层 VLAN。

### 用户资源管理 API

- `GET/PUT /api/admin/resource-management/config`：读取或保存本机资源服务器地址和用户名；读取响应不包含密码，保存后清除运行时会话。
- `POST /api/admin/resource-management/login`、`POST /api/admin/resource-management/logout`：建立或清除仅存于 Node 进程内存的 NMSE 会话。
- `GET /api/admin/resource-management/users?oltId=&q=`、`POST /api/admin/resource-management/sync-users`：查询或完整同步当前 OLT 用户快照。`oltId` 省略且提供 `q` 时，查询全部本机用户快照；同步仍只针对当前选择 OLT。NMSE ONU 接口固定按 `pageSize=20` 请求；第 1 页使用 120 秒超时并最多重试 2 次以确定总量，剩余页使用最多 8 个独立只读会话并发读取，每页保留 45 秒超时和 1 次临时失败重试；同步仅在全部分页读取成功后替换旧快照。
- `GET /api/admin/resource-management/sync-users/progress?oltId=`：返回当前用户同步的已读取条数、总条数、页数、并发路数与运行状态；不返回用户明细。
- `POST /api/admin/resource-management/sync-users/checkpoint`：仅用于本地调试检查点，按请求的有限页数读取并原子替换该 OLT 的本地检查点数据；不替换正式用户快照。

### 本机数据备份 API

- `GET /api/admin/backup`：下载完整本机项目 SQLite 备份；文件可能包含本机凭据，调用方必须保存到可信位置。
- `POST /api/admin/restore`：上传完整 SQLite 备份并还原本机项目数据。服务先校验完整性和核心表，再替换本机数据库；不连接、不写入 OLT。
- `GET /api/admin/resource-management/vlans?oltId=`、`POST /api/admin/resource-management/sync-vlans`：查询或同步 NMSE VLAN 快照；解析 `ponText.slot<board>[0]["<pon>"]`，并更新匹配本地 PON 的 SVLAN 外层 VLAN。

安全要求：后端仅调用固定 NMSE 登录、OLT 发现、ONU、SVLAN、CVLAN 路径；不支持任意 URL 代理或远端写入。更多已确认但尚未接入的 NMSE 内部接口记录在 `EXPERIMENTS.md`，不得据此开放任意路径。密码、token、Cookie、完整用户响应不得写入 API 响应或审计日志。
登录、会话初始化与后续分页请求在 45 秒后取消并返回明确超时错误；用户第一页使用 120 秒超时与 2 次临时失败重试。任一最终失败都不替换旧快照。

## API 演进规则

- 新增接口前先写清楚用途、输入、输出和失败行为。
- 涉及设备命令时必须说明只读证明。
- 涉及敏感数据时必须说明脱敏和不落库策略。
- 前端依赖的字段变更要同步更新 `src/main.js` 和本文件。
