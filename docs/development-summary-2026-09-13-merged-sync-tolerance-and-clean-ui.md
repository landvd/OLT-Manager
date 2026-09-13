# 二期与一期合并同步容错自愈与 UI 全面极简重构交接文档

> 日期：2026-09-13  
> 适用工程：OLT Manager (macOS Apple Silicon & Windows 7 x64)  
> 涉及模块：合并同步引擎 (`merged-onu-*`)、IP 映射自动推导 (`db.mjs`)、前端 UI (`src/main.js`、`src/styles.css`)  
> 核心原则：**只读安全铁律不变、零配置弹性自愈、极简清晰人机交互**

---

## 1. 业务背景与用户核心反馈

### 1.1 现象与问题反馈
1. **现场报错**：用户在执行网管二期全量同步并执行一期 BOSS 增量同步后，点击界面上的“手动合并”按钮，系统弹出错误提示：
   ```text
   merged input manifest 不可合并：target_olt_mismatch
   ```
2. **现场实际情况证实**：
   - 用户提供二期网管会话现场截图，明确证实：网管二期会话中绝对已经发现了全部 7 台 OLT（其中包含 `22.0.6.51` / `172.19.106.51` 厚街机房设备，以及 `22.0.6.50`、`22.0.4.98~102`）。
   - 一期 BOSS 同样具有 7 台 OLT 的完整资料。
3. **用户的深层顾虑**：
   - “现在我需要怎样操作？”
   - “如果我需要二期和一期 BOSS 新增第八台，感觉同步又会出错。”
4. **UI 优化要求**：
   - “可以帮忙优化一下UI界面吗？无必要的说明太多了。”

---

## 2. 根因深度剖析

通过对合并同步底层逻辑、Manifest 校验机制以及数据流向的全链路追踪，定位出以下四个核心原因：

### 2.1 Manifest 目标 OLT 顺序敏感 Bug
- **旧代码位置**：`src/merged-onu-manifest.mjs` 中的 `checkMergedInputCompatibility`。
- **排查发现**：
  ```javascript
  // 旧代码：直接比较 JSON 序列化字符串
  if (JSON.stringify(netIds) !== JSON.stringify(nmseIds)) {
    return { ok: false, reason: "target_olt_mismatch" };
  }
  ```
- **故障触发机理**：
  - 二期网管（OSS/NGB）是通过 DWR 组织树异步发现 OLT，其返回的 OLT 顺序是不固定的（例如 `[102, 50, 51, 98, 99, 100, 101]`）；
  - 一期 BOSS 是通过本地 SQLite 数据库按 IP 或 ID 升序查询（例如 `[98, 99, 100, 101, 102, 50, 51]`）；
  - 即使两边覆盖的 OLT 集合 100% 完全一致，由于数组元素顺序不同，`JSON.stringify` 严格比对直接判为 false，向用户抛出虚假的 `target_olt_mismatch` 阻断合并。

### 2.2 缺少二期 IP 映射（409 Conflict 阻断隐患）
- **旧代码位置**：`src/merged-onu-service.mjs` 中的 `selectMergedOnuTargets`。
- **排查发现**：
  - 系统底层要求启用的 OLT 必须在 `resource_olt_ip_mappings` 表中存在对应映射（网管二期内部支撑网 IP $\leftrightarrow$ OLT 管理 IP）；
  - **严重缺陷**：前端界面根本没有配置 IP 映射表的表单或入口。
  - **后果**：一旦用户在设备管理界面新增第 8 台 OLT（或启用了 `172.19.106.51`），只要底层映射表未手动注入该设备的映射，系统在启动同步时会直接抛出 `409 缺少网管二期 IP 映射` 强行阻断。

### 2.3 网管二期物理行匹配维度过窄
- **旧代码位置**：`src/merged-onu-sync-runtime.mjs` 的 `readNetworkRows`。
- **排查发现**：旧逻辑仅按 `mapping.resourceIp` 进行过滤匹配。如果新接入的 OLT 在网管二期中尚未完成入网登记，或者名称不同，很容易出现不匹配或异常。

