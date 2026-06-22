# 发现记录：ZTE 自定义 VLAN 配置方案

## 初始判断

- 现有 ZTE 内部网络模板 VLAN 固定为 `100`。
- 新需求是在该模板能力上增加可配置 VLAN，而不是改变原有内部网络模板默认行为。
- 需要同步配置模板、前端输入、测试和用户文档。

## 代码定位

- 配置模板定义和命令生成位于 `src/config-plan.mjs`。
- 前端弹窗位于 `src/main.js` 的“未注册 ONU 配置方案”对话框。
- 当前前端生成接口只传 `templateId` 和 `ethPorts`，没有传自定义 VLAN。
- `/api/unregistered-onus/:id/config-plan` 在 `src/server.mjs` 中把请求体传入 `buildConfigPlanFromTemplate`，适合增加 `customVlan` 字段。

## 设计决策

- 保留原 `ZTE 内部网络` 模板固定 VLAN `100`，避免改变既有行为。
- 新增独立模板 `ZTE 自定义 VLAN`，复用内部网络命令结构，用户输入 `customVlan`。
- 缺少自定义 VLAN 时阻断命令生成，不给出半成品命令。

## 需求复核确认

- `ZTE 自定义 VLAN` 只用于 ZTE，不扩展 Huawei。
- 只提供一个业务 VLAN 输入，该 VLAN 同时用于 `user-vlan`、`vlan` 和所有选中物理口的 `def-vlan`。
- 除 VLAN 外，其它命令结构沿用 `ZTE 内部网络`，包括 `sn-bind disable`、`tcont`、`gemport` 和 `service-port` 结构。
- 未输入或非法 VLAN 时阻止生成，并提示用户重新输入；不默认回退到 `100`。
- VLAN 范围按标准限制为 `1-4094`。
- 物理口继续沿用内部网络方案，支持 `eth_0/1` 到 `eth_0/4` 多选。
- 命令末尾保留两条 ZTE 只读 `show` 核查命令。
- 界面名称为 `ZTE 自定义 VLAN`，输入项标签为 `业务 VLAN`。
- 自定义 VLAN 只用于本次生成，不保存为 OLT/PON 默认值。
- 不新增 Excel、PON 台账字段或采集逻辑。

## 文档同步

- README、PRD、架构、API、数据库、时序、ADR-004 和 changelog 均记录了 `ZTE 自定义 VLAN` 模板。
- 文档强调自定义 VLAN 仍是命令预览，不自动下发、不自动粘贴、不保存配置。
