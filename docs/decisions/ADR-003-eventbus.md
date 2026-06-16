# ADR-003: Avoid Event Bus Until UI State Requires It

## Status

Accepted

## Context

当前前端在 `src/main.js` 中集中管理状态和 API 调用。页面规模还不大，引入全局事件总线或状态库会增加概念和调试成本。

## Decision

当前不引入 event bus。继续使用 Vue 组合式状态和明确的函数调用。

当出现以下情况时再重新评估：

- 多个独立页面需要订阅同一批实时事件。
- 后端引入 SSE/WebSocket。
- ONU 查询、告警、日志需要跨组件同步刷新。
- `src/main.js` 已经难以局部理解和测试。

## Consequences

优点：

- 状态流简单。
- 降低早期复杂度。
- 更容易把业务逻辑拆成可测试函数。

代价：

- 随着页面增长，`src/main.js` 可能继续变大。
- 某些跨组件刷新需要手工传递。

## Follow-up

- 优先拆分纯解析函数和 API helper。
- 后续如引入事件流，先写一个小 ADR 说明事件类型、生命周期和错误处理。
