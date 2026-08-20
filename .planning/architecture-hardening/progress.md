# 执行记录

## 2026-08-19

- 已从 `main` 创建分支 `codex/architecture-hardening-20260819`。
- 已建立本次实施的独立规划目录，保留既有架构审查记录。
- Luna 子任务已回收：本地登录、凭据提供器、Win7 图标、Feishu 设备号/帮助、历史光功率 seam 均已落地。
- 主线程已补齐：API 敏感 OLT 投影脱敏、空字段保留既有凭据、设备号生产 Gateway 查询、OSS/NGB 历史光功率注入、CLI 回环自动化边界，以及备份目录忽略规则。
- 验证：整合阶段全量 Node 测试 249/249 通过；`pnpm build` 通过；版本检查通过；`git diff --check` 通过。构建仍保留既有的单 JS chunk 较大警告，未纳入本轮功能变更。
- 修正认证测试绕过边界后最终验证：全量测试 250/250 通过；非回环地址不能关闭认证的测试通过。

## 继续整治（2026-08-19）

- 重新读取规划文件，确认上一阶段已完成，新增 NMSE 凭据迁移、定时任务安全解锁和服务端模块化阶段。
- 当前实施焦点：先清除 NMSE 密码明文持久化，再处理无解密材料时的定时任务失败关闭。
- Luna 凭据阶段已完成；SOL 验收发现全量测试 250/250 通过，专项语法和 diff 检查通过。
- Luna 第二阶段已启动：只提取资源定时任务调度器，采用依赖注入，避免继续扩大 `server.mjs` 单文件职责。
- 定时任务调度器已验收：全量测试 253/253、构建、语法检查和 diff 检查通过。
- Luna 第三阶段已启动：抽出前端本地认证客户端，保持 `main.js` 业务状态逻辑不变。
- Luna 第三阶段已完成：新增 `src/local-auth-client.mjs` 与 5 项基础测试；SOL 复核发现会话恢复必须显式携带已有 Bearer，已在 `main.js` 补齐并将该边界加入第 6 项测试。
- 前端认证切片定向验收：6/6 通过，`src/main.js` 与认证客户端语法检查通过，`git diff --check` 通过。
- 开始最终验收：准备运行全量测试、构建、版本检查和关键只读安全回归。
- 最终验收：全量测试 259/259 通过；`pnpm build`、`pnpm run check:version`（1.1.4）、关键模块 `node --check`、`git diff --check` 全部通过。
- `pnpm run dist:dir` 成功生成 macOS arm64 目录包；日志确认托盘 PNG 和 Windows ICO 均被纳入资源布局。
- `pnpm run dist:win` 已完成 Windows x64 目录打包和 `--set-icon assets/generated/olt-manager.ico` 注入阶段，但当前 Apple Silicon 主机的旧版 x86 Wine 在 rcedit 阶段报 `bad CPU type in executable`，无法在本机继续生成 ZIP；需在 Windows/GitHub Actions 复验最终 ZIP。
- 本轮 SOL 验收结论：代码与自动化验证完成，保留真实 Windows 7 机器/CI 的最终桌面验收作为发行前门禁。

## 架构二期整治（2026-08-19）

