# OLT Manager Agent Guide

本文件是本仓库的入口说明。任何人或 agent 开始工作前，先按这里的顺序读取项目上下文，再决定是否修改代码。

## 读取顺序

1. `DEVELOPMENT_STATE.md`：本地当前状态、现场验证进展、未提交的临时判断。该文件可能包含环境细节，默认不提交。
2. `docs/requirements/PRD.md`：产品目标、用户、MVP 范围和明确不做的内容。
3. `ARCHITECTURE.md`：系统边界、模块职责、数据流和运行方式。
4. `docs/design/api.md`：HTTP API 合约。
5. `docs/design/database.md`：SQLite 表结构和本地数据约定。
6. `docs/design/sequence.md`：主要业务流程时序。
7. `docs/decisions/*.md`：已经做出的架构决策。
8. `EXPERIMENTS.md`：OID、设备、解析逻辑和现场只读实验记录。
9. `CHANGELOG.md`：对用户可见的变化记录。

## 当前工程原则

- 项目以只读 OLT 管理和人工确认配置为主。
- 允许 SNMP v2c `get/walk` 读取。
- 允许固定白名单的 ZTE `show` 查询。
- 禁止 `snmpset`、任意 Telnet/SSH 命令、ONU 注册/删除/重启、自动写配置、保存配置。
- 桌面版内置 Telnet 终端可以按厂商进入配置模式，但不得自动粘贴或执行生成的配置命令。
- PON 台账 Excel 导入导出只允许读写本地 SQLite 台账，不得触发任何 OLT 设备命令。
- 真实 OLT IP、community、账号、密码、现场台账和 SQLite 运行库不得提交。
- 变更前先确认当前分支、未提交改动和验证命令。

## 常用命令

```bash
pnpm install
pnpm test
pnpm build
pnpm start
pnpm dev
pnpm run reset:data
pnpm run desktop
pnpm run dist:mac
pnpm run dist:win
node --check src/server.mjs
node --check src/db.mjs
node --check src/zte-telnet.mjs
```

当前仓库使用 Node 内置 test runner 运行 `tests/*.test.mjs`。修改解析、数据库、SNMP、Telnet 适配逻辑或配置方案模板时，应优先在 `tests/` 下补最小可复现测试或样例校验脚本。

## 开发流程

1. 在 `docs/requirements/PRD.md` 中确认需求是否属于 MVP。
2. 如涉及架构边界，先更新 `ARCHITECTURE.md` 或新增 ADR。
3. 如涉及设备/OID 行为，先在 `EXPERIMENTS.md` 记录只读实验计划和结果。
4. 实现时保持改动小而可验证。
5. 完成后运行构建、语法检查和相关手工验证。
6. 在 `CHANGELOG.md` 记录用户可见变化。

## Huawei 自营上网方案注意事项

- `display ont autofind all` 已验证未注册 ONT 的 `Ont SN` 原始十六进制和 SNMP `unconfiguredSerial` 表一致。
- Huawei `ont add ... sn-auth` 使用原始十六进制 SN，例如 `5A544547030C0914`，不是括号里的 `ZTEG-030C0914`。
- 配置方案仍只生成命令预览，系统不自动粘贴、不自动执行、不保存配置。
- “打开内置终端”按钮会打开 Electron 内置 Telnet 终端，自动 Telnet 登录当前 OLT，并按厂商进入配置模式；命令文本仍需人工粘贴和确认。

## 桌面发行注意事项

- Windows 7 x64 发行包固定使用 Electron 22 legacy 线；不要升级到 Electron 23+，否则会丢失 Win7/Win8/Win8.1 支持边界。
- Windows 7 x64 发行包必须内置 `bin/win32/sqlite3.exe`；GitHub Release workflow 会在 Windows 构建前准备该文件。
- Windows 7 桌面版启动时应自动检测包内 `resources/app/bin/win32/sqlite3.exe` 和 `resources/bin/win32/sqlite3.exe`，并把存在的路径绑定到 `OLT_MANAGER_SQLITE_BIN`；用户不需要把 SQLite 加入系统 PATH。
- macOS 发行包当前按未签名 DMG 处理，暂不做 Apple 签名和公证。
- 桌面版运行数据应写入用户数据目录，不能写入安装目录，避免升级覆盖现场台账和 SQLite 数据。
- Windows 版使用 Electron 内置 Telnet 终端，不调用系统 Telnet、PowerShell 或外部终端；命令预览仍必须人工复制和确认。
- 桌面包当前关闭 `asar`，确保 `src/server.mjs` 等 ESM 模块在安装后仍是真实文件路径；恢复 `asar` 前必须先更新 ADR-006 并验证 macOS/Win7 启动。
