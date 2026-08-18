# 执行记录

## 2026-08-17

- 读取仓库上下文、开发状态、PRD、架构、API、数据库、时序和相关测试。
- 复核现有 NMSE-PON、本地 SQLite 备份、OSS/NGB 历史光功率和 Feishu Gateway 边界。
- 用户确认：扩展现有网管二期固定只读接口；以网管二期坐标为准并以 LOID 跨坐标匹配；手动加可选定时同步；冲突保留网管行并记录待处理；Feishu 使用 LOID 回显按钮和历史光功率按钮。
- 创建分支 `codex/nmse-ngb-merged-data`。
- 已 fork 当前任务并派发 5.6 Luna 执行网管二期 ONU 全量只读适配器与脱敏 fixture/测试；Luna 不修改数据库、API、前端或飞书，不提交 commit。
- Luna 已完成模块 1：src/oss-ngb-client.mjs 新增固定 DWR 全量分页读取和字段投影，tests/oss-ngb-client.test.mjs 新增分页、坐标、脱敏和失败关闭测试。
- Luna 回报专项测试 10/10、全量 pnpm test 211/211、node --check 和 git diff --check 通过；主代理已审查 diff，确认当前未修改数据库/API/前端/飞书。
- 进入模块 3：设计并实现统一合并表、冲突记录和同步前完整 SQLite 备份。
- 已实现初稿：`normalizeOssOnuRow()` 和 `OssNgbClient.readOnuInventory()`，复用固定 `OnuGridBO` DWR 分页，支持坐标字段解析、字段投影和重复坐标失败关闭。
- 首次专项测试发现分页夹具总量为 2、生产页大小为 500，夹具只会返回一页；调整入口允许 1-500 的受限页大小并用 `pageSize=1` 覆盖多页行为。
- 适配器专项测试 `node --test tests/oss-ngb-client.test.mjs` 通过 10/10；语法检查和 `git diff --check` 通过。
- 全量测试 `pnpm test` 通过 211/211（含版本检查）；本次仅修改 `src/oss-ngb-client.mjs` 与 `tests/oss-ngb-client.test.mjs`，未提交 commit。
- 模块 3 已实现：`merged_onu_snapshots`、`merged_onu_sync_runs`、`merged_onu_conflicts`、`merged_onu_dataset_state` schema；`createDatabaseBackup()`/`backupDatabaseBeforeSync()` 生成带原因和时间戳的完整 SQLite 快照并返回路径、字节数和 SHA-256。
- 新增 `src/merged-onu-sync.mjs` 纯函数合并服务：网管二期坐标和主字段优先，NMSE 仅补 username/LOID 来源；支持 LOID 跨 OLT 迁移、严格坐标回退、稳定 LOID/坐标规范化和冲突记录。
- 新增脱敏模块测试 6/6；全量 `pnpm test` 通过 217/217，`node --check src/db.mjs src/merged-onu-sync.mjs` 与 `git diff --check` 通过。
- 模块 4 已接入服务端：同步顺序为先本地完整备份、再网管二期 ONU、再 NMSE 全量用户、再纯函数合并和统一表事务替换；NMSE 读取复用 `resourceUserSync.readComplete()`，不再写旧快照表。
- 新增 `/api/admin/merged-onu/sync`、`sync/progress`、`runs`、`conflicts`、`status`；API 仅返回脱敏备份 basename、统计和冲突，不返回 CUID/FDN/token/Cookie。
- `createLocalOltDataGateway` 和 `/api/onus` 用户补充改用 merged 快照；首次同步前 Gateway 返回明确 `dataset:merged-unsynced`，不回退旧 `resource_user_snapshots`。
- restore 迁移补齐 merged_* 表；新增合并 API 合成测试和旧备份还原测试。专项 API 1/1、合并/备份专项 7/7、相关回归 17/17、全量 `pnpm test` 219/219 通过。
- 主代理审计发现 restore 旧备份迁移和“备份先于 NMSE 写入”需要在服务接线阶段补齐；已派发模块 4 给 5.6 Luna：服务端合并同步 API、统一快照接入和失败保留旧数据测试。
- 失败同步在备份成功后追加 `failed` 运行审计记录；重新执行 API 专项和全量测试仍为 1/1、219/219。
- 主代理已审计模块 4 的服务端接线：统一快照为 `/api/onus` 与本地 Gateway 数据源；下一阶段接入 Feishu ONU 详情的 LOID 回显与历史光功率，同时保持只读和授权范围。
- 模块 5/6 已完成 Feishu 接入：ONU 详情卡的数据继续来自 merged Gateway；新增不透明的“复制 LOID”和“ONU 历史光功率”绑定，回调重新校验 token、聊天和启用 OLT scope，并写入审计记录。
- 新增 `readOnuHistory` Gateway contract：严格 ONU 坐标、默认最近 7 天、最多 48 条，只读取本地 `onu_status_history`，不触发 OLT/NMSE；生产 Gateway 注入 `getOnuStatusHistory`，旧数据库历史汇总调用保持原有默认范围。
- Feishu 历史卡展示时间、相位、RX 光功率和距离，并明确“本地历史记录，不触发刷新”；无记录有明确提示。复制回调只发送 LOID 或“该 ONU 未提供 LOID”。
- 新增/更新 Feishu、Gateway 和历史数据合成测试；专项测试 47/47、全量 `pnpm test` 224/224、相关 `node --check` 和 `git diff --check` 通过，未连接真实飞书、OLT 或 NMSE。
- 模块 7 已完成桌面端接入：用户资源管理页新增“合并 ONU 数据同步”卡片，展示未同步/已同步、revision、最近完成、数量、冲突和阶段，手动调用全量同步 API并轮询进度；未登录资源系统或网管二期时按钮保持禁用，不自动填写或保存凭据。
- 同步 API 已移除部分 OLT 执行路径并拒绝 `body.oltId`，明确只支持全量同步，避免 `replaceMergedOnuDataset` 全表 DELETE 误删其它 OLT；合成 API 测试覆盖拒绝参数后再执行全量同步。
- 已更新 API、数据库、时序、架构和 CHANGELOG 文档，记录统一表、备份顺序、冲突、全量语义及 Feishu 本地历史限制；桌面静态契约测试通过。
- 最终验证：`pnpm test` 224/224、桌面/合并 API专项通过，相关 `node --check` 和 `git diff --check` 通过；未连接远端/现场，未使用真实凭据。
- 主代理审计模块 5/6：按钮顺序、透明数据投影、TTL/chat/OLT scope/重复回调校验和本地 7 天/48 条历史边界符合只读要求；进入最终管理界面、文档、构建和验收。
- 模块 7 已完成：资源管理页新增统一合并 ONU 同步卡片，显示 dataset/revision/数量/冲突/阶段并轮询进度；同步接口拒绝 `oltId` 部分参数，保持全量替换安全语义；补齐 API/数据库/时序/架构/CHANGELOG 文档。
- 主代理最终验证：`pnpm test` 224/224，`check:version` 1.1.3；相关 `node --check` 全部通过；`git diff --check` 通过；`pnpm build` 成功（仅有依赖注释和 bundle size 警告）。
- 用户现场测试反馈 NMSE-PON 全量同步过慢；定位到 ONU 分页固定 20 条。已改为优先请求 100 条、最多 8 路只读并发，兼容旧版静默限制 20 条的服务端并自动按 20 条计算页数；同步前备份和失败保留旧快照语义不变。
- 性能修复验证：`node --test tests/nmse-client.test.mjs tests/resource-user-sync.test.mjs` 13/13、全量 `pnpm test` 225/225、`pnpm build`、相关 `node --check` 和 `git diff --check` 通过；本地服务已重启至 8787。真实 NMSE 复测需用户在内置浏览器手动完成登录后点击同步。
- 完成网管二期密码保存增强：桌面版新增显式“本机自动登录”，使用 Electron `safeStorage` 加密保存到 SQLite 之外，重启后可后台自动登录；纯 Web/Node 环境仍要求迁移主密码，未降级为明文。新增自动登录存储单元测试，更新 API、数据库、时序、架构和 CHANGELOG 文档。
- 密码功能验证：自动登录存储/OSS 登录专项 6/6，全量 `pnpm test` 227/227，`pnpm build`、语法检查和 `git diff --check` 通过；本地服务已重启至 8787。当前 Codex 内置浏览器是纯 Web/Node 模式，因此不会显示桌面系统加密选项。
- 现场同步失败审计：最近一次运行网管二期读取 13,987 条、NMSE 读取 0 条，失败发生在 NMSE 阶段；原因此前被 API 泛化提示隐藏。已修复为 NMSE 阶段强制新建会话，分页期间遇到 401/会话过期时自动重新登录并重试当前 OLT，同时显示脱敏的 NMSE 超时/连接/会话错误。
- 会话失败修复验证：专项 11/11、全量 `pnpm test` 228/228、`pnpm build`、语法检查和 `git diff --check` 通过；本地服务已重启至 8787，等待重新登录后复测。
- 新需求开始：将同步逻辑拆为网管二期独立同步、NMSE-PON独立同步和本地手动合并；保留全量同步兼容入口，设计源快照与状态表以支持分步成功和失败重试。
- 已完成数据库拆分：新增网管二期源快照、NMSE-PON源快照、源 revision 状态；同步运行记录增加 full/network/nmse/merge operation，初始化和旧备份恢复均补齐迁移。
- 已完成服务端拆分：新增网管二期独立同步、NMSE-PON独立同步和本地手动合并 API；独立源失败不覆盖对应源快照，手动合并失败不覆盖旧统一快照，全量入口继续保留。
- 已完成桌面端和文档接入：资源管理页显示两套源状态，新增“同步网管二期”“同步 NMSE-PON”“手动合并”及保留的“全量同步”按钮；专项回归 11/11 通过。
- 最终验证：`pnpm test` 228/228、`pnpm build` 成功、`node --check` 通过、`git diff --check` 通过；Codex 内置浏览器刷新后确认四个入口和未登录禁用状态。
- 本次仍未连接真实网管二期/NMSE-PON，也未输入或保存现场凭据；真实现场应先分别验证两套源字段/分页与映射，再按“源同步 → 手动合并”操作。
- 复核并修正独立边界：NMSE-PON 源同步不再要求网管二期 IP 映射；网管二期源同步/全量同步仍严格要求映射。修正后专项通过，全量 `pnpm test` 仍为 228/228。
- 按最新要求复用既有用户快照链路：NMSE-PON 每个 OLT 的完整用户资料先写入 `resource_user_snapshots`，沿用地址清洗和标准化逻辑；随后从本地清洗快照仅抽取用户名、LOID、ONU 索引及来源 OLT，写入 NMSE 合并源表，供人工合并使用。
- 新增回归断言确认电话和安装地址等 NMSE 字段会保留在本地用户资料库，但不会进入网管二期主数据或最终合并投影；专项 8/8、全量 `pnpm test` 228/228、`pnpm build`、语法检查和 `git diff --check` 通过。
- 本次仍未连接真实 NMSE-PON、未输入现场凭据、未对远端系统执行写操作。
- 现场复测发现：登录和 OLT 发现成功，但 `pageSize=100` 的首个 ONU 列表请求长时间无响应；恢复现场兼容的 `pageSize=20` 后，首个 OLT 成功返回 3475 条、174 页，并以 8 路页并发持续读取。
- 已重启本地 WEB 并启动一次真实只读 NMSE 源同步复测；复测进度从 17 页/340 条推进到 33 页/660 条，未再出现首请求卡死或失败。完整现场同步仍在进行中。

