# Database Design

当前数据层使用本地 SQLite，入口在 `src/db.mjs`。SQLite 文件属于运行时数据，不提交。

## 运行目录

- Web 开发模式默认使用仓库内 `data/olt-manager.sqlite`。
- 桌面版通过 `OLT_MANAGER_DATA_DIR` 指定用户数据目录，SQLite、台账和日志写入用户数据目录，不写入安装目录。
- Seed 目录可通过 `OLT_MANAGER_SEED_DIR` 指定；桌面版从安装包内 `data/*.example.json` 读取脱敏示例 seed。
- SQLite CLI 路径可通过 `OLT_MANAGER_SQLITE_BIN` 指定；未指定时优先使用包内或系统 `sqlite3`。
- Windows 7 x64 桌面发行包必须内置 `bin/win32/sqlite3.exe`，避免用户额外安装 SQLite；该文件使用固定 legacy Windows x86 SQLite CLI，避免新版 x64 CLI 的 Win7 entry-point 兼容问题。该 CLI 是打包运行库，必须受 git 跟踪，不能被 `.gitignore` 排除。
- Windows 安装版启动时由 Electron 主进程检测 `resources/app/bin/win32/sqlite3.exe` 和 `resources/bin/win32/sqlite3.exe`，并把存在的路径写入 `OLT_MANAGER_SQLITE_BIN`，所以用户不需要把 SQLite 加入 PATH；只有需要替换 SQLite CLI 时才手动配置该环境变量。

## 表：olts

保存 OLT 基本信息。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | TEXT PRIMARY KEY | OLT 逻辑 ID |
| `name` | TEXT | 展示名称 |
| `vendor` | TEXT | 厂商，例如 `zte`、`huawei` |
| `model` | TEXT | 型号 |
| `device_profile` | TEXT | 设备适配键，例如 `zte-c300`、`zte-c600`、`huawei-ma5800`；配置模板和防误用逻辑使用该字段 |
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
| `chassis` | TEXT | 槽；ZTE 旧台账默认补 `1`，Huawei 旧台账默认补 `0` |
| `board` | TEXT | 板卡 |
| `pon` | TEXT | PON 口 |
| `pon_port` | TEXT | 兼容字段，规范格式为 `槽/板卡/PON`，如 ZTE `1/9/16`、Huawei `0/1/0` |
| `outer_vlan` | TEXT | 外层 VLAN |
| `address` | TEXT | 地址或现场备注 |

### 台账导入导出约定

- 页面中的 Excel 导入导出只面向 `pon_ports` 本地台账。
- Excel 表头支持 `OLT IP`、`槽`、`板卡`、`PON`、`板槽端口`、`外层 VLAN`、`地址`。
- 导入时前端会把 Excel 行转换为 `oltIp`、`ponPort`、`outerVlan`、`address` 后提交给 `/api/admin/import-pon-ports`。
- 旧 `PON=板卡/PON` 两段台账仍可导入，后端按 OLT 厂商补齐默认槽；新台账应使用 `槽/板卡/PON` 三段格式。
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

## 表：onu_status_history

保存 ONU 查询时产生的本机只读状态采样，用于详情页趋势和离线统计。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT | 记录 ID |
| `olt_id` | TEXT | OLT 逻辑 ID |
| `olt_ip` | TEXT | OLT 地址快照 |
| `chassis` / `board` / `pon` / `onu_id` | TEXT | ONU 坐标 |
| `serial` | TEXT | ONU 序列号快照 |
| `phase` | TEXT | 采样时状态 |
| `rx_power` | TEXT | 采样时 RX 光功率 |
| `distance` | TEXT | 采样时 ONU 距离 |
| `last_online_time` | TEXT | 设备返回的最近上线时间 |
| `last_offline_time` | TEXT | 设备返回的最后离线时间 |
| `last_offline_cause` / `last_offline_cause_code` | TEXT / INTEGER | 设备返回的离线原因及原因码；ZTE 代码标签按当前代码表写入，应用启动时会迁移已保存的 1/2/3/4/8/9/10 历史标签 |
| `sampled_at` | TEXT | 本机采样时间 |