- 用户要求继续处理：`server.mjs`/`main.js` 拆分、SQLite 迁移、同步 manifest 与恢复、入口生命周期、备份策略、代码分包和 `asar` 评估。
- SOL 已完成初步拆分：SQLite 迁移、同步状态、备份策略、运行时生命周期、前端模块、Vite 分包和 `asar` 评估分别限制写入范围；核心大文件不允许多 Luna 任务并行修改。
- 已创建 13-20 阶段，下一步先派发 13-15 三个低耦合 Luna 子任务；每个子任务完成后由 SOL 做定向验收再进入整合。
- 已派发 Luna 子任务：13 SQLite 迁移、14 多源 manifest、15 备份策略，分别使用不重叠写入范围。
- 13-20 的后续 Luna 槽位当前受并发限制，16-19 将在前一批完成并回收后继续派发；不让多个 agent 同时改动 `server.mjs` 或 `main.js`。
- 第一批切片已回收：13 SQLite 迁移、14 manifest 基础模块、15 备份策略基础模块、16 生命周期协调器、17 状态工厂、18 Vite 分包、19 asar 布局契约。
- SOL 交叉定向回归：52/52 通过；全量 `pnpm test`：295/295 通过；`pnpm build` 通过。代码分包后入口约 134 KB，Element Plus chunk 仍约 774 KB并保留体积提示。
- 当前真实未完成项被重新拆为 21-25：manifest/恢复接入、备份运行时接入、server 领域服务拆分、main.js 业务域拆分、最终验收。
- 原第 21 项一次性接入 server/db 范围过大，Luna 未形成稳定产出后已停止；改为 21A（SQLite 持久化 API）和 21B（server 阶段写回）两个串行切片，避免半成品进入服务端。
- 已重新派发 21A 给 Luna，写入范围仅为 `db.mjs`、恢复测试和 ADR-015。
- 21A 的 SQLite recovery API 已由 SOL 补充 4 项临时目录测试并通过；21B server 阶段写回已派发给 Luna。
- 22A 已派发给 Luna：只做安全目录枚举、候选清理和 dry-run/confirmed 双阶段，不把现有未加密 SQLite 误标为安全。
- 21A SOL 定向验收：临时目录测试 4/4 通过；幂等键重复拒绝、过期租约接管、source manifest 脱敏持久化和成功后恢复列表清空均成立。
- 21B Luna 已完成第一轮 server 接入；SOL 验收：合并 ONU API 回归 1/1 通过（需授权本机回环监听），同步恢复测试 4/4 通过。启动时会刷新可恢复任务，源同步/手动合并/全量合并均写入阶段、manifest、lease 和结果状态。
- 22A Luna 已完成；定向测试 13/13 通过。清理仅允许明确的绝对备份根目录、受信 sidecar、摘要/完整性元数据和 `.sqlite.enc`，默认 dry-run，确认后仍执行计划二次校验；未加密完整 SQLite fail-closed。
- 23/24 已分别派发给 Luna，写入范围分离：23 仅服务端合并同步运行时纯函数，24 仅 ONU 列表视图状态纯模块；等待回收后由 SOL 做交叉回归。
- 23/24 已回收：服务端新增 `merged-onu-runtime.mjs`，前端新增 `onu-list-state.mjs`；两项各自定向测试通过，未移动设备读取或改变 UI/API 字段契约。
- 交叉定向回归首轮 46 项中发现并修正迁移恢复测试遗漏的 v3 断言，修正后迁移、恢复、manifest、租约、API、运行时和前端切片合计 17/17 通过。
- 第二批 SOL 最终验收：`pnpm test` 311/311 通过，`pnpm build` 通过，关键 ESM/CJS 语法检查和暂存区/工作区 diff 检查通过；构建仍提示 Element Plus chunk 约 774 KB，属于后续按需加载优化，不阻断本轮拆分。
- 本轮仍明确保留：22B 尚未接入完整加密备份容器、密钥输入和恢复 UX；`asar:false` 仅完成布局契约和恢复评估，未强行切换；Windows 7 实机/CI 最终托盘和发行 ZIP 验收仍需发行环境完成。

## 架构三期整治（2026-08-19）

- SOL 重新盘点后确认：当前最安全的顺序是先建立可独立测试的加密 SQLite 容器格式，再评估导出/导入密钥 UX；不在密钥生命周期未确定时直接修改现有备份 API。
- 新增 26A-30 阶段：加密容器格式、server 合并域拆分、main 项目 ONU 状态拆分、Element Plus 按需加载评估和第三批最终验收。
- 26A Luna 已完成：新增版本化 AES-256-GCM/scrypt 加密 SQLite 容器纯模块，限制容器大小，绑定用途 AAD、明文摘要和大小校验；3/3 专项测试通过。尚未接入现有导出/导入 API。
- 27 Luna 已完成第一刀：新增 `merged-onu-service.mjs`，通过依赖注入抽取 OLT 目标选择、NMSE 投影和本地用户转合并行；4/4 专项/API 测试通过。
- 28 Luna 已完成第一刀：新增 `project-onu-state.mjs`，抽取项目 ONU 行归一化、列表替换、选择和删除后的纯状态；4/4 专项测试通过。
- 29 Luna 已完成评估：当前 `main.js` 全局注册 Element Plus 并使用约 31 类组件和 `v-loading`，仅调整 manualChunks 不会缩小 vendor；`vendor-element-plus` 仍约 773.56 kB（gzip 244.63 kB），已新增 ADR-024 和 2 项构建门禁测试，未强行改入口。
- 26B 准备拆为后端导出/导入 seam 与前端/Electron 密钥 UX 两段；本轮先让 Luna 实现后端密文容器接入和导入前校验，主密码不落盘、不回显。
- 26B Luna 已完成：新增受本地认证保护的加密备份导出/导入接口，限制 Content-Type 和请求体大小；导入顺序为解密、SQLite 核心表/integrity 校验、原子恢复，失败不替换旧库。专项测试 2/2 通过。
- 第三批 SOL 本地验收：`pnpm test` 325/325 通过，`pnpm build` 通过；构建 chunk 与 Element Plus 评估基线一致，关键 ESM/CJS 语法和暂存区/工作区 diff 检查通过。
- 第三期当前收敛点：加密后端 seam 已具备自动化基础，但 26C 尚未把密码输入接入 Web/Electron 备份页面；Windows 7 实机/CI ZIP、托盘和 `asar:false` 发行门禁仍需真实发行环境验证。
- 26C 已派发给 Luna：只改备份页面和 renderer 请求，支持加密 SQLite 导出/导入；组合备份、旧明文 SQLite 导出和 Electron IPC 恢复流程保持不变。
- 26C Luna 已完成：备份页面新增密码确认、加密 `.sqlite.enc` 导出/导入，失败或请求结束清空字段；未使用 prompt、localStorage 或 URL，不改 Electron IPC。专项测试 3/3 通过；SOL 补充 ADR-026 并修正格式化细节。
- 26C 后最终回归首次出现 1 项测试失败：篡改测试修改 JSON 末字节，导致非确定性地命中格式校验而非 GCM 校验；已改为保持容器格式有效、只修改密文内容，继续要求 `BACKUP_DECRYPT_FAILED`。
- 修正后 SOL 第三批最终回归：`pnpm test` 328/328 通过；加密容器/API/UI、迁移、同步恢复、服务拆分和项目 ONU 状态切片均纳入全量测试。

