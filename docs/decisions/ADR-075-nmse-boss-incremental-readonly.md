# ADR-075：一期 NMSE-PON 使用 BOSS 历史姓名初始化与只读增量

## 状态

已采纳（2026-09-09，2026-09-10 补充历史姓名初始化）

## 决策

网管二期继续使用现有全量只读同步；一期 NMSE-PON 由固定 BOSS GET 入口读取。查询条件固定为处理状态成功、操作状态全部、查询内容厚街镇。第 9 版迁移后首次运行从 `2019-08-23 00:00:00` 起到运行启动时的上海墙钟时间，按自然月分段完整读取；后续运行以上次成功水位向前重叠一天，同样截止本次启动时间。

历史阶段不回放报装、移机、更换或销户对设备坐标的历史变更，只从成功工单投影 LOID、姓名、工单号和接收时间，按 LOID 保留最新姓名。该目录用于为网管二期中只有姓的行补全姓名，不改写远端 NMSE-PON 或 OLT。任一分段、分页或详情失败，或所有月份没有返回任何可用姓名时，不提交半套/空目录；只有全部成功且至少取得一条可用姓名才原子写入 `nmse_boss_name_snapshots`、初始化状态和水位。

查询前先访问固定只读页面 `/BOSS/BOSSInstruction`，仅在内存中携带 `accessToken`、`phone`、`type`、`id` 和会话 Cookie；页面路径与 JSON API 白名单分离。列表使用已验证的 `/boss/getBossOperation`，固定 20 条分页并按 `recTime` 升序；每条再使用 `/onu/getOnuAuthorizePercentByIdentity` 按认证类型读取详情，分页或任一详情失败均不提交。页面与两条 API 路径复用同一 NMSE 登录会话和 Cookie。

初始化成功后，变更仍按工单号、LOID、接收时间幂等。报装、移机、更换 ONU 更新当前一期快照；只有成功销户允许删除/失效现有记录。有非空姓名的新工单也会按时间更新持久姓名目录。事件、快照、姓名目录、来源状态和 watermark 在一个本地事务中提交，任一步失败都保留旧值。

来源 manifest 使用 v2。网管二期 `sourceKind` 为 `network-full-snapshot`，一期 `sourceKind` 为 `nmse-boss-incremental-overlay`；一期 `scope` 固定记录处理状态成功、操作状态全部、查询内容厚街镇，`exclusiveWatermark` 等于查询结束时间，`coverageThrough` 严格保存水位在上海日历的前一自然日。`targetOltIds` 只表示本地合并目标，不声称 BOSS 按 OLT 筛选；未登记 OLT 的成功记录保留在一期源快照。旧 v1 manifest 仍可按原格式解析，但必须重新同步两套 v2 源后才能合并。

一期源提交是 staged workflow 中的独立权威提交：事件、快照、coverage、source 状态、manifest 和水位在 `.bail on`/`BEGIN IMMEDIATE` 下同一事务完成；后续二期或统一合并失败不会伪造回滚一期已确认数据，页面应展示其独立状态并允许重试后续阶段。

## 安全边界

BOSS 客户端仅允许固定 HTTP(S) 基地址下的固定查询路径和 GET 方法，响应只投影业务字段。代码、日志和数据库不保存凭据、Cookie、token 或原始响应；此流程不访问 OLT 写接口。