## 2026-08-18

- 用户要求总结本阶段对话、现场测试经验和后续开发注意事项，写入项目相关文档。
- 新增 `docs/development-summary-2026-08-18-nmse-ngb-merged-data.md`，集中记录数据权威规则、LOID 跨坐标迁移、源快照/手动合并流程、现场字段别名、NMSE 分页超时经验、旧快照不自动补齐原因、继续开发 Runbook 和验证边界。
- 更新 `DEVELOPMENT_STATE.md` 的当前分支和最新状态；更新 `ARCHITECTURE.md`、`docs/design/api.md`、`docs/design/database.md`、`docs/design/sequence.md`、`CHANGELOG.md` 和本阶段 `task_plan.md`，补充 `STB_SN`、`CUSTNAME`、`MOBILE`、`WHLADDR` 以及 NMSE 缺失时保留网管二期联系人字段的规则。
- 本次文档整理不写入真实凭据、Cookie、token、CUID、FDN、现场用户资料或运行数据库；未改变远端只读边界。
- 复核 `docs/design/oss-resource-api.md`，补充 `STB_SN`、`CUSTNAME`、`MOBILE`、`WHLADDR` 的脱敏字段投影说明；修正 `docs/design/sequence.md` 对 NMSE 分页的过时表述为固定 `pageSize=20`。

## 错误记录

| 错误 | 尝试次数 | 处理 |
| --- | ---: | --- |
| 普通沙箱无法创建 Git ref lock | 1 | 使用授权的 `git switch -c` 成功；无代码或数据库损坏 |
| 多页适配器夹具只返回一页 | 1 | 修正夹具使用受限 `pageSize=1`，保留生产默认 500 |
| 普通沙箱禁止 API 测试监听回环端口 | 1 | 使用授权测试执行；不涉及远端或现场连接 |
| API fixture 假定示例 OLT 为 192.0.2.10 | 1 | 改为读取本地脱敏 seed 的第一个 OLT，仍使用合成映射 |
| 敏感字段断言误匹配 runId 中的 `merged-onu` | 1 | 缩小断言为 CUID/FDN/token/Cookie 等真实敏感字段 |
| 独立同步新增事件后旧 API 测试仍断言事件列表为空 | 1 | 改为记录独立同步前事件长度，确认 oltId 拒绝请求不触发远端读取 |
