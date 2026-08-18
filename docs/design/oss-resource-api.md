# OSS 设备资源只读接口

本文件记录 2026-08-12 对内部 OSS/NGB 系统完成的只读接口验证，以及随后接入 OLT Manager 的首个固定只读切片。这里记录的是内部页面合同和安全边界，不代表 OSS 提供公开或稳定的第三方 API。

本轮工作范围、OLT Manager 已实现部分和未完成项汇总见 [`docs/development-summary-2026-08-12-oss-resource-phase2.md`](../development-summary-2026-08-12-oss-resource-phase2.md)。

## 访问流程

1. 通过 OSS 统一登录页建立会话。
2. 登录后进入 NGB 首页。
3. 打开“配置管理 → 设备配置”。
4. 从空查询的组织树根节点开始，按页面顺序逐层展开目标分公司/机房；不要用组织名称拼接合成搜索请求。
5. 页面通过 DWR 请求刷新 OLT 列表。
6. 从列表响应中只提取设备资源白名单字段。
7. 双击目标 OLT 进入设备信息页，打开“详细参数 → ONU 管理 → ONU 列表”。
8. 按页面总数分页读取 ONU 列表，并在第一层解析时完成字段投影和敏感字段丢弃。

登录跳转中的临时 `uid`、`token`、Cookie、`JSESSIONID` 和 DWR `scriptSessionId` 只存在于当前会话，不得写入日志、文档、配置或 SQLite。

当前运行时由 OLT Manager 页面发起登录，不依赖外部浏览器自动化。SQLite 保存非敏感基地址、用户名、组织名称和机房名称，以及独立表中的跨平台登录密文；原始密码、迁移主密码及登录后的会话材料不落盘。桌面版可由用户显式勾选本机自动登录，密码改由 Electron `safeStorage` 保存到本机加密凭据文件，后续启动可自动登录；该凭据不进入 SQLite 或项目备份。跨设备迁移或纯 Web/Node 环境仍使用迁移主密码解锁 SQLite 密文。

登录跳转后的 NGB 框架页和设备配置页使用同一临时页面版本，DWR `batchId` 从 0 自然递增。适配器不探测额外用户权限接口、不添加 uid/token 兼容请求头，也不在 OSS/NGB 地址之间猜测回退路径；这些字段和路径不是当前页面成功基线的一部分。

## 已确认的 DWR 调用

DWR 请求统一使用 `POST /ngb/dwr/call/plaincall/<Service>.<method>.dwr`，请求体为 DWR 表单格式。

| 用途 | Service.method | 关键参数/对象 | 状态 |
| --- | --- | --- | --- |
| 组织树加载与展开 | `TreePanelAction.loadData` | `cuid`、`text`、`parentTreeNode`、`boName`、`params`、`treeName`、`treeParams`、`queryParams` | 已验证 |
| OLT 列表分页信息 | `GridViewAction.getGridPageInfo` | `count/start/limit/totalNum`、`cfgParams`、`urlParams`、`queryParams` | 已验证 |
| OLT 列表数据 | `GridViewAction.getGridData` | 与分页信息相同；设备模板为 `res.logic.RES_DEV.OLT`，查询对象为 `XmlMvGridBO` | 已验证 |
| OLT 详情菜单 | `TreePanelAction.loadData` | 详情页根节点、OLT CUID、菜单树参数 | 已验证 |
| ONU 列表元数据 | `GridViewAction.getGridMeta` | `OnuGridBO`、ONU 列表模板和字段元数据 | 已验证 |
| ONU 列表分页信息 | `GridViewAction.getGridPageInfo` | ONU 查询对象与 `count/start/limit/totalNum` | 已验证 |
| ONU 列表数据 | `GridViewAction.getGridData` | `OnuGridBO`、OLT CUID 过滤和分页对象 | 已验证 |
| 历史光功率字典 | `CmpTplDwrAction.getGridDict` | `res.logic.RES_DEV.ONU.OPTICAL_HIS` | 已验证 |
| 历史光功率权限 | `AuthorityDwrAction.getFuncAuth` | 当前页面功能权限 | 已验证 |
| 历史光功率元数据 | `GridViewAction.getGridMeta` | 历史光功率模板、ONU CUID、`XmlMvGridBO` | 已验证 |
| 历史光功率分页/数据 | `GridViewAction.getGridPageInfo` / `getGridData` | ONU CUID、采集日期区间、分页对象 | 已验证 |

表中“已验证”描述页面观察结果，不等于全部进入运行时白名单。当前适配器只调用 `TreePanelAction.loadData`、`GridViewAction.getGridPageInfo` 和 `GridViewAction.getGridData`；元数据、字典和权限接口未接入。

设备列表请求的核心对象结构可抽象为：

