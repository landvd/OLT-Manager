# 中兴 C600 配置方案模板、Windows 7 发行包与组合备份交接文档

> 日期：2026-09-12  
> 目标系统：OLT Manager (macOS Apple Silicon & Windows 7 x64)  
> 涉及设备：中兴 C600 (TITAN 架构，172.19.106.50)  
> 核心原则：**严格保持只读与人工确认边界，系统绝不自动向 OLT 下发任何写配置**

---

## 1. 背景与用户需求

1. **中兴 C600 (172.19.106.50) 接入与配置支持**：
   - 现场已通过 SNMP 与只读 Telnet 验证了 `172.19.106.50`（ZXA10 C600 V2.0.10，厚街 XGPON）。
   - 用户要求开发针对 C600 的专属配置方案模板（自营上网、链路展台、自定义 VLAN），对比分析并适配 C600 与既有 C300 命令的巨大差异。
   - 用户明确指示：**可以编写相关模板，但不要应用到 OLT 设备上**，等待后续在 C600 上挂接测试 ONT 后再行实机测试。
2. **打包 Windows 7 x64 发行版**：
   - 生成针对 Win7 x64 环境的免安装绿色桌面程序（ZIP），供现场部署与验证。
3. **导出组合备份**：
   - 将当前最新的全量业务数据（包含 1.4 万+ 条网管二期台账快照、已更新的 OLT 凭据等）和 Feishu 状态导出为标准组合备份，以便直接导入至 Win7 运行环境。

---

## 2. 中兴 C600 (ZXA10-TITAN) vs C300 CLI 核心语法差异

通过现场只读 Telnet 登录 `172.19.106.50`，实测抓取了现网正在运行的 GPON/XGPON ONU（如 `1/1/1:1`）真实配置并与 C300 对比，得出核心差异如下：

| 配置维度 | 中兴 C300 (传统 ROS 架构) | 中兴 C600 (TITAN 架构) | 差异说明与避坑点 |
| :--- | :--- | :--- | :--- |
| **进入全局配置模式** | `configure terminal` / `con t` | `configure terminal` | C600 键入 `con t` 会报 `%Error 140301: Ambiguous command:"con t"`，**必须全写** `configure terminal` |
| **OLT 物理接口命名** | `interface gpon-olt_1/1/1` | `interface gpon_olt-1/1/1` | 下划线与连字符位置反转（`gpon-olt_` vs `gpon_olt-`） |
| **ONU 逻辑接口命名** | `interface gpon-onu_1/1/1:1` | `interface gpon_onu-1/1/1:1` | 下划线与连字符位置反转（`gpon-onu_` vs `gpon_onu-`） |
| **ONU 认证注册命令** | 在 `gpon-olt` 下：<br>`onu 1 type <TYPE> sn <SN>` | 在 `gpon_olt` 下：<br>`onu 1 type <TYPE> sn <SN>` | 基本一致，支持 16 进制原始 SN |
| **T-CONT 声明** | `tcont 1 name T1 profile <NAME>` | `tcont 1 name <NAME> profile <NAME>` | TITAN 强制需要 `name` |
| **GEMPORT 声明** | `gemport 1 name G1 tcont 1` | `gemport 1 name <NAME> tcont 1` | TITAN 强制需要 `name` |
| **业务流与打标体系** | **全局命令行体系**：<br>`service-port 1 vport 1 user-vlan <V> vlan <V>` | **接口内部体系 (彻底废弃 service-port)**：<br>在 `gpon_onu-X/X/X:Y` 视图下：<br>`vport-mode manual`<br>`vport 1 name <NAME> vlan map-type vlan`<br>`vport-map 1 1 vlan <V>` | TITAN 彻底废除了全局 `service-port` 命令，改在 `interface gpon_onu` 内通过 `vport-mode manual` + `vport-map` 进行打标 |
| **网关接口与透传** | 物理口模式：<br>`vlan port eth_0/1 mode tag vlan <V>` | 智能网关/一体机：<br>`vlan port veip_1 mode trunk`<br>`vlan port veip_1 vlan <V>`<br>*(亦支持 `eth_0/1`)* | 现代智能 ONT 绝大多数使用 `veip_1` 虚拟以太口，C600 模板默认支持 `veip_1`，并兼容物理口切换 |
| **配置核对/显示命令** | 全局视图敲：<br>`show running-config interface ...` | 进入各接口视图后敲：<br>`show this` | C600 废弃了远程跨视图打印接口配置，必须进入具体 interface 视图后敲 `show this` |

---

## 3. 代码修改与架构落地