## 架构四期整治（2026-08-19）

- SOL 重新划分后续工作：先建立不具备删除权限的可注入清理调度器，再评估服务端定时器接入；同时继续从 `main.js` 抽取备份页面纯逻辑。
- 已派发 31/32 两个 LUNA 子任务，写入范围分离；不让调度器和页面模块同时修改服务端或数据库。
- 31 已由 Luna 完成；SOL 验收并收紧为“定时回调永远 dry-run”，`start({ confirmed: true })` 明确拒绝，只有一次性 `trigger({ confirmed: true })` 可以执行计划。
- 32 已由 Luna 完成；加密备份页面的状态初始化、密码校验、密码清理和文件识别已抽到 `src/backup-view-state.mjs`，请求路径、密码生命周期和旧备份分支保持不变。
- 架构四期专项回归：备份调度器、备份视图状态和加密备份 UI 共 13/13 通过。
- 架构四期最终本地验收：`pnpm test` 338/338 通过，`pnpm build` 通过；构建入口约 138 KB，Element Plus vendor chunk 约 773.56 KB 的既有警告保持不变。
- 本批不接入服务端定时器：自动删除仍需跨进程 lease、持久化状态、恢复、审计和发行环境验证；当前调度器仅作为安全的 dry-run/显式执行基础。

## 架构五期整治（2026-08-19）

- SOL 开始下一刀：先从 `server.mjs` 抽取 SNMP/OID 纯解析、编码和安全值转换；暂不同时修改路由、数据库或远端会话，降低入口冲突和回归面。
- 34 已由 Luna 完成：新增 `src/snmp-oid-codecs.mjs` 和 `ADR-029`，`server.mjs` 保留 `parseZteOuterVlanRows` 兼容导出；7/7 SNMP/OID 专项回归通过。
- 第五期验收首轮发现 `phaseLabel` 导入遗漏，SOL 已补齐并复跑项目 API、SNMP/OID 与兼容 VLAN 测试 22/22 通过。
- 第五期最终本地验收：`pnpm test` 343/343 通过，`pnpm build` 通过；前端入口与 Element Plus vendor chunk 体积保持既有基线。

## 架构六期整治（2026-08-19）

- SOL 选择下一低风险边界：从 `server.mjs` 抽取 HTTP 协议辅助函数，严格不改 `handleApi` 路由分支、数据库调用和远端会话；重点保留请求大小限制、Content-Type 白名单和密码头不落日志边界。
- 36 已由 Luna 完成：新增 `src/http-protocol.mjs` 和 `ADR-030`，JSON/二进制请求体、Content-Type 和加密备份校验已从 `server.mjs` 抽离；专项测试 2/2、语法和 diff 检查通过。
- 第六期最终本地验收：`pnpm test` 345/345 通过，`pnpm build` 通过；HTTP 协议拆分未改变路由、认证、数据库或远端会话行为。

## 架构七期整治（2026-08-19）

- SOL 选择项目管理路由作为下一低风险边界：模块只接收依赖和 OLT 投影，负责路径匹配、请求体读取和响应编排；数据库校验、写入和 ONU 读取实现保持原位置。
- 38 已由 Luna 完成：新增 `src/project-routes.mjs` 和 `ADR-031`，项目及项目 ONU 路由改为依赖注入编排；路由专项 2/2、项目 API 15/15 通过。
- 第七期最终本地验收：`pnpm test` 347/347 通过，`pnpm build` 通过；项目路由拆分未改变数据库校验、OLT 读取或 API 响应契约。

## 架构八期整治（2026-08-19）

- SOL 选择远端会话状态作为下一边界：新增独立状态容器，统一 NMSE/网管二期会话和迁移主密码的内存生命周期；登录、数据库和远端协议实现暂不移动。
- 40 已完成：`src/remote-session-state.mjs` 由服务端创建单一实例，NMSE-PON/网管二期会话及迁移主密码均改为显式 getter/setter/clear 操作；配置变更、401 失效、备份恢复和退出路径保持原有清理语义。
- 已补充 `ADR-032` 与状态容器专项测试；真实远端登录、桌面重启恢复和发行包跨进程行为仍列为现场/发行门禁，不以纯内存测试替代。
- 第八期定向验收通过：远端状态容器专项 3/3、资源管理/合并 ONU/项目 API 回归 20/20，`pnpm test` 350/350，`pnpm build` 通过；构建仅保留既有 Element Plus vendor chunk 体积警告。

## 架构九期整治（2026-08-19）

