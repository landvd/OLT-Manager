# OLT Manager 项目接手与深度上下文交接文档 (Handover Prompt)

你接手的是 **OLT Manager**（当前版本 `v1.1.6`，分支 `main`，基于 Node.js ESM + SQLite + Vue 3 + Electron 22 legacy + 飞书 SDK 开发）。本项目面向 GPON OLT 现场装维排障与 ONU 台账管理。

---

## 1. 核心铁律与安全红线（最高优先级）

在阅读和生成任何代码之前，必须无条件遵循以下工程约束：
1. **绝对只读设备边界**：仅允许 SNMP v2c `get/walk` 与固定白名单 ZTE/Huawei `show` 命令；**严禁**任何 `snmpset`、自动注册/删除/重启 ONU、自动写配置、保存配置等写设备操作。
2. **人工确认机制**：配置方案预览只生成复制命令；内置 Telnet 终端可自动登录并进入配置模式，但**绝不得自动粘贴或自动执行**任何配置命令。
3. **敏感凭据边界**：代码、注释、测试、日志和可提交文档中，**严禁记录真实 OLT IP、community、账号、密码、Cookie、Token、CUID 或现场用户明细**。本机运行库可按已实现的凭据模式保存业务登录材料，但接口与审计必须脱敏，普通备份须按敏感文件处理。
4. **Win7 x64 兼容约束**：现场部署机器为 Windows 7 x64。
   - Electron 固定锁定在 `22.3.27` legacy 线（Electron 23+ 不支持 Win7）。
   - 必须内嵌 32 位 legacy SQLite CLI（`bin/win32/sqlite3.exe`，SHA3-256 校验通过），运行时自动注入 `OLT_MANAGER_SQLITE_BIN`，不得要求用户安装环境或配置 PATH。
   - 打包关闭 `asar`（`asar: false`），确保 ESM 模块作为真实文件路径运行。

---

## 2. 本轮工作完成清单与修改文件明细

本轮会话已彻底解决两大现场痛点，并成功打包 Windows 7 发行包：

### 2.1 任务一：修复网管二期全量同步重复物理坐标中断问题
- **现场报错**：Win7 上执行网管二期全量同步时，报 502 错误：`网管二期 ONU 列表包含重复坐标：1/7/14:10`。
- **根因分析**：网管二期（OSS NGB）在实际业务中由于历史换装机、多业务绑定或在线过渡期，同物理坐标存在多行不同记录。旧逻辑遇到差异行直接抛出 502 中断全量同步。
- **修改文件**：
  1. `src/oss-ngb-client.mjs`：实现 `scoreOssOnuRow` 与 `mergeOssOnuRows`，按在线状态、有效物理光功率和标识完整度评分择优合并；用户标识冲突时不跨记录拼接联系人字段，不再硬报错中断。
  2. `src/merged-onu-sync.mjs`：将重复记录打标，写入冲突审计表 `merged_onu_conflicts`（`network_coordinate_duplicate`）。
  3. `src/db.mjs`：保持快照主键的严格唯一约束；重复坐标必须在适配器层择优并留痕，数据库不静默覆盖未知重复行。
  4. `tests/oss-ngb-client.test.mjs` & `tests/merged-onu-sync.test.mjs`：补齐多行评分、属性合并与冲突审计单测。

### 2.2 任务二：取消 NMSE-PON 与网管二期必须需要“迁移主密码”限制
- **现场痛点**：旧版强制要求至少 8 位 `migrationMasterPassword`。Win7 或纯 Web 缺少 safeStorage 时，如果不输入迁移主密码，保存或登录会报 400/428 错误（`RESOURCE_CREDENTIAL_MIGRATION_REQUIRED`），且无法无人值守执行定时全量同步。
- **修改文件**：
  1. `src/db.mjs`：
     - 表 `oss_resource_config` 新增 `password TEXT NOT NULL DEFAULT ''` 列并增加 `addMissingColumns` 升级函数。
     - 更新 `getResourceManagementPassword`：优先解锁系统/迁移密文，纯 Web/Node 免主密码模式再读取本机 `config.password`。
     - 更新 `saveResourceManagementConfig`：系统加密可用时优先使用 `safeStorage` 封装；未输入主密码且系统加密不可用时将密码保存在本机 `resource_management_config.password` 中。
     - 导出 `getOssResourcePassword`，更新 `saveOssResourceConfig` 支持密码持久化，对公 `getOssResourceConfig` 保持密码脱敏。
  2. `src/server-data-access.mjs`：白名单契约增加 `"getOssResourcePassword"`。
  3. `src/remote-access-runtime.mjs`：注入 `getOssResourcePassword` 和 `saveOssResourceConfig`；`loginOssNgbSession` 移除强行要求主密码拦截，登录密码降级解析链自动支持本地保存密码；新增并导出 `ensureOssNgbSession`。
  4. `src/merged-onu-sync-runtime.mjs` & `src/server.mjs`：`readNetworkRows` 接入 `ensureOssNgbSession`，全量同步和定时任务支持静默自动登录。
  5. `src/main.js`：表单更新为“迁移主密码（可选）”，移除 `loginOssResource` 中缺失主密码的告警拦截，按钮自适应展示“登录网管二期”或“保存并登录”。
  6. `tests/resource-management-db.test.mjs` & `tests/remote-access-runtime.test.mjs`：补齐直接存取密码、无主密码登录和 `ensureOssNgbSession` 单测。