```text
cfgParams:
  tplName: res.logic.RES_DEV.OLT
  createFormTplName: res.logic.RES_DEV.OLT_cust-create
  updateFormTplName: res.logic.RES_DEV.OLT_cust-update
  baseParams:
    RELATED_ORG_CUID: <org-cuid>
    RELATED_ROOM_CUID: <room-cuid>
  boName: XmlMvGridBO
urlParams/queryParams:
  PRV_DEPARTMENT:
    key: RELATED_ORG_CUID
    type: append
    alias: ROOM
    value: ROOM.RELATED_ORG_CUID LIKE '<org-cuid>%'
  RELATED_ROOM_CUID:
    key: RELATED_ROOM_CUID
    relation: '='
    value: <room-cuid>
```

页面默认以 20 条分页；本次只读验证将分页上限扩大到 100 条后，在返回体内按机房字段筛选目标设备。`<org-cuid>` 是会话/现场组织树中的内部标识，适配器必须通过 `TreePanelAction.loadData` 动态发现，不得把现场值硬编码为公共配置。

## ONU 列表请求合同

OLT 详情页入口为 `GET /ngb/ResDevAction/config.do`。页面通过菜单树加载“ONU 列表”模块，实际列表仍由 `GridViewAction` 的三个只读 method 提供。已观察到的核心请求对象为：

```text
page:
  count: <page-size>
  start: <zero-based-offset>
  limit: <page-size>
  totalNum: <page-size-or-page-total>
data:
  boName: OnuGridBO
  exportBoName: BoGridExportBO
  cfgParams.tplName: res.logic.pon.olt.grid.OnuList
  queryParams:
    alias: D
    key: PREID
    relation: "="
    type: string
    value: <olt-cuid>
```

页面默认每页 20 条。全量读取必须先取得页面总数，再使用有界分页；本次验证使用 1000 条分批读取，并以一次覆盖页面总数的只读快照复核唯一性。DWR 的 `batchId`、`httpSessionId`、`scriptSessionId` 和页面版本号均为临时会话字段，不得写入实现或测试固件。

### ONU 字段投影

ONU 原始对象包含约 86 个字段。适配器不应保存完整对象，只允许按业务需要从以下类别建立白名单：

- 标识与位置：`ONU_CUID`、`CUID`、`LOID`、`MAC`/`SN`、`ONUDEVICEINDEX`、`ONUIDX`、`OLTCARDIDX`、`OLTPORTIDX`、`PON_NAME`、`DEVNAME`。
- 状态：`N_STATUS`、`N_AUTHSTATUS`、`ONUADMINSTATUS`、`BUSSTATUS`。
- 光功率和环境：`RX_OPTICAL`、`TX_OPTICAL`、`OLT_RX_OPTICAL`、`OLT_TX_OPTICAL`、`OPTICALPOWER`、`BIASCURRENT`、`VOLTAGE`、`TEMPERATURE`。
- 设备信息：`STB_SN`（统一设备号）、`ONUNAME`、`ONUTYPE`、`VENDORNAME`、软件/固件版本、管理 IP/掩码/网关。
- 用户关联：`CUSTNAME` 等姓名字段、`MOBILE` 等手机号字段、`WHLADDR` 等安装地址字段，以及宽带账号、网格和片区，仅可进入受保护的本地用户资源快照，不得写入日志、文档、语言模型请求或飞书回复。现场字段别名必须先经过白名单映射，不能保存完整原始对象。

原始响应还可能包含 `ONUMGMTSNMPCOMMUNITYFORREAD`、`ONUMGMTSNMPCOMMUNITYFORWRITE` 和 `ONUMGMTSNMPTRAPHOST`。这些字段即使为空也必须列入拒绝名单，并在解析第一层丢弃；禁止为调试目的保存原始 DWR 响应。

## ONU 历史光功率请求合同

在 ONU 列表中只选择一条记录并点击“历史光功率”后，页面打开以下只读查询入口：

```text
GET /ngb/core/cmp_ext/mt/MvQueryGridPanel.jsp
  code=res.logic.RES_DEV.ONU.OPTICAL_HIS
  s_ONU.CUID=<onu-cuid>
```

页面初始化时依次读取模板字典、表格元数据、功能权限、分页信息和历史数据。核心 `GridViewAction` 请求对象可抽象为：

```text
page:
  count: true
  start: <zero-based-offset>
  limit: <page-size>
  totalNum: <page-size-or-page-total>
data:
  cfgParams.tplName: res.logic.RES_DEV.ONU.OPTICAL_HIS
  boName: XmlMvGridBO
  urlParams:
    ONU.CUID:
      alias: ONU
      key: CUID
      relation: "="
      type: string
      value: <onu-cuid>
  queryParams:
    REPORT_TIME:
      alias: O
      key: REPORT_TIME
      relation: between
      type: date
      value: <start-datetime>,<end-datetime>
    ONU.CUID: <same-filter-as-urlParams>
```

