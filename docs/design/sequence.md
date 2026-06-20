# Sequence Design

本文件描述关键流程，便于后续拆分测试和定位回归。

## 启动流程

```mermaid
sequenceDiagram
  participant User as User
  participant Browser as Browser
  participant Electron as Electron IPC
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

## 桌面启动流程

```mermaid
sequenceDiagram
  participant User as User
  participant Electron as Electron main
  participant FS as Package resources
  participant API as Node API
  participant Window as BrowserWindow
  participant DB as User data SQLite

  User->>Electron: 启动桌面应用
  Electron->>Electron: 设置 OLT_MANAGER_DATA_DIR / STATIC_DIR / SEED_DIR
  Electron->>FS: 检测 app/bin 或 resources/bin 下的 sqlite3.exe
  FS-->>Electron: 返回包内 SQLite 路径
  Electron->>Electron: 设置 OLT_MANAGER_SQLITE_BIN
  Electron->>API: startServer({ host: 127.0.0.1, port: 0 })
  API->>DB: 初始化或迁移本地 SQLite
  API-->>Electron: 返回本机访问 URL
  Electron->>Window: loadURL(localhost)
  Window->>API: GET /api/bootstrap
  API-->>Window: 返回本地 OLT、台账和公开 OID profile
```

桌面壳只负责启动本地服务和窗口，不增加设备写操作能力。运行数据写入用户数据目录，安装目录只放程序、脱敏 seed 和包内工具。Windows 7 安装版会自动绑定包内 SQLite CLI，不要求用户把 SQLite 加入 PATH。

## ONU 查询流程

```mermaid
sequenceDiagram
  participant Browser as Browser
  participant Electron as Electron IPC
  participant API as Node API
  participant DB as SQLite
  participant SNMP as SNMP tools / built-in client
  participant OLT as OLT

  Browser->>API: GET /api/onus
  API->>DB: 读取 OLT 配置
  API->>SNMP: snmpbulkwalk 或内置 GETBULK 只读 OID
  SNMP->>OLT: SNMP v2c read
  OLT-->>SNMP: ONU 原始数据
  SNMP-->>API: stdout 或结构化 rows
  API->>API: 解析 OID 和索引
  API-->>Browser: ONU 列表 JSON
```

## ZTE ONU 配置只读查询

```mermaid
sequenceDiagram
  participant Browser as Browser
  participant API as Node API
  participant Adapter as zte-telnet.mjs
  participant Telnet as telnet-client.mjs
  participant OLT as OLT

  Browser->>API: GET /api/onu-config?slot=&pon=&onuId=
  API->>API: 校验 OLT 与 ONU 坐标
  API->>Adapter: queryZteOnuReadOnly
  Adapter->>Adapter: 生成固定 show 命令
  Adapter->>Telnet: 内置 Telnet 自动登录并执行白名单 show
  Telnet->>OLT: Telnet 登录并 show
  OLT-->>Telnet: 配置输出
  Telnet-->>Adapter: 只读命令输出
  Adapter-->>API: 只读配置文本
  API-->>Browser: ONU 配置 JSON
```

## 未注册 ONU 配置方案生成

```mermaid
sequenceDiagram
  participant Browser as Browser
  participant Electron as Electron IPC
  participant API as Node API
  participant DB as SQLite
  participant SNMP as SNMP tools / built-in client
  participant OLT as ZTE OLT

  Browser->>API: POST /api/unregistered-onus/:id/config-plan
  API->>API: 校验 OLT、slot、pon、serial、templateId
  API->>DB: 读取模板和 PON 台账
  API->>SNMP: 只读查询同 PON 已注册 ONU
  SNMP->>OLT: SNMP v2c get/walk
  OLT-->>SNMP: ONU ID 与 service-port 数据
  SNMP-->>API: stdout 或结构化 rows
  API->>API: 计算最大 ONU ID + 1
  API->>API: 按模板解析 VLAN、物理口和 Huawei sn-auth SN
  API-->>Browser: 返回命令预览、变量来源和告警
  Browser-->>Browser: 展示复制和打开内置终端按钮，不执行命令
  Browser->>Electron: terminal:create
  Electron->>DB: 读取当前 OLT 的 Telnet 凭据
  Electron->>OLT: 内置 Telnet 自动登录并进入配置模式
  OLT-->>Electron: 终端输出
  Electron-->>Browser: terminal:event 推送终端事件
```

规则：

- ONU ID 不复用空洞；同 PON 最大 ONU ID 达到 `128` 时阻止生成。
- 自营上网和内部网络主要使用固定 VLAN 和用户选择的物理口。
- MDU+OTT 从同 PON 已配置样板 ONU 的 service-port 表读取内层 VLAN、外层 VLAN 和互动 VLAN。
- Huawei 自营上网使用固定内层 VLAN `3301`、line/service profile `300`、gemport `0`，并把可读 SN 转换为原始十六进制 SN。
- 未注册 ONU 自身没有 service-port，不能直接读取业务 VLAN。
- 打开内置终端流程不传递命令文本；ZTE 自动 `con t`，Huawei 自动 `enable` + `config`，命令仍由用户人工粘贴和确认。
- 首页快捷入口的“打开终端”复用同一套 `terminal:create` IPC，只自动登录当前 OLT 并进入配置模式，不复制或传递任何配置方案文本。

## 管理台账流程

```mermaid
sequenceDiagram
  participant Browser as Browser
  participant API as Node API
  participant DB as SQLite

  Browser->>Browser: 页面编辑 / Excel 导入
  Browser->>Browser: 搜索过滤并优先显示当前 OLT 台账
  Browser->>Browser: 规范化为 oltIp、ponPort、outerVlan、address
  Browser->>API: 保存 OLT 或 PON 台账
  API->>API: 校验 JSON 结构
  API->>DB: replaceOlts / replacePonPorts
  DB-->>API: 写入完成
  API-->>Browser: 返回最新数据
  Browser->>Browser: Excel 导出本地台账
```

管理台账是本地应用数据写入，不是 OLT 设备写入。ONU 数据管理列表展示全部匹配台账，不再截断前 500 条；Excel 导入导出均在浏览器和本地 API 之间完成，不登录 OLT、不执行 SNMP/Telnet 写操作。

## GitHub 自动发行流程

```mermaid
sequenceDiagram
  participant Maintainer as Maintainer
  participant GitHub as GitHub
  participant CI as Actions CI
  participant Release as GitHub Release

  Maintainer->>GitHub: push / PR to main
  GitHub->>CI: 运行 pnpm install / test / build
  CI-->>GitHub: 返回验证结果
  Maintainer->>GitHub: 从 main 推送 v* tag
  GitHub->>CI: release matrix 构建 macOS DMG 和 Windows x64 ZIP
  CI->>Release: 上传 DMG/ZIP 和 SHA256SUMS
```

GitHub Actions 只负责产出桌面发行包；Windows 7 x64 兼容性仍需要真实 Win7 或虚拟机手工验收。
