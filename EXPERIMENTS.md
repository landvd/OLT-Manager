# Experiments

本文件记录只读实验。任何会改变 OLT、ONU、业务 VLAN、配置或运行状态的操作都不允许写在这里执行。

## 实验规则

- 只允许 SNMP `get/walk`、设备 `show/display` 类读取命令。
- 不记录真实 community、账号、密码。
- 真实 IP 可用别名代替，例如 `zte-c300-site-a`。
- 每次实验必须写清楚目标、命令类型、预期、结果和结论。
- 结论进入代码前，需要转成测试样例或明确的解析规则。

## 2026-08-12 OSS/NGB 分公司 OLT 列表 DWR 只读验证

- 设备/系统别名：`oss-ngb-resource-system`
- 目标：验证能否通过 OSS 页面会话读取分公司 OLT 列表，为“获取用户信息系统二期”准备上游资源发现接口。
- 操作类型：浏览器登录、页面导航、DWR POST 读取；未调用设备配置写操作。
- 是否只读：是。

### 流程

1. OSS 统一登录建立浏览器会话。
2. 进入“配置管理 → 设备配置”。
3. 展开组织树并选择分公司组织范围。
4. 调用 OLT 列表分页接口，将只读分页上限调整为 100。
5. 在响应投影后按 `N_RELATED_ROOM_CUID` 筛选目标机房。

### 已确认调用

```text
POST /ngb/dwr/call/plaincall/TreePanelAction.loadData.dwr
POST /ngb/dwr/call/plaincall/GridViewAction.getGridPageInfo.dwr
POST /ngb/dwr/call/plaincall/GridViewAction.getGridData.dwr
```

`GridViewAction.getGridData` 使用 `res.logic.RES_DEV.OLT`、`XmlMvGridBO` 和组织范围过滤对象读取 OLT 列表；DWR 请求体的 `scriptSessionId`、批次号和会话字段均为临时值，不进入代码或文档样例。详细合同见 `docs/design/oss-resource-api.md`。

### 观察

- Ego 浏览器能够捕获真实 DWR 请求 URL、POST 方法、请求体和响应体；当前内置浏览器只能提供页面/控制台级观察，无法稳定读取请求正文。
- 厚街机房读取结果为 6 台 OLT：Huawei MA5800-X15 1 台、ZTE C600 1 台、ZTE C300v2 4 台。
- 同一列表响应可提供支撑网 IP、属地 IP、设备别名、厂商、型号、机房和 ONU 数量等字段。
- OSS 设备列表响应同时携带设备访问凭据、SNMP/Telnet 字段；本次只在内存中提取白名单字段，没有保存、打印或转发原始响应。

### 结论

- 可以稳定依赖：当前会话下的 DWR 只读调用可以获取组织范围内 OLT 资源列表，并通过机房字段筛选目标设备。
- 不能稳定依赖：这不是已确认的独立 REST API；组织 CUID、DWR 会话字段和分页批次均不能硬编码或脱离登录会话复用。
- 接入边界：当前适配器只允许固定的三个读取 method 和字段级投影；禁止任意 DWR 代理、原始响应落盘、凭据同步以及任何设备配置写操作。
- 现场 IP、完整设备别名、ONU 数量明细和内部运行数据不提交仓库，继续遵守项目敏感信息边界。

### 后续动作

- [x] 为 OSS 会话和 DWR 白名单新增只读适配器设计，不直接实现任意请求转发。
- [ ] 获取不同账号/分公司环境的脱敏响应样例，验证组织 CUID 和字段兼容性。
- [x] 增加响应字段白名单、凭据字段拒绝和 DWR 响应解析测试。

### 2026-08-13 OLT Manager 首个适配器切片

- 新增固定只读 DWR 适配器与本机 UI 登录流程；密码和 Cookie/token 仅存在当前进程内存。
- OLT 投影只保留支撑网 IP、CUID 和机房；ONU CUID 只用于同一调用链中的精确坐标关联；历史结果只返回时间、ONU 收发光功率、OLT 收光功率和光衰。
- 合成测试覆盖明文密码不出现在持久响应、method 白名单、共享 DWR 引用、精确 ONU 坐标和空光功率值。
- 本项是代码级合成验证；尚未在本轮使用真实账号进行 UI 现场验收，也未调用任何光功率刷新或 OLT 写操作。

## 2026-08-12 OSS/NGB 单台 OLT 的 ONU 列表 DWR 只读验证

- 设备/系统别名：`oss-zte-c300-site-a`
- 目标：验证能否从 OLT 详情页读取全部 ONU 信息，并确定后续只读适配器所需的接口合同。
- 操作类型：页面导航、详情树读取、DWR POST 分页读取；未点击删除、修改、复位、重启、认证、业务配置或采集刷新。
- 是否只读：是。

### 流程

1. 在设备配置列表中按支撑网 IP 精确查询目标 OLT。
2. 双击目标行进入 OLT 信息页。
3. 打开“详细参数 → ONU 管理 → ONU 列表”。
4. 捕获列表元数据、分页信息和数据请求。
5. 以 1000 条为上限分批读取全部页面，再以单次只读快照核对总数、标识和接口坐标唯一性。

### 已确认调用

```text
GET  /ngb/ResDevAction/config.do
POST /ngb/dwr/call/plaincall/TreePanelAction.loadData.dwr
POST /ngb/dwr/call/plaincall/GridViewAction.getGridMeta.dwr
POST /ngb/dwr/call/plaincall/GridViewAction.getGridPageInfo.dwr
POST /ngb/dwr/call/plaincall/GridViewAction.getGridData.dwr
```