### 2.3 任务三：Windows 7 x64 发行包构建与验证
- **产物路径**：`release/OLT Manager-1.1.6-win7-x64.zip`（约 108 MB）
- **SHA-256**：`b3545cfb333ab2c7c8acfd2b279eb5b28e592615aafb6e0c0effe03ca99ce0a3`
- **内置组件**：包含全部最新代码、Win7 32位 SQLite CLI（`resources/bin/win32/sqlite3.exe`）及 50 个飞书离线依赖包；经 `scripts/verify-package-layout.mjs` 契约校验 100% 合格。

---

## 3. 当前系统最新架构状态

### 3.1 数据层与合并模型（Merged ONU Engine）
- **数据源主次关系**：
  - **网管二期（NGB/OSS）**：设备物理主数据源（OLT IP、槽、板、PON、ONU ID、MAC、实时及历史光功率）。
  - **NMSE-PON（一期）BOSS 增量**：用户业务主数据源（LOID、客户姓名、电话、装机地址）。
- **Manifest v2 机制**：
  - 二期：`sourceKind: "network-full-snapshot"`
  - 一期：`sourceKind: "nmse-boss-incremental-overlay"`，记录查询 scope、`exclusiveWatermark` 与覆盖截止自然日。
- **端口覆盖置换（Port Displacement）**：
  - 在装维现场出现“未销户直接改接新用户”时，新装/移机工单自动清理旧记录对该物理端口的占用，避免端口冲突。
- **现网基线规模**：
  - 8月27日至9月9日 267 条厚街真实工单增量落库；与网管二期 13,987 条数据完成全量合并，生成 13,977 条合并快照，成功匹配 11,109 条。

### 3.2 飞书运维网关（Feishu Recovery Monitoring）
- 支持免授权单聊查询（按 姓名 → 手机 → LOID → 设备号 → 地址 → PON 坐标 自动匹配）。
- 支持输入“村名”触发大范围断纤抢修恢复监测：
  - 聚合该村全部含用户的 PON 口，按 5 个一组自动抽样在线 ONU。
  - 对比当前 RX 光功率与抢修前历史 RX 光功率（`|当前 RX - 历史 RX| >= 1 dB` 标红预警），以交互式卡片原位更新进度并展示结果。

### 3.3 验证基线
- 语法与构建：`pnpm build` 通过。
- 自动化测试：`pnpm test` 共 **534 项通过、0 失败**；覆盖重复坐标、四类定时分派、进程中断恢复、跨月水位、有界重试与会话自动恢复。
- 代码语法：`node --check src/server.mjs`、`src/db.mjs`、`src/remote-access-runtime.mjs`、`src/main.js` 全部通过。
- 版本对齐：`pnpm run check:version`（1.1.6）通过。
- Git 状态：位于 `main` 分支，本地领先 `origin/main` 3 个 commit（`2145213`, `a26d226`, `c112bd2`），当前工作区改动待 commit。

---

## 4. 关键常用命令

```bash
# 1. 运行测试（包含版本检查）
pnpm test

# 2. 前端构建
pnpm build

# 3. 准备 Win7 SQLite 运行库及飞书离线包
pnpm run prepare:win-sqlite
pnpm run prepare:feishu-runtime

# 4. 构建 Win7 x64 免安装 ZIP（宿主机为 Apple Silicon 时必须加 signAndEditExecutable=false）
pnpm exec electron-builder --win zip --x64 -c.win.signAndEditExecutable=false --publish never

# 5. 启动本地开发服务
pnpm start     # 默认监听 127.0.0.1:8787
pnpm dev       # Vite 前端热重载
pnpm run desktop # 桌面版调试
```

