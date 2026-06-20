# Release Guide

本文件说明 OLT Manager 的桌面版发行流程。

## 发行目标

- macOS：未签名 DMG，用于现场测试和内部分发。
- Windows 7 x64：Electron 22 legacy NSIS 安装包。Electron 23 起不再支持 Windows 7/8/8.1，因此不要在未重新评估 Win7 兼容前升级 Electron。
- 正式公开发行前建议补齐应用图标资源：macOS `.icns`、Windows `.ico`。

## 本地构建

```bash
pnpm install
pnpm build
CI=true pnpm test
CI=true pnpm run dist:dir
pnpm exec electron-builder --mac dmg --publish never
pnpm exec electron-builder --win nsis --x64 --publish never
```

产物输出到 `release/`。

`dist:dir` 用于快速验证 Electron 壳能否完成目录打包；`dist:mac` 和 `dist:win` 分别生成可分发安装包。

本地手工打包建议显式加 `--publish never`，避免 `CI=true` 环境下 electron-builder 尝试发布 GitHub Release。

## GitHub 自动发行

1. 确认 `main` 干净并已合并所有 PR。
2. 更新 `package.json` 版本号和 `CHANGELOG.md`。
3. 从 `main` 打 tag：

```bash
git tag v0.2.0
git push origin v0.2.0
```

4. GitHub Actions 会运行 `.github/workflows/release.yml`：
   - `macos-15-intel` 构建 macOS DMG。
   - `windows-2022` 准备 `bin/win32/sqlite3.exe` 后构建 Windows x64 NSIS 安装包。
   - 上传安装包和 SHA256 校验文件到 GitHub Release。

## 版本管理

- 日常开发从 `main` 新建功能分支，验证通过后通过 PR 合并。
- 只有 `main` 可以打发行 tag。
- 版本号同步维护：`package.json`、`CHANGELOG.md`、GitHub Release 标题。
- 小功能建议升级 `0.2.0`，修复补丁升级 `0.2.1`，重大不兼容变化进入 `1.0.0` 后再按语义化版本推进。

## 运行时数据

桌面版数据库、台账和日志存放在用户数据目录，不放在安装目录，升级安装包不应覆盖运行数据。

## 打包结构

- 当前桌面包设置 `asar: false`。
- 这样 `src/server.mjs`、`src/db.mjs` 和 `src/telnet-client.mjs` 会以真实目录文件存在，避免 Electron 动态加载 ESM 模块时把 `app.asar` 当目录访问导致启动失败。
- 如果后续恢复 `asar: true`，必须使用 `asarUnpack` 解包所有需要真实文件路径访问的 ESM 模块，并重新验证 macOS 与 Win7 启动。

## 设备工具依赖

- SQLite：macOS 优先使用系统 `/usr/bin/sqlite3`；Windows 7 x64 发行包内置 `bin/win32/sqlite3.exe`，也可通过 `OLT_MANAGER_SQLITE_BIN` 覆盖。
- SNMP：需要 `snmpget` 和 `snmpbulkwalk`。Windows 发行包如果未内置 net-snmp，需要用户安装并加入 PATH。
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
- Win7 x64：安装包可运行、窗口打开、包内 `sqlite3.exe` 可用、数据库可写、页面可打开、内置 Telnet 终端可登录并交互。
- 设备相关：缺少 SNMP/SQLite 工具时页面返回清楚错误。
- 安全边界：桌面版仍不自动注册 ONU、不执行生成配置、不保存 OLT 配置。
