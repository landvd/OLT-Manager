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
- Huawei MA5800 ONT 状态、光功率、距离、未注册 ONT 的 OID 验证。
- ZTE service-port VLAN 与 ONU 详情展示的一致性验证。
- ZTE `show running-config interface gpon-onu_*` 输出清洗和解析样例。

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
