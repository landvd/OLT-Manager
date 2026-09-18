# OLT Manager 项目交接文档（Antigravity CLI）

> 交接快照：2026-09-12。本文档只记录可提交的脱敏工程信息；真实设备地址、账号、密码、community、Cookie、Token、CUID、现场用户明细和运行数据库不在交接文档中。

## 1. 当前交付结论

| 项目 | 当前值 |
| --- | --- |
| 本机仓库 | `/Users/mac/Documents/OLT Manager` |
| 远程仓库 | `https://github.com/landvd/OLT-Manager.git` |
| 主分支 | `main` |
| 交接基线 | `fe383ce94601a4a08f3da35ccc2c7ff35d0c3e68` |
| 当前版本/tag | `1.1.7` / `v1.1.7` |
| 正式 Release | <https://github.com/landvd/OLT-Manager/releases/tag/v1.1.7> |
| 自动化基线 | `pnpm test`：578/578；`pnpm build`：通过 |
| 桌面目标 | macOS Apple Silicon DMG；Windows 7 x64 免安装 ZIP |
| 数据库迁移 | SQLite schema migration 10 |

开始编写本交接文档前，`main`、`origin/main` 和 `v1.1.7` 都指向上述提交，工作区干净；已合并的历史功能分支已清理。本交接文档生成后，如果尚未由用户提交，工作区预计只包含 `HANDOVER.md` 和 `HANDOVER_PROMPT.md` 两项文档修改；它们属于用户交接资产，接手者必须保留。Antigravity CLI 仍须重新执行只读核对，不能把本段快照当作永远不变的当前状态。

正式 Release 的主要资产如下；这是 GitHub Actions 重新构建后的权威值，本机 `release/` 中的候选包可能因构建元数据不同而具有不同哈希。

| 资产 | 字节数 | SHA-256 | 已完成的验收 |
| --- | ---: | --- | --- |
| `OLT.Manager-1.1.7-arm64.dmg` | 104,634,565 | `9687ee7a93872bf2a74f5e3b0597bf4fe9fd8c1314c1ec2b0a90cc9ab5ea39b7` | `hdiutil verify` 有效；主程序为 Mach-O arm64 |
| `OLT.Manager-1.1.7-win7-x64.zip` | 114,253,721 | `4b99bab240450f33d3d8ab6f4ad6769ea861c32bf10654933b282d19b94b3d20` | ZIP 完整；主程序为 PE32+ x86-64；内置两处 PE32 x86 `sqlite3.exe` |
| `OLT.Manager-1.1.7-arm64.dmg.blockmap` | 111,031 | `159b56121ffa0590a90d44b07c10a68863a22f9ba1846001cdf27779d34001db` | GitHub Release 已上传 |

## 2. Antigravity CLI 接手后的第一轮操作

先不要修改代码、运行真实同步或操作设备。进入仓库后依次执行：

```bash
cd "/Users/mac/Documents/OLT Manager"
pwd
git status --short --branch
git rev-parse HEAD
git rev-parse origin/main
git branch -a
git tag --points-at HEAD
```

然后完整阅读：

1. `AGENTS.md`
2. `DEVELOPMENT_STATE.md`（本机忽略文件，可能含现场环境信息，不得提交或复制到公开输出）
3. 本文档 `HANDOVER.md`
4. `docs/requirements/PRD.md`
5. `ARCHITECTURE.md`
6. `docs/design/api.md`
7. `docs/design/database.md`
8. `docs/design/sequence.md`
9. 当前任务相关的 `docs/decisions/*.md`
10. 涉及设备/OID 时再读 `EXPERIMENTS.md`
11. `CHANGELOG.md`

如果没有新的具体开发需求，第一轮只需报告：实际 cwd、分支/HEAD、工作区是否干净、依赖是否存在、接手文档与实际仓库是否有漂移，以及建议先做哪个待办。不要自行选择并实现新功能。

## 3. 不可突破的安全边界

### 3.1 设备与远端系统

