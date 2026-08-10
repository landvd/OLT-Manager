# OLT Manager 桌面发行与本地切换演练记录

本文记录 OLT Manager 作为唯一桌面宿主时的发行、重启恢复、组合备份和失败回退步骤。演练只使用本地样例或人工确认的脱敏状态，不连接生产 Feishu，也不执行任何 OLT 写操作。

## 固定发行边界

- macOS 使用 Apple Silicon DMG：`pnpm run dist:mac`。
- Windows 7 x64 使用 Electron `22.3.27` 和 ZIP：`pnpm run dist:win`；打包前固定准备包内 `bin/win32/sqlite3.exe`。
- `asar` 保持关闭，`src/server.mjs`、`src/db.mjs` 和 Electron 主进程模块在包内保持真实路径。
- 运行数据只写入 Electron `app.getPath("userData")` 下的 `data/`，不会写入安装目录。
- Feishu 默认关闭；配置、备份 IPC 均不自动启用生产连接。查询只支持单聊并自动使用全部已启用 OLT。
- 桌面窗口最小化后隐藏到系统托盘；托盘菜单可以恢复窗口或退出程序。Feishu SDK 运行时依赖随包放在 `resources/feishu-runtime/node_modules`。

## 可重复验证

```bash
pnpm run check:version
node --check electron/main.cjs
node --check electron/preload.cjs
node --check src/server.mjs
node --check src/db.mjs
pnpm test
pnpm build
pnpm run dist:dir
pnpm run dist:mac
```

Windows 构建在 GitHub Actions 的 `win7-x64` runner 上执行：

```text
pnpm install --frozen-lockfile
pnpm run check:version
pnpm run prepare:win-sqlite
pnpm test
pnpm run dist:win
```

验收 ZIP 时确认包内同时存在 `resources/app/bin/win32/sqlite3.exe` 或 `resources/bin/win32/sqlite3.exe`，启动日志中的 `sqliteBin` 指向包内绝对路径。

## 重启恢复演练

1. 在 OLT Manager 中只保存 Feishu App ID/App Secret 和授权状态，不点击启用；导出一次组合备份。
2. 完全退出桌面程序，再重新启动；确认首页和本地 ONU 查询可用，Feishu 状态仍为“默认关闭”，授权状态仍可读取。
3. 在不发送生产消息的前提下，使用 synthetic provider 测试或单元测试确认状态读取；生产 provider 未配置时，Feishu 故障不得阻止本地 HTTP 服务和 OLT 查询页面启动。
4. 若需要测试重连状态，只能在明确的非生产凭据和非生产应用上进行；生产切换必须按下节流程执行。

## 组合备份与历史状态边界

1. 在“备份还原”页面导出组合备份，确认文件包含版本、manifest、SQLite 和 Feishu 加密密文，不包含解密后的 App Secret 或系统密钥。
2. 旧 Feishu ONU Query 状态已迁移完成；当前 OLT Manager 不提供旧目录选择、预览、应用或 `local-administration.json` 读取入口。
3. 使用脱敏副本验证恢复：确认 manifest、SQLite 完整性、Feishu 状态/key 封装和凭据引用校验失败时不会覆盖当前状态；SQLite 恢复失败时 Feishu 密文回滚。

## 旧宿主停止、新宿主启动和失败回退

生产切换前不得让旧 Feishu ONU Query 和 OLT Manager 同时连接同一生产应用。

1. 旧宿主：保存其本地状态和旧项目目录，导出 OLT Manager 迁移前组合备份；停止旧 Feishu 进程，并确认 Feishu SDK 长连接已关闭。
2. 新宿主：启动 OLT Manager，确认本地 ONU 查询和 Feishu 状态页可用；确认 Feishu 仍停用，再人工核对 App ID 和已启用 OLT。
3. 生产启用：只在人工确认完成后启用新宿主；第一条真实消息作为上线验收，记录时间、结果和回调是否成功。
4. 失败回退：立即停止 OLT Manager Feishu 子系统，确认旧宿主未被删除且仍可启动；恢复旧宿主并确认其长连接恢复。若新宿主已经写入错误本地状态，先退出新宿主，再用迁移前组合备份恢复 OLT Manager 本地状态。
5. 回退后保留新宿主日志、组合备份和审计记录，禁止在故障未定位前重复启用两个宿主。

## 本次仓库验收记录

2026-08-05 本机验收：版本检查、全量 Node 测试（161/161）、语法检查、Vite 构建和 macOS Apple Silicon 目录包均通过；直接启动目录包后，本地 `/api/status` 返回 connected，Feishu 长连接诊断保持单次 ready，打包文件不再包含 Feishu admin/migration IPC。DMG 验证与当前授权简化无关，需以对应构建产物的实际校验记录为准。

2026-08-06 本机验收：Electron 22 内置 Node 16 不提供全局 `fetch`，因此 NMSE-PON 客户端必须在该运行时回退到 Node 原生 `http/https`。回退仍使用固定白名单接口、既有超时和 Cookie 会话规则。全量测试通过 179/179，macOS Apple Silicon 目录包构建成功；重启目录包后，资源系统登录和 OLT 发现成功，页面显示“资源系统已登录”。验收未触发用户同步或 VLAN 同步。

Windows 7 x64 ZIP 的最终发行验证仍应由对应平台的 GitHub Actions runner 产物和 SHA256 清单完成；本地不能把 macOS 构建结果冒充 Windows 7 运行验收。
