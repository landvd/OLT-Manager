# ADR-009: Feishu read-only data gateway

## Status

Accepted

## Context

Feishu ONU Query 需要使用 OLT inventory、NMSE 用户快照和 ONU 实时状态。如果复制数据库或连接凭据，两套应用会产生重复维护、结构耦合和更大的敏感数据面。现有通用管理 API 没有独立认证，也包含本集成不需要的管理能力。

## Decision

新增 `OltDataGateway` 深模块和进程内 Feishu 合同投影。它只绑定现有本机服务，不再提供独立 HTTP Adapter、端口或 bearer token。接口限于合同状态、非秘密 OLT identity、按已启用 OLT ID 过滤的用户查询、唯一用户实时状态、精确 ONU 坐标实时状态和精确 PON 口的有界状态列表。

Gateway 在读取前拒绝空、未知或未启用的 OLT ID，在计数前完成 OLT ID 与字段过滤，最多返回 100 个候选。Feishu 应用对单聊自动传入全部已启用 OLT；不再使用 Operator、Authorized Chat 或群聊成员 scope。PON 台账地址搜索同样按已启用 OLT ID 过滤，只投影 OLT identity、台账地址和 PON 坐标。用户实时状态组合接口只有在范围内恰好命中一个用户时才读取设备；当姓名或地址查询没有命中用户且查询词是短中文短语时，应用层可保守回退到 PON 台账地址搜索，不扩大为任意模糊搜索。PON 状态接口要求完整 PON 坐标，只投影最多 128 个 ONU 的坐标、快照姓名、在线状态和光功率，不返回电话、地址、LOID、MAC 或 SN。

唯一用户的详细读取优先使用已验证的 ONU 详情；详情读取失败时尝试通用 ONU 实时状态。若 OLT 当前仍未返回本地快照中的精确 ONU 坐标，则保留用户快照资料，并将实时字段标记为未知、明确提示实时 ONU 数据未返回。该降级只读已有快照，不猜测设备状态，也不触发设备写操作。候选卡片由应用层保存五分钟的一次性绑定，最多保留 100 条候选，每页展示 5 条；翻页和候选选择都重新校验聊天与 OLT 范围。

状态合同返回持久化的 opaque `datasetRevision`；完整用户快照替换、备份导入或影响用户资料的本机清洗会轮换版本。版本本身不由用户内容派生，不暴露用户资料或数据库实现。它不返回数据库、主机地址、凭据、NMSE 会话、项目、配置方案、审计或全量用户数据，也不提供同步和写操作。

桌面版不提供 Gateway 设置界面；页面服务固定使用本机回环端口 `8787`，Feishu 通过 Electron 主进程内的只读数据服务访问数据。

## Consequences

- OLT Manager 是 OLT、NMSE 用户快照和设备实时状态的唯一维护源。
- Feishu ONU Query 只保存审计和 Feishu App 凭据引用，不保存独立 Gateway token 或当前 OLT 授权表。
- 当前用户快照没有 ONU serial 字段，Gateway 不猜测映射，也不通过无界设备扫描实现 serial 查询；该意图在合同扩展前失败关闭。
- 数据库和厂商适配可独立演进，只要 v1 投影合同保持兼容。
- Feishu ONU Query 可以把 Synthetic Dataset Attestation 绑定到 `datasetRevision`；版本变化只使确认失效，不授予任何数据访问权限。