### 3.1 设备能力开启与模板定义
- [`src/device-profiles.mjs`](file:///Users/mac/Documents/OLT%20Manager/src/device-profiles.mjs)：
  - 将 `zte-c600` 的 `configSupported` 标记由 `false` 更新为 `true`。
- [`src/config-plan.mjs`](file:///Users/mac/Documents/OLT%20Manager/src/config-plan.mjs)：
  - 新增三个专属 C600 模板生成函数：
    1. `buildZteC600SelfOperatedInternetConfigPlan`（C600 自营上网方案）
    2. `buildZteC600LinkBoothConfigPlan`（C600 链路展台方案）
    3. `buildZteC600CustomVlanConfigPlan`（C600 自定义 VLAN 方案）
  - 生成标准的 TITAN 配置命令序列与 `show this` 验证命令。
  - 在 `buildUnregisteredConfigPlan` 中增加 `matchedTemplate.deviceProfiles.includes(olt.deviceProfile)` 白名单严格校验，杜绝 C300 与 C600 模板混用。
- [`src/server.mjs`](file:///Users/mac/Documents/OLT%20Manager/src/server.mjs)：
  - 在未注册 ONT 配置推荐逻辑中，若设备为 `zte-c600`，自动推荐 `zte-c600-self-operated-internet` 模板。
- [`tests/config-plan.test.mjs`](file:///Users/mac/Documents/OLT%20Manager/tests/config-plan.test.mjs)：
  - 补充对 C600 自营上网、链路展台、自定义 VLAN 以及跨型号阻断的单测。
  - **全量测试验证：576 / 576 pass（0 fail）**。

### 3.2 严格的只读隔离保证
- 系统**绝不调用任何写 OLT 命令**，不通过 Telnet 下发配置，不保存配置。
- 界面上的“配置方案”仅提供 CLI 语法高亮文本预览与一键复制功能。
- 待现场测试 ONT 连接到 C600 设备后，由维护工程师在内置终端中人工登录、核对并逐行粘贴执行。

---

## 4. Windows 7 x64 绿色桌面版打包

- **构建命令**：`pnpm run dist:win`（集成 Vite 前端构建、Feishu runtime 依赖封装、Win7 sqlite3.exe 依赖装配及 electron-builder 打包）。
- **兼容性保障**：
  - 基于 Electron 22.3.27 legacy 分支，确保 Windows 7 / 8 / 8.1 x64 原生可运行。
  - 内置已验证的 PE32 Intel 80386 legacy `sqlite3.exe`（位于 `resources/bin/win32/`），用户与目标系统**无需安装 SQLite 或配置环境变量**。
  - 关闭 asar 打包，保持 Node 原生 ESM 文件结构。
  - 用户运行数据隔离在 `%APPDATA%/olt-manager/data/`，升级更新解压包不丢失现场数据。
- **输出产物**：
  - ZIP 包：[`release/OLT Manager-1.1.7-win7-x64.zip`](file:///Users/mac/Documents/OLT%20Manager/release/OLT%20Manager-1.1.7-win7-x64.zip) (约 108 MB)
  - 解压目录：[`release/win-unpacked/`](file:///Users/mac/Documents/OLT%20Manager/release/win-unpacked)

---

## 5. 组合备份导出与 Windows 7 导入恢复

### 5.1 备份导出工具与产物
为方便将 macOS 上的全量现场台账迁移到 Win7 测试机，编写了标准导出脚本 [`scripts/export-combined-backup.mjs`](file:///Users/mac/Documents/OLT%20Manager/scripts/export-combined-backup.mjs)：
- 自动读取最新 `data/olt-manager.sqlite`（21.81 MB，包含 14,222 条网管二期台账快照、12,168 条用户快照、7 台 OLT 凭据包括 172.19.106.50 C600 凭据）。
- 自动读取 `~/Library/Application Support/olt-manager/` 下的 Feishu 加密密文（`feishu-state.enc`、`feishu-state-key.json`、`feishu-credentials.json`）。
- 按照 `olt-manager/combined-backup/v1` 协议生成包含 SHA-256 Manifest 的组合备份，并进行了校验自检。
- **导出文件**：
  - 组合备份：[`release/olt-manager-combined-backup-2026-09-12.oltbackup.json`](file:///Users/mac/Documents/OLT%20Manager/release/olt-manager-combined-backup-2026-09-12.oltbackup.json) (29.19 MB)
  - 独立 SQLite 备份：[`release/olt-manager-backup-2026-09-12.sqlite`](file:///Users/mac/Documents/OLT%20Manager/release/olt-manager-backup-2026-09-12.sqlite) (21.81 MB)

### 5.2 Windows 7 导入操作说明
1. 将上述 `.oltbackup.json`（或 `.sqlite`）文件拷贝至 Win7 测试机。
2. 启动 Win7 上的 `OLT Manager.exe`。
3. 进入界面的 **“备份与恢复”** 页面，点击 **“导入并还原”** 并选取该文件。
4. 确认还原：
   - 系统将校验 Manifest 与 SQLite 完整性；
   - 跨平台安全保护：检测到备份来自 `darwin` 平台时，系统自动安全重置 Feishu 密文（避免跨系统 Keychain 无法解密报错），同时 **100% 完整恢复所有本地 SQLite 数据库资料（OLT、PON 口、全量台账与快照）**；
   - 页面弹出成功提示并自动刷新。

---

## 6. 一期 BOSS 增量同步幂等键冲突问题排查与修复闭环

### 6.1 故障现象与报错
现场反馈在执行网管二期全量同步后，触发一期 BOSS 增量同步时报错中断：
```text
BOSS 同一幂等键对应的业务字段发生冲突，已拒绝提交。
```

### 6.2 根因排查与机制分析
1. **增量窗口向前重叠机制（Overlap）**：根据 ADR-075 与事件流防漏单设计，每次 BOSS 增量同步以上次成功水位向前重叠 1 天（`overlapDays: 1`），因此每次增量同步必然会重新读到过去 24 小时内已入库的成功工单。
2. **上游 NMSE 接口特性**：
   - `/boss/getBossOperation` 列表接口仅返回基础工单号和 LOID；
   - 坐标、MAC、deviceType、电话、装机地址等字段是调用 `/onu/getOnuAuthorizePercentByIdentity` 查询获得的；
   - 该详情接口返回的是该用户在 NMSE 中的**当前实时状态**，而非工单产生历史时刻的冻结快照。
3. **字段演进误杀**：
   - 当用户在昨天办理完工单后，若发生换装机、移机、改名、更新 MAC、改电话、或者网管二期刷新，上游实时状态随之演进；
   - 旧版 `src/db.mjs` 对已入库的同一工单（`same`）执行了 10 个字段的严格强等字符串比对（`oltIp, onuIndex, username, userPhone, installationAddress, mac, pon, ponType, deviceType`）；
   - 只要任何一个字段因为上游实时动态接口的更新而与数据库历史快照略有差异，就会被误判为“同一幂等键业务字段冲突”，导致整批增量同步被 409 异常硬性阻断。
4. **底层架构安全性自洽**：
   - 底层 SQL 已采用 `INSERT OR IGNORE INTO nmse_boss_change_events`，对于已存在的历史事件天然保持权威记录不变，根本不会重复修改；
   - 快照更新严格依赖 `temp_nmse_boss_new_events`（仅 `changes() = 1` 的新事件才会进入），已入库工单根本不会触发快照更新，天然具备幂等安全性。

### 6.3 修复方案与验证
1. **逻辑优化**：将已入库工单苛刻的 10 字段全量强等校验，调整为核心业务操作类型（`same.operation !== row.operation`）校验；操作类型一致的已入库工单视为合法重叠重放，平滑放行，同批新工单正常入库并推进水位。
2. **单测覆盖**：新增 [`tests/nmse-boss-idempotent-replay.test.mjs`](file:///Users/mac/Documents/OLT%20Manager/tests/nmse-boss-idempotent-replay.test.mjs)，覆盖非 operation 字段演进幂等放行和 operation 类型冲突拦截用例，全量 577 个测试全部通过。
3. **重新打包与导出**：
   - 已重新执行 `pnpm run dist:win` 生成包含此修复的最新 Windows 7 免安装安装包 [`release/OLT Manager-1.1.7-win7-x64.zip`](file:///Users/mac/Documents/OLT%20Manager/release/OLT%20Manager-1.1.7-win7-x64.zip)；
   - 已重新导出最新组合备份 [`release/olt-manager-combined-backup-2026-09-12.oltbackup.json`](file:///Users/mac/Documents/OLT%20Manager/release/olt-manager-combined-backup-2026-09-12.oltbackup.json)。

---

## 7. 后续继续开发建议

1. **实机 ONT 测试**：
   - 待现场将测试 ONT 连接至 C600（172.19.106.50）PON 口；
   - 刷新 OLT Manager 未注册 ONT 列表，确认实时发现的 SN（如 `SKWH...` 或 `ZTEG...`）；
   - 点击“配置方案”，确认生成的 TITAN 语法（`vport-mode manual`、`vport-map`、`veip_1`）与实际现网规划 VLAN 一致；
   - 在内置终端中手动执行并测试业务通断。
2. **其他模板扩充**：
   - 若现场有 IPTV 或语音（VoIP）等多业务混合打标需求，可在 `src/config-plan.mjs` 中按相同 TITAN 语法规范继续扩充。

