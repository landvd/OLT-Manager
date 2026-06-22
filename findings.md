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

## Huawei MA5800 内部网络方案发现

### 初始判断

- 当前代码只有 `Huawei 自营上网` 模板，固定内层 VLAN `3301`，需要 OUTERVLAN，并生成 `ont add`、`ont port native-vlan` 和 `service-port ... tag-transform translate-and-add`。
- 已验证事实集中在 Huawei 未注册 ONT SN：`sn-auth` 必须使用原始十六进制 SN。
- 现有文档没有单独记录 Huawei 内部网络命令样例；新增方案应以最小差异实现，并在警告/文档中标注需要现场确认。

### 用户提供的现场命令依据

```text
ont port native-vlan 14 127 eth1 vlan 100 priority 0
ont port native-vlan 14 127 eth2 vlan 100 priority 0
ont port native-vlan 14 127 eth3 vlan 100 priority 0
ont port native-vlan 14 127 eth4 vlan 100 priority 0
quit

service-port vlan 100 gpon 0/10/14 ont 127 gemport 0 multi-service user-vlan 100 tag-transform translate
```

### 设计决策

- 新增模板 `huawei-link-booth`，展示名 `Huawei 内部网络`，vendor 为 `huawei`，businessType 为 `link-booth`。
- 固定内部网络 VLAN 为 `100`，不要求 OUTERVLAN。
- 复用 Huawei 自营上网的 `ont add`、line profile `300`、service profile `300`、gemport `0` 和 `sn-auth` 转换；端口统一使用 `eth1` 到 `eth4`。
- 生成 4 条 `ont port native-vlan <pon> <ontId> eth1-eth4 vlan 100 priority 0`。
- `service-port` 使用 `service-port vlan 100 gpon 0/<slot>/<pon> ont <ontId> gemport 0 multi-service user-vlan 100 tag-transform translate`。
- 该模板仍只生成预览，不自动登录、不自动粘贴、不执行。

## Huawei eth 端口选择规划发现

### 代码定位

- 前端端口选择显示条件在 `src/main.js`：`showEthPortSelector` 当前对 Huawei 直接隐藏。
- 前端端口状态使用 `state.configPlan.ethPorts`，目前默认值是 ZTE 风格 `eth_0/1`。
- 后端 ZTE 端口校验在 `src/config-plan.mjs` 的 `normalizeEthPorts`，只允许 `eth_0/1` 到 `eth_0/4`。
- 实施前 Huawei 自营模板固定变量 `ethPort: "eth 1"`，命令只生成一条 `ont port native-vlan ... eth 1 vlan 3301`；最终实现已统一为 `eth1` 到 `eth4`。
- Huawei 内部网络模板当前固定 `huaweiInternalEthPorts = ["eth1", "eth2", "eth3", "eth4"]`，不能由前端选择。

### 推荐实现方向

- 抽象端口选项为模板/厂商驱动，而不是继续用 `selectedOlt.vendor !== "huawei"` 控制显示。
- 前端可根据当前模板的 `portRules.allowed/defaults` 渲染 checkbox，做到 ZTE/Huawei 共用一套端口选择 UI。
- 后端增加 Huawei 专用端口规范化函数，避免把 ZTE `eth_0/1` 当成 Huawei 端口。
- Huawei 自营上网默认 `eth1`，多选时只扩展 `ont port native-vlan` 行，`service-port` 保持一条。
- Huawei 内部网络默认 `eth1` 到 `eth4`，用户可选择部分端口。
- 至少选择一个端口；空选择应阻止生成并提示用户重新选择，避免生成缺少 ONT 端口 VLAN 的命令。

### 需求复核确认

- `Huawei 自营上网` 多选端口时，只生成多条 `ont port native-vlan ... vlan 3301`，`service-port` 仍只生成一条。
- `Huawei 内部网络` 默认全选 `eth1` 到 `eth4`，允许用户取消部分端口。
- Huawei 端口全部取消时，阻止生成并提示至少选择一个端口。
- Huawei 命令中的端口统一使用 `eth1`、`eth2`、`eth3`、`eth4`，不再使用 `eth 1`。
- 前端复用同一个“物理端口”表单项，根据当前模板切换 ZTE/Huawei 端口选项。
- Huawei 端口选择只作用于 `Huawei 自营上网` 和 `Huawei 内部网络`，不影响 ZTE，不新增 Huawei 自定义 VLAN 或 MDU+OTT。
- 后端过滤非法 Huawei 端口；过滤后为空则阻止生成并提示至少选择一个有效端口。
- 端口选择只作为本次生成配置方案的临时输入，不保存为 OLT/PON/模板默认值，不改 Excel 或台账字段。
- 测试覆盖 `Huawei 自营上网` 默认 `eth1`、多选 `eth1/eth2`，`Huawei 内部网络` 默认 `eth1-eth4`、部分选择，以及非法端口过滤后阻止生成。
- 文档同步记录 Huawei 使用 `eth1-eth4`、自营默认 `eth1`、内部网络默认全选。

### 风险

- Huawei CLI 样例中端口写法是 `eth1`；最终实现已将 Huawei 自营上网和内部网络端口统一为 `eth1` 到 `eth4`。
- 如果不同 MA5800 软件版本接受的端口写法不同，需要在文档中说明以现场 CLI 为准。
- 多端口自营上网是否只需要一条 service-port 仍需用户确认；目前推荐保持一条，减少业务侧变化。