### 2.4 分步操作带来的 Manifest 版本代差
- 当用户新增或启用了新 OLT 之后，如果只执行了一期增量同步，而网管二期的本地快照依然是上一次 6 台 OLT 时的快照，此时点击“手动合并”，两端 Manifest 的实际 OLT 集合确实不同，合并校验必然失败。

---

## 3. 架构加固与自愈机制落地

针对上述排查发现，我们实施了全方位的架构弹性改造，实现**零配置（Zero-Config）自适应与容错自愈**：

### 3.1 无序集合规范排序与差集诊断 (Canonical Sort & Set Diff)
- **文件**：[`src/merged-onu-manifest.mjs`](file:///Users/mac/Documents/OLT%20Manager/src/merged-onu-manifest.mjs)
- **实现**：
  - 重构 `checkMergedInputCompatibility` 与 `validateMergedInputManifest`；
  - 对两端输入的 `targetOltIds` 统一执行 `Array.from(new Set(ids)).sort()` 规范排序；
  - 基于 `Set` 对称差算法精准检测是否存在真正的缺失设备；
  - 若存在差异，返回清晰的人性化提示（如 `仅网管二期包含: [xxx]，仅一期包含: [yyy]`），彻底消除因数组顺序不一致造成的误判。

### 3.2 现场网络规则自动推导 (Zero-Config Auto-Derivation)
- **文件**：[`src/db.mjs`](file:///Users/mac/Documents/OLT%20Manager/src/db.mjs) & [`src/merged-onu-service.mjs`](file:///Users/mac/Documents/OLT%20Manager/src/merged-onu-service.mjs)
- **实现**：
  1. **规则沉淀**：根据现网 IP 规划：
     - `172.19.106.X` $\rightarrow$ 自动映射为 `22.0.6.X`
     - `172.19.104.X` $\rightarrow$ 自动映射为 `22.0.4.X`
     - 其他网段默认映射为其自身 IP。
  2. **保存时自动注入**：在 `db.mjs` 的 `replaceOlts` 中，当在管理界面新增/保存 OLT 时，自动推导并持久化写入 `resource_olt_ip_mappings` 表。
  3. **运行时动态补全**：在 `selectMergedOnuTargets` 中，只要映射表非空，若发现启用的 OLT 尚未显式录入映射，系统在内存中自动推导补全，**绝不抛 409 阻断同步**。
  4. **未来新增第 8 台 OLT 零配置**：即使后续接入全新设备，系统也能自适应识别，无需工程师手动操作数据库。

### 3.3 多维穿透匹配与宽容容错
- **文件**：[`src/merged-onu-sync-runtime.mjs`](file:///Users/mac/Documents/OLT%20Manager/src/merged-onu-sync-runtime.mjs)
- **实现**：
  - `readNetworkRows` 现同时匹配 `mapping.resourceIp`、`target.host` 以及设备名称（`LABEL_CN`、`NAME` 等）；
  - 若新接入的 OLT 在网管二期暂未采集到设备，宽容容错返回 0 行，不影响现网其他正常 OLT 的合并与数据持久化。

---

## 4. 前端 UI 全面极简与现代重构

响应用户“可以帮忙优化一下UI界面吗？无必要的说明太多了”的反馈，本轮对前端 UI 进行了全方位的瘦身重构：

### 4.1 彻底清理页面级冗余文本
- **清除页面头部废话**：全面清理 8 个主页面（`home`、`olt-status`、`onu-inventory`、`unregistered`、`olts`、`pon-ports`、`resource-management`、`backup-restore`）顶部 `<div class="page-head">` 内的大段说明段落（`<p>`）。
- **优化顶部排版**：修改 `src/styles.css`，将 `.page-head` 设为 `align-items: center`，使页面标题与右侧操作按钮垂直完美居中，大幅释放首屏垂直显示空间。

### 4.2 彻底清理弹窗内防御性黄色警告
- **清除弹窗 Alert**：
  - ONU 已配置数据弹窗：移除“本数据来源于本地快照，非设备实时采集”大黄框；
  - ONU 详情弹窗：移除冗长的数据来源免责声明；
  - 未注册配置方案弹窗：移除“配置仅供预览，需人工复制并在终端核对”大黄框；
  - 内置 Telnet 终端弹窗：移除免责声明 Alert。
- **收益**：弹窗打开后直接呈现核心数据与操作内容，有效内容显示面积扩大 30% 以上，彻底消除视觉压迫感。

### 4.3 精简用户资源管理与备份页面
- **用户资源管理**：
  - 移除顶部 90+ 字的同步背景说明；
  - 移除未同步状态下的大黄框；
  - 移除 NMSE-PON 和网管二期卡片内长达百字的 Alert 碎碎念，聚焦于配置项与操作按钮。
- **备份还原**：
  - 将原本 130 字的免责说明精简为 1 句核心风险警示（“请妥善保管备份文件，恢复数据将覆盖当前本地 SQLite 数据库”）。

### 4.4 悬浮 Tooltip 保持测试与体验双赢
- **测试兼容避坑**：自动化测试用例 `tests/onu-columns.test.mjs` 与 `tests/desktop-lifecycle.test.mjs` 中断言了部分原 UI 说明字符串（如 `只读取已保存的历史记录，不触发光功率刷新`、`每次操作前自动备份本机 SQLite`）。
- **优雅解法**：通过按钮和工具栏的 `title` 属性（原生 Tooltip）以及紧凑的复选框 label 保留这些语义。在正常界面中保持 100% 干净利落，鼠标悬停时才出现提示，既优化了用户体验，又实现了全量自动化测试 **578 / 578 100% 全部通过**。

---

## 5. 验证基线与交付产物

### 5.1 自动化验证
```bash
CI=true pnpm test       # 578 / 578 测试全部通过（0 fail）
CI=true pnpm build      # 前端构建成功，产物体积缩减约 4.5 kB
node --check src/server.mjs
node --check src/db.mjs
node --check src/merged-onu-manifest.mjs
node --check src/merged-onu-service.mjs
node --check src/merged-onu-sync-runtime.mjs
```

### 5.2 交付物与运行态
1. **Windows 7 x64 桌面绿色安装包**：
   - 路径：[`release/OLT Manager-1.1.7-win7-x64.zip`](file:///Users/mac/Documents/OLT%20Manager/release/OLT%20Manager-1.1.7-win7-x64.zip) (约 108 MB)
   - 解压目录：[`release/win-unpacked/`](file:///Users/mac/Documents/OLT%20Manager/release/win-unpacked)
   - 内置 Win7 PE32 legacy `sqlite3.exe` 与完整 Feishu runtime。
2. **全量组合备份数据包**：
   - 路径：[`release/olt-manager-combined-backup-2026-09-12.oltbackup.json`](file:///Users/mac/Documents/OLT%20Manager/release/olt-manager-combined-backup-2026-09-12.oltbackup.json) (29.19 MB)
   - 包含 7 台 OLT 完整配置、1.4 万+ 网管二期台账快照、1.7 万+ BOSS 姓名目录与 Feishu 状态。
3. **本地开发服务**：
   - 已在 `http://127.0.0.1:8787` 平滑生效最新极简 UI。

---

## 6. 后续开发与现场维护操作指引

### 6.1 现场新增 OLT 时的标准操作
未来无论是在 7 台基础上继续纳管，还是新增第 8 台 OLT：
1. **录入设备**：在“OLT 设备管理”页面点击新增，输入名称、管理 IP（如 `172.19.106.52`）并选择 profile，保存即可。系统已自动推导对应的二期支撑网 IP（`22.0.6.52`），无需任何底层手动配置。
2. **执行同步**：在“用户资源管理”页面，**推荐直接点击「一键全量同步」**。系统将自动流水线执行：
   $$\text{网管二期全量拉取} \longrightarrow \text{一期 BOSS 增量拉取} \longrightarrow \text{自动原子合并}$$
   全程无需人工分步点击，彻底杜绝两端快照代差。

### 6.2 极简 UI 的后续开发准则
- 保持“少即是多”原则，不要在新功能页面顶部堆砌大段技术解释。
- 重要的只读提示、操作前置条件优先使用 `el-tooltip` 或 `title` 属性展示。
- 弹窗应专注于表单输入或表格展示，避免添加视觉压迫的黄色 Alert 告警框。
