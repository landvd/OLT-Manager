# 开发总结：内置 Telnet 终端与桌面发行修复

日期：2026-06-20
分支：`codex/new-work`

## 背景

本轮目标是让 OLT Manager 的桌面版不再依赖系统 Terminal、Expect 或系统 telnet，参考免费 OLT 登录器的 Electron 22 + xterm.js + Node Telnet 方案，为 macOS 和 Windows 7 x64 提供统一的内置交互式 Telnet 终端。同时保留项目的核心安全边界：配置方案只生成和复制文本，系统不自动粘贴、不自动执行、不保存 OLT 配置。

## 主要改动

- 新增跨平台 Telnet 内核：
  - `src/telnet-client.mjs`
  - 支持 Telnet IAC 协商、NAWS、Terminal Type、自动登录状态机、交互式会话和白名单只读命令执行。
- 改造 ZTE 只读查询：
  - `src/zte-telnet.mjs` 改为复用 Node Telnet 内核。
  - macOS 和 Win7 x64 不再依赖 `expect` 或系统 `telnet`。
- 新增 Electron 内置终端 IPC：
  - `terminal:create`
  - `terminal:input`
  - `terminal:resize`
  - `terminal:close`
  - `terminal:event`
- 前端新增内置 Telnet 终端弹窗：
  - 配置方案按钮改为“打开内置终端”。
  - 桌面版中使用 xterm.js 显示交互终端。
  - 浏览器 Web 模式仍只支持复制命令，会提示内置终端仅桌面版支持。
- 修复桌面包启动问题：
  - macOS DMG 安装后曾出现 `app.asar/src/server.mjs` 路径启动失败。
  - `package.json` 当前设置 `asar: false`，保留真实目录结构。
  - 新增 `ADR-006` 记录该发行决策。

## 文档更新

- 更新 `README.md`：补充 macOS/Win7 运行环境、内置 Telnet 终端、发行和安全边界说明。
- 更新 `ARCHITECTURE.md`：记录 Node Telnet 内核、Electron IPC、asar 关闭和桌面数据流。
- 更新 `docs/design/api.md`：补充 Electron terminal IPC 和 `/api/open-terminal-login` 兼容定位。
- 更新 `docs/design/sequence.md`：把 ZTE 只读查询从 Expect 流程改为内置 Telnet 流程。
- 更新 `docs/release.md`：补充 `--publish never` 本地打包建议和 asar 关闭说明。
- 更新 `docs/decisions/ADR-005-terminal-login-helper.md`：从 macOS Terminal 辅助调整为内置 Telnet 终端决策。
- 新增 `docs/decisions/ADR-006-desktop-asar-disabled.md`：记录关闭 asar 的原因、影响和恢复条件。
- 更新 `CHANGELOG.md`：记录用户可见变化和桌面启动修复。
- 更新 `DEVELOPMENT_STATE.md`：记录当前状态、验证命令和下一步验收项。

## 验证结果

已执行：

```bash
node --check src/server.mjs
node --check src/db.mjs
node --check src/zte-telnet.mjs
node --check src/terminal-login.mjs
node --check src/telnet-client.mjs
node --check electron/main.cjs
CI=true pnpm test
CI=true pnpm build
CI=true pnpm run dist:dir
CI=true pnpm build && pnpm exec electron-builder --mac dmg --publish never
CI=true pnpm build && pnpm exec electron-builder --win nsis --x64 --publish never
```

测试结果：

- Node 语法检查通过。
- `pnpm test`：19 项通过。
- Vite 构建通过，仅保留 chunk size 警告。
- Electron 目录包构建通过。
- macOS DMG 和 Win7 x64 NSIS 安装包均已生成。
- 已确认 macOS 包内存在真实文件：`Contents/Resources/app/src/server.mjs`。
- 已确认 macOS 包内不存在 `app.asar`。

## 当前产物

- macOS arm64 DMG：
  - `release/OLT Manager-1.0.0-arm64.dmg`
  - SHA256：`b0f92e7b324d1c4d040cc7c5d1fd225fcf31f85114fa9e166803342b43a5a039`
- Windows 7 x64 NSIS：
  - `release/OLT Manager-1.0.0-win7-x64.exe`
  - SHA256：`8c0c2b905b78e0084e5391dc71ae1f9040e29f6aa8a528160a67a76bd7d20324`

## 已知边界

- 内置 Telnet 终端仅 Electron 桌面版支持，普通浏览器 Web 模式不提供真实 Telnet 终端。
- 自动登录可以进入配置模式，但配置方案命令必须由用户人工粘贴和确认。
- Win7 x64 可构建不等于已通过 Win7 真机验收，还需要真实 Win7 或虚拟机测试。
- macOS 包未签名、未公证，首次打开需要用户手工允许。
- 当前未内置 Windows 版 `sqlite3.exe` 或 net-snmp 工具；真实设备采集仍依赖可用工具路径。

## 下一步建议

- 在 macOS `/Applications` 用新 DMG 覆盖安装后复测启动。
- 在 Win7 x64 真实机或虚拟机测试安装、启动、内置 Telnet 登录、ZTE 只读查询和 Excel 导入导出。
- 准备正式应用图标：macOS `.icns`、Windows `.ico`。
- 评估是否为 Windows 包内置 `sqlite3.exe` 和 net-snmp 工具。
- 如需恢复 `asar: true`，先实现 `asarUnpack` 并重新验证 macOS/Win7 启动。
