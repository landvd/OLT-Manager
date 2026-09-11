# OLT Manager 系统交接与运维管理指南

> **文档性质**：本文档为 OLT Manager 项目全局交接文档（Handover Document），用于系统交付、运维交接、新成员入场及架构回顾。详细设计与单项变更可对照文末文档导航索引。

---

## 1. 项目基本信息与交付总览

- **项目名称**：OLT Manager
- **当前版本**：`v1.1.7`
- **主要技术栈**：Node.js ESM + SQLite + Vue 3 + Element Plus + Electron 22 (Win7 legacy) + 飞书开放平台 SDK
- **核心定位**：轻量、安全、只读的 GPON OLT 现场运维管理与 ONU 台账工具，支持现场装维查询、配置命令预览、两套网管数据合并与飞书运维监测。
- **适配硬件型号**：
  - 中兴（ZTE）：C300、C320、C600
  - 华为（Huawei）：MA5800 系列

### 核心安全与工程铁律
1. **100% 只读设备访问**：仅允许 SNMP v2c `get/walk` 与固定白名单 Telnet `show` 命令读取设备状态。**严禁**任何形式的 `snmpset`、自动注册/删除/重启 ONU、自动写配置、保存配置。
2. **人工确认机制**：配置方案（ZTE/Huawei）仅在界面生成命令文本预览；内置 Telnet 终端可自动登录并进入配置模式，但**绝不自动粘贴、绝不自动执行**任何下发命令，必须由维护工程师人工核对并粘贴确认。
3. **数据敏感边界**：真实 OLT IP、community、账号、密码、现场台账和 SQLite 生产库不得提交到版本库。
4. **Windows 7 兼容保障**：客户端必须无缝运行于现场 Windows 7 x64 工控机/办公电脑，Electron 固定在 22.3.27 legacy 线，内置兼容版 SQLite CLI。

---

## 2. 系统核心架构与子系统职责

系统整体由四个核心子系统构成：

```text
┌───────────────────────────────────────────────────────────────┐
│                       OLT Manager v1.1.7                      │
├───────────────┬───────────────────────────────┬───────────────┤
│  前端展示层   │ Vue 3 + Element Plus + Pinia  │ 本地 127.0.0.1 │
│               │ xterm.js 内置只读 Telnet 终端 │ 端口 8787     │
├───────────────┼───────────────────────────────┼───────────────┤
│  本地服务端   │ Node.js 原生 ESM HTTP API     │ 极轻量原生服务 │
│               │ 集中路由、会话隔离与只读校验   │ 无重型依赖    │
├───────────────┼───────────────────────────────┼───────────────┤
│  数据存储层   │ SQLite (olt-manager.sqlite)   │ 事务性存储     │
│               │ 全库快照备份 / AES-256-GCM 加密 │ 自动增量迁移   │
├───────────────┴───────────────────────────────┴───────────────┤
│                       外部交互与数据协同                      │
├─────────────────┬─────────────────┬───────────────────────────┤
│    OLT 设备     │    外部网管     │         飞书服务          │
│ • SNMP 只读采集 │ • 网管二期全量  │ • 飞书机器人单聊免授权    │
│ • 华为 MA5800   │ • NMSE-PON BOSS │ • 全村 PON 自动抽样与对比 │
│ • 中兴 C300/C600│   只读增量 (v2) │ • 抢修恢复断纤监测卡片    │
└─────────────────┴─────────────────┴───────────────────────────┘
```

### 2.1 Web 与 Electron 桌面壳
- 桌面版复用同一套本地 Node.js HTTP 核心，启动时监听 `127.0.0.1:8787`。
- 桌面包关闭 `asar`（`asar: false`），确保 ESM 模块为真实文件路径，保障 Windows 7 和 macOS 本地子进程及路径解析完全正常。

