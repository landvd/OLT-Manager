# Experiments

本文件记录只读实验。任何会改变 OLT、ONU、业务 VLAN、配置或运行状态的操作都不允许写在这里执行。

## 实验规则

- 只允许 SNMP `get/walk`、设备 `show/display` 类读取命令。
- 不记录真实 community、账号、密码。
- 真实 IP 可用别名代替，例如 `zte-c300-site-a`。
- 每次实验必须写清楚目标、命令类型、预期、结果和结论。
- 结论进入代码前，需要转成测试样例或明确的解析规则。

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
````

## 已知候选实验

- ZTE MDU+OTT 配置方案 VLAN 自动识别已完成一轮脱敏验证，后续需要转成测试样例。
- Huawei MA5800 未注册 ONT SN 已完成 CLI 与 SNMP 对照验证；已注册 ONT SN OID 仍需继续验证。
- Huawei MA5800 ONT 状态、光功率、距离 OID 验证。
- ZTE service-port VLAN 与 ONU 详情展示的一致性验证。
- ZTE `show running-config interface gpon-onu_*` 输出清洗和解析样例。
- ZTE 未注册 ONU SNMP 索引与 CLI `gpon-onu_<槽>/<板卡>/<PON>:<ID>` 对照验证。

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
- 仍需验证：已注册 ONT SN 对应的 Huawei SNMP OID；需要结合 `interface gpon <槽>/<板卡>` 下的 `display ont info <pon> all` 或单 ONT 输出继续验证。
- 不进入代码的原因：已进入代码的范围只包括未注册 ONT 配置方案预览；已注册 ONT SN 仍显示 `N/A` 或待验证字段。

### 后续动作

- [x] Huawei 自营上网配置预览使用原始十六进制 SN 作为 `sn-auth`。
- [x] 为 Huawei 自营上网模板增加 Node 测试。
- [ ] 继续验证已注册 ONT SN OID。

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
