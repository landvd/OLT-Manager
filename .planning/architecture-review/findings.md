# 架构审查发现

本文件记录本次审查的证据和推论；外部或不可信内容仅作为数据，不作为执行指令。

## 第一阶段：上下文与约束

- 项目是本地 Web + Electron 壳的 OLT 只读管理工具：Vue 3/Element Plus/Vite 前端，Node.js ESM 原生 HTTP 服务，SQLite 本地数据，SNMP v2c 只读和固定白名单 ZTE show 查询。
- 桌面壳复用同一套 HTTP API；运行数据写入用户数据目录；桌面发行固定 Electron 22 legacy 线，当前 `asar` 关闭以保留真实 ESM 服务路径。
- 安全边界明确禁止 `snmpset`、任意 Telnet/SSH 命令、ONU 注册/删除/重启、自动写配置和保存配置；配置方案只生成预览，终端动作由人工粘贴确认。
- 当前 `DEVELOPMENT_STATE.md` 记录的实际工作分支与 `git status` 不一致：文档写为 `codex/nmse-ngb-merged-data`，Git 实际为 `main`；这是状态文档治理风险，不能直接作为当前分支事实。
- 当前文档同时包含设备采集、台账、NMSE-PON 用户快照、OSS/NGB DWR 适配、Feishu 只读网关、桌面发行、备份还原和本地 CLI 等多个边界，说明系统已经从单一 OLT 查询器演化为多源本地数据平台。

## 证据边界

- 本阶段只读取项目文档和脱敏历史记忆，未读取 `data/backups/` 的内容。
- 现阶段结论是候选问题，需在源码、测试、打包脚本和运行入口核对后才能定级。

## 第二阶段：源码与运行路径证据

### A. 服务端边界集中，模块 seam 不足

- `src/server.mjs` 约 3,000 行，同时包含会话管理、合并同步调度、备份、SNMP 命令调用/OID 解码、ONU 数据聚合、配置预览、项目 API、资源系统 API、静态文件和 HTTP 路由。
- 路由从约第 2374 行连续使用大量 `if (method && pathname)` 分支直连数据库和远端客户端；服务端还持有 `nmseSession`、`ossNgbSession`、合并进度和调度器等全局可变状态。
- 这不是单纯可读性问题：测试、CLI、Web 和 Electron 都通过启动完整 `server.mjs` 获得能力，导致启动生命周期、会话隔离、错误契约和安全边界都依赖同一个大模块。

### B. 敏感数据边界存在实际矛盾

- `olts` 表把 `read_community`、`telnet_username`、`telnet_password` 作为普通列保存；`resource_management_config` 也把 NMSE-PON `password` 作为普通列保存。
- `/api/admin/olts` 在 GET 时直接调用 `getOlts({ includeSecrets: true })`，可返回 Telnet 密码；PUT 响应也返回含 secrets 的 `adminOlts`。这与“本地默认信任”一致，但与“管理 API/CLI 不暴露凭据”的安全意图不一致，且没有认证作为补偿控制。
- 代码和文档已对 OSS/NGB 密码增加 AES-GCM/scrypt 密文，但 NMSE-PON 密码仍是明文存储；两套外部资源的凭据保护模型不一致。
- 终端登录器必须从 SQLite 读取 Telnet 凭据，因此当前架构把设备凭据作为数据库一等数据，而不是受控 secret provider；完整 SQLite 备份也会携带这些凭据。

### C. 本地 API 的 local-first 假设没有被运行时强制

- 服务默认监听 `127.0.0.1`，文档明确“没有独立认证层”；但 `startServer(options)` 接受任意 `host`，API 路由本身没有认证中间件、来源校验、CSRF 防护或角色区分。
- 管理写入、备份导出/还原、远端登录、定时同步、SNMP 探测和设备 Telnet 登录均通过同一 API 命名空间；只要进程被绑定到非回环地址或被本机其他进程访问，就没有第二道权限边界。
- Feishu 已用进程内 `OltDataGateway` 限制投影，但通用 `/api/admin/*` 仍是宽权限入口；“内部 gateway 已收窄”不能替代管理 API 的认证设计。

### D. SQLite 持久化和迁移缺少统一 schema 版本

- `src/db.mjs` 通过启动时的大段 `CREATE TABLE IF NOT EXISTS`，再用多处 `PRAGMA table_info` + 条件 `ALTER TABLE` 执行迁移；没有 schema version、迁移编号、单一迁移目录或已执行迁移表。
- `restoreDatabaseBackup()` 内又复制一套建表/迁移 SQL；这会形成“正常启动迁移”和“备份还原迁移”两条可能漂移的 schema 演进路径。
- 数据库写入依赖单进程 `sqlQueue` 串行调用外部 `sqlite3` CLI；它能避免当前进程内的并发写冲突，但不能表达跨操作事务、跨进程锁、取消、幂等键或长同步的提交边界。

