# Feishu 生产单实例切换 Runbook

本文是 OLT Manager 接管现有生产 Feishu 应用的人工切换记录模板。它不自动停止进程、不自动输入凭据、不自动发送消息，也不执行任何 OLT 写操作。旧 Feishu ONU Query 项目必须保留，直到新宿主完成上线和回退验收。

## 当前前置结论

2026-08-05 当前迁移分支已完成：全量测试 162/162、Electron 22 macOS Apple Silicon 目录包与 DMG、组合备份、旧状态迁移和桌面重启演练。当前生产 Language Interpretation provider 尚未配置，OLT Manager 的“启用”IPC 有 fail-closed 保护，因此本 runbook 目前只能执行到人工接管前，不能宣称已完成生产切换。

## 切换前硬性检查

操作者逐项确认并记录证据：

1. 当前分支和目标 commit 已通过 `pnpm run check:version`、`pnpm test`、语法检查、桌面目录包和目标平台构建。
2. OLT Manager 已导出迁移前组合备份，并已保存迁移后的组合备份；旧 `local-administration.json` 和旧宿主目录未删除、未覆盖。
3. 旧 Feishu ONU Query 宿主已由操作者停止，且日志/进程检查确认 SDK 长连接已关闭。没有“旧宿主仍运行但窗口关闭”的模糊状态。
4. 已确认生产 provider、生产 App ID、当前 OLT Manager 新 Keychain 凭据引用、Operator、Authorized Chat 和 OLT Scope；敏感凭据由操作者手工输入或由当前 Keychain 引用提供，不能粘贴到聊天或日志。
5. 已确认当前数据集版本 `datasetRevision`、回退联系人和回退所需旧宿主启动方式。

## 执行步骤

1. 停止旧宿主，并记录停止时间、操作者和进程/长连接检查结果。
2. 启动 OLT Manager，打开“飞书子系统”，确认状态页显示 provider 已配置、凭据已配置、Feishu 仍处于停用状态。
3. 人工复核迁移后的 App ID、Operator、Authorized Chat、OLT Scope 和审计记录；确认只读 Gateway 指向当前本机数据源。
4. 仅在所有硬性检查通过后，由操作者点击“启用”；当前 provider 未配置时，程序必须拒绝该操作。
5. 发送第一条真实生产查询消息，验证：授权判断、查询结果、响应卡片、候选回调和审计记录。记录消息时间、操作者、查询类型、结果数量和数据集版本；不要记录 App Secret、Token 或完整用户资料。
6. 在第一条消息完成前，不得启动旧宿主，不得再次点击启用，不得执行任何 OLT 配置命令。

## 失败与回退

任一失败信号（provider 启动失败、凭据不可用、授权范围异常、查询无响应、回调失败、审计未记录或出现双宿主）都立即执行：

1. 在 OLT Manager 中停止 Feishu 子系统，并确认新长连接关闭。
2. 保留新宿主诊断日志、失败时间和审计记录；不要删除新状态或旧项目。
3. 按迁移前组合备份恢复 OLT Manager 本地状态（如本地状态确实需要回退）。
4. 启动旧 Feishu ONU Query 宿主，确认旧状态和旧 Keychain 仍可用，再做一条最小只读回退验收。
5. 在故障定位完成前禁止新旧宿主并行连接同一生产 Feishu 应用。

## 切换记录模板

```text
切换日期/时间：
操作者：
旧宿主停止时间：
旧宿主长连接关闭证据：
新宿主版本/commit：
数据集版本 datasetRevision：
迁移前组合备份文件及 SHA256：
迁移后组合备份文件及 SHA256：
生产 provider 状态：
Operator/Chat/OLT Scope 复核结果：
第一条真实消息时间：
第一条真实消息查询类型/结果数量：
候选回调结果：
审计记录结果：
是否触发回退：
回退判断和证据：
```