- 自动化设备访问只允许 SNMP v2c `get/walk`。
- ZTE Telnet 查询只允许程序内部生成的固定白名单 `show` 命令。
- 禁止 `snmpset`、任意 Telnet/SSH 命令、ONU/ONT 注册、删除、重启、恢复出厂、配置下发和保存配置。
- 配置方案 API 只生成文本预览，不执行命令。
- Electron 内置 Telnet 终端是人工操作通道：可以自动登录；ZTE 可进入配置模式，Huawei 只进入已定义的登录视图。程序或 agent 不得自动粘贴、不得自动执行预览命令。
- NMSE-PON、BOSS、OSS/NGB 和飞书只调用现有固定白名单接口。不要通过猜测 URL、隐藏接口或任意代理扩大权限。
- 任何现场读请求都必须有用户明确授权、精确目标和只读范围。合成 fixture、HTTP 200、构建通过都不能替代现场验收。

### 3.2 敏感数据

- 不得把真实 OLT IP、community、账号、密码、Cookie、Token、CUID/FDN、现场台账、用户姓名/电话/地址或原始远端响应写入代码、测试、日志、提交文档或回复。
- 用户要求读取已保存的本机配置时，可使用现有本地凭据链路，但不得输出凭据或会话材料。
- 不得提交 `DEVELOPMENT_STATE.md`、`data/*.sqlite`、本地 seed、备份、日志或 `release/` 构建目录。
- 普通完整备份在“免迁移主密码且系统加密不可用”模式下可能包含本机登录材料；跨设备转交应优先使用加密备份。
- 若怀疑历史提交曾暴露凭据，先建议轮换。未经明确批准不要改写 Git 历史。

### 3.3 本地数据写入与破坏性操作

- 本地项目、PON 台账、同步状态、审计和备份属于 SQLite 本地数据写入，不等于设备写入；仍需严格限定在用户授权任务内。
- 修改本地运行库前先创建不覆盖旧文件的备份，并记录精确回滚路径。
- `pnpm run reset:data` 会替换目标数据目录，只能在明确的临时 `OLT_MANAGER_DATA_DIR` 或用户明确授权的目标上运行。
- 不要删除 `.npmrc`、`.pnpm-store`、`bin/win32/sqlite3.exe` 或本机运行数据库。

## 4. 技术栈与运行模式

- 前端：Vue 3、Element Plus、Vite；没有 Pinia，页面状态主要位于 `src/main.js` 和纯 view-state 模块。
- 后端：Node.js ESM 原生 HTTP server，不使用 Express。
- 数据：SQLite，通过 `sqlite3` CLI 和 `src/sqlite-repository.mjs` 串行访问。
- 桌面：Electron `22.3.27`；该 legacy 线用于保留 Windows 7/8/8.1 兼容边界。
- 飞书：`@larksuiteoapi/node-sdk` `1.71.1`，发行包通过独立 runtime 目录加载依赖。
- 表格：`xlsx`，前端延迟加载。
- 终端：xterm.js，前端延迟加载；底层 Telnet 是内置 Node 客户端。
- Node 开发基线：`>=22.13.0`；CI 固定 Node `22.13.0` 和 pnpm `11.6.0`。

运行模式：

1. `pnpm start`：本地 Node 服务，默认 `http://127.0.0.1:8787`。
2. `pnpm dev`：Vite 前端开发服务。
3. `pnpm run desktop`：Electron 开发壳，复用本地服务。
4. `node src/cli.mjs ...` / `olt-manager call`：只读模型工具 CLI，映射到同一业务 API，不另建业务逻辑。
5. GitHub Release：tag 触发 macOS 与 Windows 两平台构建并发布。

桌面运行数据写入 Electron userData 目录，不写入安装目录。Web 源码模式默认使用仓库下 `data/`；具体路径由 `OLT_MANAGER_DATA_DIR` 等环境变量控制。

## 5. 代码结构地图

