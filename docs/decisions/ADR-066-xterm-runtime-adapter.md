# ADR-066：内置终端运行库延迟加载

## 状态

已接受（2026-08-20）。

## 背景

内置 Telnet 终端只在桌面用户主动打开时使用，但 `main.js` 之前静态导入
`@xterm/xterm` 和 `@xterm/addon-fit`，导致终端运行库进入首屏静态依赖图。

## 决策

- 通过 `src/xterm-runtime.mjs` 统一动态加载 xterm 和 FitAddon。
- `main.js` 只在挂载内置终端时调用加载函数，并复用同一个 Promise。
- Telnet 会话创建、窗口尺寸同步、固定命令白名单、人工粘贴和只读边界继续由原有入口管理。
- 运行库加载失败时只显示错误并停止挂载，不创建远端会话。
- 保留 xterm CSS 静态入口，避免改变已验证的终端样式和打包行为。

## 验收

- 运行库专项测试验证动态模块可用且 Promise 复用。
- 构建产物验证 `vendor-xterm` 为异步 chunk。
- `main.js` 不再静态导入 xterm JavaScript 模块。
