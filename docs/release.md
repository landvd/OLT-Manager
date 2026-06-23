# Release Guide

本文件说明 OLT Manager 的桌面版发行流程。

## 发行目标

- macOS：未签名 DMG，用于现场测试和内部分发。
- Windows 7 x64：Electron 22 legacy 免安装 ZIP。Electron 23 起不再支持 Windows 7/8/8.1，因此不要在未重新评估 Win7 兼容前升级 Electron。从 v1.0.1 起不再发布 Win7 EXE/NSIS 安装包。
- 正式公开发行前建议补齐应用图标资源：macOS `.icns`、Windows `.ico`。

## 本地构建

要求 Node.js `>=22.13.0` 和 pnpm `11.6.0`。

仓库通过 `.npmrc` 固定 pnpm store 为项目内 `.pnpm-store`，避免本机全局 store 路径变化导致 `pnpm build` 在无网络环境中尝试重建依赖。

```bash
pnpm install
pnpm build
CI=true pnpm test
CI=true pnpm run dist:dir
pnpm exec electron-builder --mac dmg --publish never
pnpm run dist:win
```

产物输出到 `release/`。

`dist:dir` 用于快速验证 Electron 壳能否完成目录打包；`dist:mac` 生成 macOS DMG，`dist:win` 生成 Windows 7 x64 ZIP。

本地手工打包建议显式加 `--publish never`，避免 `CI=true` 环境下 electron-builder 尝试发布 GitHub Release。

## GitHub 自动发行

1. 确认 `main` 干净并已合并所有 PR。
2. 更新 `package.json` 版本号、首页展示版本号和 `CHANGELOG.md`。
3. 从 `main` 打 tag：

```bash
git tag v1.0.2
git push origin v1.0.2
```

4. GitHub Actions 会运行 `.github/workflows/release.yml`：
   - `macos-15-intel` 构建 macOS DMG。
   - `windows-2022` 准备 `bin/win32/sqlite3.exe` 后构建 Windows x64 ZIP 包。
   - 不发布 Win7 EXE/NSIS 安装包，避免安装和卸载流程带来的 Win7 兼容风险。
   - 上传 DMG、ZIP 和 SHA256 校验文件到 GitHub Release。

## 版本管理

- 日常开发从 `main` 新建功能分支，验证通过后通过 PR 合并。
- 只有 `main` 可以打发行 tag。
- 版本号同步维护：`package.json`、首页展示版本号、`CHANGELOG.md`、GitHub Release 标题。
- 首页展示版本号当前在 `src/main.js` 中维护，包括 `state.version` 和侧边栏 `v{{ state.version || "..." }}` 兜底值；版本更新推送到 GitHub 或打 Release tag 前必须同步修改。
- 当前发布线为 `1.0.x`；修复补丁升级补丁版本，小功能升级 `1.1.0`，重大不兼容变化升级下一个主版本。

## 运行时数据

桌面版数据库、台账和日志存放在用户数据目录，不放在安装目录，升级安装包不应覆盖运行数据。

## 打包结构

- 当前桌面包设置 `asar: false`。
- 这样 `src/server.mjs`、`src/db.mjs` 和 `src/telnet-client.mjs` 会以真实目录文件存在，避免 Electron 动态加载 ESM 模块时把 `app.asar` 当目录访问导致启动失败。
- Windows 7 ZIP 包内的 SQLite CLI 优先位于 `resources/app/bin/win32/sqlite3.exe`，另通过 `extraResources` 保留 `resources/bin/win32/sqlite3.exe`；Electron 启动本地服务前会自动把存在的绝对路径设置为 `OLT_MANAGER_SQLITE_BIN`。
- `bin/win32/sqlite3.exe` 必须提交到仓库并参与 Release 构建；不要把它加入 `.gitignore`。被忽略的只应是 `data/*.sqlite` 这类现场数据库运行数据。
- 如果后续恢复 `asar: true`，必须使用 `asarUnpack` 解包所有需要真实文件路径访问的 ESM 模块，并重新验证 macOS 与 Win7 启动。

## Windows 本地调试包

在 macOS 上本地生成 Win7 验证包时，使用免安装 ZIP：

```bash
pnpm run dist:win:zip
```

ZIP 解压后直接运行 `OLT Manager.exe`，没有 NSIS 安装器和卸载器，适合排查应用本体、SQLite、Telnet 和本地服务启动问题。

从 v1.0.1 起正式 Release 不再提供 Win7 NSIS 安装包；需要排查安装器问题时应在独立实验分支或 Windows 构建机上生成临时产物，不作为公开发布资产。

## 设备工具依赖

- SQLite：macOS 优先使用系统 `/usr/bin/sqlite3`；Windows 7 x64 发行包内置 `bin/win32/sqlite3.exe`。该文件应通过 `pnpm run prepare:win-sqlite` 准备固定的 SQLite 3.41.0 Windows x86 CLI，避免较新的 x64 CLI 在 Win7 上触发 `0xC0000139` entry-point 错误。桌面版会自动绑定包内路径，不需要加入 PATH；也可通过 `OLT_MANAGER_SQLITE_BIN` 覆盖。
- SNMP：优先使用 `snmpget` 和 `snmpbulkwalk`。Windows 发行包如果未内置 net-snmp，可安装工具并加入 PATH，或通过 `OLT_MANAGER_SNMPGET_BIN`、`OLT_MANAGER_SNMPBULKWALK_BIN` 指定完整路径；工具缺失时会回退到内置 Node SNMP v2c 只读客户端。
- ZTE Telnet 只读查询使用内置 Node Telnet 客户端，不依赖系统 `expect` 或 `telnet`。
- 桌面版默认使用 Electron 内置 Telnet 终端，macOS 和 Windows 7 x64 共用同一套登录和交互能力。

可用环境变量：

- `OLT_MANAGER_SQLITE_BIN`
- `OLT_MANAGER_SNMPGET_BIN`
- `OLT_MANAGER_SNMPWALK_BIN`
- `OLT_MANAGER_SNMPBULKWALK_BIN`
- `OLT_MANAGER_EXPECT_BIN`
- `OLT_MANAGER_DATA_DIR`
- `OLT_MANAGER_SEED_DIR`
- `OLT_MANAGER_STATIC_DIR`

## 验收清单

- Mac：首次启动、页面打开、SQLite 可写、Excel 导入导出可用。
- Win7 x64：ZIP 解压后可运行、窗口打开、包内 `sqlite3.exe` 可用、数据库可写、页面可打开、内置 Telnet 终端可登录并交互。
- 设备相关：Win7 ZIP 版诊断日志中 `sqliteBin` 应指向 `resources/app/bin/win32/sqlite3.exe` 或 `resources/bin/win32/sqlite3.exe`；缺少 SNMP/SQLite 工具时页面返回清楚错误。
- 设备相关：Win7 首页 `mock/offline` 告警会显示实际 `snmpget` 路径、内置 SNMP fallback 结果、目标、OID 和脱敏错误，便于区分工具缺失、PATH/env 问题、UDP 161 不通或 community/ACL 问题。
- 安全边界：桌面版仍不自动注册 ONU、不执行生成配置、不保存 OLT 配置。