| 领域 | 关键文件 | 责任与不变量 |
| --- | --- | --- |
| 服务端入口 | `src/server.mjs`、`src/server-request-handler.mjs`、`src/runtime-lifecycle.mjs` | 组合依赖、认证优先、API 后静态文件、统一生命周期 |
| 数据访问 | `src/db.mjs`、`src/db-migrations.mjs`、`src/sqlite-repository.mjs`、`src/server-data-access.mjs` | schema、事务、SQLite 队列和白名单门面；不要绕过 Repository 自建并发写 |
| 前端入口 | `src/main.js`、`src/app-state.mjs`、`src/*-view-state.mjs`、`src/*-api.mjs` | Vue 页面、纯状态与固定请求适配器；保持现有动作顺序 |
| OLT/SNMP | `src/snmp-client.mjs`、`src/snmp-oid-codecs.mjs`、`src/snmp-parsers.mjs` | SNMP v2c 只读 GET/GETBULK、平台索引和厂商解码 |
| Telnet/配置预览 | `src/telnet-client.mjs`、`src/zte-telnet.mjs`、`src/huawei-telnet.mjs`、`src/config-plan.mjs`、`src/terminal-*.mjs` | 固定查询、预览生成和人工终端；不得形成任意命令执行器 |
| NMSE-PON/BOSS | `src/nmse-client.mjs`、`src/nmse-boss-sync.mjs`、`src/nmse-boss-runtime.mjs` | 固定只读页面/API、历史姓名初始化、增量事件、水位和失败关闭 |
| OSS/NGB | `src/oss-ngb-client.mjs`、`src/remote-access-runtime.mjs`、`src/remote-history-session.mjs` | 固定 DWR 只读合同、自动登录、ONU 快照和历史光功率读取 |
| 合并 ONU | `src/merged-onu-sync.mjs`、`src/merged-onu-sync-runtime.mjs`、`src/merged-onu-service.mjs`、`src/merged-onu-manifest.mjs` | 备份、来源快照、manifest、租约/心跳、原子合并、冲突审计 |
| 飞书 | `src/feishu/application.mjs`、`src/feishu/production-runtime.cjs`、`src/feishu/production-language-provider.mjs`、`src/olt-data-gateway.mjs` | 单聊只读查询、回调绑定、卡片更新和只读数据门面 |
| 备份 | `src/backup-*.mjs`、`src/database-backup-container.mjs`、`electron/combined-backup.cjs` | 普通/加密备份、完整性、恢复与显式清理门禁 |
| Electron | `electron/main.cjs`、`electron/preload.cjs`、`electron/*-store.cjs` | 启动本地服务、userData、safeStorage、IPC 和打包路径 |
| CLI | `src/cli.mjs`、`src/cli-tools.mjs` | 严格只读工具白名单、统一 JSON 信封和临时服务回收 |
| 构建/发行 | `scripts/*.mjs`、`.github/workflows/*.yml`、`package.json` | 版本一致性、运行库准备、包布局和正式 Release |

`src/server.mjs` 与 `src/main.js` 仍然较大，但仓库已经通过 routes、API adapters、view-state 和 runtime 深模块持续拆分。后续重构必须保留现有算法、字段、业务动作顺序、自动/手动边界和 HTTP 合约，不要为了“更漂亮”重写核心流程。

## 6. 核心业务流程

### 6.1 普通 OLT 查询

1. 前端通过 `/api/bootstrap` 获取版本、OLT、PON 台账和公开 profile。
2. 服务端从 SQLite 读取本地配置。
3. SNMP 优先调用外部工具；缺失时回退到内置 UDP SNMP v2c 只读客户端。
4. ZTE 配置片段查询走固定白名单 Telnet `show`。
5. 后端投影脱敏 JSON，前端展示；任何失败都不得触发写设备补救。

### 6.2 网管二期 + 一期 BOSS + 合并 ONU

1. 长同步先创建本地备份并获取全局单 worker 租约。
2. 网管二期提供设备物理主数据的只读全量快照。
3. 一期 BOSS 首次从 `2019-08-23 00:00:00` 到任务启动时间按上海自然月读取成功工单姓名；以后以上次成功水位向前重叠一天做增量。
4. BOSS 列表固定 `page=0` 起、`pageSize<=20`、`opResult="1"`、厚街镇、接收时间升序，再逐条读取详情。
5. 历史阶段只建立 `LOID -> 最新姓名` 目录，不回放多年坐标历史；后续增量才处理报装、移机、更换 ONU 和成功销户。
6. 来源快照、姓名目录、事件、manifest 和 watermark 只在完整成功后以事务提交；空历史、分页/详情失败或租约失权都失败关闭并保留旧快照。
7. 手动合并只读取本地两套来源，网管二期坐标/设备字段为主，BOSS/NMSE 非空用户字段补充；最终统一快照原子替换并保留冲突审计。
8. 首次历史读取可能运行数小时。当前 worker 使用专用心跳续租，所有来源和统一快照提交前再次确认租约所有权；不要恢复旧的固定 30 分钟总时限。

