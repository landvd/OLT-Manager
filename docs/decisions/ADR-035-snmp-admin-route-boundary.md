# ADR-035：SNMP 管理诊断路由边界

## 状态

已接受，架构十一期第 46 项（2026-08-19）。

## 决策

新增 `src/snmp-admin-routes.mjs`，通过依赖注入承载 OID profile、只读 SNMP 测试、SNMP 历史和管理员事件查询路由。模块负责 HTTP 路径匹配、`get/walk` 白名单、危险操作拒绝、OID 格式校验、探测记录和响应编排；SNMP UDP 实现、OID profile、SQLite 记录和事件查询继续由现有模块提供。

SNMP 测试仍只允许 `get` 与 `walk`，不允许 `set` 或任何可能改变 OLT 状态的命令；原始探测输出仍按既有契约记录和返回，真实凭据由底层脱敏边界负责，不在路由模块新增暴露路径。

## 兼容与回滚

保留既有路径、方法、错误文案、OID 校验、探测记录字段和历史查询默认条数；不改变 OLT 设备操作权限。回滚时删除该模块和测试，并恢复 `server.mjs` 原诊断路由区。

## 验证

`tests/snmp-admin-routes.test.mjs` 覆盖 profile、危险操作拒绝、get/walk、OID 错误、探测记录和历史/事件查询；完整测试继续验证真实服务端 API 与 SNMP 只读边界。