ONU 列表数据请求使用 `OnuGridBO`、`BoGridExportBO` 和 `res.logic.pon.olt.grid.OnuList`，并以 `PREID = <olt-cuid>` 限定目标 OLT。完整脱敏合同和字段边界见 `docs/design/oss-resource-api.md`。

### 观察与结论

- 全量返回条数与页面显示总数一致；单次快照中的 ONU 标识及板卡/端口/ONU 坐标均唯一且非空。
- 页面数据会实时变化，分批读取时可能在页边界出现重复行；这不代表源对象重复。接入时必须按稳定标识去重，并记录读取时间和总数变化。
- 原始对象包含标识、状态、光功率、设备、用户关联等约 86 个字段，同时暴露 SNMP management community/trap host 等禁止字段。
- 本次没有落盘原始响应、用户姓名/电话/地址、宽带账号、会话材料或设备访问凭据；仓库只保留脱敏接口结构和安全结论。
- 后续实现只能提供固定页面和固定 method 的只读适配器，不能暴露任意 DWR 转发能力。

## 2026-08-12 OSS/NGB ONU 历史光功率 DWR 只读验证

- 设备/系统别名：`oss-zte-onu-site-a`
- 目标：验证在 ONU 列表选择单条记录后，“历史光功率”使用的只读页面和数据接口。
- 操作类型：选择列表记录、打开历史页面、DWR POST 查询；未调用单 ONU 光功率刷新、PON 口全量刷新或其他设备采集动作。
- 是否只读：是。

### 已确认调用

```text
GET  /ngb/core/cmp_ext/mt/MvQueryGridPanel.jsp
POST /ngb/dwr/call/plaincall/CmpTplDwrAction.getGridDict.dwr
POST /ngb/dwr/call/plaincall/GridViewAction.getGridMeta.dwr
POST /ngb/dwr/call/plaincall/AuthorityDwrAction.getFuncAuth.dwr
POST /ngb/dwr/call/plaincall/GridViewAction.getGridPageInfo.dwr
POST /ngb/dwr/call/plaincall/GridViewAction.getGridData.dwr
```

页面模板为 `res.logic.RES_DEV.ONU.OPTICAL_HIS`，查询对象为 `XmlMvGridBO`，固定使用 `ONU.CUID = <onu-cuid>` 和 `REPORT_TIME between <start>,<end>` 两个过滤条件。完整脱敏合同见 `docs/design/oss-resource-api.md`。

### 观察与结论

- 默认日期窗口按天返回历史记录，页面总数和 `getGridData` 返回条数一致。
- 响应同时包含 ONU 标识、LOID、SN/MAC、组织/FDN、采集日期、ONU 收发光功率、OLT 侧收光功率和 ONU-OLT 光衰。
- 普通诊断只允许保留日期与光功率/光衰；标识、LOID、SN/MAC、CUID 和组织字段必须在第一层投影时丢弃或进入受保护的本地关联域。
- “历史光功率”和两个刷新动作是不同的用户操作；只读适配器不得为了查询历史数据自动触发任何刷新或采集。
- 本次未在仓库保存目标 OLT IP、ONU 索引、用户信息、历史明细、会话字段或内部 CUID。

## 2026-08-12 网管二期与本地 OLT IP 映射验证

- 设备/系统别名：`oss-ngb-resource-mapping`
- 目标：确认支撑网 IP 与 OLT Manager 管理 IP 不能按相似网段直接推断，并验证本地一一映射、停用设备和数据库完整性边界。
- 操作类型：只读核对 OSS 列表；备份后写入本机 SQLite 台账和映射表；未连接或修改 OLT。
- 是否只读：对 OSS/NGB 和 OLT 是；对本机 SQLite 是受控台账写入。

### 观察与结论

- 支撑网 IP 和设备管理 IP 属于不同地址域，映射必须逐台人工确认或由未来受控适配器提供明确证据，不能根据尾号或网段猜测。
- 一台 C600 已在 OSS 中出现并经现场确认；另一台 C600 经现场确认存在，但当时尚未登记到 OSS。两类来源必须分别记录，不能都标记为自动发现。
- 两台缺少已验证 SNMP 配置的 C600 只作为停用 OLT 写入本地台账，凭据留空，没有触发连接；既有 PON 台账只关联到修正后的本地管理 IP。
- 发现并撤销了早先基于错误地址域写入的候选记录；修正前分别备份 Web 和桌面 SQLite，修正后两库 `integrity_check` 均为 `ok`。
- `resource_olt_ip_mappings` 已用测试覆盖 IPv4 校验、一一对应约束、目标 OLT 存在校验和替换读取；现场精确映射与备份路径只记录在本机 `DEVELOPMENT_STATE.md`。

### 接入边界

- 映射不会更改 `olts.host`，不会自动启用 OLT，不会补齐或复制 SNMP/Telnet 凭据。
- 尚未登记到 OSS 的现场设备可记录为人工确认来源，但不能伪装为 OSS 结果。
- 本实验不授权对 C600 执行 SNMP、Telnet、SSH 或配置命令；补齐 profile 和凭据后仍需单独只读验证。

## 2026-08-14 OSS/NGB 登录上下文修复实验

