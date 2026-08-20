# ADR-029：SNMP/OID 纯函数边界

- 状态：已接受
- 日期：2026-08-19

## 背景

`src/server.mjs` 同时包含 SNMP 读取编排和厂商 OID 的索引、VLAN 行、坐标及值转换逻辑。解析规则本身不需要网络、数据库或 HTTP 运行时，却难以在入口文件外独立回归。

## 决策

新增 `src/snmp-oid-codecs.mjs`，集中承载并导出这些无副作用函数：

- ZTE/Huawei ONU、PON 和接口索引的编码与解析；
- ZTE/Huawei VLAN 行解析和外层 VLAN 选择；
- PON 坐标归一化、SNMP 行索引和状态值转换；
- Hex 序列号、Rx 光功率、距离及 DateAndTime 的解析。

`src/snmp-parsers.mjs` 继续提供既有通用 OID 后缀、基础 ZTE ifIndex、未注册 ONU 索引和原始 Hex 兼容函数；新模块组合并重新导出这些基础函数。`server.mjs` 通过 import 使用新边界，并继续导出既有的 `parseZteOuterVlanRows`。

## 不做事项

- 不移动或修改 SNMP get/walk、UDP fallback、命令白名单、超时和错误诊断；
- 不修改 HTTP 路由、数据库读写、远端会话、同步流程或业务字段契约；
- 不把未经现场验证的 OID、设备写操作或配置下发逻辑加入该模块；
- 不以纯函数测试替代真实 OLT、发行包或跨进程验收。

## 验证

新增 `tests/snmp-oid-codecs.test.mjs` 覆盖索引、VLAN、Hex、Rx、日期、坐标和行索引规则；原有 `tests/zte-vlan-parser.test.mjs` 继续从 `server.mjs` 导入，验证兼容导出。
