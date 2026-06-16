# Architecture

OLT Manager 是一个本地运行的只读 GPON OLT 管理原型。它把现场 OLT 数据读取、PON 台账、ONU 查询和配置片段展示放在一个轻量 Web 应用里，目标是帮助维护人员快速定位 ONU、PON、VLAN 和注册状态。

## 系统边界

```text
Browser
  |
  | HTTP JSON API
  v
Node.js server
  |-- SQLite local data
  |-- SNMP get/walk through system tools
  |-- ZTE read-only Expect/Telnet adapter
  v
OLT devices
```

系统只读取设备信息，不执行设备写操作。

## 主要模块

- `src/main.js`：Vue 3 前端入口，负责页面状态、表格、表单、对话框和 API 调用。
- `src/styles.css`：前端样式。
- `src/server.mjs`：HTTP API、静态文件服务、SNMP 调用、OID 解析和业务聚合。
- `src/db.mjs`：SQLite 初始化、台账读写、操作日志和 SNMP 测试历史。
- `src/zte-telnet.mjs`：ZTE ONU 只读配置查询封装。
- `src/zte-readonly.expect`：Expect 脚本，只执行内部生成的白名单 show 命令。
- `data/*.example.json`：可提交示例 seed。
- `data/*.json`、`data/*.sqlite*`：本地运行数据，不提交。

## 数据流

1. 前端请求 `/api/bootstrap` 获取 OLT、PON 台账和公开 OID profile。
2. 用户发起状态、ONU、未注册 ONU 或配置查询。
3. 后端读取 SQLite 中的 OLT 配置和台账。
4. 后端通过 SNMP 只读命令采集设备数据。
5. 对 ZTE ONU 配置查询，后端调用固定白名单 Telnet show 命令。
6. 后端解析输出并返回 JSON。
7. 前端展示状态、告警、ONU 列表、PON 台账和只读配置片段。

## 安全边界

- 不暴露任意命令执行接口。
- 不支持 `snmpset`。
- 不支持 ONU 注册、授权、删除、重启、恢复出厂。
- 不支持配置模式、保存配置、提交配置。
- ZTE Telnet 只允许根据 `slot/pon/onuId` 生成固定 show 命令。
- 默认服务监听 `127.0.0.1`，不假设已经具备公网暴露安全性。

## 技术约束

- 当前后端是原生 Node HTTP 服务，不依赖 Express。
- SQLite 通过系统 `/usr/bin/sqlite3` 调用。
- SNMP 依赖系统 `snmpget`、`snmpbulkwalk`。
- ZTE Telnet 查询依赖 `expect` 和本机 telnet。
- Vite 7 对 Node 版本要求高于 `package.json` 当前 `>=18` 的宽松声明，后续需要校准。

## 可演进方向

- 将 SNMP/OID 解析从 `src/server.mjs` 拆成可测试模块。
- 增加最小认证或本机代理部署文档。
- 为 Huawei MA5800 建立更多只读样例和解析测试。
- 将 API 合约、数据库迁移和解析函数纳入自动化测试。
