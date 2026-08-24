# API Design

后端入口为 `src/server.mjs`，默认监听 `http://127.0.0.1:8787`。API 返回 JSON；本地管理 API 由 Bearer 会话保护，首次运行需设置本地密码，免登录调试仅允许回环监听。

面向大模型的 CLI 入口为 `src/cli.mjs`。CLI 只通过白名单工具映射调用本文已有接口，不新增任意设备命令接口；完整命令和工具清单见 `docs/design/cli.md`。

## 外部 OSS 资源发现与历史光功率（首个只读切片已接入）

获取分公司 OLT 列表的内部 OSS/NGB 页面使用 DWR，而不是已确认的公开 REST API。现场验证观察到更多页面初始化调用，但当前运行时只开放 `TreePanelAction.loadData`、`GridViewAction.getGridPageInfo` 和 `GridViewAction.getGridData` 三项固定只读 method，覆盖组织树、OLT 列表、ONU 精确定位和 ONU 历史光功率。完整参数结构、字段白名单和脱敏要求见 [`docs/design/oss-resource-api.md`](oss-resource-api.md)，架构决定见 ADR-011。

该上游响应会携带设备访问凭据等不应进入 OLT Manager 数据模型的字段，因此未来接入只能使用固定 DWR 白名单和字段级投影，不得提供任意 DWR 代理，也不得保存原始响应。

OLT Manager 本地 API 只暴露配置、登录/退出和精确 ONU 历史光功率读取，不暴露任意 DWR method、页面或参数。`resource_olt_ip_mappings` 仍只负责本机一一映射；运行时 OLT/ONU CUID、Cookie、token 和原始响应不进入本地 API 或 SQLite。

## Feishu 内部只读数据服务

Feishu 子系统在 Electron 主进程内直接调用 `src/feishu/gateway-contract.mjs` 投影后的 `OltDataGateway`，不再通过独立 HTTP 路由、端口或 bearer token 访问。合同仍提供 OLT 清单、按全部已启用 OLT 过滤的用户/PON 查询、唯一用户实时状态、精确 ONU/PON 实时状态和已验证的 ONU 详情；用户/PON 查询最多投影 100 条候选，由 Feishu 应用卡片按每页 5 条分页展示，所有查询保持只读、范围过滤和有界投影。

唯一用户查询的实时读取按以下顺序处理：优先读取已验证的 ONU 详细状态；详细接口失败时尝试通用实时状态；如果 OLT 当前没有返回该候选坐标（例如本地用户快照仍有记录，但实机 ONU 已删除或更换），则返回用户快照资料并在卡片中明确标注实时数据未返回。该降级只展示已有本地投影和“未知”实时字段，不猜测设备状态，也不触发任何设备写操作。

Feishu 应用层只接受单聊事件；群聊事件在语言解析前拒绝。单聊不需要 Operator、OLT Scope、Authorized Chat 或访问申请记录。旧状态迁移入口已移除，当前桌面端不读取旧 Feishu ONU Query 的 `local-administration.json`。

该内部服务不提供用户全量列表、同步触发、数据库下载、设备/NMSE 凭据、配置方案、项目或审计数据，也不对外暴露 `/api/gateway/v1/*`。

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

- `loid`、`username`、`userPhone`、`installationAddress`：按当前 OLT IP 和 ONU 索引匹配用户资源管理本地快照得到的 LOID、姓名、电话、装机地址；未匹配时为空字符串。
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