---

## 5. 接手任务收口状态

### Task 1: 真实 Win7 机器 / 虚拟机实机冒烟验收
- **状态**：外部验收仍待完成。本机没有可用 Win7 虚拟机或虚拟化运行时，只能完成 ZIP 完整性、PE 架构、包布局与内置运行库静态门禁；不得把这些证据写成真实 Win7 启动成功。
- **目标**：在真实的 Windows 7 x64 物理机或虚拟机中解压 `release/OLT Manager-1.1.6-win7-x64.zip`。
- **核验点**：
  1. 双击 `OLT Manager.exe` 启动是否顺畅，检查日志确认是否正确加载内置 `resources/bin/win32/sqlite3.exe`。
  2. 验证页面与本地 Node HTTP 服务（`127.0.0.1:8787`）通信。
  3. 验证内置 Telnet 终端打开及人工粘贴命令流程。
  4. 验证 SNMP fallback 模式在无外部 net-snmp 环境下的只读采集能力。

### Task 2: BOSS 增量定时调度与长期水位稳定性验证
- **状态**：代码与自动化验收已完成。四类任务使用固定分派；计划时间参与稳定幂等键；进程中断的现代任务等待旧租约到期后恢复，旧单 OLT 任务失败关闭。跨月上海日历、水位只在事务成功后推进及重叠窗口幂等均有测试。
- **恢复策略**：BOSS 列表、分页、详情对瞬时连接/超时、`429`、`5xx` 最多尝试三次；NMSE-PON 与网管二期读取遇到 `401` 各自动重登一次，失败提示明确保留在任务记录。真实跨周持续运行仍属于时间型现场验收，不能由单元测试替代。

### Task 3: 飞书断纤抢修“五天连续监控”模型评估与规划
- **状态**：评估与规划已完成，见 `docs/decisions/ADR-076-feishu-five-day-fiber-recovery-monitoring.md`。
- **结论**：需要独立 SQLite 事件、影响范围、主/备样本和观察记录；五个连续上海自然日必须逐分层满足数据门槛，缺基线/缺日/覆盖不足一律显示“数据不足”。原始观察建议 180 天可配置留存，但首版不自动删除。
- **边界**：ADR 状态为“已规划，待实现”；当前一次性村级抽样不等于五天连续监控已上线。

### Task 4: 代码仓库提交与推送 (Git Push)
- **状态**：本轮完成测试、构建、发行静态门禁后统一提交并推送到 `origin/main`；以仓库远端状态为最终证据。

---

## 6. 核心资产与代码位置索引
- **入口与架构定义**：[`ARCHITECTURE.md`](file:///Users/mac/Documents/OLT%20Manager/ARCHITECTURE.md)、[`AGENTS.md`](file:///Users/mac/Documents/OLT%20Manager/AGENTS.md)
- **全局交接指南**：[`HANDOVER.md`](file:///Users/mac/Documents/OLT%20Manager/HANDOVER.md)
- **最新功能交付记录**：[`docs/development-summary-2026-09-10-boss-incremental-sync.md`](file:///Users/mac/Documents/OLT%20Manager/docs/development-summary-2026-09-10-boss-incremental-sync.md)
- **BOSS 同步核心**：[`src/nmse-boss-sync.mjs`](file:///Users/mac/Documents/OLT%20Manager/src/nmse-boss-sync.mjs)、[`src/nmse-client.mjs`](file:///Users/mac/Documents/OLT%20Manager/src/nmse-client.mjs)
- **合并台账数据层**：[`src/db.mjs`](file:///Users/mac/Documents/OLT%20Manager/src/db.mjs)、[`src/merged-onu-manifest.mjs`](file:///Users/mac/Documents/OLT%20Manager/src/merged-onu-manifest.mjs)
- **飞书网关与恢复监测**：[`src/feishu/application.mjs`](file:///Users/mac/Documents/OLT%20Manager/src/feishu/application.mjs)、[`src/olt-data-gateway.mjs`](file:///Users/mac/Documents/OLT%20Manager/src/olt-data-gateway.mjs)
- **最新 ADR**：[`ADR-076-feishu-five-day-fiber-recovery-monitoring.md`](file:///Users/mac/Documents/OLT%20Manager/docs/decisions/ADR-076-feishu-five-day-fiber-recovery-monitoring.md)