### 2.2 两套数据源合并引擎（Merged ONU）
- **网管二期（NGB/OSS）**：作为**设备物理资产主数据源**（OLT IP、槽位、板卡、PON 口、ONU ID、MAC、实时与历史光功率等）。
- **NMSE-PON（一期）BOSS 增量**：作为**用户业务主数据源**（LOID、客户姓名、联系电话、装机地址）。
- **合并规则**：以物理坐标为核心主键，唯一 LOID 识别迁移；非空字段兜底互补；针对现场真实装机移机支持**物理端口覆盖置换**（Port Displacement）；冲突与未匹配项独立记录审计。

### 2.3 飞书运维网关与抢修恢复监测子系统
- **飞书免授权单聊**：维护人员在飞书单聊中直接输入“姓名 / 手机 / LOID / 设备号 / 地址 / PON 坐标”，机器人自动跨启用 OLT 进行只读查询。
- **断纤抢修恢复监测**：输入“村名”，系统聚合全村 PON 口，每批 5 个 PON 自动抽样在线 ONU，对比抢修前历史光功率与当前光功率（`|当前 RX - 历史 RX| >= 1 dB` 标记异常），卡片实时呈现汇总。

---

## 3. Windows 7 x64 与 macOS 发行部署指南

### 3.1 Windows 7 x64 发行版（现场首选）
- **交付介质**：免安装绿色 ZIP 包 `release/OLT Manager-1.1.7-win7-x64.zip`（113,643,034 字节，约 108 MiB）。
- **当前 SHA-256**：`000b99668aa9291ad01d350cfe3db6d24eb3444b0adb9eb8255f99f5917b0b10`（2026-09-11 发布候选）。
- **运行环境**：Windows 7 x64 / Windows 10 / Windows 11。
- **为什么使用免安装 ZIP**：避免现场 Win7 环境下 NSIS 安装包卸载脚本与注册表权限兼容问题。
- **开箱即用保障**：
  1. **内置 SQLite CLI**：包内自带 `resources/bin/win32/sqlite3.exe`（经 SHA3-256 校验的 PE32 32位版本，在 Win7 上不会发生 `0xC0000139` 缺失入口点报错），应用启动时自动绑定环境变量 `OLT_MANAGER_SQLITE_BIN`，**现场用户不需要安装任何数据库或配置系统 PATH**。
  2. **内置 Feishu SDK**：包内自带 `resources/feishu-runtime`，包含完整的 50 个脱机依赖包。
  3. **Node SNMP Fallback**：若 Win7 现场未安装 `net-snmp` 工具，系统自动无缝启用内置 Node.js 原生 UDP SNMP v2c 客户端进行读取。
- **现场使用步骤**：
  1. 将 ZIP 解压至现场电脑（建议非系统盘，如 `D:\Tools\OLT-Manager`）。
  2. 双击运行 `OLT Manager.exe`。
  3. 软件启动后会自动拉起本地服务并展现运维主窗口。

#### 本机（macOS Apple Silicon）交叉构建 Windows 包说明
由于 Apple Silicon macOS 宿主机上的 x86 Wine 无法执行 `rcedit` 资源注入（报 `bad CPU type in executable`），构建 Windows ZIP 时需通过参数关闭图标/版本篡改：
```bash
pnpm build
pnpm run prepare:feishu-runtime
pnpm run prepare:win-sqlite
pnpm exec electron-builder --win zip --x64 -c.win.signAndEditExecutable=false --publish never
```
产物输出在 `release/OLT Manager-1.1.7-win7-x64.zip`。

### 3.2 macOS Apple Silicon 版本
- **构建命令**：`pnpm run dist:mac`
- **产物位置**：`release/OLT Manager-1.1.7-arm64.dmg`（104,781,046 字节；SHA-256 `425b2cca7939090278f87bfa4fddd3c95bf8fff08af5c9180ed57a383bd5db91`）
- **绕过“已损坏”安全提示**：
  因内部分发包未经过 Apple 公证与 Developer ID 签名，若系统提示“已损坏，无法打开”，请在终端执行：
  ```bash
  xattr -dr com.apple.quarantine "/Applications/OLT Manager.app"
  ```

---

## 4. 本地数据存储、安全与备份还原

