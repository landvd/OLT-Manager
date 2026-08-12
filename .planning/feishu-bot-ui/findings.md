# 关键发现

- 设置页模板位于 `src/main.js`。
- 当前 `configureFeishu` 同时保存飞书凭据和语言 provider，需拆分为两个前端动作与两个 IPC 处理路径，避免凭据按钮被大模型字段阻塞。
- `electron/main.cjs` 已有 `configureFeishu`，内部同时处理 App Secret 和语言 provider；应复用相同的安全存储逻辑，增加只更新 App 凭据的 IPC 方法。
- CC Switch 导入由 `electron/cc-switch-provider-discovery.cjs` 与 preload 暴露，页面删除入口不代表必须立即删除底层能力；本次范围聚焦页面和保存交互。
- 现有飞书子系统查询逻辑与只读 OLT Gateway 不应改变。
