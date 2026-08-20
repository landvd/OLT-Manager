# ADR-017：统一 Web/Electron/CLI 运行时生命周期边界

## 状态

已接受（架构二期第 16 项）。

## 背景

CLI 临时服务和 Electron 桌面服务都启动本地 HTTP 服务，但此前分别保存 server handle、处理中断和执行关闭。重复关闭、启动失败和连接未及时释放的语义不一致，也容易让上层误把 OLT 会话或凭据放入生命周期全局状态。

## 决策

新增 `src/runtime-lifecycle.mjs`，提供可注入的协调器：

- 统一 `starting`、`ready`、`closing`、`closed` 状态；
- 统一保存和返回 server handle；
- `start()` 在启动失败时执行清理并重新抛出原错误；
- `close()` 幂等，支持 `closeAllConnections()`、关闭超时和强制关闭；
- `abort()` 只管理当前运行时的 AbortSignal，不保存 OLT 会话、凭据或业务状态。

CLI 使用每次调用独立的协调器，仍固定监听 `127.0.0.1` 随机端口并保持免登录边界。SIGINT/SIGTERM 先 abort 当前调用，再强制关闭临时服务。

Electron 使用进程内一个协调器管理本地 `127.0.0.1:8787` 服务，窗口重建时复用 ready handle，应用退出时等待幂等关闭完成后再退出。Feishu 和内置 Telnet IPC 仍由原有模块管理，不由协调器接管。

## 未统一的边界

- Web 进程仍由自身启动入口和操作系统进程管理；协调器不让 Web 管理 Electron。
- Electron `BrowserWindow`、Tray、Feishu runtime、Telnet session 仍是各自的资源，只有本地 HTTP server 纳入本 ADR 的共同关闭语义。
- CLI 子进程和 Electron 主进程的退出码、窗口生命周期及操作系统信号仍由各自宿主负责。
- OLT 连接、SNMP/Telnet 会话和凭据生命周期尚未迁移到本协调器，避免扩大安全边界。

## 后果

生命周期测试可以使用 fake server，不需要启动真实 OLT 或桌面窗口。后续若统一 Web/Electron/CLI 的更大范围资源退出，需要另行设计资源注册表和所有权模型，不应把业务对象直接塞入当前协调器。
