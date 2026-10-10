# ADR-085：Pi Agent 改用 Pi Durable 持久会话

## 状态

已接受（2026-10-10）。部分取代 ADR-082 第 3 条（飞书短期上下文）。

## 背景

- 原 SDK 路径使用 `@earendil-works/pi-coding-agent@0.85.1`：每次提问新建内存 session，答完即销毁；为了只读，需要关闭它自带的 bash/read/edit/write、在空目录里加载资源、写临时 `models.json`。
- 飞书多轮上下文只有进程内存里 30 分钟、最近 3 轮，重启即丢；抢修过程中的连续追问经常断档。
- Earendil 于 2026-10-01 发布 `@earendil-works/pi-durable`（实验性）：对话、模型调用、工具调用先提交到存储再展示，进程中断后续跑；不依赖编码 agent，只用 `pi-ai` 访问模型。

## 决策

1. **依赖**：移除 `@earendil-works/pi-coding-agent`，固定 `@earendil-works/pi-durable`、`@earendil-works/pi-ai`、`@earendil-works/chord` 为 1.1.0。系统仍在开发期，接受实验性 API 的升级风险，不加功能开关。
2. **持久会话**：`src/pi-agent/pi-sdk-adapter.mjs` 在进程内打开一个 Harness，存储为用户数据目录下独立的 `pi-durable.sqlite`（`node:sqlite`，WAL）。每个 `conversationKey` 对应一条永久对话，映射保存在会话级文档 `olt.conversation-keys`；飞书使用 `feishu:<chatId>|<openId>`，并以 `feishu:<eventId>` 作为 `requestId` 防止重投时重复提问。每次只提交最新一问，历史由 Durable 保存，超出上下文窗口时自动压缩（旧条目仍保留在存储中）。模型为 GLM-5.3（1M 上下文），但外勤问答主要依赖最近几轮，有效窗口按 128K 计算、最近约 32K 保留原文，以保证回答速度。
3. **保留期与备份**：对话永久保留，不做自动清理；`pi-durable.sqlite` 不纳入项目加密备份（备份只快照 `olt-manager.sqlite`）。
4. **脱敏**：模型为本地部署，对话和工具结果中的用户资料（姓名、电话、地址、LOID、SN）不再脱敏；OLT 管理地址、community、密码、token、cookie、Telnet 账号等凭据仍在工具结果和终端上下文中剔除（按字段名精确匹配，不再误删 `description` 等普通字段）。
5. **工具与提示词**：只安装 `olt-readonly` 扩展，含原有 7 个只读工具，全部声明 `replay: "safe"`（崩溃后重放只会再读一次）。固定规则作为提示词分段；每轮的授权范围、终端输出和已审核规约写入会话文档 `olt.turn-context`，由另一分段在请求前读取。
6. **桌面版**：内置终端的 Pi 助手按 OLT 使用 `desktop:<oltId>` 作为会话 key；打开终端或切换 OLT 时从 `GET /api/pi-agent/history` 载入当前上下文的问答，“新对话”按钮调用 `POST /api/pi-agent/reset`（Durable 的 `reset()`，旧记录保留）。桌面会话选择 `olt-desktop` 扩展：原桌面链路的 16 个只读工具（`PI_AGENT_TOOL_DEFINITIONS`，含只读 CLI、联网搜索、弱光聚类、离线研判、数字孪生、端口经验等）和原系统提示词；未传 `oltId` 时默认使用本轮上下文的当前 OLT。飞书会话只选择 `olt-readonly`（7 个显式授权范围的工具）。每条对话固定选择一个扩展，未配置的对话默认只有 `olt-readonly`。
7. **资料候选 ID**：`search_resource_users` 返回的 `candidateId` 带本次启动标识。永久对话里留下的旧 ID 在重启后只会查不到，不会因计数器从 1 重新开始而指向其他用户。
8. **模型**：用现有语言模型配置构造内存中的 OpenAI-compatible provider（`openai-completions` 或 `openai-responses`），不再写临时目录；模型变更时对已有会话执行 `configure`。

## 安全边界

- 不安装 pi-durable 的 `CodingTools`，不提供环境（`env`），没有文件或进程访问能力。
- 任何会写设备的动作都不得做成 agent 工具：崩溃续跑会重放未完成的工具调用。
- 一个存储文件只能由一个进程打开；Web 开发模式（`data/`）与桌面版（用户数据目录）使用不同文件。

## 后果

- 飞书的同一用户可以跨天、跨重启连续追问。
- 进程中断时正在进行的回答会在重启后续跑完成并保存，但不会再推送到飞书。
- pi-durable 处于实验阶段，升级版本时需要重新跑 `tests/pi-agent.test.mjs`，并核对 API 变化。
- `pi-durable.sqlite` 会随使用持续增长，需要时由管理员手动处理。
