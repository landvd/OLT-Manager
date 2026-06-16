# API Design

后端入口为 `src/server.mjs`，默认监听 `http://127.0.0.1:8787`。API 返回 JSON，当前没有独立认证层，因此不应暴露到不可信网络。

## 通用约定

- 成功响应使用 HTTP `200`。
- 客户端错误使用 HTTP `400` 或 `404`。
- 服务端错误使用 HTTP `500`。
- 设备访问失败时，优先返回结构化错误，不把敏感凭据写入响应。

## 核心接口

### GET `/api/bootstrap`

返回前端启动所需数据。

包含：

- OLT 列表
- PON 台账
- 公开 OID profile

### GET `/api/status`

返回 OLT 状态摘要、SNMP 可达性和台账数量。

### GET `/api/onus`

查询 ONU 列表。

常见查询参数：

- `oltId`
- `slot`
- `pon`
- `q`

### GET `/api/unregistered-onus`

查询未注册 ONU/ONT。

### GET `/api/config-templates`

列出本地配置方案模板。

返回字段应包含：

- `id`：模板 ID，例如 `zte-self-operated-internet`、`huawei-self-operated-internet`。
- `name`：展示名称，例如 `ZTE 自营上网`、`Huawei 自营上网`。
- `vendor`：厂商，例如 `zte`、`huawei`。
- `businessType`：业务类型，例如 `self-operated-internet`、`link-booth`、`mdu-ott`。
- `vlanRules`：固定 VLAN 与动态 VLAN 来源说明。
- `portRules`：物理口选择或固定映射说明。

### POST `/api/config-templates/import-docx`

导入 Word 配置文档，生成配置模板草稿。

当前实现状态：返回 `501`，提示 DOCX 模板导入尚未实现；系统先提供内置 ZTE 自营上网、内部网络、MDU+OTT 和 Huawei 自营上网模板。

安全要求：

- 只解析文档内容，不执行文档中的任何命令。
- 真实账号、密码、community 和现场敏感信息不得写入可提交文件。
- 解析结果必须作为草稿展示，由用户确认后才保存到本地模板。

### POST `/api/unregistered-onus/:id/config-plan`

基于未注册 ONU 和配置模板生成命令预览。

请求体包含：

- `oltId`
- `slot`
- `pon`
- `serial`
- `templateId`
- `ethPorts`
- 可选的人工修正 VLAN 字段

响应包含：

- `blocked`：是否阻止生成。
- `warnings`：需要人工确认的提示。
- `variables`：ONU ID、VLAN、物理口和来源。
- `commands`：只展示/复制用的命令文本。

规则：

- ONU ID 使用同 PON 已注册 ONU ID 最大值 + 1。
- 不复用 ONU ID 空洞。
- 当同 PON 最大 ONU ID 达到 `128` 时返回 `blocked=true`。
- 未注册 ONU 自身没有 service-port，MDU+OTT 动态 VLAN 必须来自同 PON 已配置样板 ONU 或台账。
- Huawei 自营上网模板会把 `ZTEG-030C0914` 这类可读 SN 转换成 `5A544547030C0914` 这类原始十六进制 `sn-auth`。
- 接口不登录 OLT、不进入配置模式、不执行、不保存。

### POST `/api/open-terminal-login`

打开本机 macOS Terminal，自动 Telnet 登录当前选中 OLT，并按厂商进入配置模式，供用户人工粘贴已经复制的配置方案。

请求来源：

- `oltId` 查询参数或请求体字段。

响应包含：

- `ok`：是否成功打开本机 Terminal 登录脚本。
- `error`：失败原因。

安全要求：

- 只读取当前 OLT 的本地 Telnet 凭据。
- 不接收命令文本。
- 不粘贴、不执行、不保存任何 OLT 命令。
- ZTE 登录后发送 `con t`。
- Huawei 登录后发送 `enable` 和 `config`。
- 如果设备要求 enable 二次密码，交给人工处理。
- 非 macOS 环境返回 `501`。

### GET `/api/onu-config`

查询 ONU 详情和只读配置片段。

参数：

- `oltId`
- `slot`
- `pon`
- `onuId`

安全要求：

- 只允许已知 OLT。
- 只允许合法数字坐标。
- ZTE 查询只生成固定 show 命令。
- 不接受任意 CLI 文本。

### POST `/api/admin/snmp-test`

执行只读 SNMP 测试。

允许：

- `get`
- `walk`

禁止：

- `set`
- `clear`
- `delete`
- `reboot`
- `reset`
- `save`
- `write`
- `commit`
- 其他任何设备写操作或危险操作名。

## API 演进规则

- 新增接口前先写清楚用途、输入、输出和失败行为。
- 涉及设备命令时必须说明只读证明。
- 涉及敏感数据时必须说明脱敏和不落库策略。
- 前端依赖的字段变更要同步更新 `src/main.js` 和本文件。
