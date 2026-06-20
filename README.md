# OLT Manager

OLT Manager 是一个本地运行的 GPON OLT 只读管理工具，面向 ZTE C300/C320、Huawei MA5800 等现场维护场景。它提供 Vue 3 + Element Plus 前端、Node.js 本地 HTTP API、SQLite 本地数据、SNMP v2c 只读采集，以及可选的 Electron 桌面壳。

项目目标是帮助维护人员快速查询 ONU、PON、VLAN、地址、光功率、距离、未注册 ONU/ONT 和本地台账。系统不会自动注册 ONU、不会自动下发配置、不会保存 OLT 配置。

## 当前功能

- 运维概览：首页展示当前 OLT、SNMP 状态、未注册 ONU、异常 ONU、PON 台账健康和快捷入口。
- ONU 安装查询：只读查询当前 OLT 未注册 ONU/ONT，并按本地 PON 台账匹配地址。
- 配置方案预览：对未注册 ONU/ONT 生成可复制的配置命令预览，支持 ZTE 自营上网、内部网络、MDU+OTT，以及 Huawei 自营上网模板。
- ONU 数据查询：按地址、序列号、槽位、PON、状态、RX 光功率查询 ONU。
- ONU 详情：展示只读状态、光功率、距离、地址、外层 VLAN 和配置片段。
- OLT 设备管理：维护本地 OLT 记录、SNMP 只读 community、Telnet 登录辅助字段。
- ONU 数据管理：维护本地 PON 台账，支持页面编辑、完整列表展示、Excel 导入导出、外层 VLAN 刷新和保存台账，默认优先显示当前 OLT 台账。
- 数据采集记录：记录 SNMP 测试历史和管理操作日志。
- 桌面发行：支持 macOS 未签名 DMG 和 Windows 7 x64 legacy 免安装 ZIP 构建。

## 技术栈

- 前端：Vue 3、Vite、Element Plus
- 后端：Node.js 原生 HTTP 服务
- 数据：SQLite，本地 JSON seed 初始化
- 表格：xlsx
- SNMP：系统或包内 `snmpget`、`snmpbulkwalk`
- 桌面：Electron 22、electron-builder

## 运行方式概览

OLT Manager 有两种运行方式：

1. 源码运行：适合开发、调试、现场临时修改。
2. 桌面发行包运行：适合交付给维护人员测试使用。

源码运行需要 Node.js 和 pnpm；桌面发行包运行不需要用户手动安装 Node.js 和 pnpm。

默认 Web 地址：

```text
http://127.0.0.1:8787
```

## macOS 运行环境

### macOS 桌面版用户

macOS 桌面版目标产物是未签名 DMG。

运行要求：

- macOS，可运行 Electron 22 的系统版本。
- 首次打开未签名应用时，可能需要在系统设置中允许打开，或右键应用选择“打开”。
- SQLite：优先使用系统 `/usr/bin/sqlite3`。
- SNMP：如需真实设备采集，需要安装 net-snmp，确保 `snmpget`、`snmpbulkwalk` 可执行。
- Telnet 登录辅助：桌面版默认使用 Electron 内置 Telnet 终端，不依赖系统 Terminal。
- ZTE 只读 Telnet 查询：使用内置 Node Telnet 客户端执行固定白名单 `show` 命令，不依赖 `expect` 或本机 `telnet`。

macOS 推荐安装 SNMP 工具：

```bash
brew install net-snmp
```

如果系统缺少 telnet，可安装：

```bash
brew install telnet
```

桌面版运行数据不会写入安装目录，而是写入用户数据目录。升级应用时，不应覆盖 SQLite 数据、台账和日志。

### macOS 源码运行

开发或源码运行建议使用：

- Node.js：建议 `>=22.13.0`
- pnpm：建议 `11.6.0`
- SQLite：系统 `/usr/bin/sqlite3`
- SNMP：`snmpget`、`snmpbulkwalk`