- 目标：验证登录跳转后的用户/权限上下文、URL 重写会话和 DWR 批次兼容是否能减少组织树及历史光功率读取的 `NullPointerException`。
- 操作类型：代码级合成测试和本地 Web 启动验证；未使用真实密码发起自动登录，未执行任何 OLT 写操作。
- 实验改动：在 `transfer.do` 后尝试固定的只读用户信息/权限接口；保留 OSS/NGB 会话 Cookie；复用设备配置页版本号；组织树对 batch 22 失败时以新 `scriptSessionId` 和 batch 0 进行一次兼容尝试；DWR 错误增加阶段、批次和查询词诊断。
- 安全边界：仍只允许固定只读 DWR method；密码、Cookie、token、CUID 和原始响应不写入 SQLite、日志或普通 API 响应。
- 验证：OSS 专项测试 5/5、全量测试 202/202、语法检查和 `git diff --check` 通过；Web 首页返回 HTTP 200。
- 真实验证：用户重新登录后仍返回 `TreePanelAction.loadData`、batch 0、`q=南区分公司` 的 HTTP 200 DWR `NullPointerException`；batch 22 → batch 0 兼容尝试均未解决。
- 结论：合成环境验证通过，但真实 OSS/NGB 登录上下文仍未建立或当前请求合同不匹配，不能标记为已修复；不再继续盲目增加批次或地址回退。

## 2026-08-14 真实成功会话基线与登录修复

- 目标：用一次实际可用的 OSS/NGB 页面会话确定端到端只读成功标准，并修复 OLT Manager 中与页面顺序不一致的登录实验逻辑。
- 操作类型：用户已登录的 OSS/NGB 页面只读导航；未输入或读取密码，未执行采集刷新、配置、删除、认证、重启或其他设备写操作。
- 真实基线：登录后依次进入“配置管理 → 东莞分公司 → 南区分公司 → 厚街机房”，打开 `olt-resource-site-a`、ONU 列表，选中一条 ONU 并打开历史光功率；默认日期区间成功返回 11 条历史记录。
- 观察：真实页面先加载空查询组织树根节点，再逐层展开节点；此前适配器在组织树前发送 `q=组织名称` 的合成请求，该请求在现场返回 HTTP 200 的 DWR `NullPointerException`。HTTP 200 不代表 DWR 业务成功。
- 修复：适配器从 `batchId=0` 开始自然递增，使用同一页面版本打开 NGB 框架和设备配置页，按节点逐层查找组织/机房；移除登录后的用户权限接口探测、uid/token 兼容请求头、OSS/NGB 多路径回退和 batch 22 → batch 0 重试。
- 安全边界：继续只允许固定只读 DWR method；密码、Cookie、token、CUID 和原始响应不写入 SQLite、日志或普通 API 响应。
- 验证：专项合成测试 5/5 通过，语法检查通过；真实 OSS 页面基线通过。OLT Manager 使用现场密码的端到端登录仍需由用户在本地 Web 页面执行后确认，当前不将生产问题标记为已完全解决。

## 2026-08-14 OSS/NGB 组织树根节点兼容修复

- 目标：处理登录后首个 `TreePanelAction.loadData` 返回 HTTP 200、DWR `NullPointerException` 的情况。
- 改动：保留原始根节点请求；仅在明确收到 `NullPointerException` 时，按两个固定的页面根节点形态继续尝试，成功后恢复正常逐层遍历。DWR POST 同时显式发送 UTF-8 内容长度，兼容旧 Java Web 容器的请求解析。
- 安全边界：兼容尝试只针对固定只读组织树 method，不增加任意 DWR 代理、不改变登录路径、不执行 OLT 写操作，也不记录密码、Cookie、token、CUID 或原始响应。
- 验证：OSS 专项测试 7/7，全量测试 206/206，`node --check src/oss-ngb-client.mjs` 和 `git diff --check` 通过。
- 结论：本地合成场景已验证兼容分支生效；仍需用户在现场 OSS/NGB 环境重新点击“保存并登录”确认生产端结果，不能仅凭合成测试宣称已完全修复。

## 2026-08-14 OSS/NGB DWR 会话初始化修复

- 观察：根节点三种参数形态均返回 `NullPointerException`，说明失败不再局限于 `q` 或根节点字段；此前 DWR 请求体的 `httpSessionId` 始终为空，且未先加载页面实际使用的 `engine.js`。
- 初步改动：登录后先读取固定的 `/ngb/dwr/engine.js`，从响应提取页面脚本会话种子，并尝试把当前 NGB `JSESSIONID` 填入 DWR `httpSessionId`。
- 后续现场对照：真实页面请求的 `httpSessionId` 为空，`JSESSIONID` 只通过 Cookie 发送；适配器已恢复相同语义，同时继续使用 `engine.js` 的脚本会话种子。Cookie、脚本会话和内部 CUID 仍只存在进程内存。
- 安全边界：仍只调用固定只读 DWR method，不增加权限探测、任意代理或设备写操作。
- 验证：OSS/NGB 登录合成测试覆盖 `engine.js` 会话种子、空 `httpSessionId` 与 Cookie 中的 `JSESSIONID`。
- 结论：会话字段已与真实 DWR 浏览器客户端一致；完整现场结果见下一项。

## 2026-08-14 OSS/NGB 组织树与 OLT 列表现场修复验证