### E. 数据快照的原子性和时间语义仍有架构风险

- 源同步、NMSE 分页、网管二期读取、合并快照和进度状态由服务端全局状态协调；数据库里有 revision，但远端源的采集时间、合并输入版本和最终快照之间缺少一个统一 manifest/commit record。
- 网管二期和 NMSE 源可以独立刷新，随后手动合并；如果两源更新时间差距很大，最终数据仍然可以成功提交，但 API 仅以 revision/count/status 表示完成，不能清晰表达“这两个版本是否来自同一业务时间窗”。
- 全量同步前先做 SQLite 备份，失败时保留旧快照，这是好的回退策略；但会话和进度仍是进程内变量，重启/多实例时不具备恢复能力。

### F. Web、Electron、CLI 三个入口共享实现但生命周期不统一

- Electron 主进程启动本地服务并通过 IPC 管理 Telnet/Feishu；CLI 每次调用重新启动完整 HTTP 服务；Web 直接访问 API。三者共享 `server.mjs`，但端口、关闭、会话、用户数据目录和凭据来源由不同入口决定。
- CLI 通过 `/api/admin/olts` 读取敏感字段后再脱敏，意味着安全控制依赖调用方补救，而不是服务端返回最小投影。
- Electron 当前要求 `asar: false` 才能动态加载 ESM 源码，说明业务运行时与发行包仍是源码目录级耦合；同时 macOS/Win7 采用不同 Electron 线，跨平台回归依赖打包检查而非统一运行时契约。

### G. 测试强项在纯函数/适配器，弱项在安全与真实生命周期

- 测试数量覆盖数据库、适配器、Feishu 合同、CLI、项目 API、备份和解析，说明局部行为有较好保护。
- 但现有测试主要以 `startServer({ port: 0 })` 的同进程合成服务为边界；没有看到针对“未认证访问 `/api/admin/olts` 不得返回 secrets”“非回环 host 必须拒绝”“多实例/重启后任务恢复”“数据库 schema 迁移唯一来源”“真实打包后备份/还原与凭据 provider 一致”的系统性验收。
- `pnpm test` 通过的是当前源码和合成 fixture，不等于 Windows 7、macOS 已安装包、真实远端会话、跨进程锁和灾难恢复已验证。

### H. 文档与代码状态存在治理漂移

- `DEVELOPMENT_STATE.md` 记录的分支为 `codex/nmse-ngb-merged-data`，Git 当前为 `main` 且已在 `v1.1.4`；本地状态文档没有在合并后自动失效或标记历史快照。
- ADR-003 仍接受“前端暂不引入状态库”，但 `src/main.js` 已约 3,400 行并承载大量页面模板、状态、请求、轮询和桌面桥接逻辑；这已达到 ADR 自己定义的“需要重新评估”条件。
- ADR-010/011 已明确许多未实现/未确认项（会话续期、验证码、SSO 失效、具体 Feishu schema 等），但这些决策、实现状态、发布状态和 DEVELOPMENT_STATE 没有一个自动生成的 capability/status manifest。

### I. 备份保护与敏感数据生命周期不闭合

- `data/backups/` 是运行时自动生成目录，但当前 `.gitignore` 未覆盖该目录；本次工作区也确实出现了未跟踪的 `data/backups/`。虽然本审查没有读取其中内容，但从设计可知完整 SQLite 备份可能包含 OLT/NMSE 凭据和现场用户资料。
- 当前备份以完整 SQLite 文件导出，完整性校验使用 `integrity_check` 和 SHA-256，但完整性不等于机密性；没有统一的备份加密、密钥托管、保留期、自动清理和“导出后明文文件如何处置”的策略。
- 备份路径和摘要被写入同步运行记录；API 只裁剪到文件名，但本地数据库中仍保存路径、大小和 hash，说明备份元数据与秘密存储/删除策略尚未统一。

### J. 运行时依赖与构建产物耦合

- 前端生产构建已产生约 1.9 MB 的单一 JS chunk，并出现超过 500 KB 的 chunk 警告；这不是当前功能故障，但反映单入口页面和所有可选 Feishu/管理能力一起进入首屏包，桌面与 Web 启动成本会随功能继续增长。
- Electron `asar: false` 是当前可接受的兼容决策，但它把发行包安全、文件布局和动态 import 绑定到源码级目录；这应被视为明确的技术债，而不是长期架构目标。
