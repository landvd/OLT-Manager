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

- Huawei MA5800 ONT 状态、光功率、距离、未注册 ONT 的 OID 验证。
- ZTE service-port VLAN 与 ONU 详情展示的一致性验证。
- ZTE `show running-config interface gpon-onu_*` 输出清洗和解析样例。
