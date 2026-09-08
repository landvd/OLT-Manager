# 调查发现

## 已确认

- `src/remote-session-state.mjs` 只保存 `ossNgbSession` 内存引用，没有过期时间、租约或自动退出。
- `src/server.mjs` 的 `readHistoricalOpticalForTarget()` 只读取当前 `activeOssNgbSession()`，未登录时直接失败；Feishu gateway 通过 `readHistoricalOptical` 调用该路径。
- `src/feishu/application.mjs` 已实现远端历史优先、失败回退本地 `onu_status_history`，但远端会话建立仍依赖用户先在页面登录。
- `src/main.js` 的“本机自动登录”是启动时自动登录能力，不是历史查询按需登录，也没有 10 分钟退出租约。
- `src/oss-ngb-client.mjs` 已有固定只读 `login`、`logout`/退出相关能力和会话 Cookie 内存容器，应优先复用，不能猜测新路径。
- 当前 Mac 现场页面显示“网管二期历史光功率配置：未登录”，所以“田金水”历史查询失败的直接原因是没有有效 OSS/NGB 会话。

## 待核对

- 精确的现有登录函数、退出函数和凭据解锁返回值，需在源码中确认注入位置。
- 应用关闭时 Electron 是否已有统一生命周期清理入口，需接入而不是新增第二套关闭钩子。
