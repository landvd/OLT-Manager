# Progress

## 2026-08-24

- 已读取项目开发状态、架构、API/数据库/时序、实验记录和变更记录。
- 已确认工作区已有 `CHANGELOG.md`、`src/olt-admin-api.mjs`、`tests/olt-admin-api.test.mjs` 改动，保留不动。
- 已确认生成器原文的空格正常，问题集中在内置终端剪贴板发送路径。
- 已新增 `src/terminal-paste.mjs` 和对应回归测试；更新桌面端按钮/键盘粘贴链路，并保持生成器不变。
- 已修正主界面中的转义字符问题；粘贴测试 3/3、相关前端/生成器/状态/键盘测试 29/29 通过。
- 既有 Telnet 集成测试首次受沙箱回环监听限制，改用允许本机临时监听的测试方式后 5/5 通过。
- `CI=true pnpm run build` 和 `CI=true pnpm run dist:dir` 通过；已核对 macOS 目录包包含新的粘贴模块和主界面引用。
- 初次不带 `CI=true` 的 pnpm 构建尝试因依赖联网检查/非交互 modules purge 中止，未产生代码变更；后续使用项目既有 CI 构建方式成功。
- 根据现场截图追加修复：Huawei 内置 Telnet 不再自动发送 `config`，只发送 `enable`；完整配置方案和剪贴板内容保留 `config`。
- 更新了内置 Telnet、旧 macOS 登录辅助、PRD/架构/API/时序/ADR 文档和回归测试。
- 相关回归测试 35/35 通过，`CI=true pnpm run dist:dir` 通过。
- 现场补充确认 Huawei 应自动扫描同 PON 空闲 ONT ID：新增 `suggestHuaweiOntId`，空位优先、无空位时最大 ID + 1；服务端把同一候选 ID 同时传给 `ont port native-vlan` 和 `service-port`。
- 配置方案及项目模板回归覆盖空位候选和显式 ID 渲染；配置方案 23/23 通过，项目 API 15/15 通过（回环监听使用授权测试环境）。
- 已重新构建并启动最新 v1.1.5 桌面包；当前桌面端已加载新的 Huawei ONT ID 空位扫描逻辑。
- Huawei 自营上网方案已允许 `ethPorts: []`：保留 `service-port`，跳过 `ont port native-vlan`；内部网络和自定义 VLAN 仍要求有效网口。
- 已确认 Huawei 自动发现列表误报根因：服务端使用了会保留历史记录的 `...52.1.2` 注册信息表，而非 CLI 对应的 `...48.1.2` 自动发现表；同时保留了注册结果过滤、已注册 ONT SN 去重和当前 OLT 响应隔离。
- 已通过只读 SNMP 对照确认现场 `...48.1.2` 返回 2 条；最新桌面包现场刷新后显示同样 2 条。完整回归测试 450/450 通过，目录包构建通过。

## 2026-08-24 Win7 x64 打包

- 版本校验通过：`1.1.5`；Win7 SQLite CLI 复用并通过 SHA3-256 校验。
- 首次 `dist:win` 因 Apple Silicon 无法执行旧版 Wine 的 `wine64`（`bad CPU type in executable`）停在 Windows 资源编辑步骤，未影响源码和 Electron x64 文件生成。
- 使用 electron-builder 的 `signAndEditExecutable=false` 重新生成 `release/OLT Manager-1.1.5-win7-x64.zip`，目标为 Electron `22.3.27` / Windows x64。
- ZIP 内容核验通过：PE32+ x86-64 主程序、`resources/bin/win32/sqlite3.exe`、Feishu runtime、动态模块和 Huawei 自动发现修复均存在；SHA-256：`b781343c697ad11d98378e29a69b7b34aa99fb09d058e01b923b18b55d190d23`。
- 沙箱内完整测试因禁止本机回环监听出现环境性失败；在允许本机临时监听的环境复跑通过：450/450。

## 2026-08-24 Win7 Huawei OID 修复

- 已根据 Win7 截图确认负数接口索引根因：`-100653312` 应还原为无符号值 `4194313984`。
- 已在 `src/snmp-parsers.mjs` 统一还原 Win7 有符号 OID 子标识，并在 `src/snmp-client.mjs` 修正高位 OID 的 BER 编解码算术；未改变 SNMP 只读边界。
- 已新增负数 ifIndex、Huawei 接口解析和高位 OID UDP 编解码回归测试；相关测试 15/15 通过。
- 完整回归测试通过：453/453；首次全量测试出现的资源调度时序波动单独复跑通过。
- 已重新构建并核验 Win7 x64 ZIP：`release/OLT Manager-1.1.5-win7-x64.zip`，PE32+ x86-64、包布局、内置 SQLite 和修复后的 SNMP 模块均存在；SHA-256：`3a8c47f66c892bc617bf5bfa91bef9f328d4353ec0e6d1736ea2e2e16db0e3d0`。

## 2026-08-24 Win7 Huawei 光功率修复

- 已将 Huawei `32768–65533` 范围的光功率原始值按 16 位补码解码，并识别 `65534`、`65535`、`2147483647` 无效标记。
- 已新增 `64177 -> -13.59 dBm`、`63883 -> -16.53 dBm` 回归测试；专项测试 7/7、完整回归测试 453/453 通过。
- 已重新构建并核验 Win7 x64 ZIP：`release/OLT Manager-1.1.5-win7-x64.zip`，主程序为 PE32+ x86-64，ZIP 校验通过，SHA-256：`7e6aeabcd8e79785cb58490e7ff9d5c8a94d9f3f18c5dd0e573b7802d8e2a5d4`。