### 4.1 数据文件布局
- **生产数据库**：
  - Web 模式：`data/olt-manager.sqlite`
  - 桌面模式：系统用户数据目录（如 Windows 上的 `%APPDATA%\olt-manager\data\olt-manager.sqlite`，macOS 上的 `~/Library/Application Support/olt-manager/data/`）。
- **初始化 Seed**：初次运行若数据库不存在，系统自动根据 `data/*.example.json` 模板初始化空表结构。

### 4.2 备份与恢复
- **普通备份**：通过界面一键导出 SQLite 全库快照；导入前系统执行完整的 `PRAGMA integrity_check` 与核心表结构校验。
- **AES-256-GCM 加密备份**：支持使用临时口令导出加密容器，支持跨平台安全流转。
- **凭据保存模式**：系统加密可用时优先使用系统密文；填写迁移主密码时保存可迁移 AES-256-GCM 密文；免迁移主密码模式为支持重启后的定时只读同步，可把密码保存到本机 SQLite。API、日志和审计均不返回密码，迁移主密码、Cookie、token 与 CUID 不落盘。
- **备份敏感性**：普通完整 SQLite/组合备份在免主密码模式下可能包含本机登录密码，必须仅保存到可信位置；跨设备流转优先使用 AES-256-GCM 加密备份。

---

## 5. 关键运维操作手册（Runbook）

### 5.1 NMSE-PON BOSS 增量同步与全量合并
当现场需要同步最新业务开户/移机/拆机数据时：
1. 打开系统左侧导航 **合并 ONU** 页面。
2. 确认两套上游已保存登录材料；同步会在没有内存会话时自动登录，自动恢复失败才需要回到配置页人工核对并登录。
3. 点击 **一期 BOSS 历史全量初始化**（旧库升级后只出现一次）：
   - 系统从 2019-08-23 起到本次启动时间，按月读取厚街成功工单姓名；页面显示历史批次与当前分页。
   - 不要在执行中重复点击或退出应用。当前 worker 会在长时间读取中自动续租；任一批次失败或租约失权都不会写入半套姓名，可排障后重试。
   - 成功后按钮自动变为 **一期 BOSS 增量同步**；以后从上次 Watermark 向前重叠一天，读取至本次启动时间。
   - 后续增量自动应用新装、过时端口置换、同客户更正、销户与姓名更新。
4. 点击 **手动合并**：
   - 触发合并计算引擎，将二期设备数据与一期业务数据做全量关联（目前现网基线约 1.4 万条数据，合并耗时约 2-3 秒）。
5. 检查 **冲突记录** 选项卡是否有异常未归属记录。

### 5.2 飞书机器人运维与连接自检
1. 进入系统 **飞书状态** 页面。
2. 检查长连接状态：显示为 `connected` 且监听就绪即表示正常。
3. 检查单聊查询日志：若维护人员反馈查不到用户，首先确认该用户的装机镇区是否属于厚街镇，其次核实是否属于已启用的 OLT 范围。
4. 按 OLT 管理 IP 查询单个 PON 时，可直接发送 `192.0.2.1 7/12` 或 `192.0.2.1/7/12`（文档保留测试地址）；两段数字固定表示板卡/PON，完整槽位四段格式当前不在此入口合同内。

### 5.3 常见故障排查
| 故障现象 | 根因排查 | 处置方法 |
| --- | --- | --- |
| Win7 提示 `sqlite3` 异常退出或无法启动 | 检查是否使用了 64 位的 sqlite3.exe 替换了包内文件 | 必须使用 `bin/win32/sqlite3.exe`（32位 legacy 版本） |
| Huawei MA5800 光功率显示为 600+ dBm 异常大正值 | 旧版本解码未识别 Huawei 16位有符号补码 | 已在 v1.1.6 彻底修复，升级到最新版本即可正常显示负 dBm |
| Huawei 命令粘贴在内置终端中缺少空格或被截断 | 外部剪贴板格式混杂或换行符过快 | 内置终端已增加原生剪贴板字符过滤与按行回车节流保护 |
| BOSS 增量拉取失败报 401 | NMSE-PON Web 会话超时，且一次自动重登仍失败 | 查看任务中的恢复错误，核对本机已保存登录材料后在资源管理页重新登录 |
| 历史姓名完成后提示“合并 ONU 同步租约已失效” | 2026-09-10 历史姓名初始化包只在阶段切换时续租，七年历史读取超过固定 30 分钟 | 升级到 2026-09-11 续租修复包；若页面已显示姓名数量，重新发起一期同步会按已保存水位走短增量，成功后再执行手动合并 |