安装依赖：

```bash
pnpm install
```

构建前端：

```bash
pnpm build
```

启动 Web 服务：

```bash
pnpm start
```

启动后访问：

```text
http://127.0.0.1:8787
```

开发模式启动前端：

```bash
pnpm dev
```

运行 Electron 桌面壳开发模式：

```bash
pnpm run desktop
```

构建 macOS DMG：

```bash
pnpm run dist:mac
```

如果在本地或 CI shell 中只想生成 macOS 安装包、不发布 GitHub Release，使用：

```bash
CI=true pnpm build
pnpm exec electron-builder --mac dmg --publish never
```

构建产物输出到：

```text
release/
```

当前桌面包关闭 `asar`，以保证安装后 `src/server.mjs` 等 ESM 模块仍是真实文件路径，避免本地服务启动失败。

## Windows 7 x64 运行环境

### Win7 桌面版用户

Windows 7 x64 版本使用 Electron 22 legacy 方案。Electron 23 起不再支持 Windows 7/8/8.1，因此 Win7 版本必须固定在 Electron 22 线。

运行要求：

- Windows 7 x64。
- 发布目标：Windows x64 免安装 ZIP；从 v1.0.1 起不再发布 Win7 EXE/NSIS 安装包。
- 不需要手动安装 Node.js。
- 不需要手动安装 pnpm。
- SQLite：ZIP 包内置 `sqlite3.exe`，启动时会自动使用 `resources/app/bin/win32/sqlite3.exe` 或 `resources/bin/win32/sqlite3.exe`，不需要加入系统 PATH；也可以通过 `OLT_MANAGER_SQLITE_BIN` 指定其它路径。
- SNMP：优先使用 `snmpget.exe`、`snmpbulkwalk.exe`；如果 Win7 ZIP 中没有这些工具，系统会回退到内置 Node SNMP v2c 只读客户端。也可以通过 `OLT_MANAGER_SNMPGET_BIN`、`OLT_MANAGER_SNMPBULKWALK_BIN` 指定完整路径。

Win7 桌面版能力和限制：

- 支持 Electron 内置 Telnet 终端，不调用系统 Telnet、PowerShell 或外部终端。
- 支持 ZTE Telnet 只读查询，仍只执行内部固定 `show` 命令。
- 支持自动登录当前 OLT，并可按厂商进入配置模式。
- 保留 Web 页面、ONU 查询、台账管理、Excel 导入导出、配置方案预览和复制命令。
- 不自动粘贴配置命令。
- 不自动执行配置命令。

Windows 桌面版运行数据应写入用户数据目录，不写入安装目录，避免升级覆盖现场数据。

### Windows 源码构建说明

Windows 上构建 ZIP 包建议使用 Windows 2022 或较新的构建环境。构建产物面向 Win7 x64，但构建机不需要是 Win7。

构建要求：

- Node.js：建议 `>=22.13.0`
- pnpm：建议 `11.6.0`
- Git

安装依赖：

```powershell
pnpm install
```

构建 Windows x64 ZIP：

```powershell
pnpm run dist:win
```

本地构建 Windows 包前，需要准备包内 SQLite CLI：

```powershell
pnpm run prepare:win-sqlite
```

这个脚本会下载并校验 SQLite 3.41.0 Windows x86 CLI，再写入 `bin/win32/sqlite3.exe`。不要换成最新 Windows x64 tools；较新的 x64 `sqlite3.exe` 在 Win7 上可能因为缺少系统入口点而以 `0xC0000139` / `3221225785` 退出。桌面版启动时会自动把包内路径绑定到 `OLT_MANAGER_SQLITE_BIN`，用户不需要手动配置 PATH。

GitHub Release 工作流会自动执行同一个准备脚本。