约定：

- 同一 ONU 的相同状态在 5 分钟内去重，最多保留 30 天；查询详情时只读取本地历史表。
- 采样仅由只读 ONU 查询触发，不执行任何 OLT 写操作，也不把历史数据写回设备。
- 光功率趋势和离线次数属于本机采样统计；采样不足时页面显示暂无历史采样，不补造历史数据。

## 表：projects

保存本地项目资料。项目只用于本地项目管理和后续项目模板，不绑定单台 OLT，也不对应 OLT 实机对象。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | TEXT PRIMARY KEY | 项目 ID |
| `name` | TEXT UNIQUE | 项目名称，全局唯一，大小写不敏感 |
| `vlan` | INTEGER | 项目 VLAN，必须是 `1-4094` 范围内的单个 VLAN |
| `address` | TEXT | 项目地址，可为空 |
| `contact_name` | TEXT | 联系人姓名，可为空 |
| `contact_phone` | TEXT | 联系人电话，可为空 |
| `contact_note` | TEXT | 联系人备注，可为空 |
| `created_at` | TEXT | 创建时间 |
| `updated_at` | TEXT | 更新时间 |

### 项目管理约定

- 项目名称作为用户可见标识，保存和更新时按大小写不敏感方式检查全局唯一。
- 项目 VLAN 在保存时校验为 `1-4094` 的单个 VLAN。
- 项目地址和联系人字段均为选填。
- 项目数据属于本地运行数据，写入用户数据目录中的 SQLite，不提交真实现场项目资料。
- 项目新建、编辑和删除会记录 `admin_events`，但不会连接 OLT 或执行任何设备命令。

## 表：project_onus

保存本地项目与 ONU 的关联。`ONU 数据查询` 可以把已注册 ONU 加入项目并保存加入时的本地快照；项目详情可以读取项目 ONU、编辑项目 ONU 备注并移除本地项目 ONU 关联。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT | 关联 ID |
| `project_id` | TEXT | 项目 ID |
| `olt_id` | TEXT | OLT 逻辑 ID |
| `chassis` | TEXT | 槽 |
| `board` | TEXT | 板卡 |
| `pon` | TEXT | PON 口 |
| `onu_id` | TEXT | ONU/ONT ID |
| `serial` | TEXT | 加入项目时保存的序列号快照 |
| `address` | TEXT | 加入项目时保存的地址快照 |
| `vlan` | TEXT | 加入项目时保存的 VLAN 快照 |
| `note` | TEXT | 项目 ONU 备注 |
| `created_at` | TEXT | 创建时间 |
| `updated_at` | TEXT | 更新时间 |

约束：

- `olt_id + chassis + board + pon + onu_id` 唯一，保证同一个 ONU 只能归属一个项目。
- 删除项目时只删除本地 `project_onus` 关联，不删除本地 ONU 台账，不删除 OLT 实机 ONU，不执行设备命令。
- 项目详情移除 ONU 只删除本地 `project_onus` 单条关联，不删除本地 ONU 台账，不删除 OLT 实机 ONU，不执行设备命令。
- 项目详情刷新状态失败时保留 `serial`、`address`、`vlan`、`note` 等加入项目时保存的快照。

## 表：config_templates

保存本地配置方案模板。模板属于本地运行数据，可以从示例文档导入或由页面维护；真实现场模板、账号、密码和凭据不得提交。

## 用户资源管理表

