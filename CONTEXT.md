# OLT Manager

本 context 描述本地只读 OLT 管理中，用于核对 PON 台账、运行态与资源管理数据的核心术语。

## Feishu 查询子系统

**Feishu 查询子系统**：运行在 OLT Manager 桌面宿主内、按需启用的飞书 ONU 查询能力，负责飞书连接、查询编排、授权和审计；它不复制 OLT Manager 的用户快照、数据库或设备凭据。
_Avoid_：独立的第二套 OLT 数据源、默认启用的远程管理服务

**迁移过渡项目**：原 Feishu ONU Query 仓库在迁移期间保留的独立实现，用于回退、对照测试和分阶段切换；它不是新的 OLT 数据维护源。
_Avoid_：长期双写、双份用户快照、未经合同验证的代码直接复制

**平台分层 Electron 运行时**：macOS Apple Silicon 使用现代 Electron，Windows 7 x64 继续使用 Electron 22.3.27；两者共享业务代码，不共享超出平台兼容边界的壳层假设。
_Avoid_：为迁移方便统一升级 Electron 并破坏 Windows 7 支持

**Feishu 加密状态存储**：位于 OLT Manager 用户数据目录中的独立加密文件，保存 Feishu 应用配置、凭据引用和审计归档；旧 Operator、Authorized Chat、Access Request 字段仅为历史备份兼容保留，不参与当前查询授权；加密密钥由操作系统钥匙串保护。
_Avoid_：把 Feishu 授权状态写入 OLT Manager 主 SQLite、复制 User Snapshot 或明文保存飞书凭据

**内部只读数据服务**：OLT Manager 内部 Feishu 子系统使用进程内 `OltDataGateway` 接口；迁移完成后不再提供 `/api/gateway/v1/*` HTTP 接口、独立端口或 bearer token。合同只负责稳定的只读投影和授权前过滤规则。
_Avoid_：为内部调用复制一套查询规则、绕过只读合同或重新暴露独立数据服务

**Feishu 子系统生命周期**：Feishu 查询默认关闭；Local Administrator 完成配置并显式启用后才建立长连接，启用状态可持久化并在下次桌面启动时自动重连；停止子系统不影响 OLT Manager 本地只读功能。
_Avoid_：未配置时后台自动联网、Feishu 连接失败阻断 OLT Manager 启动

**Feishu 查询范围模型**：仅支持飞书单聊；每次消息和卡片回调都重新读取全部已启用 OLT，不要求 Operator、Authorized OLT Scope 或 Authorized Chat；仍保留限流、候选过期和审计规则。
_Avoid_：接受群聊查询、把旧授权字段当作当前权限、绕过已启用 OLT 状态或让 Feishu 触发设备写操作

**Language Interpretation seam**：自然语言模型只把当前消息转换为严格约束的 Query Request；它不能访问 User Snapshot、OLT 数据或查询结果，模型故障或输出不合规时必须停止查询。生产模型与仅限 Synthetic Dataset Attestation 的测试模型分离。
_Avoid_：让模型直接查询数据、用本地规则绕过模型失败或把测试模型用于真实现场资料

**生产应用单实例切换**：生产 Feishu 应用由 OLT Manager 单实例接管；旧 Feishu ONU Query 已完成数据迁移并退出，切换时先确认旧宿主停止，再启用新子系统。
_Avoid_：两个宿主同时消费生产消息、为迁移复制生产应用或在未完成本地安全检查时自动放量

**Feishu 状态迁移**：旧 Feishu ONU Query 状态已迁移完成，当前应用不再提供迁移入口或重新读取旧状态；历史状态仅保留作备份/回退材料。
_Avoid_：再次迁移、复制旧密钥文件或把历史授权记录当作当前查询权限

**Feishu 管理界面**：嵌入 OLT Manager 现有桌面界面的 Feishu 管理模块，提供连接状态、启停、应用配置和 provider 配置；不再提供 Operator/Scope、Authorized Chat、申请审批或状态迁移入口。
_Avoid_：通过飞书消息修改授权、为 Feishu 另建远程管理台或让 Feishu 模块影响本地 OLT 只读功能

**组合本机备份**：同时包含 OLT Manager 主 SQLite 和 Feishu 加密状态文件的本机备份；Feishu 内容保持密文，恢复需要人工确认、完整性校验和钥匙串引用检查。
_Avoid_：导出解密后的 Feishu 状态、把备份上传到远程服务或恢复时绕过数据集版本校验

**直接生产切换**：不另建测试应用、不做双宿主并行或生产灰度；完成本地自动化检查、状态迁移和组合备份后，停止旧宿主并启用 OLT Manager 子系统，由第一条真实生产消息完成上线验收，异常时按回退流程恢复旧宿主。
_Avoid_：未备份就切换、两个宿主同时连接生产应用或把未验证的错误暴露给生产群聊

## 用户资源管理

## OSS/NGB 只读会话

**端到端 OSS/NGB 只读登录成功**：不仅完成认证并获得临时会话，还必须能建立网管二期页面会话、加载组织树、发现目标 OLT，并为后续精确 ONU 历史光功率读取提供有效的只读上下文。
_Avoid_：仅凭 uid/token 或 HTTP 200 就认定登录成功

**真实成功会话基线**：由一次实际可用的 OSS/NGB 页面会话提供的、经过脱敏的请求顺序与接口结构，用来核对 OLT Manager 的只读适配器；它不等于可长期复用的 API 凭据或固定会话。
_Avoid_：把一次浏览器会话的 Cookie、token、CUID 或原始 DWR 响应固化到代码、配置或文档

**脱敏 DWR 证据**：只保留 method、路径、状态码、字段形状、参数类型和必要的调用先后关系；组织名称、地址、CUID、用户信息、设备凭据和会话材料均需隐藏或替换为占位符。
_Avoid_：保存可重放的完整请求体、响应体或包含认证材料的网络日志

**用户资源快照**：
某一 OLT 在资源管理系统中完整读取成功后保存的本地 ONU 用户记录集合。它代表资源管理配置数据，不代表 OLT 的实时 SNMP 运行态。
_Avoid_：实时用户数据、部分同步结果

**用户资源检查点**：
仅用于本地调试的有限页 ONU 用户记录集合，附带预期总量和已完成页数；不能替代用户资源快照。
_Avoid_：正式用户快照、断点续传状态

**PON 台账**：
按 OLT 与结构化 PON 坐标保存的本地地址和外层 VLAN 记录。资源管理 SVLAN 可以更新匹配记录；SNMP 读取的是另一来源的运行态信息。
_Avoid_：OLT 实时配置

**完整本机项目备份**：
完整导出的本机 SQLite 数据库，包含项目的本地台账、资源快照和配置。备份文件可能含连接配置等敏感本机数据；恢复前必须由用户确认，并通过 SQLite 完整性与核心表校验。备份和恢复均不得访问或修改 OLT。
_Avoid_：设备配置备份、OLT 配置下发

**装机地址清洗**：
仅针对本地用户资源快照的地址文本进行规范化，清除末尾标记以及因资源系统拼接导致的重复行政区前缀，保留实际村、道路和门牌。清洗规则应幂等，新增规则前需要用样例核对结果。
_Avoid_：修改资源系统原始数据、设备侧地址配置