- 目标：修复 OLT Manager 点击“保存并登录”后，组织树展开报 DWR 异常，以及继续读取目标机房 OLT 列表时返回 SQL 参数错误的问题。
- 操作类型：用户授权的一次性内存登录、真实页面只读请求合同对照、合成回归测试；未触发采集刷新、配置、删除、认证、重启或任何 OLT 写操作。
- 组织树证据：真实页面根节点请求只携带 `templateIds`；展开子节点时只回传 `cuid`、`text`、`leaf`、`parentTreeNode`、`checked`、`isRoot`、`boName`、`params`、`treeParams`、`treeName`、`system`、`queryParams` 十二个字段。旧实现把服务端返回的完整节点原样发送，导致请求体包含额外通用对象并触发旧 DWR 转换异常。
- OLT 列表证据：目标机房页面只在 `baseParams` 保存机房范围，固定房间过滤使用 `RELATED_ROOM_CUID`、别名 `T0`，并在 `queryParams.DOMAIN` 复用同一过滤对象；旧实现额外拼接组织 SQL 条件，真实上游返回 SQL 语法错误。
- 传输层证据：项目原生 HTTP 请求没有 `User-Agent` 时，旧 NGB 返回缺少正常标题与运行上下文的 4832 字节框架页，随后根节点 DWR 返回 `NullPointerException`；添加明确的 `OLT-Manager OSS read-only client` 标识后返回完整 14235 字节框架页，组织树和列表读取均成功。
- 修复：所有 OSS/NGB 原生 HTTP 请求携带明确的 OLT Manager 只读客户端标识；根节点按真实页面使用空查询合同；展开节点前做十二字段白名单投影；有明确机房时按页面合同构造列表过滤，无机房时保留既有组织范围分支。
- 安全边界：密码、Cookie、token、DWR 会话、内部 CUID、原始响应和现场设备明细均未写入仓库、SQLite 或日志；诊断只保留阶段、状态、长度、字段名和计数。
- 验证：专项测试 9/9 通过；真实独立登录成功，建立 NGB/DWR 会话，完成 8 次组织树读取和 2 次列表读取，目标机房投影返回 6 台 OLT。

## 2026-08-14 OSS/NGB“保存并登录”端到端闭环验收

- 触发：用户反馈本地页面点击“保存并登录”后仍显示 `TreePanelAction.loadData` 的 DWR 空指针。
- 授权与范围：用户明确授权使用一次性内存密码进行实际登录测试；只读组织树和 OLT 列表，不执行采集刷新、配置、删除、认证、重启或任何 OLT 写操作。
- 页面结果：真实本地 Web 页面提示“网管二期登录成功，发现 6 台已投影 OLT”，并显示“已发现 6 台目标机房 OLT”。
- 状态结果：本地 OSS 配置接口确认 `loggedIn=true`，密码输入框已清空；密码、Cookie、token、DWR 会话、内部 CUID 和原始响应均未落盘或写入日志。
- 验证结果：OSS 专项测试 9/9、全量测试 206/206、构建和 `git diff --check` 均通过。
- 结论：此前的生产问题已完成真实页面闭环修复；后续若出现失败，应优先重新采集页面合同并区分框架初始化、DWR 会话、组织树、机房列表和会话失效阶段，不应只根据 HTTP 状态码判断成功。

## 2026-07-29 Feishu PON 地址联调

- 目标：验证飞书单聊查询能够在全部已启用 OLT 内定位 PON 台账，并读取整口状态。
- 操作类型：本机 Gateway HTTP 读取与既有 SNMP 只读采集。
- 是否只读：是。

### 观察

- 飞书查询词可能带行政后缀 `村`，而 PON 台账备注使用区域名加道路/光交箱且省略该后缀。
- 原始包含匹配因此返回 0，但 OLT Manager 本地搜索能够显示相关台账项。
- 去掉末尾单个 `村` 后可以命中；更宽泛的模糊匹配会扩大结果，不应采用。
- 整口实时结果可按精确 `chassis/board/pon` 返回状态和光功率，并按同坐标合并快照姓名。

### 结论

- `queryPons` 采用直接包含优先、受限尾部 `村` 兼容，并继续在计数前执行已启用 OLT ID 过滤。
- 候选最多 10 项，整口最多 128 个 ONU；不返回电话、安装地址、LOID、MAC、凭据或设备命令。
- 已将该规则转为 `tests/olt-data-gateway.test.mjs` 合成测试；未在文档中记录现场地址、token 或凭据。

## 2026-08-02 ZTE ONU detail-info 的 SNMP 只读映射

- 目标：为 `gpon-onu_<chassis>/<board>/<pon>:<onuId>` 提供 CLI `show gpon onu detail-info` 的安全、只读 SNMP 子集。
- 操作类型：SNMP GET/WALK 与本机 Gateway HTTP 读取。
- 是否只读：是。

### 已确认进入 Gateway 合同的字段

- ONU 接口坐标、ONU 名称、Phase 状态、序列号、接收光功率、ONU 距离、最近上线时间。
- ZTE C300 当前使用既有 OID profile；整口 scoped walk 仍受 128 ONU 限制，精确坐标由 Gateway 再校验。

### 尚未进入合同的字段

- Type、Admin/Config state、认证模式、SN Bind、Profile/DBA、Online Duration、FEC 和完整 Authpass/OfflineTime/Cause 历史。
- 未取得同型号/同版本的 MIB/OID 合同前，不根据 CLI 字段名称猜测 OID；Gateway 以 `unsupportedFields` 明确返回这些字段。
- Huawei MA5800 当前 profile 的详情 OID 仍标记为需现场测试，因此 `readOnuDetail` 对 Huawei 失败关闭，避免把未经验证的值当作合同字段。

## 2026-07-23 NMSE-PON 用户与宽带 VLAN 只读接口验证

- 目标：验证 NMSE-PON 登录后可按 OLT `gridRank` 读取 ONU 用户信息、宽带 SVLAN 与 CVLAN。
- 操作类型：固定 HTTP 登录 / GET 读取
- 是否只读：是

### 观察

- SVLAN 使用 `getOltSvlanRelationList`，`ponText` 的端口必须按 `slot<board>[0]["<pon>"]` 字符串键读取。
- CVLAN 使用 `getOltCvlanRelation`，当前响应为 OLT 级范围，不应伪造为 PON 级字段。
- NMSE 配置数据与 SNMP ONU/service-port 运行态 VLAN 不同；空 PON 仍可在 NMSE 返回规划 SVLAN。
- ONU 用户分页的现场吞吐上限按 8 路独立只读会话控制：先读取第 1 页取得总量，后续页并发读取；任一页失败不写入正式快照。
- `olt-manager-site-a` 的 ONU 接口按 `pageSize=20` 实测单页约 27–28 秒；8 路读取 8 页（160 条）约 28 秒成功。不得把每页数量提高到 100，否则首分页可能超时。
- 当前 OLT 的完整同步已成功保存 3,511 条用户快照，共 176 页；本地刷新后从 SQLite 快照读取，不重新拉取 NMSE 用户数据。
- 用户快照按 `机框/板卡/PON:ONU ID` 数值排序；例如 `:9` 必须排在 `:58` 前，而不是使用字典序。