### 6.3 飞书查询

- 飞书生产子系统默认关闭；启用后以长连接接收已验证事件。
- 单聊直接使用所有已启用 OLT；群聊在语言解释前拒绝。
- 查询顺序与显式意图由现有应用合同控制：姓名、电话、LOID、设备号、地址和 PON 坐标。
- `OLT-IP/板卡/PON` 与 `OLT-IP 空格 板卡/PON` 都映射到既有 `readPonStatusesByIp` 只读 seam；额外坐标段必须拒绝，不能部分吞掉。
- 长查询必须先返回 `callback-accepted`/加载态，再原位更新成功或可重试失败；不能让用户反复点击。
- 当前村级 PON 查询是一次性聚合与抽样，不等于“五天连续监控”。

### 6.4 配置方案与人工终端

- ZTE/Huawei 配置模板只生成文本；支持的 profile 由 `src/device-profiles.mjs` 和 `src/config-plan.mjs` 控制。
- Huawei `sn-auth` 使用未注册 ONT 的原始十六进制 SN。
- ZTE C600 已绑定已验证的独立配置模板；仅当请求模板不包含 `zte-c600` profile 时拒绝生成预览，避免误用 C300 命令。
- 打开终端、复制预览、人工粘贴和人工确认是不同动作。自动化不得把它们合并。

## 7. v1.1.7 已完成内容与验收边界

### 已实现并发布

- BOSS 历史姓名目录、后续增量 overlay、manifest v2、幂等事件、事务水位和空历史失败关闭。
- 合并同步的全局单活跃租约、长任务心跳、提交前租约守卫和同运行安全重放。
- 网管二期重复物理坐标择优合并与冲突审计。
- NMSE-PON/OSS 按需自动登录及迁移主密码可选流程。
- 飞书带空格的 OLT-IP + 板卡/PON 直查解析修复。
- 正式 GitHub `v1.1.7` Release，main CI 与两平台 Release workflow 成功。
- 中兴 C600 TITAN 专属只读配置方案模板落地与白名单隔离。
- 现场 OLT 合并 Manifest 规范排序与集合对称校验，彻底消除上游设备遍历顺序不一致造成的 `target_olt_mismatch` 假性报错。
- 二期支撑网 IP 映射零配置自动推导（`172.19.106.X` 映射 `22.0.6.X`，`172.19.104.X` 映射 `22.0.4.X`），新增 OLT 设备无需手动配置底层映射，彻底消除 409 阻断。
- 前端 UI 全面极简与现代重构：清除 8 个核心页面顶部冗余描述，移除弹窗免责警告 Alert，精简长篇说明，优化排版与 Tooltip 交互。
- 重新构建前端产物并重新打包 Win7 x64 ZIP，重新导出最新 29.19 MB 组合备份。
- 本地完整回归 578/578 全部通过；`pnpm build` 成功通过。

### 不能宣称已完成

- 没有在真实 Windows 7 x64 机器上完成 `v1.1.7` 启动、SQLite、托盘、内置终端和 SNMP fallback 的整套冒烟。
- `v1.1.7` 的长任务租约修复尚未在真实多年 BOSS 历史读取上重新跑满。现场曾读取并提交 17,818 条姓名目录，但旧外层任务因 30 分钟租约过期未完成登记；升级后应先核对本地完成状态/水位，再走短增量，不能盲目重置重跑。
- 本轮发行未执行真实 NMSE-PON、OSS/NGB、飞书或 OLT 请求。
- `ADR-076` 的五个上海自然日断纤恢复监控只有设计，尚未实现事件、固定样本、持久调度和五日现场验收。
- macOS 包仍未签名、未公证；`hdiutil verify` 成功不等于 Gatekeeper 或正式公开分发通过。
- 连接成功、HTTP 200、构建通过、fixture 通过或单次抽样正常，都不能单独证明现场业务成功。