- SOL 选择资源同步任务路由作为下一低风险边界：模块只负责路径匹配、输入校验、任务状态保护和调度器编排；数据库、NMSE 会话、用户同步和定时器实现保持原位置。
- 42 已完成：新增 `src/resource-sync-routes.mjs` 和 `ADR-033`，`server.mjs` 改为依赖注入调用；原任务 API 的错误文案、状态保护和调度时机保持不变。
- 第九期专项验收首轮发现并修复“已写响应但未返回 handled 标记”导致的二次 404 响应；修正后资源同步路由/调度器/资源管理 API 6/6 通过。
- 第九期最终本地验收：`pnpm test` 352/352 通过，`pnpm build` 通过；构建体积和既有 Element Plus vendor chunk 警告保持不变。

## 架构十期整治（2026-08-19）

- SOL 选择备份 HTTP 路由作为下一低风险边界：路由模块只负责响应头、密码头、解密/校验/恢复顺序和会话清理编排；数据库和加密容器实现保持原位置。
- 44 已完成：新增 `src/backup-routes.mjs` 和 `ADR-034`，普通 SQLite 与加密备份 API 改为依赖注入调用。
- 第十期定向验收通过：备份路由、加密容器、加密 API 共 7/7 通过；导出与还原顺序保持“解密 → 校验 → 还原 → 会话清理”。
- 第十期最终本地验收：`pnpm test` 354/354 通过，`pnpm build` 通过；构建仅保留既有依赖注释和 Element Plus vendor chunk 体积警告。

## 架构十一期整治（2026-08-19）

- SOL 选择 SNMP 管理诊断路由作为下一边界：模块只负责只读白名单、危险操作拒绝、OID 格式校验和查询响应；SNMP UDP、OID profile、SQLite 记录实现保持原位置。
- 46 已完成：新增 `src/snmp-admin-routes.mjs`、专项测试和 `ADR-035`，`server.mjs` 改为依赖注入调用；原 SNMP get/walk 和历史/事件 API 契约保持不变。
- SNMP 管理路由专项与相关只读 API 回归 25/25 通过，下一步继续执行全量测试和构建门禁。
- 第十一期最终本地验收：`pnpm test` 356/356 通过，`pnpm build` 通过；SNMP get/walk 白名单、危险操作拒绝和历史/事件查询保持原契约，构建仍仅有既有依赖警告。

## 架构十二期整治（2026-08-19）

- SOL 选择资源管理同步路由作为下一边界：路由层只负责本地查询、输入限制、NMSE 会话调用和响应编排；同步服务、数据库快照和远端协议实现保持原位置。
- 48 已完成：新增 `src/resource-management-routes.mjs`、专项测试和 `ADR-036`，用户同步、检查点、VLAN 同步及地址清理路由已从 `server.mjs` 移出。
- 第十二期专项回归 7/7 通过，下一步继续执行全量测试和构建门禁。
- 第十二期最终本地验收：`pnpm test` 358/358 通过，`pnpm build` 通过；检查点最大 50 页、401 仅清理 NMSE 会话、VLAN 仍通过固定只读远端接口，构建警告保持既有基线。

## 架构十三期整治（2026-08-19）

- SOL 选择合并 ONU 管理路由作为下一边界：模块只负责进度/快照查询、路径脱敏、幂等键传递和全量替换保护；manifest、lease、备份、合并算法和 SQLite 事务保持原位置。
- 50 已完成：新增 `src/merged-onu-routes.mjs`、专项测试和 `ADR-037`，合并 ONU 管理 API 改为依赖注入调用。
- 合并 ONU 路由与恢复/manifest/API 专项 14/14 通过，下一步继续执行全量测试和构建门禁。
- 第十三期最终本地验收：`pnpm test` 360/360 通过，`pnpm build` 通过；运行记录路径继续脱敏、全量替换仍拒绝 `oltId`、备份优先和恢复边界保持既有基线。

## 架构十四期整治（2026-08-19）

- SOL 选择 `main.js` 顶部纯函数作为下一边界：独立状态展示、光功率分级、统计、筛选键和 Excel PON 映射，不触碰 Vue 响应式对象、DOM、localStorage 或 API 生命周期。
- 52 已完成：新增 `src/main-view-state.mjs`、专项测试和 `ADR-038`，主视图继续使用原有模板和交互契约。
- 前端纯状态、ONU 列表和构建入口专项 10/10 通过，下一步继续执行全量测试和构建门禁。
- 第十四期最终本地验收：`pnpm test` 362/362 通过，`pnpm build` 通过；主视图展示文案、光功率分级、筛选键、Excel PON 映射和 Vue 构建入口保持既有基线。

## 架构十五期整治（2026-08-19）

- SOL 选择 OLT/台账管理路由作为下一数据库边界：模块只负责 OLT 响应脱敏、PON 台账读写和只读 VLAN 刷新编排；SQLite 操作和 SNMP 读取实现保持原位置。
- 54 已完成：新增 `src/olt-admin-routes.mjs`、专项测试和 `ADR-039`，OLT 与 PON 台账管理路由已从 `server.mjs` 移出。
- 第十五期最终本地验收：OLT/台账、数据库和只读服务专项 28/28 通过；`pnpm test` 364/364、`pnpm build` 通过。credential-free OLT 投影、本地台账写入和只读 VLAN 刷新契约保持不变；真实 OLT、Windows 7/发行包和跨进程桌面行为仍待现场门禁。