### 已确认 NMSE-PON 内部只读接口

| 用途 | 方法 | 路径 | 关键参数 | 当前处理 |
| --- | --- | --- | --- | --- |
| 登录 | POST | `/proxy/api/login` | `loginname`、`password`、`client`、`state` | 已接入 |
| 当前账号根网格 | GET | `/grid/getGridNode` | `loginname`、`accessToken`、`userId`、`userType` | 已接入 |
| 子网格树 | GET | `/grid/getGridList` | `pid` | 已确认，未接入 |
| 网格详情 | GET | `/grid/getGridInfo` | `id` | 已确认，未接入 |
| 网格类型 | GET | `/grid/getGridTypeList` | 无 | 已确认，未接入 |
| OLT 列表与 IP/gridRank | GET | `/resource/getOltList` | `gridRank`、`page`、`pageSize`、`queryStr` | 已接入 |
| ONU 用户数据分页 | GET | `/onu/getOnuListByGridRank` | `gridRank`、`page`、`pageSize`、`queryStr` | 已接入 |
| OLT/资源搜索 | GET | `/search/searchByQueryStr` | 搜索关键字 | 已确认，未接入 |
| 宽带 SVLAN/PON 配置 | GET | `/olt/getOltSvlanRelationList` | `gridRank`、`useType`、`classification` | 已接入 |
| 宽带 CVLAN 范围 | GET | `/olt/getOltCvlanRelation` | `gridRank`、`useType` | 已接入 |

接口确认不等于开放任意代理：客户端仍只允许已接入的固定白名单路径。后续扩展前需补充字段样例、权限与只读验证；不得把密码、accessToken 或 Cookie 写入文档、日志或示例。

### 结论

- 系统可通过固定白名单路径只读同步当前 OLT 用户快照和 VLAN 规划。
- 密码、token、Cookie 不进入日志、API 响应或可提交文件。

## 记录模板

````markdown
## YYYY-MM-DD 实验名称

- 设备别名：
- 设备型号：
- 软件版本：
- 目标：
- 操作类型：SNMP walk / SNMP get / fixed show
- 读取对象：
- 是否只读：是

### 输入

```text
这里放脱敏后的 OID、命令或样例输出。
```

### 观察

- 观察 1：
- 观察 2：

### 结论

- 可以稳定依赖：
- 仍需验证：
- 不进入代码的原因：

### 后续动作

- [ ] 补测试样例
- [ ] 更新 `docs/design/api.md`
- [ ] 更新 `docs/design/database.md`
- [ ] 更新 ADR

## 2026-08-02 ZTE ONU 最近离线时间/原因 OID 现场只读验证

- 设备别名：`zte-c300-site-a`
- 设备型号：ZTE C300 V2.1
- 目标：验证 `show gpon onu detail-info` 中最近一条离线记录能否由 SNMP 读取。
- 操作类型：SNMP GET（只读）
- 是否只读：是

### 输入

```text
last activation/online:  1.3.6.1.4.1.3902.1012.3.28.2.1.5.<encoded-pon>.<onu>
last shutdown/offline:   1.3.6.1.4.1.3902.1012.3.28.2.1.6.<encoded-pon>.<onu>
last shutdown/cause:     1.3.6.1.4.1.3902.1012.3.28.2.1.7.<encoded-pon>.<onu>
```

### 观察

- 三个 OID 均返回有效值；同一 PON/ONU 行的 `.6` 时间与 CLI 历史表最近一条 `OfflineTime` 一致。
- 历史现场对照曾观察到 CLI 最近原因 `DyingGasp` 对应 SNMP `.7` 整数 `9`；本次按运维人员提供的 GPON 离线代码表，将产品当前映射切换为：`1 Unknown`、`2 DyingGasp`、`3 LOS`、`4 LOF`、`8 Deactive`、`9 Reboot`、`10 PEE`。这份表是当前产品采用的操作员选定映射，并不宣称已完成厂商版本级验证。
- `.5/.6/.7` 是每个 ONU 的最近一次上线/离线摘要，不是 CLI 展示的完整 10 行历史表。

### 结论

- 可以稳定依赖：ZTE C300 的最近离线时间和最近离线原因码/标签可以通过 SNMP 只读读取。
- 仍需验证：该代码表在不同 ZTE 软件版本上的枚举差异；未列出的代码必须原样显示为 `unknown(code)`。
- 不进入代码的原因：完整历史表的公开 SNMP 表合同尚未确认，不能猜测另一个 MIB 分支。

### 后续动作

- [x] 将 `.6/.7` 接入 ZTE OLT Data Gateway 详情合同。
- [x] 在 Feishu 详情回复中展示最近离线时间和原因。
- [ ] 若需要完整历史，继续获取同版本官方 MIB 或评估本地只读快照历史。
````

## 已知候选实验

