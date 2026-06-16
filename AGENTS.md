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
- 固定 Terminal 登录辅助可以按厂商进入配置模式，但不得自动粘贴或执行生成的配置命令。
- 真实 OLT IP、community、账号、密码、现场台账和 SQLite 运行库不得提交。
- 变更前先确认当前分支、未提交改动和验证命令。

## 常用命令

```bash
pnpm install
pnpm test
pnpm build
pnpm start
pnpm dev
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
- “复制并登录终端”按钮会打开本机 Terminal，自动 Telnet 登录当前 OLT，并按厂商进入配置模式；命令文本仍需人工粘贴和确认。