## 架构十六期整治（2026-08-19）

- SOL 选择网管二期资源路由作为下一低风险边界：模块只负责配置投影、登录/登出、字段诊断和历史光功率 HTTP 编排；远端客户端、数据库配置和会话容器保持原位置。
- 56 已完成：新增 `src/oss-resource-routes.mjs`、专项测试和 `ADR-040`，对应路由已从 `server.mjs` 移出。
- 网管二期资源路由专项 23/23 通过；下一步继续执行全量测试和构建门禁。
- 第十六期最终本地验收：`pnpm test` 367/367 通过，`pnpm build` 通过；credential-free 配置/登录投影、401 会话清理、ONU 坐标映射和历史光功率只读查询契约保持不变。真实 OSS/NGB、跨进程会话和发行包仍待现场门禁。

## 架构十七期整治（2026-08-19）

- SOL 选择 `main.js` 首页/ONU 展示状态作为下一低风险边界：模块只负责概览指标、待处理事项、最近状态、ONU 摘要和空状态纯映射；Vue 响应式对象、网络和生命周期保持原位置。
- 58 已完成：新增 `src/dashboard-view-state.mjs`、专项测试和 `ADR-041`，`main.js` 已改为依赖注入式 computed 映射。
- 首页/ONU 展示状态专项 7/7 通过；下一步继续执行全量测试和构建门禁。
- 第十七期最终本地验收：`pnpm test` 369/369 通过，`pnpm build` 通过；首页/ONU 展示纯映射保持原有文案、计数和状态契约。

## 架构十八期整治（2026-08-19）

- SOL 选择资源同步定时任务展示状态作为下一低风险边界：抽取状态、重复周期、最近结果和一次性请求体映射；任务 HTTP 生命周期和确认操作保持原位置。
- 60 已完成：新增 `src/resource-schedule-view-state.mjs`、专项测试和 `ADR-042`，`main.js` 改为复用纯映射。
- 定时任务视图专项测试已补齐，下一步执行全量测试和构建门禁。
- 第十八期最终本地验收：`pnpm test` 371/371 通过，`pnpm build` 通过；任务状态、重复周期、结果文案和一次性 `repeatDays: 0` 请求体映射保持原有行为。

## 架构十九期整治（2026-08-19）

- SOL 选择网管二期历史光功率视图状态作为下一低风险边界：抽取 ONU 坐标/日期请求组装和响应行归一化；远端查询、会话和只读路径保持原位置。
- 62 已完成：新增 `src/oss-history-view-state.mjs`、专项测试和 `ADR-043`，历史光功率请求改为复用纯状态模块。
- 历史光功率视图专项测试已补齐，下一步执行全量测试和构建门禁。
- 第十九期最终本地验收：`pnpm test` 373/373 通过，`pnpm build` 通过；历史光功率请求缺少详情/日期时 fail-closed，`board/slot` 兼容和只读查询契约保持不变。真实 OSS/NGB 路径、会话和现场数据仍待现场门禁。

## 架构二十期整治（2026-08-19）

- SOL 选择 ONU 数据领域编排作为下一数据库/领域边界：模块只负责本地资源快照、项目分配和项目 ONU 实时状态的合并；SQLite、SNMP/Telnet 和 HTTP 路由保持原位置。
- 64 已完成：新增 `src/onu-data-enrichment.mjs`、专项测试和 `ADR-044`，`server.mjs` 改为依赖注入调用。
- 第二十期最终本地验收：专项 25/25、`pnpm test` 376/376、`pnpm build` 通过；实时读取失败继续保留项目快照，下一步进入 `main.js` 页面业务模块拆分。

## 架构二十一期整治（2026-08-19）

- SOL 选择合并 ONU 同步页面状态作为下一前端业务边界：抽取阶段文案、源状态、进度百分比和日期展示；请求、轮询和响应式状态合并保持原位置。
- 66 已完成：新增 `src/merged-onu-view-state.mjs`、专项测试和 `ADR-045`，`main.js` 改为复用纯展示映射。
- 合并 ONU 视图专项测试已补齐，下一步执行全量测试和构建门禁。

## 架构二十二期整治（2026-08-19）

- SOL 选择备份清理运行时接入作为第三项后续工作：服务启动后只做定时 dry-run 计划，显式确认执行仍由底层二次扫描和完整性校验保护。
- 68 已完成：新增 `src/backup-cleanup-runtime.mjs`、路由/运行时专项测试和 `ADR-046`；服务关闭时停止定时器。
- 第二十二期最终本地验收：专项 18/18、`pnpm test` 381/381、`pnpm build` 通过；未开放定时自动删除。

## 架构二十三期整治（2026-08-19）

