# Database Design

当前数据层使用本地 SQLite，入口在 `src/db.mjs`。SQLite 文件属于运行时数据，不提交。

## 运行目录

- Web 开发模式默认使用仓库内 `data/olt-manager.sqlite`。
- 桌面版通过 `OLT_MANAGER_DATA_DIR` 指定用户数据目录，SQLite、台账和日志写入用户数据目录，不写入安装目录。
- Seed 目录可通过 `OLT_MANAGER_SEED_DIR` 指定；桌面版从安装包内 `data/*.example.json` 读取脱敏示例 seed。
- SQLite CLI 路径可通过 `OLT_MANAGER_SQLITE_BIN` 指定；未指定时优先使用包内或系统 `sqlite3`。
- Windows 7 x64 桌面发行包必须内置 `bin/win32/sqlite3.exe`，避免用户额外安装 SQLite；该文件使用固定 legacy Windows x86 SQLite CLI，避免新版 x64 CLI 的 Win7 entry-point 兼容问题。
- Windows 安装版启动时由 Electron 主进程检测 `resources/app/bin/win32/sqlite3.exe` 和 `resources/bin/win32/sqlite3.exe`，并把存在的路径写入 `OLT_MANAGER_SQLITE_BIN`，所以用户不需要把 SQLite 加入 PATH；只有需要替换 SQLite CLI 时才手动配置该环境变量。

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

### 台账导入导出约定

- 页面中的 Excel 导入导出只面向 `pon_ports` 本地台账。
- Excel 表头使用 `OLT IP`、`PON`、`外层 VLAN`、`地址`。
- 导入时前端会把 Excel 行转换为 `oltIp`、`ponPort`、`outerVlan`、`address` 后提交给 `/api/admin/import-pon-ports`。
- Excel 导出不包含 OLT 凭据、SNMP community 或设备配置输出。
- 当前导入语义为整表替换本地台账；后续可增加差异预览和字段级错误报告。

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
- `pnpm run seed:sample` 会只读当前 SQLite，随机抽取少量 OLT 和 PON 台账，脱敏输出到 `data/sample-seed/`。
- `pnpm run reset:data` 会删除本地 `olts.json`、`pon-ports.json`、`*.sqlite` 运行库，并从 example seed 重新生成调试数据；现场库调试时应改用临时 `--data-dir`。
- 桌面版初始化时从 seed 目录读取 example，只把运行库写到用户数据目录。
- 示例模板可以提交脱敏样例；真实现场模板若包含敏感地址、账号或凭据，必须保留在本地运行数据中。
- Telnet 用户名和密码只保存在本地 SQLite 或本地 `olts.json`，不得提交真实值。
- PON 台账中可能包含现场地址，应按本地运行数据处理；导出的 Excel 不应提交到公共仓库。

## 后续改进

- 增加 schema version 表。
- 将迁移从内联 SQL 拆到 `scripts/` 或 `src/migrations/`。
- 为导入台账增加字段校验和错误报告。
