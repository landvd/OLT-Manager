# ADR-010: Host the Feishu query subsystem in OLT Manager

## Status

Accepted

## Context

Feishu ONU Query 当前包含飞书长连接、自然语言查询编排、Operator/Chat 授权、审计和只读查询业务。OLT Manager 已经是 OLT、NMSE 用户资源快照、PON 台账和只读 OLT Data Gateway 的唯一维护源。

如果继续让两个桌面程序分别承担核心业务，会产生两个宿主、两套运行状态和更高的发布与回退复杂度；如果把数据源复制到 Feishu ONU Query，则会破坏 OLT Manager 的数据权威边界和敏感数据约束。

## Decision

OLT Manager 作为唯一桌面宿主和数据核心。Feishu 查询能力迁移为 OLT Manager 内的可选子系统，复用 OLT Manager 的本地 SQLite、只读 OLT 适配器、用户资源快照和版本化只读 Gateway 合同。

原 Feishu ONU Query 仓库在迁移期间保留为迁移过渡项目，用于回退、行为对照和分阶段验收；迁移完成前不删除、不改造成第二个数据源，也不进行双写。

迁移不得复制 OLT Manager 数据库、用户快照、设备凭据或 OLT 写操作。Feishu 子系统只通过明确的本地模块 seam 访问允许的查询投影和本地授权/审计能力。

合并后的桌面发行继续保留平台分层 Electron 运行时：macOS Apple Silicon 使用现代 Electron，Windows 7 x64 使用 Electron 22.3.27；业务代码保持共用，平台壳层、启动脚本和打包配置按平台适配。

Feishu 子系统的 Operator、Authorized Chat、Access Request 和 Audit Record 使用 OLT Manager 用户数据目录下的独立加密状态存储，密钥由操作系统钥匙串保护。OLT Manager 主 SQLite 仍只保存 OLT、PON 台账、用户资源快照、项目和其他既有本地业务数据；迁移不复制 User Snapshot 或飞书凭据。

Feishu 子系统在 OLT Manager 内部优先进程内调用 `OltDataGateway`；现有 `/api/gateway/v1/*` HTTP Adapter 继续保留，作为迁移过渡项目和外部兼容 seam。两条 seam 复用同一 Gateway 合同、只读投影和授权前过滤规则。

Feishu 子系统默认关闭。Local Administrator 完成配置并显式启用后才建立飞书长连接；启用状态持久化并在后续桌面启动时自动重连。管理员可以单独停止 Feishu 子系统，连接失败不得阻断 OLT Manager 本地只读管理功能。

迁移完整保留 Feishu ONU Query 的授权模型：Operator 使用 `open_id`，每个 Operator 绑定 Authorized OLT Scope，群聊使用 Authorized Chat，群聊查询使用当前成员 OLT Scope 的交集；每条消息和卡片回调重新计算授权，并保留未授权单聊申请、限流、候选选择过期和 Audit Record。

自然语言理解迁移保留严格的 Query Request Schema 和 provider seam。Language Interpretation 只能把当前消息转换为受约束 JSON，不能访问 User Snapshot、OLT 数据或查询结果；服务超时、不可用或输出不合规时必须停止查询。生产模型与仅限 Synthetic Dataset Attestation 的测试模型分离，测试模型不得用于真实现场资料。

迁移直接使用现有生产 Feishu 应用，不另建测试应用。迁移期间原 Feishu ONU Query 与 OLT Manager 内 Feishu 子系统不得同时连接同一生产应用；正式切换必须先停止旧宿主，再启用新子系统，并保留旧项目作为回退实现。

现有 Feishu 状态采用一次性本机迁移：有效 Operator、Authorized OLT Scope、Authorized Chat 和必要配置迁入新的加密状态存储；Audit Record 作为历史只读归档迁入，不参与授权判断；飞书 App Secret、模型密钥等敏感凭据重新写入新的系统钥匙串引用。原项目状态文件不删除、不覆盖，保留为回退备份。

Feishu 管理能力嵌入 OLT Manager 现有桌面界面，包含连接状态、启停、应用配置、Operator/Scope、Authorized Chat、申请审批、Audit Record 和状态迁移入口；不再维护第二套管理窗口或远程管理台。

OLT Manager 的本机备份/还原扩展为组合本机备份：同时保存主 SQLite 和 Feishu 加密状态文件。Feishu 内容保持密文，不导出解密后的资料或密钥；还原继续要求人工确认、完整性校验，并检查 Gateway 地址、数据集版本和钥匙串引用。

生产切换直接使用现有生产 Feishu 应用，不另建测试应用、不做双宿主并行或生产灰度。切换前必须完成本地自动化检查、状态迁移和组合备份；随后停止旧宿主并启用 OLT Manager 子系统，第一条真实生产消息作为上线验收。若新宿主异常，立即停止新子系统并恢复旧宿主。

## Consequences

- 桌面发布、用户数据目录和启动流程以 OLT Manager 为准。
- Feishu 子系统可以关闭，不影响 OLT Manager 的本地只读管理功能。
- 原项目需要保留一段时间，直到新宿主完成行为对照和回退验收。
- 后续必须单独确认飞书密钥钥匙串归属、授权/审计数据表和本地模块接口；这些未在本 ADR 中预先决定。
- 后续必须单独确认飞书密钥钥匙串归属、授权/审计数据表和本地模块接口；其中授权/审计的存储边界已经确定，但具体 schema 和接口仍待设计。
- 后续必须单独确认飞书密钥钥匙串归属、授权/审计数据表和本地模块接口；存储边界、双 Gateway seam、生命周期、授权模型、Language Interpretation seam、生产应用切换、状态迁移、管理界面、组合备份和直接生产切换策略已确定，但具体 schema 和接口仍待设计。