- SOL 选择 Element Plus 体积问题作为第四项后续工作：从全量插件改为实际模板组件选择性注册，保留 `v-loading`、消息 API 和全局 CSS。
- 70 已完成：更新 `src/main.js`、Element Plus 契约测试并新增 `ADR-047`。
- 第二十三期最终本地验收：`pnpm test` 381/381、`pnpm build` 通过；`vendor-element-plus` JS 约 773.56 KB → 379.69 KB，gzip 约 244.63 KB → 119.28 KB。

## 架构二十四期整治（2026-08-19）

- SOL 选择 `asar` 恢复可行性作为第五项后续工作：新增只读评估器，限定动态模块、Feishu runtime 和 Win7 SQLite 的候选 `asarUnpack` 范围，缺少实际包报告或 Windows 证据时不判定可恢复。
- 72 已完成：新增 `scripts/evaluate-asar-migration.mjs`、专项测试并补充 `ADR-018`。
- 第二十四期本地验收：评估测试、现有布局契约和构建门禁通过；`package.json` 继续保持 `asar:false`，真实 macOS/Win7 发行包仍待现场门禁。

## 架构二十五期整治（2026-08-19）

- SOL 按顺序完成 Windows 发行目录包门禁：macOS arm64 目录包与 Windows unpacked 目录包的 `package-layout/v1` 均通过；Win7 legacy SQLite CLI、Windows ICO 和 Feishu runtime 均在包内。
- Windows 最终 ZIP 未在本机宣称完成：Apple Silicon 主机的旧版 x86 Wine 在 rcedit 阶段报 `bad CPU type in executable`。真实 Win7 任务栏/托盘和最终 ZIP 保留为 Windows/CI 发行门禁，并记录于 `ADR-048`。
- OLT/OSS-NGB 只读门禁通过 45/45 项本地测试，覆盖 SNMP GET/WALK、OID、固定 DWR、历史光功率坐标、凭据脱敏和失败关闭；真实远端现场未具备授权目标，不以 fixture 替代，见 `ADR-049`。
- 跨进程与备份恢复门禁：生命周期、迁移、加密/组合备份、清理确认、合并恢复和桌面 IPC 本地回归已通过；加密备份 API 的回环监听测试在授权环境 2/2 通过。真实 macOS/Win7 发行包重启和跨平台恢复仍待发行门禁，见 `ADR-050`。

## 本机调试登录优化（2026-08-19）

- 增加本机登录保护开关和 `ADR-051`：默认启用，已登录后可关闭以免除本机调试时重复输入密码。
- 关闭状态只允许回环监听；非回环启动、切换保护和当前会话失效均有专项测试，认证专项 6/6 通过。

## 架构二十六期整治（2026-08-20）

- 用户确认自行处理方案一的真实现场和发行验证；本期只继续方案二代码深模块拆分和方案三文档收敛。
- 计划拆分服务端远端访问运行时与前端 ONU 详情展示状态，两个写入范围互不重叠；完成后再统一回归。
- 远端访问运行时已抽取为 `src/remote-access-runtime.mjs`，保留 NMSE/OSS-NGB 登录、凭据解锁、会话和错误语义；新增 ADR-052 与专项测试。
- ONU 详情展示已抽取为 `src/onu-detail-view-state.mjs`，保留光功率、历史曲线和只读命令预览；新增 ADR-053 与专项测试。
- 已修正文档中的认证、Feishu 设备号、定时任务和加密备份过时描述；全量回归待本期最后执行。
- 本期验收完成：远端访问/ONU 详情专项通过，`pnpm test` 393/393 通过，`pnpm build` 通过，`git diff --check` 通过；未执行现场 OLT、Win7 或最终发行包门禁。

## 架构二十七期整治（2026-08-20）

- `src/merged-onu-sync-runtime.mjs` 已接管合并 ONU 的运行时编排；`src/server.mjs` 仅注入数据库、远端会话、同步服务和状态容器，服务端文件由 2420 行降至约 2042 行。
- 新运行时保留备份优先、幂等键、跨进程租约、manifest 一致性、NMSE 401 重登录和失败审计语义；未扩展 OLT 写操作或敏感数据投影。
- `src/project-view-state.mjs` 已接管项目表单默认值、编辑归一化、提交 payload 清洗和 ONU 选中行样式；Vue 请求/生命周期/确认流程保持在 `main.js`。
- 新增 ADR-054/055 和专项测试；专项测试 13/13、全量测试 398/398、`pnpm build`、4 个新增/变更模块语法检查和 `git diff --check` 均通过。
- 本期不执行真实 OLT、OSS/NGB、Win7、最终发行包或跨进程现场门禁；相关验证仍由用户按方案一自行处理。

## 架构二十八期整治（2026-08-20）

