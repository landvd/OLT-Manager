# ADR-059：资源同步 API 适配器

## 状态

已接受，2026-08-20。

## 决策

新增 `src/resource-sync-api.mjs`，集中定时任务列表/创建/取消/删除、合并 ONU 快照、进度查询和四类同步操作的 HTTP 合同。适配器只允许固定的 network、nmse、merge、full 路径，并统一任务 ID 编码和一次性任务 `repeatDays: 0` 规则。

`src/main.js` 继续负责轮询定时器、进度响应式状态、按钮禁用和用户提示；适配器不访问 DOM、SQLite、远端 NMSE/OSS-NGB 或 OLT。

## 验证

专项测试覆盖中文任务请求体、任务 ID 编码和固定只读同步端点；真实同步仍由现场/发行门禁验证。