- ZTE ONU ID 使用同 PON 已注册 ONU ID 最大值 + 1；Huawei 扫描同 PON 已占用 ID，优先选择第一个空闲 ID，没有空位时使用最大 ID + 1。
- ZTE 不复用 ONU ID 空洞；Huawei 优先复用扫描到的空闲 ONT ID。
- 当同 PON 最大 ONU ID 达到 `128` 时返回 `blocked=true`。
- 配置方案按 OLT `deviceProfile` 判断模板适用性；未支持的设备型号，例如当前 `zte-c600`，返回阻止提示，不生成命令预览。
- 未注册 ONU 自身没有 service-port，MDU+OTT 动态 VLAN 必须来自同 PON 已配置样板 ONU 或台账。
- ZTE 和 Huawei 自定义 VLAN 模板复用各自内部网络命令结构，业务 VLAN 来自请求体 `customVlan`，不从设备自动读取。
- 项目模板 `templateId` 格式为 `project:<projectId>:zte` 或 `project:<projectId>:huawei`，复用对应厂商自定义 VLAN/内部网络命令结构，业务 VLAN 来自本地项目 `vlan`，不要求提交 `customVlan`。
- 项目模板响应会返回项目名称、项目 VLAN 和项目 ID；接口仍只返回命令预览，不登录、不粘贴、不执行、不保存到 OLT。
- Huawei 自营上网模板会把 `ZTEG-030C0914` 这类可读 SN 转换成 `5A544547030C0914` 这类原始十六进制 `sn-auth`。
- Huawei 的 `ont port native-vlan` 和 `service-port` 统一使用扫描得到的空闲候选 ONT ID，避免前后命令分别使用空位 ID 和最大 ID + 1。
- 坐标模型统一为 `槽/板卡/PON/ID`；ZTE 命令使用 `gpon-onu_<槽>/<板卡>/<PON>:<ONU ID>`，Huawei 板槽端口如 `0/1/0:1` 表示 `0` 槽、`1` 板卡、`0` PON、`1` ONT ID。
- Huawei 已注册 ONT 序列号来自只读 SNMP `1.3.6.1.4.1.2011.6.128.1.1.2.46.1.30.<PON ifIndex>.<ONT ID>`，页面展示原始 16 位十六进制 SN。
- Huawei 自营上网、内部网络和自定义 VLAN 模板接受 `ethPorts`，只允许 `eth1` 到 `eth4`；自营上网默认 `eth1`，允许清空选择并跳过 `ont port native-vlan`，内部网络和自定义 VLAN 默认全选且仍要求至少一个有效端口。
- Huawei 内部网络模板固定 VLAN `100`，Huawei 自定义 VLAN 使用请求体 `customVlan`，为所选端口生成 `ont port native-vlan ... priority 0`，并生成对应 `service-port vlan ... tag-transform translate`。
- 接口不登录 OLT、不进入配置模式、不执行、不保存。

### POST `/api/open-terminal-login`

兼容接口。桌面版默认通过 Electron IPC 打开内置 Telnet 终端；该 HTTP 接口保留给旧 macOS Terminal 登录辅助或非桌面环境的兼容提示。

Electron IPC：

- `terminal:create`：主进程读取当前 OLT Telnet 凭据，创建内置 Telnet 会话并按厂商登录；ZTE 进入配置模式，Huawei 停在用户视图，调用入口包括首页快捷入口和配置方案弹窗。
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
- Huawei 登录后只发送 `enable`，停在用户视图；配置方案中的 `config` 由用户人工粘贴确认。
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

返回的 `onu` 对象同时包含按当前 OLT IP 和 ONU 索引匹配的 `loid`、`username`、`userPhone`、`installationAddress`、`mac`、`userSyncedAt`；未匹配时为空字符串。

详情响应还包含 `history`：本机只读采样得到的光功率趋势、采样数量、离线次数和最近离线原因。历史从首次采样后开始累积，不会用当前值伪造历史。

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

#### 网管二期历史光功率

