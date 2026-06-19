# Release Guide

本文件说明 OLT Manager 的桌面版发行流程。

## 发行目标

- macOS：未签名 DMG，用于现场测试和内部分发。
- Windows 7 x64：Electron 22 legacy NSIS 安装包。Electron 23 起不再支持 Windows 7/8/8.1，因此不要在未重新评估 Win7 兼容前升级 Electron。
- 正式公开发行前建议补齐应用图标资源：macOS `.icns`、Windows `.ico`。

## 本地构建

要求 Node.js `>=22.13.0` 和 pnpm `11.6.0`。

```bash
pnpm install
pnpm build
CI=true pnpm test
CI=true pnpm run dist:dir
pnpm run dist:mac
pnpm run dist:win
```

产物输出到 `release/`。

`dist:dir` 用于快速验证 Electron 壳能否完成目录打包；`dist:mac` 和 `dist:win` 分别生成可分发安装包。

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
   - `windows-2022` 构建 Windows x64 NSIS 安装包。
   - 上传安装包和 SHA256 校验文件到 GitHub Release。

## 版本管理

- 日常开发从 `main` 新建功能分支，验证通过后通过 PR 合并。
- 只有 `main` 可以打发行 tag。
- 版本号同步维护：`package.json`、`CHANGELOG.md`、GitHub Release 标题。
- 小功能建议升级 `0.2.0`，修复补丁升级 `0.2.1`，重大不兼容变化进入 `1.0.0` 后再按语义化版本推进。

## 运行时数据

桌面版数据库、台账和日志存放在用户数据目录，不放在安装目录，升级安装包不应覆盖运行数据。

## 设备工具依赖

- SQLite：macOS 优先使用系统 `/usr/bin/sqlite3`；Windows 可通过包内工具或 PATH 提供 `sqlite3.exe`。
- SNMP：需要 `snmpget` 和 `snmpbulkwalk`。Windows 发行包如果未内置 net-snmp，需要用户安装并加入 PATH。
- ZTE Telnet 只读查询依赖 `expect`，Windows v1 暂不支持。
- macOS Terminal 登录辅助只支持 macOS；Windows v1 不打开终端登录。

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
- Win7 x64：安装包可运行、窗口打开、数据库可写、页面可打开。
- 设备相关：缺少 SNMP/SQLite 工具时页面返回清楚错误。
- 安全边界：桌面版仍不自动注册 ONU、不执行生成配置、不保存 OLT 配置。