- `resource_management_config`：单行本机资源服务器地址、用户名和密码；密码只供后端登录使用，读取 API 不返回该字段。
- `oss_resource_config`：单行 OSS/NGB 非敏感连接配置；只保存两个基地址、用户名、组织名称和机房名称，不存在原始密码、Cookie、token 或 CUID 列。
- `oss_resource_credential`：单行跨平台登录密文；保存格式版本、scrypt 参数、salt、nonce、认证标签和 AES-GCM 密文，不保存原始登录密码或迁移主密码。
- `resource_olt_ip_mappings`：保存网管二期支撑网 IP 与 `olts.host` 管理 IP 的一一对应关系；详细约束见下节。
- `resource_sync_tasks`：本地 NMSE-PON 用户信息同步任务，保存目标 OLT、下一次执行时间、重复间隔天数、状态、上次执行结果、同步条数和脱敏错误摘要；不保存 token、Cookie 或用户响应。重复间隔为 0 表示一次性任务，1-365 表示按天重复。
- `resource_user_snapshots`：以 `olt_ip + onu_index` 唯一保存当前 OLT 全量用户快照，包括 LOID、MAC、PON、设备类型、用户名、电话、装机地址、gridRank 与同步时间。
- `resource_user_checkpoints`：本地调试用的有限页用户检查点，包含预期总量和已完成页数；与正式用户快照分表，不能作为完整快照使用。
- `resource_pon_vlan_snapshots`：保存 NMSE 每个板卡/PON 的 SVLAN、同步前本地外层 VLAN和同步时间。
- `resource_olt_vlan_snapshots`：保存 OLT 级 CVLAN 起止范围、分配方式、gridRank 与同步时间。
- `merged_onu_snapshots`：统一 ONU 最终快照，以 `olt_ip + chassis + board + pon + onu_id` 为主键；保存网管二期主字段（含设备号）、当前坐标、LOID、最终用户名及 `username_source`，并记录 NMSE 来源坐标/OLT和同步时间。仅保存字段级投影，不保存原始响应、CUID、FDN、Cookie、token、密码或设备访问字段。
- `merged_onu_network_snapshots`：网管二期全量 ONU 字段级源快照，以网管二期 OLT 和槽/板卡/PON/ONU ID 为主键；保存设备号并在独立网管二期同步成功后整体替换。
- `merged_onu_nmse_snapshots`：从完整 NMSE-PON 用户资料清洗提取出的合并源快照，只保存 OLT、ONU 索引、LOID、姓名、电话和装机地址；独立 NMSE-PON 同步成功后整体替换。完整用户资料先写入兼容的 `resource_user_snapshots`，再从本地快照提取合并字段。
- `merged_onu_source_state`：两套源快照各自的 opaque revision、数量和更新时间；允许一套成功、另一套失败后稍后重试。
- `merged_onu_sync_runs`：保存全量、网管二期源、NMSE-PON 源或手动合并运行状态、网络/NMSE/合并/冲突数量、脱敏备份摘要、错误和时间。
- `merged_onu_conflicts`：保存运行 ID、冲突原因、脱敏坐标/LOID和处理说明；正常行不因单行冲突丢弃。
- `merged_onu_dataset_state`：单行 opaque dataset revision 和更新时间；只有统一表事务替换成功后才更新。

用户与 VLAN 快照均是本地运行数据，不得提交。用户同步先读取第 1 页确定总量，剩余页最多 8 路独立会话并发读取；只有完整远端分页全部成功后才以事务替换同 OLT 旧快照。正式快照和调试检查点写入前都调用 `normalizeResourceInstallationAddress()` 清洗装机地址：去除末尾 `#`；识别“编号 + 片区”后重复拼接前段行政区后缀的结构，删除污染的前缀和中间片区/小区标签；仅在同名道路后紧接同名村时压缩前一段道路名，并保留第二段实际地址。连续的重复前缀会迭代清洗至稳定。规则不依赖特定村名，保留镇、街道等有效行政区名称，并且幂等。检查点仅替换同 OLT 旧检查点。VLAN 同步只更新本地已存在且板卡/PON 匹配的台账行。