## 8. 建议的后续优先级

### P0：先做只读现场验收，不先改算法

1. 在真实 Win7 x64 或受控虚拟机下载正式 Release ZIP，核对 SHA256 后验证：启动、本地 `127.0.0.1:8787`、userData 数据目录、内置 SQLite 路径、备份/恢复、托盘、退出和无外部 net-snmp 时的 SNMP fallback。
2. 在保存现有数据库备份后，检查一期姓名目录数量、`nameHistoryCompletedAt`、watermark 和最近任务状态。使用 `v1.1.7` 发起一次增量，确认不会重跑多年历史；成功后再手动合并并核对脱敏计数、revision、manifest 和冲突数。
3. 在已授权的飞书单聊中验证 `示例OLT-IP 7/12` 和斜杠格式都进入同一只读 PON 查询；确认加载态只出现一次、结果原位更新、非法额外坐标失败关闭。

### P1：实现 ADR-076 五天监控

按 `docs/decisions/ADR-076-feishu-five-day-fiber-recovery-monitoring.md` 分阶段实现本地事件、影响范围、主/备样本、观测、重启恢复和飞书汇总。缺基线、缺日或覆盖不足必须显示“数据不足”，不得硬编码全设备统一 dBm 阈值。

### P2：工程维护

- 修正文档中的旧版本示例；`README.md` 与 `docs/release.md` 仍有 `1.0.5/1.0.6` 命令样例。
- 跟进 GitHub Actions 对旧 Node.js action runtime 的弃用警告；本次警告不影响 `v1.1.7`。
- 继续缩小 `src/server.mjs`/`src/main.js`，但只在形成真实深模块边界时拆分，不添加浅包装层。
- 正式公开分发前补齐 macOS Developer ID、hardened runtime、公证和 staple 验收。

## 9. 本地数据、备份和依赖注意事项

- `DEVELOPMENT_STATE.md` 是本机忽略文件，可记录现场状态；它可能包含敏感路径/IP，绝对不要 `git add -f`。
- Web 默认数据库：`data/olt-manager.sqlite`；Electron 数据位于系统 userData。二者不是同一份数据库，操作前必须确认目标。
- `data/*.example.json` 是可提交的脱敏 seed；`data/olts.json`、`data/pon-ports.json`、SQLite/WAL/SHM 和备份默认忽略。
- `.npmrc` 把 pnpm store 固定为仓库内 `.pnpm-store`。不要删除或改用其他 store，否则无网络环境可能把现有 `node_modules` 判定为失效并重装。
- Windows 发行必须跟踪 `bin/win32/sqlite3.exe`。它是 Win7 legacy PE32 x86 运行库例外，不得误删或忽略。
- `release/` 是构建输出，不作为源码真相；正式资产以 GitHub Release 和其 SHA256SUMS 为准。
- 需要脱敏 fixture 时优先使用 `pnpm run seed:sample`，并人工检查导出结果没有现场身份数据。

## 10. 开发、验证和发行命令

### 依赖与常规验证

```bash
pnpm install --frozen-lockfile
pnpm run check:version
node --check src/server.mjs
node --check src/db.mjs
node --check src/zte-telnet.mjs
node --check src/terminal-login.mjs
CI=true pnpm test
CI=true pnpm build
git diff --check
```

某些 API 测试需要绑定 `127.0.0.1` 随机端口。若受限沙箱报 `listen EPERM`，这是环境限制；应在允许回环监听的环境重跑，不能把失败忽略，也不能未经复现认定为代码回归。

### 本地运行

```bash
pnpm start
pnpm dev
pnpm run desktop
```

启动只是启动，不自动登录、同步、采集或执行任何业务动作。端口被占用时先用只读方式找出占用进程，不要直接杀死不明进程。

### 桌面构建

```bash
pnpm run dist:dir
pnpm run dist:mac
pnpm run dist:win
node scripts/verify-package-layout.mjs <appRoot> <resourcesPath> [platform]
```

