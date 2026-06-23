# 任务计划：ZTE 自定义 VLAN 配置方案

## 目标

在现有未注册 ONU 配置方案基础上，新增一个基于 ZTE 内部网络模板的“自定义 VLAN”方案，让用户可以输入非 100 的业务 VLAN，并生成对应命令预览。

## 阶段

1. [complete] 梳理现有 ZTE 配置方案模板、前端表单和测试覆盖。
2. [complete] 设计自定义 VLAN 输入字段和模板变量，保持默认模板兼容。
3. [complete] 实现后端配置方案生成逻辑和前端表单。
4. [complete] 更新测试和文档。
5. [complete] 运行语法检查、测试和构建。

## 安全边界

- 仍只生成命令预览，不自动粘贴、不自动执行、不保存 OLT 配置。
- 自定义 VLAN 只影响本地生成的 ZTE 配置方案文本。
- 不引入 `snmpset` 或设备写入 API。

## 新增任务：Huawei MA5800 内部网络方案

### 目标

在现有 Huawei MA5800 自营上网方案基础上，新增 `Huawei 内部网络` 配置方案预览模板，固定内部网络 VLAN 为 `100`，用于未注册 ONT 的人工配置预览。

### 阶段

6. [complete] 梳理现有 Huawei 自营上网模板、前端厂商过滤和测试覆盖。
7. [complete] 设计 Huawei 内部网络命令结构和变量来源。
8. [complete] 实现配置模板、生成逻辑和测试。
9. [complete] 更新 README、PRD、架构、API、数据库、时序、ADR 和 changelog。
10. [complete] 运行语法检查、测试和构建。

### 安全边界

- 仍只生成命令预览，不自动粘贴、不自动执行、不保存 OLT 配置。
- 继续使用 Huawei `sn-auth` 原始十六进制 SN 转换规则。
- 不引入 Huawei 任意 Telnet 命令执行接口。
- 如命令结构缺少现场验证证据，必须在文档和警告里标注需要人工确认。

## 规划任务：Huawei 模板增加 eth 端口选择

### 目标

为 `Huawei 自营上网` 和 `Huawei 内部网络` 配置方案增加 eth 端口选择能力，交互方式尽量和 ZTE 物理端口选择一致，但使用 Huawei 端口命名 `eth1` 到 `eth4`。本阶段只规划，不立即修改业务代码。

### 推荐设计

- 前端配置方案弹窗增加厂商/模板感知的端口选项：
  - ZTE 继续使用 `eth_0/1` 到 `eth_0/4`。
  - Huawei 使用 `eth1` 到 `eth4`。
- `Huawei 自营上网`：
  - 默认选中 `eth1`，保持现有行为兼容。
  - 允许多选 `eth1` 到 `eth4`。
  - 为每个选中端口生成一条 `ont port native-vlan <pon> <ontId> <eth> vlan 3301`。
  - `service-port vlan <OUTERVLAN> ... user-vlan 3301 ...` 仍生成一条。
- `Huawei 内部网络`：
  - 默认选中 `eth1` 到 `eth4`，保持刚加入的现场命令行为。
  - 允许用户取消或选择其中一部分端口。
  - 为每个选中端口生成一条 `ont port native-vlan <pon> <ontId> <eth> vlan 100 priority 0`。
  - `service-port vlan 100 ... user-vlan 100 tag-transform translate` 仍生成一条。
- 后端必须校验 Huawei 端口，只允许 `eth1`、`eth2`、`eth3`、`eth4`；缺省时使用模板默认端口。
- 配置方案仍只生成命令预览，不自动粘贴、不执行、不保存配置。

### 阶段

11. [complete] 确认 Huawei 端口选择默认值和命令生成规则。
12. [complete] 设计前端端口选择数据结构，避免 ZTE `eth_0/x` 与 Huawei `ethx` 混用。
13. [complete] 设计后端 Huawei 端口 normalize/validate 逻辑。
14. [complete] 规划测试覆盖：Huawei 自营单端口、多端口；Huawei 内部网络默认全端口、部分端口；非法端口过滤。
15. [complete] 规划文档更新：README、PRD、架构、API、数据库、时序、ADR、CHANGELOG。
16. [complete] 运行验证并确认不会影响 ZTE 模板和现有 Huawei 默认行为。

### 待确认问题