- `GET /api/admin/oss-resource/config`：读取 OSS 认证基地址、NGB 基地址、用户名、组织名称、机房名称、是否存在已保存的加密登录密文、本机是否支持系统加密存储、本机是否存在自动登录密文和当前内存会话状态；不返回密码、迁移主密码、密文、Cookie、token 或内部 CUID。
- `PUT /api/admin/oss-resource/config`：保存上述非敏感配置并清除旧会话。基地址必须是无路径、无查询参数、无内嵌凭据的 HTTP(S) origin；请求中即使带有额外 `password` 字段也不会保存。
- `POST /api/admin/oss-resource/login`：请求体接受可选的本次登录 `password`、`migrationMasterPassword`、`rememberPassword` 和 `autoLogin`。桌面版勾选 `rememberPassword` 时，密码使用 Electron `safeStorage` 写入本机加密凭据文件；后续 `autoLogin` 可直接解锁，不要求再次输入迁移主密码。未启用系统加密存储时仍要求迁移主密码，并使用 `scrypt` 派生密钥和 AES-256-GCM 加密写入 SQLite。迁移主密码永不保存；自动登录凭据不进入 SQLite/项目备份。响应只返回投影后的 OLT 数量及 `olts`（仅含 `resourceIp`、`roomName`）和 `credentialConfigured`；密码、MD5 值、迁移主密码、密文、token、Cookie 和内部 CUID 不进入响应或审计。登录跳转必须保持在原认证服务器同源范围内。
- `POST /api/admin/oss-resource/logout`：立即丢弃当前 OSS/NGB 内存会话。
- `POST /api/onus/historical-optical`：请求体为 `{ oltId, chassis, board, pon, onuId, startDate, endDate }`。后端先由 `oltId` 解析本机 OLT，再用 `resource_olt_ip_mappings` 找到支撑网 IP；没有当前网管二期会话时，使用本机系统加密的自动登录凭据按需建立只读会话，然后在 ONU 列表中按完整坐标精确匹配 ONU CUID 并读取历史记录。

历史光功率成功响应仅包含本机 OLT identity、请求坐标、日期范围以及 `reportTime`、`rxOptical`、`txOptical`、`oltRxOptical`、`lightDecay` 五个历史字段。按需建立的历史查询会话自成功登录起最多保留 10 分钟，随后自动丢弃本地会话和 Cookie 引用；应用关闭、配置变更、显式退出或会话失效也会清理。无法自动解锁凭据时返回登录/凭据错误；本地 IP 映射、会话 OLT 或精确 ONU 坐标不存在返回 `404`。该接口只查询已有历史记录，不触发任何光功率刷新、ONU/PON 采集、SNMP 写入或设备命令。

Feishu 进程内 `OltDataGateway` 为该能力提供独立的 `readOnuHistoricalOptical` 只读 seam。宿主通过短租约会话按需自动登录，再调用固定只读 `readHistoricalOptical`；适配器只接收已授权 `oltId`、完整 ONU 坐标和 `YYYY-MM-DD` 日期范围，并且只能返回上述五个投影字段。日期格式、真实日历日期、坐标、OLT 范围和最多 48 条记录均受约束；未配置本机自动登录凭据、登录失败或会话失效时安全失败并可回退已有本地历史，不回退到任意远端路径、不刷新设备，也不允许转发 DWR 原始响应。当前本地 gateway 仍保留 `readOnuHistory` 作为兼容能力；生产 Feishu 卡片优先展示网管二期实时历史记录。

- `GET/PUT /api/admin/resource-management/config`：读取或保存本机资源服务器地址和用户名；读取响应不包含密码，保存后清除运行时会话。
- `POST /api/admin/resource-management/login`、`POST /api/admin/resource-management/logout`：建立或清除仅存于 Node 进程内存的 NMSE 会话。
- `GET /api/admin/resource-management/users?oltId=&q=`、`POST /api/admin/resource-management/sync-users`：查询或兼容旧任务的当前 OLT 用户快照；当前合并 ONU 管理界面不再调用单 OLT 同步，源数据应使用 `/api/admin/merged-onu/sync/network`、`/api/admin/merged-onu/sync/nmse`，再通过 `/api/admin/merged-onu/merge` 生成最终数据集。`oltId` 省略且提供 `q` 时，查询全部本机用户快照；兼容同步仍只针对当前选择 OLT。NMSE ONU 接口使用现场兼容的 `pageSize=20`，第 1 页使用 120 秒超时并最多重试 2 次以确定总量，剩余页使用最多 8 个独立只读会话并发读取，每页保留 45 秒超时和 1 次临时失败重试；同步仅在全部分页读取成功后替换旧快照。写入快照前统一清洗装机地址：去除末尾 `#`；当编号片区后重复拼接了前段地址的行政区后缀时，删除污染的前缀和中间片区/小区标签；同名道路后紧接同名村时压缩前一段道路名，并保留第二段实际地址以及镇、街道等有效行政区。
- `GET /api/admin/resource-management/sync-users/progress?oltId=`：返回当前用户同步的已读取条数、总条数、页数、并发路数与运行状态；不返回用户明细。
- `POST /api/admin/resource-management/sync-users/checkpoint`：仅用于本地调试检查点，按请求的有限页数读取并原子替换该 OLT 的本地检查点数据；不替换正式用户快照。
- `POST /api/admin/resource-management/clean-addresses`：按当前规则重新清洗已保存的正式用户快照和调试检查点地址，并返回变更条数；不连接 NMSE-PON 或 OLT。
- `GET /api/admin/resource-sync-tasks`：读取本机同步任务列表，返回 `operation`（`network` 网管二期同步、`nmse` NMSE-PON同步、`merge` 手动合并、`full` 全量同步）、执行日期、重复周期和结果；不返回 NMSE 密码、token 或 Cookie。旧记录仍保留 `oltId` 字段用于数据库兼容，但新任务不再使用它。
- `POST /api/admin/resource-sync-tasks`：提交 `{ operation, runAt, repeatDays }`，其中 `operation` 必须是 `network`、`nmse`、`merge` 或 `full`，不接受 `oltId`；`runAt` 必须是未来时间，`repeatDays` 为 `0` 表示仅执行一次，`1-365` 表示每隔指定天数重复。任务到点后由 Node 进程按操作复用现有合并 ONU 只读流程：网管二期源快照、NMSE-PON 源快照、本地手动合并或全量同步，完成或失败后自动安排下一次重复执行。
- `DELETE /api/admin/resource-sync-tasks/:id`：取消尚未执行的本地任务；已执行、已完成或失败的任务保留结果记录。
- `DELETE /api/admin/resource-sync-tasks/:id/delete`：永久删除本地任务记录；正在执行的任务禁止删除，已写入的用户快照不受影响。