- 新增 `src/server-data-access.mjs`，`server.mjs` 改为通过显式 SQLite 数据访问门面取得数据库能力；未移动 SQL、迁移或数据队列。
- 新增 `src/project-api.mjs`，项目页面改用统一 API 适配器；URL 编码、表单 payload 清洗和错误语义集中处理。
- `src/backup-runtime.mjs` 增加 `.backup-cleanup.lock` 跨进程原子锁；活跃锁 fail-closed，确认死进程且超过一小时的陈旧锁才回收，定时 dry-run 不触发删除。
- 新增 ADR-056/057/058；专项测试 24/24 通过（数据门面 2、项目 API/状态 7、备份清理 15）。全量测试 404/404、`pnpm build`、5 个变更模块语法检查和 `git diff --check` 均通过。
- 本期未执行真实 OLT、OSS/NGB、Win7、最终发行包或真实多进程发行环境验证；这些仍由用户按方案一自行处理。

## 架构二十九期整治（2026-08-20）

- 新增 `src/resource-sync-api.mjs`，将定时任务和合并 ONU 的列表、创建、取消、删除、进度及四类同步请求集中到固定 API 适配器。
- `main.js` 保留轮询、响应式状态、按钮禁用、确认弹窗和提示文案；适配器不访问设备、数据库或 DOM。
- 新增 ADR-059 和专项测试；专项测试及关联回归通过，全量测试 406/406、`pnpm build`、6 个变更模块语法检查和 `git diff --check` 均通过，关联修改已重新暂存。

## 架构三十期整治（2026-08-20）

- 新增 `src/resource-management-api.mjs`，将资源管理配置、登录、退出和 VLAN 同步请求集中到固定 API 适配器；配置请求只保留四个明确字段，页面继续负责交互状态和提示。
- 新增 ADR-060 和适配器专项测试；专项测试 7/7、全量测试 408/408、`pnpm build`、3 个变更模块语法检查和 `git diff --check` 均通过，本期修改已重新暂存。

## 架构三十一期整治（2026-08-20）

- 新增 `src/oss-resource-api.mjs`，将网管二期配置、登录、退出和历史光功率请求集中到固定 API 适配器；配置和登录字段分别设白名单，历史请求只接收详情状态模块生成的坐标/日期字段。
- 新增 ADR-061 和适配器专项测试；专项测试 6/6、全量测试 410/410、`pnpm build`、4 个变更模块语法检查和 `git diff --check` 均通过，本期修改已重新暂存。

## 架构三十二期整治（2026-08-20）

- SOL 安排 SQLite 执行仓储接缝作为下一刀：只移动 sqlite CLI 调用、串行队列、查询/执行辅助和安全 SQL 引号函数；领域 SQL、迁移、备份和恢复语义保持在 `db.mjs`。
- 第三十二期完成：新增 `src/sqlite-repository.mjs`，集中 SQLite CLI、串行队列、查询/执行和 SQL 引号；`db.mjs` 通过注入仓储使用，领域 SQL/迁移/备份恢复保持不变。
- 记录过一次专项断言修正：测试将默认 `json` 归一化误判为 `undefined`，修正为 `false` 后通过。
- 专项测试 11/11、全量测试 413/413、`pnpm build`、3 个变更模块语法检查和 `git diff --check` 均通过；关联修改待本期结束时暂存。

## 架构三十三期整治（2026-08-20）

- SOL 安排继续拆分 `main.js` 页面业务域控制器，优先选择资源/项目页面已有纯模块和 API 适配器之后的动作协调层，保持统一认证、Vue 生命周期和模板结构不变。
- 新增 `src/resource-page-state.mjs`，集中资源管理配置投影、网管二期登录成功和退出状态转换；密码字段在投影中清空，网络、认证和 Vue 生命周期保持在 `main.js`。
- 新增 ADR-063 和专项测试；专项测试 8/8、全量测试 415/415、`pnpm build`、3 个变更模块语法检查和 `git diff --check` 均通过，关联修改已重新暂存。

## 架构三十四期整治（2026-08-20）

- 新增 `src/xlsx-runtime.mjs`，将 xlsx 从静态入口改为单一 Promise 懒加载；构建确认 `vendor-xlsx` 保持独立异步 chunk，未改变 Excel 导入导出契约。
- 新增懒加载专项测试；专项测试 6/6、全量测试 416/416、`pnpm build`、异步 chunk 检查和 `git diff --check` 均通过，关联修改已重新暂存。

## 架构三十五期整治（2026-08-20）

- SOL 安排增强 `asar` 只读评估器：不改变 `package.json` 的 `asar:false`，只把动态模块、Feishu runtime、SQLite、renderer 和 Windows 实机证据纳入明确的 fail-closed 接口。
- `scripts/evaluate-asar-migration.mjs` 新增证据类型和平台标记校验；只有布局、动态模块、Feishu、SQLite、renderer、Windows 证据全部通过时才返回 `ready:true`。
- 新增评估专项测试；专项测试 11/11、全量测试 418/418、3 个变更模块语法检查和 `git diff --check` 均通过，关联修改已重新暂存；`package.json` 仍保持 `asar:false`。

## 架构三十六期整治（2026-08-20）

