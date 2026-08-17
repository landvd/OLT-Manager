# 现状发现

- 当前实际分支已创建为 `codex/nmse-ngb-merged-data`。
- 当前 SQLite 入口为 `src/db.mjs`，已有完整数据库备份/校验/还原能力。
- 当前 NMSE-PON 用户快照表为 `resource_user_snapshots`，主键为 `olt_ip + onu_index`，现有同步流程支持完整分页和事务替换。
- 当前网管二期适配器 `src/oss-ngb-client.mjs` 已支持组织树、OLT 发现、ONU 精确坐标查找和历史光功率，但尚未提供 ONU 全量投影。
- 当前 `src/olt-data-gateway.mjs` 的用户查询读取 NMSE 快照，Feishu 通过进程内只读 Gateway 访问。
- 当前数据库已有 `onu_status_history`，用于本机只读光功率历史；网管二期历史光功率通过固定 OSS/NGB 适配器实时读取。
- 当前 Feishu ONU 详情卡片已有“一级地址光功率查询”动作，但没有 LOID 回显动作和历史光功率动作。
- Git 分支首次创建在普通沙箱中因 Git ref lock 权限失败，使用授权的普通 `git switch -c` 成功；未发生代码或数据库写入。
- 当前 `runMergedOnuSync()` 将网管二期读取、NMSE-PON读取和最终合并作为单一运行，远端数据只在内存中存在；现有 `merged_onu_snapshots` 只保存最终结果，缺少可供人工合并的两套源快照。
- 当前桌面端合并卡片只有一个全量同步按钮，并要求两套系统同时登录；拆分后应分别按对应登录状态启用，手动合并不要求远端登录。
- 新增 `merged_onu_network_snapshots`、`merged_onu_nmse_snapshots` 和 `merged_onu_source_state`，同步运行记录增加 operation；独立源同步只替换对应源表，手动合并只读源表。
- API 新增 `/api/admin/merged-onu/sync/network`、`/sync/nmse` 和 `/merge`，旧 `/sync` 全量快捷入口保留；桌面端按对应登录状态启用三个独立按钮和全量按钮。
- NMSE-PON 独立同步不依赖网管二期 IP 映射；只有网管二期源同步和全量同步校验 `resource_olt_ip_mappings`，已用“清空映射后 NMSE 仍成功”回归覆盖。
- 完整 NMSE 用户资料应先落入既有 `resource_user_snapshots`，再在本地清洗后抽取合并字段；这样可保留电话、地址等资料供本地追溯，同时遵守“网管二期为主、NMSE-PON 只补用户名/LOID/ONU索引”的统一合并边界。
- 当前提取链路使用本地标准化 `onuIndex`，可覆盖 `1/3/12:8` 与 `1/3/12/8` 等坐标展示差异；跨 OLT 迁移仍通过不变 LOID 在合并阶段关联。
- 现场 NMSE-PON 对 `pageSize=100` 请求不兼容：登录、组织树和 OLT 发现均正常，但首个 ONU 列表请求不返回；兼容的 `pageSize=20` 可正常返回数据。该现场行为不能仅用“服务端静默限制 20 条”推断，必须避免发送 100 行请求。