- `Huawei 自营上网` 多选端口时，是否只生成多条 `ont port native-vlan`，仍只生成一条 `service-port`。
- `Huawei 内部网络` 默认是否继续全选 `eth1` 到 `eth4`。
- 用户取消全部端口时，是阻止生成，还是自动回退到模板默认端口。推荐阻止生成并提示至少选择一个端口。

## 规划任务：Huawei 自定义 VLAN 模板

### 目标

在 `Huawei 内部网络` 模板基础上新增 `Huawei 自定义 VLAN` 配置方案预览模板，让用户可以输入非固定 `100` 的业务 VLAN，并生成 Huawei MA5800 对应的 `native-vlan` 和 `service-port` 预览命令。

### 推荐设计

- 新增模板：
  - `id`: `huawei-custom-vlan`
  - `name`: `Huawei 自定义 VLAN`
  - `vendor`: `huawei`
  - `businessType`: `custom-vlan`
  - `vlanRules.innerVlan`: `custom`
  - `vlanRules.outerVlan`: `none`
  - `portRules`: 复用 Huawei 内部网络端口规则，允许 `eth1` 到 `eth4`，默认全选。
- 前端复用现有 `业务 VLAN` 输入框：
  - `showCustomVlanInput` 从只识别 `zte-custom-vlan` 扩展为识别 `businessType === "custom-vlan"` 或模板 ID 集合。
  - 切换到非自定义 VLAN 模板时继续清空 `customVlan`。
  - 端口选择继续走当前模板的 `portRules.allowed/defaults`，无需新增台账字段。
- 后端复用 Huawei 内部网络命令结构：
  - `config`
  - `interface gpon 0/<slot>`
  - `ont add <pon> sn-auth <snAuthSerial> omci ont-lineprofile-id 300 ont-srvprofile-id 300`
  - 对每个选中端口生成 `ont port native-vlan <pon> <onuId> <eth> vlan <customVlan> priority 0`
  - `quit`
  - `service-port vlan <customVlan> gpon 0/<slot>/<pon> ont <onuId> gemport 0 multi-service user-vlan <customVlan> tag-transform translate`
- 校验规则：
  - `customVlan` 必须为 `1-4094`，缺失或非法时阻止生成并提示重新输入。
  - Huawei 端口只允许 `eth1`、`eth2`、`eth3`、`eth4`；过滤后为空时阻止生成。
  - `sn-auth` 继续使用原始十六进制 SN 转换规则。
- 安全边界：
  - 只生成命令预览，不自动粘贴、不执行、不保存 OLT 配置。
  - 不新增 Excel、PON 台账、OLT 默认 VLAN 或采集逻辑。
  - 不引入 Huawei 任意 Telnet 命令接口。

### 阶段

17. [complete] 只读梳理现有 `Huawei 内部网络`、`ZTE 自定义 VLAN`、前端 VLAN 输入和测试结构。
18. [complete] 规划 `Huawei 自定义 VLAN` 模板 ID、命令结构、端口默认值和校验规则。
19. [complete] 后续实现：新增模板和后端生成逻辑，复用 Huawei 内部网络构建路径或抽取 Huawei 单 VLAN helper。
20. [complete] 后续实现：前端让 Huawei 自定义 VLAN 显示 `业务 VLAN` 输入，并保持端口选择默认全选。
21. [complete] 后续实现：补充配置方案测试和 README、PRD、架构、API、数据库、时序、ADR、CHANGELOG。

### 待确认问题

- `Huawei 自定义 VLAN` 默认端口是否沿用内部网络的 `eth1` 到 `eth4` 全选；当前规划按“基于内部网络模板”处理为默认全选。
- 自定义 VLAN 是否同时用于 `native-vlan`、`service-port vlan` 和 `user-vlan`；当前规划按同一个业务 VLAN 贯穿三处处理。
- 是否需要给 Huawei 自定义 VLAN 增加额外告警说明“以现场 MA5800 软件版本命令为准”；当前规划建议沿用内部网络模板警告。

### 已确认决策

- 用户确认默认端口沿用 Huawei 内部网络，`eth1` 到 `eth4` 全选。
- 用户确认自定义 VLAN 同时用于 `native-vlan`、`service-port vlan` 和 `user-vlan`。
- 用户确认不新增额外现场版本告警，沿用 Huawei 内部网络模板提示。
- Huawei `ont add` 按说明书格式使用 `ont add <pon> sn-auth ...`，其中 `<pon>` 是 PON 口；后续 `native-vlan` 和 `service-port` 仍使用系统建议的 ONT ID 预览。
