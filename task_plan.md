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
