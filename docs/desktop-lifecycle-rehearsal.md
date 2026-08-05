# OLT Manager 桌面发行与本地切换演练记录

本文记录 OLT Manager 作为唯一桌面宿主时的发行、重启恢复、组合备份和失败回退步骤。演练只使用本地样例或人工确认的脱敏状态，不连接生产 Feishu，也不执行任何 OLT 写操作。

## 固定发行边界

- macOS 使用 Apple Silicon DMG：`pnpm run dist:mac`。
- Windows 7 x64 使用 Electron `22.3.27` 和 ZIP：`pnpm run dist:win`；打包前固定准备包内 `bin/win32/sqlite3.exe`。
- `asar` 保持关闭，`src/server.mjs`、`src/db.mjs` 和 Electron 主进程模块在包内保持真实路径。
- 运行数据只写入 Electron `app.getPath("userData")` 下的 `data/`，不会写入安装目录。
- Feishu 默认关闭；配置、授权、备份和迁移 IPC 均不自动启用生产连接。

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

## 组合备份与旧状态迁移演练

1. 在“备份还原”页面导出组合备份，确认文件包含版本、manifest、SQLite 和 Feishu 加密密文，不包含解密后的 App Secret 或系统密钥。
2. 选择旧 Feishu ONU Query 的数据目录，读取迁移预览；确认旧 `local-administration.json` 未被修改，未知 OLT Scope 和授权冲突会被提示或阻断。
3. 迁移前先在当前 OLT Manager 配置新 App Secret；迁移只复用当前 Keychain 引用，不读取旧 Keychain。
4. 确认迁移后 Feishu 仍停用，并保存迁移前/后的组合备份；重复预览/应用同一源指纹应为幂等 no-op。
5. 使用脱敏副本验证恢复：确认 manifest、SQLite 完整性、Feishu 状态/key 封装和凭据引用校验失败时不会覆盖当前状态；SQLite 恢复失败时 Feishu 密文回滚。

## 旧宿主停止、新宿主启动和失败回退

生产切换前不得让旧 Feishu ONU Query 和 OLT Manager 同时连接同一生产应用。

1. 旧宿主：保存其本地状态和旧项目目录，导出 OLT Manager 迁移前组合备份；停止旧 Feishu 进程，并确认 Feishu SDK 长连接已关闭。
2. 新宿主：启动 OLT Manager，确认本地 ONU 查询、Gateway 和 Feishu 状态页可用；确认 Feishu 仍停用，再人工核对迁移后的 Operator、Chat、OLT Scope 和 App ID。
3. 生产启用：只在人工确认完成后启用新宿主；第一条真实消息作为上线验收，记录时间、结果和回调是否成功。
4. 失败回退：立即停止 OLT Manager Feishu 子系统，确认旧宿主未被删除且仍可启动；恢复旧宿主并确认其长连接恢复。若新宿主已经写入错误本地状态，先退出新宿主，再用迁移前组合备份恢复 OLT Manager 本地状态。
5. 回退后保留新宿主日志、组合备份和审计记录，禁止在故障未定位前重复启用两个宿主。

## 本次仓库验收记录

2026-08-05 本机验收：版本检查、全量 Node 测试（162/162）、语法检查、Vite 构建、macOS Apple Silicon 目录包和 DMG 均通过；DMG `hdiutil verify` 为 `VALID`，SHA256 为 `1c64048c7a1eb994bbc7a6955f4bd4ad8043d7300dac3d283827ec98dcb3ef68`。直接启动目录包后，本地 ONU 页面和 Feishu 状态页均可用，Feishu 显示“默认关闭”，且不再出现 Electron 22 的 `structuredClone` 兼容错误。

Windows 7 x64 ZIP 的最终发行验证仍应由对应平台的 GitHub Actions runner 产物和 SHA256 清单完成；本地不能把 macOS 构建结果冒充 Windows 7 运行验收。