- ZTE MDU+OTT 配置方案 VLAN 自动识别已完成一轮脱敏验证，后续需要转成测试样例。
- Huawei MA5800 未注册 ONT SN 已完成 CLI 与 SNMP 对照验证；已注册 ONT SN OID 已完成 `0/1/0` 实机样例对照。
- Huawei MA5800 ONT 状态、光功率、距离 OID 验证。
- ZTE service-port VLAN 与 ONU 详情展示的一致性验证。
- ZTE `show running-config interface gpon-onu_*` 输出清洗和解析样例。
- ZTE 未注册 ONU SNMP 索引与 CLI `gpon-onu_<槽>/<板卡>/<PON>:<ID>` 对照验证。

## 2026-06-30 ZTE 外层 VLAN 列表值解析修正

- 设备别名：`zte-c300-site-b`
- 设备型号：ZTE C300
- 软件版本：未采集
- 目标：确认 PON 外层 VLAN 刷新时，SNMP 返回逗号分隔 VLAN 列表和单个业务 VLAN 混合时的取值规则。
- 操作类型：SNMP walk
- 读取对象：`1/2/13`、`1/2/14`、`1/2/15`
- 是否只读：是

### 输入

```text
OID:
1.3.6.1.4.1.3902.1082.40.50.2.1.4.1.7.<PON ifIndex>

1/2/15 样例值：
"5,8,90,1028,1052,3101,3124,3701"
"5,8,41,86,90,1028,1052,3101,3124,3701"
"86,1052,3124"
"3056"
"86,1052,3124"
"100"
"852"
"106"
```

### 观察

- `1/2/13` 和 `1/2/14` 返回多组单值，其中 `1051` 与 `3115` 多次出现，外层 VLAN 应取 `1000-1999` 范围的 `1051`。
- `1/2/15` 返回逗号分隔列表和单值混合；旧解析只接受纯数字，跳过列表后误选单值 `3056`。
- 对 `1/2/15` 解析列表内所有 VLAN 后，`1052` 在 `1000-1999` 范围内出现次数最多，优先级高于单次出现的 `3056`。

### 结论

- 可以稳定依赖：ZTE 外层 VLAN 候选值需要支持逗号分隔列表；优先选择 `1000-1999` 范围内出现次数最多的 VLAN。
- 仍需验证：其它 ZTE 软件版本是否也会返回逗号分隔列表。
- 不进入代码的原因：本轮已经进入代码并补充回归测试。

### 后续动作

- [x] 修正 ZTE 外层 VLAN 解析逻辑。
- [x] 增加 `tests/zte-vlan-parser.test.mjs` 样例测试。

## 2026-06-29 PON 坐标语义修正

- 设备别名：通用模型修正
- 设备型号：ZTE C300 / Huawei MA5800
- 目标：修正早期把槽和板卡混用的问题，统一 PON 台账和命令生成坐标。
- 操作类型：文档建模 / 本地样例测试
- 读取对象：脱敏 CLI 坐标样例
- 是否只读：是

### 输入

```text
ZTE: gpon-onu_1/9/16:3
Huawei: 0/1/0:1
```

### 观察

- ZTE `gpon-onu_1/9/16:3` 中 `_1` 是槽，`9` 是板卡，`16` 是 PON，`3` 是 ONU ID。
- Huawei `0/1/0:1` 表示 `0` 槽、`1` 板卡、`0` PON、`1` ONT ID。
- 旧实现把 `slot` 当成板卡使用，且文档常写成“槽位/PON”，容易误导。

### 结论

- 可以稳定依赖：业务坐标统一为 `槽/板卡/PON/ID`；API 使用 `chassis/board/pon/onuId`，`slot` 仅作为 `board` 的兼容别名。
- 仍需验证：更多 Huawei ifName 样例是否都稳定返回 `GPON 槽/板卡/PON`。
- 不进入代码的原因：本轮已经进入代码和 ADR。

### 后续动作

- [x] 新增 ADR-007。
- [x] 数据库 `pon_ports` 增加 `chassis`、`board`、`pon`。
- [x] 配置方案和 Telnet 只读查询不再写死 ZTE `_1` 或 Huawei `0/`。

## 2026-06-16 ZTE MDU+OTT service-port VLAN 只读验证

- 设备别名：`zte-site-d`
- 设备型号：ZTE GPON OLT
- 软件版本：未采集
- 目标：验证已配置 MDU+OTT 样板 ONU 的内层 VLAN、外层 VLAN、互动 VLAN、直播 VLAN 和内网 VLAN 是否可通过 SNMP 只读读取。
- 操作类型：SNMP walk
- 读取对象：`gpon-onu_1/7/13:24`
- 是否只读：是

### 输入

```text
userVlan: 1.3.6.1.4.1.3902.1082.110.5.2.2.1.8
cVlan:    1.3.6.1.4.1.3902.1082.110.5.2.2.1.18
sVlan:    1.3.6.1.4.1.3902.1082.110.5.2.2.1.19

PON ifIndex: 285280013
vport indexes:
- vport1: 404226304
- vport2: 404226560
- vport3: 404226816
- vport4: 404227072
```

### 观察

- vport1 返回 `user-vlan=3609`、`cVlan=3609`、`sVlan=1065`，对应 MDU+OTT 内层 VLAN 和外层 VLAN。
- vport2 返回 `user-vlan=3176`、`cVlan=3176`、`sVlan=0`，对应互动 VLAN。
- vport3 返回 `user-vlan=86`、`cVlan=86`、`sVlan=0`，对应直播 VLAN。
- vport4 返回 `user-vlan=100`、`cVlan=100`、`sVlan=0`，对应内网 VLAN。

### 结论

- 可以稳定依赖：对已配置 ONU，可通过 ZTE service-port 表读取 MDU+OTT 所需 VLAN；带 `sVlan` 的 vport 可识别内层/外层 VLAN。
- 仍需验证：不同板卡、不同 PON、不同 MDU+OTT 模板下 vport 顺序是否完全一致；默认 VLAN `90` 在本测试 ONU 的四条 service-port 中未出现，但在同 PON 其他 ONU 可观察到。
- 不进入代码的原因：本轮只更新文档，后续实现前需要补可复现样例测试。