- SOL 安排继续拆分 `main.js` 的 PON 台账请求合同：PON 查询和保存集中到独立适配器，Excel 解析、页面状态和 OLT 只读筛选仍由入口及纯状态模块负责。
- 新增 `src/pon-admin-api.mjs`，PON 台账查询、页面保存和 Excel 导入共用固定请求合同；适配器不访问设备、SQLite 或 DOM。
- 新增 ADR-064 和专项测试；专项测试 8/8、全量测试 420/420、`pnpm build`、2 个变更模块语法检查和 `git diff --check` 均通过，关联修改已重新暂存。

## 架构三十七期整治（2026-08-20）

- SOL 安排继续拆分备份还原页面的 Web 请求合同：普通/加密 SQLite 导出与还原集中到适配器，桌面组合备份 IPC、密码生命周期和确认交互保持在 `main.js`。
- 新增 `src/backup-api.mjs`，集中 Web 普通/加密 SQLite 导出与还原请求；桌面组合备份 IPC、密码校验、密码清理和确认交互保持在入口。
- 更新源代码契约测试，使其跟随备份请求 seam；专项测试 10/10、全量测试 422/422、`pnpm build`、2 个变更模块语法检查和 `git diff --check` 均通过，关联修改已重新暂存。

## 架构三十八期整治（2026-08-20）

- SOL 安排 xterm 依赖延迟加载：终端依赖只在用户打开内置 Telnet 终端时加载，连接、命令白名单、人工粘贴和只读行为不变。
- Luna 已完成运行库加载接缝和专项测试；xterm 与 FitAddon 不再进入 `main.js` 的静态依赖图，只有挂载内置终端时才加载。
- 第三十八期专项测试 2/2、全量测试 424/424、`pnpm build`、异步 chunk 检查、变更模块语法检查和 `git diff --check` 均通过，关联修改已重新暂存。

## 架构三十九期整治（2026-08-20）

- SOL 选择 ONU 页面请求作为下一低风险边界：适配器只负责固定只读查询和配置方案预览请求，页面继续负责筛选、进度、弹窗和错误提示。
- Luna 已新增 `src/onu-api.mjs` 并接入 `main.js`；不移动认证、OLT 选择、页面状态或设备命令逻辑。
- 第三十九期专项测试 12/12、全量测试 426/426、`pnpm build`、语法检查和 `git diff --check` 均通过，关联修改已重新暂存。

## 架构四十期整治（2026-08-20）

- SOL 选择 OLT 管理页面的固定请求作为下一低风险边界：集中列表和保存请求，页面继续负责编辑、厂商/型号联动、错误提示和成功后的状态更新。
- Luna 已新增 `src/olt-admin-api.mjs` 并接入 `main.js`；服务端错误继续向页面传递，凭据脱敏和管理权限仍由服务端边界负责。
- 第四十期专项测试 9/9、全量测试 428/428、`pnpm build`、语法检查和 `git diff --check` 均通过，关联修改已重新暂存。

## 架构四十一期整治（2026-08-20）

- SOL 选择本地认证请求作为下一低风险 seam：适配器集中请求头、固定认证路径和稳定错误解析；页面继续负责密码输入、确认框、加载态和会话状态。
- Luna 已新增 `src/local-auth-api.mjs` 并接入 `main.js`；适配器与认证客户端/桌面生命周期专项测试 17/17、全量测试 430/430、`pnpm build`、语法检查和 `git diff --check` 均通过，关联修改已重新暂存；原有 `tests/local-auth-api.test.mjs` 服务认证测试已恢复，新增适配器测试使用独立文件。

## 架构四十二期评估（2026-08-20）

- SOL 检查内置 Telnet 控制逻辑：当前实现同时依赖 xterm 实例、终端 DOM、Vue 响应式状态、配置方案结果、设备选择和 Electron IPC。
- 若直接抽取控制器，需要暴露大量回调和可变状态，接口与实现接近，属于浅适配器，不能提供足够 leverage 或 locality。
- 本期不改动终端控制代码；保留现状，待终端 UI 组件、preload IPC 或配置预览逻辑形成独立 seam 后再拆。

## 架构四十三期整治（2026-08-20）

- SOL 选择 `server.mjs` 内联本地认证路由作为下一深 seam：路由模块只负责固定路径匹配、认证对象调用和响应编排，认证实现与服务生命周期保持原位置。
- Luna 已新增 `src/local-auth-routes.mjs` 并接入 `server.mjs`；专项测试 10/10、全量测试 432/432、`pnpm build`、语法检查和 `git diff --check` 均通过，原有 HTTP 认证集成测试继续通过。

## 架构四十四期整治（2026-08-20）

- SOL 选择服务端 HTTP 请求处理顺序作为下一深 seam：统一认证路由、API 会话认证、API 分发、静态文件和错误响应的先后关系，避免不同宿主重复实现安全顺序。
- Luna 已新增 `src/server-request-handler.mjs` 并接入 `server.mjs`；认证路径优先、普通 API Bearer 鉴权、API 分发、静态文件和统一 JSON 错误响应顺序集中到依赖注入模块。
- 第四十四期专项测试 12/12、全量测试 434/434、`pnpm build`、语法检查和 `git diff --check` 均通过；关联修改已重新暂存，未改变数据库、设备读取或认证策略实现。
