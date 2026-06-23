# ADR-004: Configuration Plans Are Preview Only

## Status

Accepted

## Context

OLT Manager 已经可以根据未注册 ONU/ONT、PON 台账、模板和只读 SNMP 数据生成配置方案文本。近期新增了 Huawei 自营上网模板，并通过 `display ont autofind all` 与 SNMP `unconfiguredSerial` 表验证了未注册 ONT SN：Huawei `ont add ... sn-auth` 应使用原始十六进制 SN，而不是括号中的可读 SN。

配置方案命令本身属于设备写操作。如果系统自动执行这些命令，就会越过当前项目的人工确认边界。

## Decision

配置方案模块只生成命令预览：

- 后端只返回 `commands` 文本、变量来源和告警。
- 前端只展示和复制命令。
- 桌面版前端可打开内置 Telnet 终端方便人工粘贴；自动登录和进入配置模式的例外见 ADR-005。
- 系统不登录 Huawei OLT 执行配置。
- 系统不自动下发、不保存。
- 系统不自动粘贴、不自动执行配置命令。
- ZTE 配置方案不生成 `configure terminal`，因为内置终端已自动 `con t`；配置命令末尾可附带只读 `show` 核查命令，供用户粘贴执行后检查结果。
- ZTE 和 Huawei 自定义 VLAN 模板只把用户输入的业务 VLAN 渲染进命令预览，仍不读取任意命令、不执行设备写入。
- Huawei 自营上网、内部网络和自定义 VLAN 模板按用户选择的 `eth1` 到 `eth4` 渲染 `native-vlan`；内部网络固定 VLAN `100`，自定义 VLAN 使用用户输入 VLAN，使用 `priority 0`，并生成对应 `service-port vlan`，仍只生成预览。
- Huawei `sn-auth` 使用原始十六进制 SN，例如 `5A544547030C0914`。
- 已注册 ONT SN OID 未完成验证前，不把已注册 ONT SN 当作可靠字段。

## Consequences

优点：

- 保持项目只读边界。
- 允许把现场经验转成可复用模板和测试。
- 人工仍可在 OLT 上二次确认后执行命令。
- 复制失败时可以使用浏览器兼容兜底；Terminal 登录辅助不会自动执行生成的配置命令。

代价：

- 仍需要人工复制和执行命令。
- 模板正确性依赖现场验证和文档更新。
- 站点差异、profile ID、VLAN 规划和自定义 VLAN 输入仍需人工确认。

## Follow-up

- 为 Huawei 已注册 ONT SN OID 建立只读实验。
- 为更多 Huawei 模板补充测试样例。
- 如未来要自动下发配置，必须新增独立 ADR，设计认证、授权、审计、回滚和防误操作机制。
