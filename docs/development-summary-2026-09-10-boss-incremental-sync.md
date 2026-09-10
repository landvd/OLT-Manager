# 2026-09-10：NMSE-PON BOSS 只读增量同步与合并数据闭环交接文档

## 1. 背景与目标

此前 NMSE-PON（一期）仅支持全量同步，在大数据量或网络不稳定场景下同步耗时较长，且无法精细跟踪日常报装、移机、更换 ONU 及销户等业务变更。

本次交付完成了 **ADR-075：NMSE-PON 使用 BOSS 只读增量同步与数据合并闭环**，实现：
1. 通过一期 NMSE-PON 的 BOSS 只读接口，按增量水位（Watermark）拉取业务工单。
2. 支持报装、移机、更换 ONU、同客户更正的原子快照更新与过时坐标物理端口置换。
3. 成功销户工单安全标记/清理对应用户快照。
4. 来源 manifest 升级为 v2，支持与网管二期设备源快照增量/全量合并。
5. 完成真实现场 267 条厚街工单增量落库，与网管二期 13,987 条全量数据完成合并（生成 13,977 条合并快照，成功匹配 11,109 条）。

> **安全与合规边界**：本系统对 BOSS 及 NMSE-PON 严格执行只读 GET 查询；代码、日志和数据库不记录密码、Cookie、Token 或原始工单响应；绝不向 OLT 发送写命令或配置保存命令。

---

## 2. 核心机制与实现要点

### 2.1 BOSS 查询链路与接口契约
- **页面与权限初始化**：先访问固定只读页面 `/BOSS/BOSSInstruction`，在内存会话中确认权限并维护 Cookie 上下文。
- **工单列表查询**：调用 `/boss/getBossOperation`，固定 20 条分页，按 `recTime`（工单接收时间）升序拉取。
  - **查询条件**：固定处理状态为成功（经过现网对照确认必须传 `opResult: "1"` 表示精确成功工单，传 `"2"` 服务端会返回全部工单），操作类型为全部，范围限定为厚街镇。
- **ONU 详情读取**：针对每条工单调用 `/onu/getOnuAuthorizePercentByIdentity` 读取认证信息与 ONU 端口详情。
- **事务性提交**：单次增量同步在一个 SQLite 事务中完成；若任意分页或详情读取失败，全部回滚，保留旧快照与旧水位。

### 2.2 业务变更分类处理
| 业务类型 | 触发工单 | 坐标/端口处理 | 用户快照处理 |
| --- | --- | --- | --- |
| **新装/开户** | 报装工单 | 绑定新 OLT/PON/ONU 坐标；若新端口上有旧用户残留，执行物理端口置换清理旧记录 | 写入/更新当前快照 |
| **移机/改址** | 移机工单 | 释放旧 OLT/PON/ONU 坐标，绑定新坐标 | 更新装机地址与最新坐标 |
| **换机/换光猫** | 换机工单 | 保留现有坐标与客户信息 | 更新 LOID、SN 及设备认证字段 |
| **同客户更正** | 更正工单 | 识别同一客户同一端口重复工单 | 幂等覆盖最新资料，不产生冲突行 |
| **销户/停机** | 销户工单 | 释放对应端口坐标占用 | 允许无坐标落库，从当前有效快照中安全移除 |

### 2.3 物理端口覆盖置换（Port Displacement）
在现场装维过程中，旧光猫可能未正式销户但物理端口已被重新分配给新用户。
- 系统在检测到合法新装/移机工单占用某物理端口时，自动清理历史占用的过时记录。
- 避免同一个 `OLT + PON + ONU ID` 出现多个不同用户的坐标冲突。

### 2.4 Manifest v2 与合并规则
- **Manifest v2**：
  - 网管二期：`sourceKind: "network-full-snapshot"`
  - NMSE-PON：`sourceKind: "nmse-boss-incremental-overlay"`，记录 `scope`（厚街镇/成功工单）、`exclusiveWatermark`（查询结束时间）和 `coverageThrough`（覆盖截止自然日）。
- **合并引擎**：
  - 设备主源仍以网管二期为准（OLT、槽、板、PON、ONU ID）。
  - 用户主源优先采用 NMSE-PON BOSS 增量与快照（LOID、用户名、联系电话、装机地址）。
  - 联系人与地址字段保持非空兜底回退：若 NMSE 为空，保留网管二期已有资料，避免空白覆盖。

---

## 3. 现场验证结果

在本地运行环境已完成真实数据回放与全量合并验证：
1. **真实增量工单范围**：8月27日 00:00 至 9月9日 00:00。
2. **入库工单数量**：267 条真实厚街工单，事务落库全部成功。
3. **全量合并结果**：
   - 网管二期原始记录：13,987 条
   - 最终合并快照总数：13,977 条
   - 成功关联匹配数：11,109 条
   - 冲突与未匹配项：严格记录在冲突审计表中，未产生非法坐标漂移。
4. **自动化测试**：本轮接手收口后全量 534 项单元与集成测试 100% 通过（`pnpm test`），新增覆盖定时中断恢复、有界瞬时重试和两套上游会话自动恢复。

---

## 4. 运维与现场操作指南

### 4.1 触发 BOSS 增量同步
1. 打开 OLT Manager（Web 版或桌面版）。
2. 进入 **资源数据同步** / **合并 ONU** 页面。
3. 在同步方式中选择 **NMSE-PON (BOSS增量)**：
   - 系统将自动基于上次成功的 Watermark（向前重叠 1 天以防跨日漏单）读取新工单。
   - 同步完成后，界面会展示处理的工单条数、新增数、更新数与销户数。
4. 点击 **手动合并**（或执行全量同步）：
   - 合并引擎将本地 BOSS 快照与网管二期快照做最终关联合并，更新 `merged_onu_snapshots`。

### 4.2 异常排查
- **会话过期（401/302）**：系统会清理旧会话并自动重登一次；仍失败时，任务记录会明确显示自动恢复失败原因，此时再到“NMSE-PON 服务器配置”核对已保存登录材料并重新登录。
- **单页超时**：系统默认采用 20 条安全分页；列表、分页和详情遇到超时、连接失败、`429` 或 `5xx` 时单项最多尝试 3 次。最终失败会使事务整体回滚，不破坏本地快照或水位。
- **数据冲突**：若出现同 LOID 跨 OLT 异常，进入“冲突记录”标签页排查，系统优先保障网管二期物理坐标。

---

## 5. 代码与设计资产索引

- 架构决策：[`ADR-075-nmse-boss-incremental-readonly.md`](file:///Users/mac/Documents/OLT%20Manager/docs/decisions/ADR-075-nmse-boss-incremental-readonly.md)
- BOSS 客户端：[`src/nmse-client.mjs`](file:///Users/mac/Documents/OLT%20Manager/src/nmse-client.mjs)
- BOSS 增量同步引擎：[`src/nmse-boss-sync.mjs`](file:///Users/mac/Documents/OLT%20Manager/src/nmse-boss-sync.mjs)
- 数据层逻辑与端口覆盖：[`src/db.mjs`](file:///Users/mac/Documents/OLT%20Manager/src/db.mjs)
- 单元测试集：[`tests/nmse-boss-sync.test.mjs`](file:///Users/mac/Documents/OLT%20Manager/tests/nmse-boss-sync.test.mjs)、[`tests/nmse-boss-db.test.mjs`](file:///Users/mac/Documents/OLT%20Manager/tests/nmse-boss-db.test.mjs)
