# ADR-009: Feishu read-only data gateway

## Status

Accepted

## Context

Feishu ONU Query 需要使用 OLT inventory、NMSE 用户快照和 ONU 实时状态。如果复制数据库或连接凭据，两套应用会产生重复维护、结构耦合和更大的敏感数据面。现有通用管理 API 没有独立认证，也包含本集成不需要的管理能力。

## Decision

新增 `OltDataGateway` 深模块和 `/api/gateway/v1/*` HTTP Adapter。它只绑定现有本机服务，要求独立 opaque bearer token，且 token 缺失时禁用。接口限于合同状态、非秘密 OLT identity、带范围用户查询和精确 ONU 坐标实时状态。

Gateway 在读取前拒绝空或未知 scope，在计数前完成 scope 与字段过滤，最多返回十个候选。它不返回数据库、主机地址、凭据、NMSE 会话、项目、配置方案、审计或全量用户数据，也不提供同步和写操作。

## Consequences

- OLT Manager 是 OLT、NMSE 用户快照和设备实时状态的唯一维护源。
- Feishu ONU Query 只保存自己的授权/审计和 Gateway token 的钥匙串引用。
- 当前用户快照没有 ONU serial 字段，Gateway 不猜测映射，也不通过无界设备扫描实现 serial 查询；该意图在合同扩展前失败关闭。
- 数据库和厂商适配可独立演进，只要 v1 投影合同保持兼容。