### 表：oss_resource_config

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | INTEGER PRIMARY KEY | 固定为 `1` 的单行配置 |
| `auth_base_url` | TEXT | OSS 统一认证 HTTP(S) 基地址 |
| `ngb_base_url` | TEXT | NGB HTTP(S) 基地址 |
| `username` | TEXT | OSS 用户名 |
| `organization_name` | TEXT | 运行时动态查找的组织展示名称 |
| `room_name` | TEXT | OLT 列表投影后的机房筛选名称 |
| `updated_at` | TEXT | 最近保存时间 |

该表刻意不设置原始密码字段。登录密码只在登录请求、解密过程和当前 Node 进程调用栈中短暂存在；保存后的密文使用迁移主密码派生的 AES-256-GCM 密钥保护。迁移主密码不进入 SQLite、备份、日志或 API。登录成功后的 Cookie、token、组织/OLT/ONU CUID 也只属于内存会话，不进入 SQLite 或组合备份。保存配置会清除旧会话，服务重启或迁移到 Win7 后需重新输入迁移主密码解锁密文。

### 表：oss_resource_credential

| 字段 | 类型 | 说明 |
|---|---|---|
| `format_version` | INTEGER | 密文格式版本 |
| `algorithm` | TEXT | 当前为 `aes-256-gcm` |
| `kdf` | TEXT | 当前为 `scrypt` |
| `kdf_n/kdf_r/kdf_p` | INTEGER | KDF 参数 |
| `salt` | TEXT | Base64 salt |
| `iv` | TEXT | Base64 AES-GCM nonce |
| `auth_tag` | TEXT | Base64 GCM 认证标签 |
| `ciphertext` | TEXT | Base64 登录密码密文 |

该表由完整 SQLite 备份自动包含。还原到另一台机器后，用户必须手工输入迁移主密码；备份文件本身无法单独解密登录密码。

### 备份还原约定

完整项目 SQLite 备份包含 `oss_resource_config`、`oss_resource_credential` 和 `resource_olt_ip_mappings`，因此还原后可恢复网管二期的非敏感配置、本地 IP 映射和加密登录密文。网管二期登录密码明文、迁移主密码、Cookie、token、组织/OLT/ONU CUID 和原始响应不进入 SQLite 备份；桌面版本机自动登录凭据由系统加密存储在 SQLite 之外，也不随项目备份迁移；还原后不会自动建立网管二期会话。

### 表：resource_olt_ip_mappings

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `resource_ip` | TEXT PRIMARY KEY | 网管二期支撑网 IP |
| `olt_ip` | TEXT NOT NULL UNIQUE | 必须已存在于本机 `olts.host` 的管理 IP |
| `source` | TEXT NOT NULL | 映射来源，默认 `oss-ngb` |
| `synced_at` | TEXT NOT NULL | 确认或同步时间 |

应用层写入时校验两端 IPv4、一一对应关系和目标 OLT 是否存在；这里不使用外键，是为了兼容既有 `olts` 表结构和数据库恢复流程。替换映射不会修改 `olts.host`、启用设备或填入 SNMP/Telnet 凭据。缺少只读 profile 或凭据的 OLT 必须保持停用。真实映射属于本机运行数据，不进入 seed、测试固件或可提交文档。

## 统一合并 ONU 数据集

源同步和统一合并均是全量替换：网管二期源同步或 NMSE-PON 源同步先在 `dataRoot/backups` 生成完整 SQLite 快照并执行 `integrity_check`，只替换对应源表；手动合并再次备份后只读取两套本地源快照，最后事务替换 `merged_onu_snapshots` 并更新 dataset revision。各同步 API 拒绝 `oltId` 部分同步参数，避免全表 DELETE 语义下误删其它 OLT；独立同步失败不覆盖对应旧源快照，合并失败不覆盖旧统一快照和旧 revision。

