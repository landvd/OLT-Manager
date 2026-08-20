# 架构整治实施发现

## 已确认上下文

- 当前分支：`codex/architecture-hardening-20260819`。
- 工作区原有未跟踪项 `.planning/architecture-review/`、`data/backups/` 保留，不读取备份内容、不覆盖用户数据。
- 现有 OSS/NGB 历史光功率能力位于 OLT Manager API/客户端侧；Feishu 现有 gateway 主要提供本地有界历史数据，需要核对能否安全注入实时远端读取。

## 继续整治发现

- `resource_management_config.password` 仍为 SQLite 明文，`loginNmseSession()` 和定时任务会直接读取。
- 已有 `SecretProvider` 只提供通用 seam，尚未接入 NMSE 配置和定时任务。
- 定时任务当前由服务启动时自动恢复，不能在没有可用解密材料时显式失败关闭。
- `server.mjs` 同时承担 HTTP 路由、NMSE/OSS 会话、同步调度、备份和设备查询，模块化必须拆成不改变只读行为的薄适配层。

## 架构二期拆分边界

- SQLite 目前同时存在 fresh schema、启动迁移和 restore 后建表/迁移 SQL；统一 runner 必须先覆盖这三条路径，再删除重复 SQL，不能只新增一个未接入的 migration 表。
- `merged-onu-sync.mjs` 当前负责纯合并和持久化调用，但 `server.mjs` 仍把 source collection 时间、进程内进度和 run 写回分散管理；manifest 先做可序列化纯模块，后续再接入持久化 checkpoint，避免一次改动同时重写同步流程。
- `backupDatabaseBeforeSync()` 当前直接生成 SQLite 文件并保留路径、大小和 hash；保留期/加密策略应先以 fail-closed 的纯策略模块定义，实际删除和加密写盘必须在明确的运行时入口接入并可回滚。
- CLI 与 Electron 各自实现 server 启动/关闭，统一层应只协调 handle、关闭幂等和 abort，不把窗口、IPC、OLT 会话或凭据跨入口共享。
- Vite 当前只有 Vue 插件和基础 build 配置，没有 manualChunks；代码分包必须保持 `dist/index.html` 与本地 server 静态入口不变。
- `asar:false` 与 Electron 主进程对 `src/server.mjs`、`src/db.mjs`、Feishu runtime 和 Win7 SQLite 的真实路径依赖相关；评估任务先建立布局契约，不直接切换发行开关。
## 架构三期拆分边界

- 现有 `createDatabaseBackup()` 仍生成用于事务回滚的本地 `.sqlite` 快照；22A 清理运行时已对未加密完整 SQLite fail-closed。因此 26A 先建立独立的加密容器格式，26B 再决定哪些导出/导入路径必须携带用户明确提供的可迁移主密码。
- 加密容器不能复用 Electron `safeStorage` 作为唯一恢复方式：它适合本机绑定的桌面凭据，不适合作为跨机器备份恢复密钥。容器模块必须注入主密码或密钥提供器，且不把主密码写入文件、SQLite、日志或 API 响应。
- `server.mjs` 的下一刀选择纯域编排：OLT 目标选择、NMSE 投影和本地用户投影可以注入依赖后独立测试；HTTP、远端会话、数据库写入继续留在 server，避免一次性重写同步流程。
- `main.js` 的下一刀选择项目 ONU 行映射、选择和列表替换纯函数；项目加载进度、HTTP 和 Element Plus 交互暂留在入口，降低 UI 回归面。
- Element Plus 当前是约 774 KB 的独立 vendor chunk。是否按需加载取决于模板全局组件解析方式；如果需要引入新插件或大规模模板改造，应先做可回滚评估，不以降低警告为唯一目标。

## 架构四期拆分边界

- 备份清理调度器可以先作为宿主无关、可注入的调用顺序模块存在；在跨进程锁、持久化租约、恢复和审计未完成前，不应由服务端启动无人值守删除。
- `start()` 的确认参数必须拒绝 `true`，避免调用方误把定时器变成自动删除；计划任务只能 dry-run，删除仍须由一次性显式确认触发并复用现有备份策略的二次校验。
- 加密备份页面的纯函数可从 `main.js` 低风险抽出，但 Vue 响应式包装、请求、下载、确认框和旧 `.sqlite`/组合备份路径继续留在入口，避免改变密码生命周期和兼容行为。