### 后续动作

- [ ] 补 MDU+OTT service-port VLAN 解析测试。
- [ ] 实现未注册 ONU 配置方案生成接口。
- [ ] 在页面展示 VLAN 来源和阻止生成原因。

## 2026-06-17 Huawei MA5800 未注册 ONT SN 只读验证

- 设备别名：`huawei-ma5800-site-a`
- 设备型号：Huawei MA5800
- 软件版本：Huawei Integrated Access Software
- 目标：确认 SNMP 未注册 ONT SN 表与 CLI `display ont autofind all` 中的 `Ont SN` 一致，并确认 Huawei `ont add ... sn-auth` 应使用原始十六进制 SN。
- 操作类型：SNMP walk / fixed display
- 读取对象：未注册 ONT 自动发现表
- 是否只读：是

### 输入

```text
CLI:
display ont autofind all

CLI 输出样例：
F/S/P  : 0/10/7
Ont SN : 5A544547030C0914 (ZTEG-030C0914)

SNMP OID:
1.3.6.1.4.1.2011.6.128.1.1.2.52.1.2

SNMP 输出样例：
Hex-STRING: 5A 54 45 47 03 0C 09 14
```

### 观察

- CLI `Ont SN` 左侧为原始十六进制 SN，右侧括号内为可读厂商码加尾号。
- SNMP `unconfiguredSerial` 表返回的 Hex-STRING 与 CLI 原始十六进制 SN 一致。
- Huawei `ont add ... sn-auth` 应使用左侧原始十六进制 SN，例如 `5A544547030C0914`。
- `display ont autofind all` 在 Huawei CLI 中会出现 `{ <cr>||<K> }:` 二次确认提示，必须再次回车后才输出结果。

### 结论

- 可以稳定依赖：未注册 ONT 的 SN 可通过 SNMP `unconfiguredSerial` 表读取并转换为 Huawei `sn-auth` 所需的原始十六进制格式。
- 仍需验证：更多板卡和 PON 下已注册 ONT SN OID 是否完全一致。
- 不进入代码的原因：已进入代码的范围只包括未注册 ONT 配置方案预览；已注册 ONT SN 仍显示 `N/A` 或待验证字段。

### 后续动作

- [x] Huawei 自营上网配置预览使用原始十六进制 SN 作为 `sn-auth`。
- [x] 为 Huawei 自营上网模板增加 Node 测试。
- [x] 继续验证已注册 ONT SN OID。

## 2026-06-29 Huawei MA5800 已注册 ONT SN 只读验证

- 设备别名：`huawei-ma5800-site-a`
- 设备型号：Huawei MA5800
- 软件版本：Huawei Integrated Access Software
- 目标：确认已注册 ONT 列表可通过 SNMP 读取原始 8 字节 SN，并在 ONU 数据查询页面展示。
- 操作类型：SNMP walk
- 读取对象：`0/1/0` PON 下已注册 ONT 表
- 是否只读：是

### 输入

```text
ifName:
1.3.6.1.2.1.31.1.1.1.1 -> GPON 0/1/0

候选 OID:
1.3.6.1.4.1.2011.6.128.1.1.2.46.1.30.<PON ifIndex>.<ONT ID>
```

### 观察

- `GPON 0/1/0` 的 ifIndex 为现场设备返回值。
- `1.3.6.1.4.1.2011.6.128.1.1.2.46.1.30` 返回 8 字节 Hex-STRING。
- 与实机列表中 `0/1/0:0`、`0/1/0:1`、`0/1/0:2` 等 ONT ID 的原始十六进制 SN 对照一致。

### 结论

- 可以稳定依赖：当前 Huawei MA5800 可用 `...2.46.1.30` 按 `PON ifIndex + ONT ID` 读取已注册 ONT 原始 SN。
- 仍需验证：其它 Huawei 软件版本、其它板卡/PON 是否一致。
- 不进入代码的原因：本轮已经进入代码，页面展示原始 16 位 Hex SN。

### 后续动作

- [x] `/api/onus` Huawei 分支展示已注册 ONT 原始 SN。
- [x] `/api/recent-onus` Huawei 分支同步使用同一 SN OID。
- [x] 增加 raw Hex SN 解码测试。

## 2026-06-19 ZTE 未注册 ONU 索引与地址匹配验证

- 设备别名：`zte-c300-site-a`
- 设备型号：ZTE C300
- 软件版本：未采集
- 目标：确认未注册 ONU SNMP 索引可还原为真实槽/板卡/PON，并用本地 PON 台账匹配地址。
- 操作类型：SNMP walk / fixed show 对照
- 读取对象：未注册 ONU 自动发现表和 CLI 中的 `gpon-onu_<槽>/<板卡>/<PON>:<ID>` 样例
- 是否只读：是

### 输入

```text
CLI 样例：
gpon-onu_1/2/10:1  SKWH5DAFFA1B
gpon-onu_1/3/2:1   SKWH0D2077F4
gpon-onu_1/4/16:1  SKWH47D9F046
gpon-onu_1/7/5:1   UMTCC602737A
gpon-onu_1/9/13:1  YHDZE2EACAE3
gpon-onu_1/9/16:3  UMTCFD391E41
gpon-onu_1/9/16:4  ZETGFE1B386E
```

### 观察

- 现场 CLI 显示的 PON 口并不是统一为 `1`，而是包含 `2/10`、`3/2`、`4/16`、`7/5`、`9/13`、`9/16` 等。
- 后端解析 ZTE 未注册 ONU 索引时，需要从编码值中取出板卡和 PON，并补齐 ZTE 槽 `1`。
- 页面地址列可按 `OLT IP + 槽/板卡/PON` 从 `pon_ports` 本地台账匹配。