数据响应已观察到以下字段：`DEVNAME`、`OLT_RX_OPTICAL`、`FDN`、`RELATED_ORG_CUID`、`CUID`、`RX_OPTICAL`、`VENDORID`、`SN`、`ONUMACADDRESS`、`REPORT_TIME`、`LOID`、`TX_OPTICAL`、`LIGHTDECAY`。其中光功率和光衰为数值，`REPORT_TIME` 由 DWR 序列化为 `new Date(<epoch-millis>)`。

对外或进入普通诊断日志时只允许投影 `REPORT_TIME`、`RX_OPTICAL`、`TX_OPTICAL`、`OLT_RX_OPTICAL` 和 `LIGHTDECAY`。`LOID`、`SN`、`ONUMACADDRESS`、内部 CUID/FDN 和组织标识只能在受保护的本地关联流程中使用，不得写入普通日志、文档、语言模型请求或飞书回复。

“历史光功率”只是查询已有历史数据，不会调用“光功率刷新”或“PON口全量 ONU 光功率刷新”。当前适配器保持这三个动作相互独立，历史查询不会隐式触发设备采集。

## 允许投影的字段

适配器只允许从 `GridViewAction.getGridData` 响应投影以下非敏感字段：

- `IP`：支撑网 IP。
- `LOCATION_IP`：属地 IP。
- `DEVALIAS`：设备别名，保存前应清理其中可能嵌入的 IP。
- `N_VENDORID`：厂商展示名称。
- `DEVTYPEID`：设备型号。
- `N_RELATED_ROOM_CUID`：机房展示名称/标识。
- `ONU_NUM`：在线 ONU 数量。

允许在需要建立外部关联时保存不透明的 `CUID`，但不得把它用于绕过组织权限或构造写操作。

响应中还观察到设备访问凭据、SNMP 字段和 Telnet 字段。它们不是本功能输入，必须在响应解析的第一层丢弃；禁止保存原始 DWR 响应、完整对象、凭据字段或调试转储。

## 本地 IP 映射边界

网管二期返回的支撑网 IP 与 OLT Manager 中的 `olts.host` 不是同一个命名空间，不能依靠相似网段或末尾数字自动推断。已人工确认的关系只写入本机 `resource_olt_ip_mappings`：`resource_ip` 与 `olt_ip` 均唯一，目标 `olt_ip` 必须已存在，来源和时间用于审计。

映射记录不会修改 `olts.host`，不会保存 OLT CUID、组织 CUID、Cookie 或 DWR 会话字段，也不会自动启用设备。现场确认但尚未出现在 OSS 的设备必须使用不同来源标记；缺少 SNMP profile 或凭据的设备继续保持停用。

## 本次验证结果

- 查询路径：东莞分公司组织范围内，按机房字段筛选厚街机房。
- 结果数量：6 台 OLT。
- 设备构成：1 台 Huawei MA5800-X15、1 台 ZTE C600、4 台 ZTE C300v2。
- 结果字段：支撑网 IP、属地 IP、别名、厂商、型号、ONU 数量均可从同一列表响应读取。
- 对一台 ZTE C300v2 进入“详细参数 → ONU 列表”后，分页读取条数与页面总数一致；单次快照中的 ONU 标识和板卡/端口/ONU 坐标均无重复、无空值。
- 分页读取期间列表会实时变化；跨多个请求直接按位置拼接可能出现页边界重叠。正式适配器应优先使用稳定排序/快照语义，无法保证时则按 `ONU_CUID` 或完整接口坐标去重并记录读取时间。
- 对一条 ONU 记录打开历史光功率后，默认日期区间返回每日历史数据；记录数与页面总数一致，光功率、光衰和采集日期字段均可从同一 `getGridData` 响应读取。
- 具体现场 IP、设备别名、ONU 数量明细不提交仓库，保留在用户现场/运行数据中。

## 接入边界

- 只允许登录、组织树读取、OLT 列表读取、OLT 详情菜单读取、ONU 列表读取和 ONU 历史光功率读取。
- 不调用新增、删除、修改、导入、导出或配置下发接口。
- 不执行 Telnet/SSH 命令，不读取或保存设备凭据。
- 不能把 DWR 会话令牌、Cookie 或原始响应转发给语言模型、Feishu 或本地 HTTP API。
- 当前适配器已实现固定 method 白名单、字段级投影、45 秒超时、响应大小上限、同源重定向限制和失败关闭；继续禁止任意 DWR method 代理。

## 尚未确认

- OSS 是否提供独立、稳定、可脱离浏览器会话的正式 REST API。
- 会话续期、验证码、单点登录失效和权限变化时的自动恢复流程。
- 组织树内部 CUID 在不同账号、分公司或环境之间是否稳定。
- 设备列表响应字段在不同 OSS 版本中的兼容性。
