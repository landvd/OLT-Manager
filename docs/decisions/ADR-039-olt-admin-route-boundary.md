# ADR-039：OLT 与台账管理路由边界

## 状态

已接受，架构十五期第 54 项（2026-08-19）。

## 决策

新增 `src/olt-admin-routes.mjs`，通过依赖注入承载 OLT 列表读取/替换、PON 台账读取/导入和外层 VLAN 刷新路由。模块负责 HTTP 编排和依赖调用；SQLite 表替换、敏感字段保存、PON 台账校验和 SNMP 只读刷新继续由现有数据库/服务函数提供。

OLT 响应继续经过 `publicOlt` 投影，不能返回 SNMP community、Telnet 用户名或密码；PON 导入只写本地 SQLite 台账，VLAN 刷新仍只能读取 OLT 状态并更新本地台账，不产生任何设备写配置命令。

## 兼容与回滚

保留原有路径、方法、响应字段、`admin` 来源标记、OLT 敏感字段投影和 VLAN 刷新参数。回滚时删除该模块和测试，并恢复 `server.mjs` 原 OLT/台账路由区。

## 验证

`tests/olt-admin-routes.test.mjs` 覆盖 credential-free OLT 投影、OLT 替换、PON 查询/导入、VLAN 刷新和未匹配路径；完整测试继续验证本地数据库与只读 SNMP 行为。