### 结论

- 可以稳定依赖：已验证样例中，ZTE 未注册 ONU 索引可解析为真实板卡/PON，并补齐槽后与 CLI 样例一致。
- 仍需验证：更多 ZTE 软件版本和板卡下索引编码是否完全一致。
- 不进入代码的原因：本轮已经进入代码；后续需要补充可复现解析测试样例。

### 后续动作

- [x] 修正 ZTE 未注册 ONU PON 解析。
- [x] 未注册 ONU 列表增加地址列。
- [x] 为 ZTE 未注册 ONU 索引解析补单元测试。

## 2026-07-20 ZTE 空 PON 外层 VLAN 获取边界验证

- 设备别名：`zte-c300-site-a`
- 设备型号：ZTE C300
- 软件版本：V2.1.0
- 目标：确认同一板卡上部分 PON 可以读取外层 VLAN、相邻空 PON 无法读取的原因，并核对人工规划台账与设备运行数据的边界。
- 操作类型：SNMP walk
- 读取对象：同一板卡、同一 PON 分组中的若干相邻端口
- 是否只读：是

### 输入

```text
PON VLAN 表：
1.3.6.1.4.1.3902.1082.40.50.2.1.4.1.7.<PON ifIndex>

ZTE PON ifIndex：
0x11010000 + (board << 8) + pon
```

### 观察

- 有实际业务条目的 PON 会在 `zteVlanIfConfVlan` 下返回多行 VLAN 候选；解析器可以按既有规则选出重复出现的 `1000-1999` 范围外层 VLAN。
- 同一板卡上的相邻空 PON 对其完整 PON ifIndex 返回 `No Such Instance currently exists at this OID`，PON VLAN 表没有可解析候选。
- 对空 PON 继续读取 ZTE service-port 的 `userVlan`、`sVlan` 子树，也返回 `No Such Instance`；没有已配置 ONU/service-port 时，不能从运行态 SNMP 表取得规划外层 VLAN。
- 人工系统中仍可登记该 PON 的规划外层 VLAN；该值属于台账规划数据，不等于 OLT 当前运行态一定存在对应 MIB 实例。
- 同组其它 PON 的外层 VLAN 各不相同、没有某个值至少出现两次时，现有安全推断规则不会根据端口编号规律猜测空 PON 的 VLAN。

### 结论

- 可以稳定依赖：ZTE PON VLAN 表能读取已经存在实际业务条目的 PON 外层 VLAN。
- 不能稳定依赖：空 PON 的规划外层 VLAN 不能从当前已知 PON VLAN 或 service-port SNMP 表读取，应由人工台账或可信规划系统提供。
- 刷新行为必须保守：设备返回 `No Such Instance` 时跳过该 PON，不得用空值覆盖已经人工填写的本地外层 VLAN。
- 不进入代码的原因：当前刷新实现已经只更新成功解析出的非空值，并在无直接结果时要求同组候选至少重复两次才推断；本轮仅补充现场证据和接口语义。

### 后续动作

- [x] 核对有业务 PON 与空 PON 的原始 SNMP 响应差异。
- [x] 核对空 PON 的 service-port `userVlan`、`sVlan` 响应。
- [x] 在 API 文档中明确空 PON 不清空人工台账值。

## 2026-08-15 网管二期登录密文与 Win7 迁移边界

- 目标：让网管二期登录密码可随 SQLite 备份迁移到 Win7，同时不保存迁移主密码或登录密码明文。
- 实现：新增 `oss_resource_credential` 单行表；使用 Node 内置 `scrypt` 派生 32 字节密钥，以 AES-256-GCM 保存随机 salt、nonce、认证标签和密文。
- 流程：首次成功登录或更新密码时同时输入登录密码和迁移主密码；服务重启或还原到另一台机器后，可只输入迁移主密码解锁密文并重新登录。
- 验证：合成测试覆盖加密往返、错误主密码、两次登录复用、备份还原后密文状态；全量测试 208/208，构建、语法检查和 `git diff --check` 通过。
- 安全边界：迁移主密码不进入 SQLite、备份、日志、审计或 API；当前未使用现场密码写入运行库，实际保存需由用户在本机页面完成首次“保存并登录”。

## 2026-08-15 对话流程、用户信息差异与修复经验

- 故障判断：DWR HTTP 200 仍可能是 Java 异常响应；必须检查 DWR 回调/异常体、失败阶段和后续业务结果。
- 调查顺序：本地复现 → 真实成功页面只读基线 → 对比请求字段/顺序/会话 Cookie → 最小修复 → 合成测试 → 本地 Web 验收。
- 修复要点：固定 `User-Agent`；根节点空查询；组织树子节点白名单投影；机房使用 `RELATED_ROOM_CUID` 与 `DOMAIN` 页面过滤合同；`httpSessionId` 为空；JSESSIONID、scriptSessionId 和 token 仅存内存。
- 数据边界：NMSE-PON 是本地用户快照，偏 LOID、用户名、电话、地址和 PON 关系；OSS/NGB 是在线设备资源与历史光功率，偏 CUID、设备状态、坐标和光功率。两者没有自动合并，逐条比较必须先建立 OLT IP 映射并完成网管二期登录。
- 当前只读统计：本地资源快照 12,153 条、5 台 OLT、最新同步时间 2026-07-23；网管二期未登录时不输出实时用户数量或逐条差异结论。
- 文档与测试禁止记录真实密码、Cookie、CUID、原始 DWR 响应和个人用户资料；设备访问范围仍保持只读。
