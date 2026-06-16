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