`merged_onu_snapshots` 的联合主键为 `olt_ip + chassis + board + pon + onu_id`，网管二期坐标、设备号、设备状态等设备字段为主；NMSE-PON 提供姓名、电话、装机地址以及 LOID 来源坐标，电话和装机地址在 NMSE 有非空值时优先采用。当 NMSE 没有匹配记录或对应字段为空时，保留网管二期源快照中的联系人字段，避免合并结果无故变成空白。现场网管二期设备号和联系人字段通过适配器白名单映射进入源表，当前已兼容 `STB_SN`、`CUSTNAME`、`MOBILE`、`WHLADDR` 等字段别名。冲突写入 `merged_onu_conflicts`，不丢弃其它正常行。`merged_onu_sync_runs` 记录运行统计、冲突数量和脱敏备份摘要，`merged_onu_dataset_state` 保存 opaque revision。表中不保存原始响应、CUID、FDN、Cookie、token、密码或设备访问字段。

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

- 默认模板按 `device_profile` 绑定：当前支持 `zte-c300` 和 `huawei-ma5800`；`zte-c600` 可录入但暂不生成配置方案。
- 自营上网：内层 VLAN 固定 `3301`，外层 VLAN 使用 PON 口 `OUTERVLAN`，物理口由用户选择。
- 内部网络：VLAN 固定 `100`，不使用外层 VLAN，包含 `sn-bind disable`，物理口由用户选择。
- ZTE 自定义 VLAN：复用内部网络命令结构，VLAN 由用户在生成方案时输入，不使用外层 VLAN，包含 `sn-bind disable`，物理口由用户选择。
- MDU+OTT：直播 VLAN `86`、默认 VLAN `90`、内网 VLAN `100` 固定；内层 VLAN、外层 VLAN、互动 VLAN 从同 PON 已配置样板 ONU 的 service-port 表动态读取。
- Huawei 自营上网：内层 VLAN 固定 `3301`，外层 VLAN 使用 PON 口 `OUTERVLAN`，物理口可在 `eth1` 到 `eth4` 中选择，默认 `eth1`。
- Huawei 内部网络：VLAN 固定 `100`，物理口可在 `eth1` 到 `eth4` 中选择，默认全选，为所选端口生成 `native-vlan ... priority 0`，并生成 `service-port vlan 100`。
- Huawei 自定义 VLAN：复用内部网络命令结构，VLAN 由用户在生成方案时输入，不使用外层 VLAN，物理口可在 `eth1` 到 `eth4` 中选择，默认全选。

## Seed 约定

- `data/olts.example.json` 和 `data/pon-ports.example.json` 可提交。
- `data/olts.json` 和 `data/pon-ports.json` 是本地真实数据，不提交。
- 初始化时优先读取真实 JSON，找不到时读取 example。
- `pnpm run seed:sample` 会只读当前 SQLite，随机抽取少量 OLT 和 PON 台账，脱敏输出到 `data/sample-seed/`。
- `pnpm run reset:data` 会删除本地 `olts.json`、`pon-ports.json`、`*.sqlite` 运行库，并从 example seed 重新生成调试数据；现场库调试时应改用临时 `--data-dir`。
- 桌面版初始化时从 seed 目录读取 example，只把运行库写到用户数据目录。
- `data/*.sqlite`、`data/*.sqlite-*` 属于本地运行数据，继续忽略且不得提交；`bin/win32/sqlite3.exe` 是 Win7 ZIP 的 SQLite CLI 依赖，必须提交到仓库。
- 示例模板可以提交脱敏样例；真实现场模板若包含敏感地址、账号或凭据，必须保留在本地运行数据中。
- Telnet 用户名和密码只保存在本地 SQLite 或本地 `olts.json`，不得提交真实值。
- PON 台账中可能包含现场地址，应按本地运行数据处理；导出的 Excel 不应提交到公共仓库。

## 后续改进

- 增加 schema version 表。
- 将迁移从内联 SQL 拆到 `scripts/` 或 `src/migrations/`。
- 为导入台账增加字段校验和错误报告。
