# Experiments

本文件记录只读实验。任何会改变 OLT、ONU、业务 VLAN、配置或运行状态的操作都不允许写在这里执行。

## 实验规则

- 只允许 SNMP `get/walk`、设备 `show/display` 类读取命令。
- 不记录真实 community、账号、密码。
- 真实 IP 可用别名代替，例如 `zte-c300-site-a`。
- 每次实验必须写清楚目标、命令类型、预期、结果和结论。
- 结论进入代码前，需要转成测试样例或明确的解析规则。

## 2026-07-29 Feishu PON 地址联调

- 目标：验证飞书区域查询能够在授权 OLT 范围内定位 PON 台账，并读取整口状态。
- 操作类型：本机 Gateway HTTP 读取与既有 SNMP 只读采集。
- 是否只读：是。

### 观察

- 飞书查询词可能带行政后缀 `村`，而 PON 台账备注使用区域名加道路/光交箱且省略该后缀。
- 原始包含匹配因此返回 0，但 OLT Manager 本地搜索能够显示相关台账项。
- 去掉末尾单个 `村` 后可以命中；更宽泛的模糊匹配会扩大结果，不应采用。
- 整口实时结果可按精确 `chassis/board/pon` 返回状态和光功率，并按同坐标合并快照姓名。

### 结论

- `queryPons` 采用直接包含优先、受限尾部 `村` 兼容，并继续在计数前执行 Authorized OLT Scope 过滤。
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
- `172.19.104.98` 的 ONU 接口按 `pageSize=20` 实测单页约 27–28 秒；8 路读取 8 页（160 条）约 28 秒成功。不得把每页数量提高到 100，否则首分页可能超时。
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