在 Apple Silicon 本机交叉构建 Windows ZIP 时，旧 Wine 可能在 `rcedit` 报 `bad CPU type in executable`。正式包优先交给 GitHub Windows runner；若只生成本机验证包，可显式使用 `signAndEditExecutable=false`，但不能据此宣称真实 Win7 已验收。

### 正式发行

1. 从 `package.json` 准备版本：`pnpm run release:prepare <version>`。
2. 更新 changelog，运行 `pnpm run check:version`、完整测试、构建和包门禁。
3. 推送 `main`，等待 main CI 成功。
4. 在该成功提交创建注解 tag `v${version}` 并推送。
5. 等待 Release workflow 的 macOS、Windows、publish 三个阶段全部成功。
6. 下载正式资产与 SHA256SUMS，重新计算哈希并验证 DMG/ZIP/架构/SQLite。

没有用户明确授权时，不得自行 commit、push、打 tag、创建 Release 或删除分支。

## 11. 已知故障模式

- NMSE 登录和 OLT discovery 成功但 ONU page 1 为空/500：先检查上游资源页面是否真实有数据，再查 Cookie、分页和兼容逻辑；不要用客户端补丁掩盖上游资源消失。
- 旧 NGB DWR HTTP 200 仍可能在业务体中返回异常；必须解析业务结果，不能只看状态码。
- BOSS 任一月份、分页或详情失败：不提交姓名目录、不推进水位；不要手工改水位跳过失败区间。
- 合并同步显示租约失效：确认运行版本、worker/lease、心跳和提交守卫；不要放宽租约所有权条件。
- Win7 `sqlite3.exe` 报入口点错误：检查是否误换为较新的 x64 SQLite；发行包必须保留固定 PE32 x86 legacy 版本。
- macOS 显示“已损坏”：先核对 Release SHA256 和 `hdiutil verify`；确认来源可信后才处理 quarantine。根治方案是签名和公证。
- 恢复 `asar:true` 前必须更新 ADR 并重新验证动态 ESM、Feishu runtime、SQLite、renderer 和 Win7 启动；当前保持 `asar:false`。
- 源码静态测试要兼容 CRLF，异步状态测试要等待真实完成条件；不要用固定 1 秒等待制造跨平台偶发失败。

## 12. 文档导航

- 项目规则：`AGENTS.md`
- 本机当前状态：`DEVELOPMENT_STATE.md`
- 产品范围：`docs/requirements/PRD.md`
- 架构：`ARCHITECTURE.md`
- API：`docs/design/api.md`
- 数据库：`docs/design/database.md`
- 时序：`docs/design/sequence.md`
- 现场实验：`EXPERIMENTS.md`
- 变更记录：`CHANGELOG.md`
- 发行指南：`docs/release.md`
- BOSS 增量交接：`docs/development-summary-2026-09-10-boss-incremental-sync.md`
- C600 模板与组合备份交接：`docs/development-summary-2026-09-12-c600-config-template-and-backup.md`
- 合并容错自愈与极简 UI 交接：`docs/development-summary-2026-09-13-merged-sync-tolerance-and-clean-ui.md`
- 合并数据交接：`docs/development-summary-2026-08-18-nmse-ngb-merged-data.md`
- 飞书恢复监测方案：`docs/development-summary-2026-09-07-feishu-olt-recovery-monitoring.md`
- 关键 ADR：`ADR-048`、`ADR-049`、`ADR-054`、`ADR-073`、`ADR-074`、`ADR-075`、`ADR-076`
- Antigravity 启动提示：`HANDOVER_PROMPT.md`

## 13. 交付报告应使用的证据分层

Antigravity CLI 每次完成任务时应分别报告：

1. 修改了哪些文件和实际行为。
2. 静态检查、单元测试、集成测试和构建结果。
3. 本地 Web/Electron 运行时验证结果。
4. 正式目标包或目标平台验证结果。
5. 真实 NMSE/OSS-NGB/Feishu/OLT 现场验证结果。
6. 未验证项、失败项、敏感边界和回滚方式。

只有对应层级的证据才能支持对应结论。不要把测试绿色写成现场同步成功，不要把 ZIP 完整写成 Win7 已启动，也不要把单个 ONU 正常写成整条光路稳定恢复。