---

## 6. 核心工程资产与文档索引

所有架构设计、技术决策及历史里程碑均已沉淀在仓库文档体系中：

### 6.1 核心规范与产品定义
- 项目操作与开发准则：[`AGENTS.md`](file:///Users/mac/Documents/OLT%20Manager/AGENTS.md)
- 产品需求与功能边界 (PRD)：[`docs/requirements/PRD.md`](file:///Users/mac/Documents/OLT%20Manager/docs/requirements/PRD.md)
- 系统架构与系统边界：[`ARCHITECTURE.md`](file:///Users/mac/Documents/OLT%20Manager/ARCHITECTURE.md)
- HTTP API 接口合约：[`docs/design/api.md`](file:///Users/mac/Documents/OLT%20Manager/docs/design/api.md)
- SQLite 表结构与设计约定：[`docs/design/database.md`](file:///Users/mac/Documents/OLT%20Manager/docs/design/database.md)
- 变更记录日志：[`CHANGELOG.md`](file:///Users/mac/Documents/OLT%20Manager/CHANGELOG.md)

### 6.2 重点功能交接与阶段交付总结
- **NMSE-PON BOSS 增量同步与合并闭环（最新）**：[`docs/development-summary-2026-09-10-boss-incremental-sync.md`](file:///Users/mac/Documents/OLT%20Manager/docs/development-summary-2026-09-10-boss-incremental-sync.md)
- **飞书大范围断纤抢修恢复监测交接**：[`docs/development-summary-2026-09-07-feishu-olt-recovery-monitoring.md`](file:///Users/mac/Documents/OLT%20Manager/docs/development-summary-2026-09-07-feishu-olt-recovery-monitoring.md)
- **NMSE-PON 与网管二期合并 ONU 开发总结**：[`docs/development-summary-2026-08-18-nmse-ngb-merged-data.md`](file:///Users/mac/Documents/OLT%20Manager/docs/development-summary-2026-08-18-nmse-ngb-merged-data.md)
- **网管二期 DWR 接口适配与脱敏记录**：[`docs/development-summary-2026-08-12-oss-resource-phase2.md`](file:///Users/mac/Documents/OLT%20Manager/docs/development-summary-2026-08-12-oss-resource-phase2.md)
- **飞书生产网关与子系统交付记录**：[`docs/development-summary-2026-08-05-feishu-subsystem.md`](file:///Users/mac/Documents/OLT%20Manager/docs/development-summary-2026-08-05-feishu-subsystem.md)

### 6.3 关键架构决策（ADR）
- [`ADR-004`](file:///Users/mac/Documents/OLT%20Manager/docs/decisions/ADR-004-config-plan-preview.md)：配置方案纯文本预览与免下发安全边界
- [`ADR-005`](file:///Users/mac/Documents/OLT%20Manager/docs/decisions/ADR-005-terminal-login-helper.md)：内置 Telnet 终端与人工粘贴执行原则
- [`ADR-006`](file:///Users/mac/Documents/OLT%20Manager/docs/decisions/ADR-006-desktop-asar-disabled.md)：桌面发行包禁用 asar 决策
- [`ADR-048`](file:///Users/mac/Documents/OLT%20Manager/docs/decisions/ADR-048-release-validation-gates.md)：Windows 7 桌面发行验证门禁
- [`ADR-075`](file:///Users/mac/Documents/OLT%20Manager/docs/decisions/ADR-075-nmse-boss-incremental-readonly.md)：一期 NMSE-PON 使用 BOSS 只读增量同步

---
*交接文档编制完成，如需了解具体实现细节，请优先查阅对应源码与 ADR。*
