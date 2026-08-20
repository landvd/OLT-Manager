# ADR-020：ONU 列表视图状态边界

## 状态

已接受（2026-08-19）

## 决策

将 ONU 数据查询页的纯状态初始化、地址关键词匹配和表格排序放入 `src/onu-list-state.mjs`。`src/main.js` 继续负责 Vue 响应式状态、API 请求、筛选条件持久化和 UI 事件编排。

模块不改变 `filters.search/chassis/slot/pon`、`sort.field/direction` 字段含义，也不把服务端筛选复制到前端；查询参数仍由 `loadOnus()` 按原有字段提交。

## 依据与边界

这些逻辑不依赖 DOM、Vue、网络或运行时凭据，可以用 Node 原生测试独立验证。后续拆分应继续保持 ONU 坐标模型和现有排序 tie-break 行为不变；涉及 API 查询语义的改动需要另行评估。