#### 统一合并 ONU 数据同步

- `GET /api/admin/merged-onu/status`（`/api/admin/merged-onu/dataset` 兼容别名）：返回统一数据集状态及 `sources.network`、`sources.nmse` 两套源快照状态（同步标记、opaque revision、数量、更新时间），以及当前同步进度；不返回 CUID、FDN、Cookie、token、密码或原始远端响应。
- `GET /api/admin/merged-onu/snapshots?oltId=&q=`：读取本地合并 ONU 快照；支持按 OLT 和关键词筛选，返回网管二期设备号、坐标、LOID、用户名、电话、装机地址及其它网管二期主字段，不访问远端。用户资源管理界面不展示重复的设备名称列。
- `GET /api/admin/merged-onu/sync/progress`：返回 `idle`、`running`、`success` 或 `failed` 状态、`operation`（`full`/`network`/`nmse`/`merge`）、当前阶段、OLT/网络 ONU/NMSE 用户/合并/冲突计数、脱敏错误摘要，以及不含敏感会话材料的可恢复任务 lease/checkpoint 投影。
- `POST /api/admin/merged-onu/sync/network`：只读取网管二期全量 ONU，备份后替换本地网管二期源快照；只需网管二期会话。可选请求体字段 `idempotencyKey` 用于跨进程幂等。
- `POST /api/admin/merged-onu/sync/nmse`：读取并保存 NMSE-PON 全量用户资料到本地用户快照，完成地址清洗后再提取 OLT、ONU 索引、LOID 和姓名替换本地 NMSE-PON 合并源快照；只需资源管理系统会话。可选 `idempotencyKey` 用于跨进程幂等。
- `POST /api/admin/merged-onu/merge`：备份后只读取两套本地源快照，按网管二期坐标和 LOID 执行手动合并；不访问远端，需两套源快照均已同步。可选 `idempotencyKey` 用于跨进程幂等。
- `POST /api/admin/merged-onu/sync`：只支持全量同步，请求体可为空对象或只包含 `idempotencyKey`；显式提交 `oltId` 会返回 `400`，避免全表替换语义误删其它 OLT。后端严格按“完整 SQLite 备份 → 网管二期全量 ONU → NMSE-PON 全量用户姓名 → 纯函数合并 → 统一表事务替换”执行。有效 lease 期间拒绝第二个 worker；进程重启后仅允许在阶段边界恢复或人工重试，不静默重放远端分页。
- `GET /api/admin/merged-onu/runs`、`GET /api/admin/merged-onu/conflicts?runId=`：读取带 operation 的同步运行统计和冲突原因；备份路径只返回文件名，冲突保留网管二期主行，不猜测姓名。

