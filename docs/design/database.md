# Database Design

当前数据层使用本地 SQLite，入口在 `src/db.mjs`。SQLite 文件位于 `data/olt-manager.sqlite`，属于运行时数据，不提交。

## 表：olts

保存 OLT 基本信息。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | TEXT PRIMARY KEY | OLT 逻辑 ID |
| `name` | TEXT | 展示名称 |
| `vendor` | TEXT | 厂商，例如 `zte`、`huawei` |
| `model` | TEXT | 型号 |
| `version` | TEXT | 软件版本或备注 |
| `host` | TEXT UNIQUE | OLT 地址 |
| `snmp_port` | INTEGER | SNMP 端口，默认 161 |
| `read_community` | TEXT | 只读 community |
| `telnet_port` | INTEGER | Telnet 端口，默认 23 |
| `telnet_username` | TEXT | 本地 Telnet 用户名 |
| `telnet_password` | TEXT | 本地 Telnet 密码 |
| `enabled` | INTEGER | 是否启用 |

## 表：pon_ports

保存本地 PON 台账。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT | 台账行 ID |
| `olt_ip` | TEXT | OLT 地址 |
| `pon_port` | TEXT | PON 端口，如 `1/2/1` |
| `outer_vlan` | TEXT | 外层 VLAN |
| `address` | TEXT | 地址或现场备注 |

## 表：snmp_probe_history

记录 SNMP 测试历史。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT | 记录 ID |
| `olt_id` | TEXT | OLT ID |
| `operation` | TEXT | `get` 或 `walk` |
| `oid` | TEXT | 查询 OID |
| `ok` | INTEGER | 是否成功 |
| `duration_ms` | INTEGER | 耗时 |
| `summary` | TEXT | 摘要 |
| `raw_output` | TEXT | 原始输出 |
| `created_at` | TEXT | 创建时间 |

## 表：admin_events

记录管理操作。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT | 记录 ID |
| `action` | TEXT | 操作名 |
| `source` | TEXT | 来源 |
| `detail` | TEXT | 详情 |
| `created_at` | TEXT | 创建时间 |

## 表：config_templates

保存本地配置方案模板。模板属于本地运行数据，可以从示例文档导入或由页面维护；真实现场模板、账号、密码和凭据不得提交。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | TEXT PRIMARY KEY | 模板 ID |
| `name` | TEXT | 展示名称 |
| `vendor` | TEXT | 厂商，例如 `zte` |
| `business_type` | TEXT | 业务类型，例如 `self-operated-internet`、`link-booth`、`mdu-ott` |
| `onu_type` | TEXT | ONU 类型，例如 `GPON-SFU` |
| `fixed_vlans_json` | TEXT | 固定 VLAN 规则 JSON |
| `dynamic_vlan_rules_json` | TEXT | 动态 VLAN 来源和识别规则 JSON |
| `port_rules_json` | TEXT | 物理口选择或固定映射 JSON |
| `command_template_json` | TEXT | 命令片段模板 JSON |
| `created_at` | TEXT | 创建时间 |
| `updated_at` | TEXT | 更新时间 |

### 默认模板规则

- 自营上网：内层 VLAN 固定 `3301`，外层 VLAN 使用 PON 口 `OUTERVLAN`，物理口由用户选择。
- 内部网络：VLAN 固定 `100`，不使用外层 VLAN，包含 `sn-bind disable`，物理口由用户选择。
- MDU+OTT：直播 VLAN `86`、默认 VLAN `90`、内网 VLAN `100` 固定；内层 VLAN、外层 VLAN、互动 VLAN 从同 PON 已配置样板 ONU 的 service-port 表动态读取。

## Seed 约定

- `data/olts.example.json` 和 `data/pon-ports.example.json` 可提交。
- `data/olts.json` 和 `data/pon-ports.json` 是本地真实数据，不提交。
- 初始化时优先读取真实 JSON，找不到时读取 example。
- 示例模板可以提交脱敏样例；真实现场模板若包含敏感地址、账号或凭据，必须保留在本地运行数据中。
- Telnet 用户名和密码只保存在本地 SQLite 或本地 `olts.json`，不得提交真实值。

## 后续改进

- 增加 schema version 表。
- 将迁移从内联 SQL 拆到 `scripts/` 或 `src/migrations/`。
- 为导入台账增加字段校验和错误报告。