把 `release/OLT Manager-1.0.1-win7-x64.zip` 解压到 Win7 后直接运行 `OLT Manager.exe`。这个包没有 NSIS 安装/卸载流程，可避开 NSIS 卸载器兼容问题。

如果只生成本地测试包、不发布 GitHub Release，使用：

```powershell
pnpm run dist:win
```

构建产物输出到：

```text
release/
```

注意：GitHub Actions 或 Windows 2022 runner 可以构建 Windows ZIP，但不能证明 Win7 可运行。Win7 兼容性必须用真实 Win7 x64 或虚拟机手工验收。

## 本地数据

以下运行数据默认不提交到 git：

- `data/olt-manager.sqlite`
- `data/olts.json`
- `data/pon-ports.json`

可以复制示例文件作为起点：

```bash
cp data/olts.example.json data/olts.json
cp data/pon-ports.example.json data/pon-ports.json
```

如果只想从当前数据库里随机抽几条作为测试数据，推荐先导出一份脱敏抽样 seed：

```bash
pnpm run seed:sample
```

默认输出到：

```text
data/sample-seed/
```

它只读当前 SQLite，不删除、不修改当前数据库；输出会脱敏 IP、community、Telnet 凭据和地址。

然后用临时数据目录启动调试实例：

```bash
node scripts/reset-data.mjs \
  --yes \
  --data-dir /tmp/olt-manager-debug-data \
  --seed-dir data/sample-seed

OLT_MANAGER_DATA_DIR=/tmp/olt-manager-debug-data pnpm start
```

也可以直接重置成本仓库的脱敏 seed data，但这会清空默认本地数据目录：

```bash
pnpm run reset:data
```

`pnpm run reset:data` 会删除本地 `data/olts.json`、`data/pon-ports.json` 和 SQLite 运行库，再从 `.example.json` 复制调试数据；不会连接 OLT，不会执行 SNMP 或 Telnet 命令。如果 `data/` 中是现场库，不要直接运行这个命令。

然后按现场环境修改：

- OLT IP
- 只读 SNMP community
- Telnet 登录辅助字段
- PON 口
- 地址
- 外层 VLAN

真实 community、账号、密码、现场台账、SQLite 数据库运行数据不要提交到仓库。Win7 打包所需的固定 legacy SQLite CLI `bin/win32/sqlite3.exe` 是例外，必须提交并随 ZIP 发布，否则解压后的 Win7 包会缺少 SQLite CLI 而无法启动本地服务。

## 可配置工具路径

如果系统工具不在 PATH 中，可以通过环境变量指定。Windows 7 安装版的 SQLite 会自动使用包内路径，通常只需要为外部 SNMP 工具配置这些变量：

- `OLT_MANAGER_SQLITE_BIN`
- `OLT_MANAGER_SNMPGET_BIN`
- `OLT_MANAGER_SNMPWALK_BIN`
- `OLT_MANAGER_SNMPBULKWALK_BIN`
- `OLT_MANAGER_EXPECT_BIN`
- `OLT_MANAGER_DATA_DIR`
- `OLT_MANAGER_SEED_DIR`
- `OLT_MANAGER_STATIC_DIR`

示例：

```bash
OLT_MANAGER_SNMPGET_BIN=/opt/homebrew/bin/snmpget pnpm start
```

Windows 示例：

```powershell
$env:OLT_MANAGER_SQLITE_BIN="C:\Tools\sqlite3.exe"
$env:OLT_MANAGER_SNMPGET_BIN="C:\Tools\net-snmp\bin\snmpget.exe"
$env:OLT_MANAGER_SNMPBULKWALK_BIN="C:\Tools\net-snmp\bin\snmpbulkwalk.exe"
```

只有在需要替换发行包内置 SQLite CLI 时才需要设置 `OLT_MANAGER_SQLITE_BIN`。

Windows 7 ZIP 版建议先在 `cmd.exe` 中直接验证 SNMP 工具和 OLT 连通性：

