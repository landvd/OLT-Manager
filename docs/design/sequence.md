# Sequence Design

本文件描述关键流程，便于后续拆分测试和定位回归。

## 启动流程

```mermaid
sequenceDiagram
  participant User as User
  participant Browser as Browser
  participant API as Node API
  participant DB as SQLite

  User->>Browser: 打开页面
  Browser->>API: GET /api/bootstrap
  API->>DB: 读取 OLT 与 PON 台账
  DB-->>API: 返回本地数据
  API-->>Browser: 返回 bootstrap JSON
  Browser->>API: GET /api/status / GET /api/unregistered-onus / GET /api/onus
  API-->>Browser: 返回只读状态、未注册 ONU 和 ONU 摘要
  Browser-->>User: 展示运维概览和快捷入口
```

## ONU 查询流程

```mermaid
sequenceDiagram
  participant Browser as Browser
  participant API as Node API
  participant DB as SQLite
  participant SNMP as SNMP tools
  participant OLT as OLT

  Browser->>API: GET /api/onus
  API->>DB: 读取 OLT 配置
  API->>SNMP: snmpbulkwalk 只读 OID
  SNMP->>OLT: SNMP v2c read
  OLT-->>SNMP: ONU 原始数据
  SNMP-->>API: stdout
  API->>API: 解析 OID 和索引
  API-->>Browser: ONU 列表 JSON
```

## ZTE ONU 配置只读查询

```mermaid
sequenceDiagram
  participant Browser as Browser
  participant API as Node API
  participant Adapter as zte-telnet.mjs
  participant Expect as zte-readonly.expect
  participant OLT as OLT

  Browser->>API: GET /api/onu-config?slot=&pon=&onuId=
  API->>API: 校验 OLT 与 ONU 坐标
  API->>Adapter: queryZteOnuReadOnly
  Adapter->>Adapter: 生成固定 show 命令
  Adapter->>Expect: 执行只读 Expect 脚本
  Expect->>OLT: Telnet 登录并 show
  OLT-->>Expect: 配置输出
  Expect-->>Adapter: stdout
  Adapter-->>API: 只读配置文本
  API-->>Browser: ONU 配置 JSON
```

## 未注册 ONU 配置方案生成

```mermaid
sequenceDiagram
  participant Browser as Browser
  participant API as Node API
  participant DB as SQLite
  participant SNMP as SNMP tools
  participant OLT as ZTE OLT

  Browser->>API: POST /api/unregistered-onus/:id/config-plan
  API->>API: 校验 OLT、slot、pon、serial、templateId
  API->>DB: 读取模板和 PON 台账
  API->>SNMP: 只读查询同 PON 已注册 ONU
  SNMP->>OLT: SNMP v2c get/walk
  OLT-->>SNMP: ONU ID 与 service-port 数据
  SNMP-->>API: stdout
  API->>API: 计算最大 ONU ID + 1
  API->>API: 按模板解析 VLAN、物理口和 Huawei sn-auth SN
  API-->>Browser: 返回命令预览、变量来源和告警
  Browser-->>Browser: 展示复制和登录终端按钮，不执行命令
  Browser->>API: POST /api/open-terminal-login
  API->>DB: 读取当前 OLT 的 Telnet 凭据
  API-->>Browser: 打开本机 Terminal 登录脚本结果
```

规则：

- ONU ID 不复用空洞；同 PON 最大 ONU ID 达到 `128` 时阻止生成。
- 自营上网和内部网络主要使用固定 VLAN 和用户选择的物理口。
- MDU+OTT 从同 PON 已配置样板 ONU 的 service-port 表读取内层 VLAN、外层 VLAN 和互动 VLAN。
- Huawei 自营上网使用固定内层 VLAN `3301`、line/service profile `300`、gemport `0`，并把可读 SN 转换为原始十六进制 SN。
- 未注册 ONU 自身没有 service-port，不能直接读取业务 VLAN。
- 打开终端流程不传递命令文本；ZTE 自动 `con t`，Huawei 自动 `enable` + `config`，命令仍由用户人工粘贴和确认。

## 管理台账流程

```mermaid
sequenceDiagram
  participant Browser as Browser
  participant API as Node API
  participant DB as SQLite

  Browser->>Browser: 页面编辑 / Excel 导入
  Browser->>Browser: 规范化为 oltIp、ponPort、outerVlan、address
  Browser->>API: 保存 OLT 或 PON 台账
  API->>API: 校验 JSON 结构
  API->>DB: replaceOlts / replacePonPorts
  DB-->>API: 写入完成
  API-->>Browser: 返回最新数据
  Browser->>Browser: Excel 导出本地台账
```

管理台账是本地应用数据写入，不是 OLT 设备写入。Excel 导入导出均在浏览器和本地 API 之间完成，不登录 OLT、不执行 SNMP/Telnet 写操作。

## 常用命令检索流程

```mermaid
sequenceDiagram
  participant User as User
  participant Browser as Browser

  User->>Browser: 输入中文用途或命令片段
  Browser->>Browser: 在内置中兴/华为命令清单中模糊过滤
  Browser-->>User: 展示命令和说明
```

常用命令检索在独立页面展示命令文本，不能自动登录、自动粘贴或自动执行。
