# Feishu 子系统更新摘要（2026-08-05）

本文记录今天 OLT Manager Feishu 子系统的实现和本机验收结果，作为当前规则的补充说明。旧的 Gateway 集成记录仍保留为历史背景；当前生产路径以本文和 `ARCHITECTURE.md`、`CONTEXT.md` 为准。

## 当前查询规则

- Feishu 子系统默认关闭，启用前必须完成生产 provider 配置和凭据配置。
- 只支持飞书单聊；查询自动使用 `gateway.listOlts()` 返回的全部已启用 OLT。
- 不再使用 Operator、OLT Scope、Authorized Chat、群成员交集或访问申请。
- 群聊事件在调用语言 provider 前拒绝，并提示仅支持单聊。
- 卡片回调重新读取当前已启用 OLT，候选属于已停用或未知 OLT 时拒绝。
- OLT 查询仍通过进程内只读 `OltDataGateway`，不触发设备写操作。

## 桌面端与 provider 更新

- 前端移除 Operator/Scope、Authorized Chat、访问申请和旧状态迁移页面。
- Electron 主进程和 preload 移除对应 admin/migration IPC；生产路径不加载旧 admin/migration 服务，也不读取旧 `local-administration.json`。
- 历史授权字段和迁移模块仅作为既有加密备份/代码兼容材料保留，不参与当前授权。
- 生产 provider 的 API Key 继续通过系统加密凭据存储；CC Switch 只读取供应商名称、接口地址、模型和格式，不导入 API Key、Token 或 Secret。
- 修复状态轮询重复初始化导致 SDK 长连接反复重建的问题；状态读取不再触发重复初始化，并保留脱敏启动诊断。

## 验收记录

- `CI=true pnpm test`：161/161 通过。
- `CI=true pnpm run dist:dir`：构建成功。
- macOS Apple Silicon 目录包已启动，监听 `127.0.0.1:8787`。
- `GET /api/status`：返回 `connected`。
- 打包后的 `electron/main.cjs`、`electron/preload.cjs` 和 `src/main.js` 不再包含 `feishu:admin:*`、`feishu:migration:*`、`feishuAdmin` 或 `feishuMigration` 入口。
- 启动诊断中仅出现一次本次启动的 `Feishu long connection ready`，未观察到状态轮询触发重复连接。

## 安全与回退边界

- Feishu 仍是可选本地子系统，连接失败不应阻断本地 OLT 查询、台账和备份还原。
- 查询只读；禁止通过 Feishu 触发 `snmpset`、Telnet/SSH 写命令、ONU 注册/删除/重启或配置保存。
- 旧项目和历史备份材料不在本次代码路径中重新迁移；如需回退，按 `docs/production-cutover-runbook.md` 执行人工停用和恢复。