```cmd
"C:\Tools\net-snmp\bin\snmpget.exe" -v2c -c <community> -Ovq <OLT_IP>:161 1.3.6.1.2.1.1.1.0
"C:\Tools\net-snmp\bin\snmpget.exe" -v2c -c <community> -Ovq <OLT_IP>:161 1.3.6.1.2.1.1.3.0
```

如果外部工具不存在，新版本会自动尝试内置 SNMP 只读 fallback。若 fallback 也失败，桌面首页会显示 `mock/offline`，并在警告通知里显示目标、OID、脱敏错误和 fallback 结果；不会显示 community。

## SNMP 说明

内置 profile 包含常用只读 OID：

- System：`sysDescr`、`sysUpTime`
- ZTE：ONU 名称、序列号、Phase 状态、RX 光功率、距离、未注册 ONU 序列号、外层 VLAN 候选
- Huawei：XPON ifName、ONT 描述、运行状态、RX 光功率、距离、未注册 ONT 序列号/状态、service-flow 外层 VLAN 候选

厂商私有 OID 可能因设备型号、软件版本、MIB 包不同而变化。现场使用前，应以目标 OLT 实测结果为准。

## 测试与验证

语法检查：

```bash
node --check src/server.mjs
node --check src/db.mjs
node --check src/zte-telnet.mjs
```

测试：

```bash
CI=true pnpm test
```

构建：

```bash
CI=true pnpm build
```

Electron 目录打包验证：

```bash
CI=true pnpm run dist:dir
```

## GitHub 自动构建

项目包含 GitHub Actions：

- `.github/workflows/ci.yml`：push 或 PR 到 `main` 时运行安装、测试和构建。
- `.github/workflows/release.yml`：推送 `v*` tag 时构建 macOS DMG 和 Windows x64 ZIP，并上传到 GitHub Release。
- `bin/win32/sqlite3.exe` 必须保留在 git 中；`.gitignore` 只忽略 `data/*.sqlite` 等运行数据，不能忽略这个 Win7 ZIP 打包运行库。

版本发布建议：

1. 合并功能分支到 `main`。
2. 更新 `package.json` 和 `CHANGELOG.md` 版本。
3. 从 `main` 打 tag：

```bash
git tag v1.0.1
git push origin v1.0.1
```

GitHub Release 自动构建只负责生成桌面发行包；Win7 真机兼容性仍需要人工验收。

## 安全边界

本项目始终保持设备写操作由人工确认：

- 不配置写 community。
- 不支持 `snmpset`。
- 不暴露任意 Telnet/SSH 命令入口。
- 不自动注册 ONU。
- 不自动授权 ONU。
- 不自动删除 ONU。
- 不自动重启或复位 ONU。
- 不自动保存 OLT 配置。
- 配置方案只生成文本预览。
- 复制命令只是复制到剪贴板，不代表已经执行。
- 桌面版内置 Telnet 终端只登录并进入配置模式，不粘贴、不执行生成命令。

Huawei MA5800 自营上网方案中，`sn-auth` 必须使用原始十六进制 SN，例如 `5A544547030C0914`，不要使用 `ZTEG-030C0914` 这类可读格式。

## 发行前检查

- macOS DMG 可以安装和启动。
- Win7 x64 ZIP 可以在真实 Win7 或虚拟机中启动。
- SQLite 数据目录可写。
- Excel 导入导出可用。
- ONU 数据管理无搜索时显示全部台账；切换当前 OLT 后，该 OLT 的台账排在前面。
- Win7 ZIP 版诊断日志中 `sqliteBin` 指向包内 `resources/app/bin/win32/sqlite3.exe` 或 `resources/bin/win32/sqlite3.exe`。
- 缺少 SNMP/SQLite 工具时有明确错误提示。
- 配置方案仍然只预览，不自动执行。
- 真实 OLT IP、community、账号密码和现场台账没有进入 git。
