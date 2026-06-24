# OLT Manager PRD

## 背景

维护 GPON OLT 时，经常需要在多个信息源之间切换：OLT 状态、PON 台账、ONU 序列号、光功率、距离、外层 VLAN、未注册 ONU 和现场地址。OLT Manager 的目标是把这些只读信息汇总到一个本地 Web 工具中，降低查询和核对成本。

## 目标用户

- 宽带/园区网络维护人员
- 需要核对 ONU、PON、VLAN、地址台账的一线工程师
- 需要做只读排障和现场信息汇总的管理员

## MVP 目标

- 查看 OLT 基本状态和 SNMP 可达性。
- 查询 ONU 列表并按地址、序列号、槽位、PON、状态、光功率过滤。
- 查看 ONU 详情，包括 PON、地址、序列号、光功率、距离、VLAN 和配置片段。
- 查询未注册 ONU/ONT。
- 未注册 ONU/ONT 列表展示槽位、PON、地址、序列号、发现时间和状态，地址由本地 PON 台账匹配。
- 从未注册 ONU/ONT 生成可复制的配置方案预览，包括 ZTE 自营上网、内部网络、自定义 VLAN、MDU+OTT，以及 Huawei 自营上网、内部网络、自定义 VLAN 模板。
- 配置方案弹窗支持复制命令和打开桌面版内置 Telnet 终端自动登录，方便人工粘贴确认。
- 首页作为运维概览，展示当前 OLT、SNMP 状态、未注册 ONU、异常 ONU、台账健康和快捷入口；桌面版快捷入口支持打开当前 OLT 的内置 Telnet 终端。
- 管理本地 OLT 和 PON 台账，PON 台账支持页面编辑、搜索、完整列表展示、Excel 导入导出和外层 VLAN 刷新。
- 记录 SNMP 测试历史和管理操作日志。
- 保持设备数据读取只读，配置命令必须人工粘贴和确认。
- 支持 Apple Silicon macOS 和 Windows 7 x64 桌面发行包，桌面版仍复用本地只读 Web 服务。
- Windows 7 x64 桌面发行包内置 SQLite CLI，安装后启动不要求用户手动配置 SQLite PATH。

## 非目标

- 不做 ONU 自动注册。
- 不做业务开通、删除、重启、复位。
- 不做写配置、保存配置、提交配置。
- 不把生成的配置方案自动下发到 OLT。
- 不自动粘贴或执行生成的配置命令。
- 不自动保存配置。
- 不做公网多用户管理平台。
- 不承诺所有厂商 OID 都已验证。
- Windows 7 x64 桌面版支持内置 Telnet 终端和 ZTE Telnet 只读查询，不依赖系统 Terminal、Expect 或系统 telnet。

## 成功标准

- 本地 `pnpm build` 可通过。
- 后端可以在 `127.0.0.1:8787` 启动。
- 示例数据可以初始化 SQLite。
- ZTE 和 Huawei profile 能在页面中作为只读候选展示。
- 对已验证设备，ONU 查询和详情查询能返回可读结果。
- 对 ZTE 未注册 ONU，页面能从 SNMP 索引解析真实槽位/PON，并用 PON 台账匹配地址。
- 对未注册 ONU，页面可以按模板生成只读命令预览，并清楚标注不会执行、不下发。
- 复制命令在内嵌浏览器中可用；桌面版内置 Telnet 终端可从首页或配置方案弹窗登录当前 OLT 并按厂商进入配置模式，支持用户手动粘贴剪贴板内容，但不自动粘贴或执行生成命令。
- PON 台账可导出为 Excel；Excel 导入只更新本地台账，不触发设备操作。
- 首页待处理事项只做只读统计和页面跳转，不自动处理 ONU 或写设备。
- Huawei 模板的 `sn-auth` 使用 CLI/SNMP 已验证的原始十六进制 SN；Huawei 自营上网、内部网络和自定义 VLAN 支持 `eth1` 到 `eth4` 端口选择，内部网络固定 VLAN `100`，自定义 VLAN 使用用户输入业务 VLAN，并为所选端口生成 `native-vlan ... priority 0`。
- 敏感运行数据不会进入 git。
- 桌面版运行数据保存在用户数据目录，升级安装包不覆盖 SQLite 台账。
- Windows 7 桌面版只能自动使用包内 SQLite CLI 或用户显式指定的 `OLT_MANAGER_SQLITE_BIN`。现场 SQLite 数据库运行数据不得提交；Win7 发行所需的固定 legacy SQLite CLI `bin/win32/sqlite3.exe` 必须提交并随包发布。

## 风险

- 不同 OLT 软件版本的私有 OID 可能不一致。
- 设备 CLI 输出可能受语言、分页、终端控制字符影响。
- 当前自动化测试覆盖配置方案和部分登录辅助逻辑，但 SNMP/OID 解析样例仍需继续补齐。
- 默认 API 没有认证，不应直接暴露到不可信网络。
- 配置方案依赖现场 VLAN 规划；ZTE 和 Huawei 自定义 VLAN 需要人工输入业务 VLAN，MDU+OTT 需要从同 PON 已配置样板 ONU 或台账读取动态 VLAN。
- Huawei 已注册 ONT SN OID 尚未验证，不应把已注册 ONT SN 展示为已确认字段。
- Excel 导入当前以整表替换本地 PON 台账为主，字段级校验和错误报告还需要增强。
- macOS DMG 当前未使用 Apple Developer ID 签名、未经过 Apple 公证；浏览器下载后可能被 Gatekeeper 显示为“已损坏”，只适合可信来源的内部测试分发。

## 待确认问题

- 是否需要对本地 Web 页面增加最小口令。
- Huawei MA5800 已注册 ONT SN OID 是否能稳定读取。
- PON 台账是否需要更严格的导入模板校验、差异预览和错误报告。
- 后续是否支持多站点数据隔离。
- 配置方案模板是否需要按站点、OLT 或 PON 口设置默认值。
- 正式公开分发 macOS 版本前，何时配置 Apple Developer ID 签名和 Apple 公证。