同步以网管二期的 OLT、槽/板卡/PON/ONU ID 和其它主字段为准；NMSE-PON 通过 LOID 补充用户名，电话和装机地址在 NMSE 有非空值时优先采用。NMSE 无匹配记录或字段为空时保留网管二期已有联系人字段。LOID 唯一匹配支持 OLT/坐标迁移，严格坐标回退只在 LOID 缺失时使用。独立同步失败不覆盖对应源快照，手动合并失败不覆盖旧 `merged_onu_snapshots` 和旧 revision。首次成功合并前，ONU API、Feishu Gateway 和桌面界面明确显示未同步，不回退旧 `resource_user_snapshots` 作为最终合并数据。

### 本机登录保护与数据备份 API

- `GET /api/auth/settings`：读取本机登录保护是否启用，默认启用。
- `POST /api/auth/settings`：切换本机登录保护。关闭仅允许回环监听的桌面/本机调试使用；非回环监听启动时始终强制要求登录。关闭前必须已有有效登录会话，重新开启后当前会话立即失效。

- `GET /api/admin/backup`：下载完整本机项目 SQLite 备份，包含 `oss_resource_config`、`oss_resource_credential`（仅为网管二期登录密码加密密文）和 `resource_olt_ip_mappings` 本地 IP 映射；不包含网管二期登录密码明文、迁移主密码、Cookie、token 或 CUID。文件可能包含其他本机凭据，调用方必须保存到可信位置。自动清理只提供默认 dry-run/显式确认的本地运行时基础；在便携密钥和恢复 UX 完成前，不把未加密 SQLite 备份标记为可自动删除对象。
- `POST /api/admin/backup/encrypted`：请求体严格为 `{ password }`，且只接受 `application/json`；服务端在内存中把完整 SQLite 快照封装为版本化 AES-256-GCM/scrypt 容器，返回 `application/vnd.olt-manager.encrypted-backup` 二进制文件。主密码不进入响应、日志或 SQLite。
- `POST /api/admin/restore`：上传完整 SQLite 备份并还原本机项目数据。服务先校验完整性和核心表，再替换本机数据库；不连接、不写入 OLT。
- `POST /api/admin/restore-encrypted`：上传加密备份容器，Content-Type 必须为 `application/octet-stream` 或 `application/vnd.olt-manager.encrypted-backup`，主密码只从 `X-OLT-Manager-Backup-Password` 请求头传入。服务固定按“解密 → 完整性/核心表校验 → 原子恢复”执行，任一步失败都不替换旧库；错误不回显密码或容器内容。
- 桌面端“导入并还原”同时接受上述 WEB 导出的 `.sqlite` 和桌面端 `.oltbackup.json`：前者只替换桌面本机 SQLite，保留当前 Feishu 加密状态；后者按组合备份协议同时恢复 SQLite 与 Feishu 加密文件。两种格式均在覆盖前经过用户确认和本地完整性校验。
- `GET /api/admin/resource-management/vlans?oltId=`、`POST /api/admin/resource-management/sync-vlans`：查询或同步 NMSE VLAN 快照；解析 `ponText.slot<board>[0]["<pon>"]`，并更新匹配本地 PON 的 SVLAN 外层 VLAN。

安全要求：后端仅调用固定 NMSE 登录、OLT 发现、ONU、SVLAN、CVLAN 路径；不支持任意 URL 代理或远端写入。更多已确认但尚未接入的 NMSE 内部接口记录在 `EXPERIMENTS.md`，不得据此开放任意路径。密码、token、Cookie、完整用户响应不得写入 API 响应或审计日志。
登录、会话初始化与后续分页请求在 45 秒后取消并返回明确超时错误；用户第一页使用 120 秒超时与 2 次临时失败重试。任一最终失败都不替换旧快照。

## API 演进规则

- 新增接口前先写清楚用途、输入、输出和失败行为。
- 涉及设备命令时必须说明只读证明。
- 涉及敏感数据时必须说明脱敏和不落库策略。
- 前端依赖的字段变更要同步更新 `src/main.js` 和本文件。
