# ADR-006: Desktop Package Disables ASAR

## Status

Accepted

## Context

Electron 桌面版需要从主进程动态加载 `src/server.mjs`、`src/db.mjs` 和 `src/telnet-client.mjs` 等 ESM 模块。启用 `asar` 后，这些文件会被打包到 `app.asar` 中，已在 macOS 安装包中触发启动失败：

```text
ENOTDIR: not a directory, stat '/Applications/OLT Manager.app/Contents/Resources/app.asar/src/server.mjs'
```

本项目当前是内网本地工具，桌面包的首要目标是 macOS 和 Windows 7 x64 可启动、可访问本地服务、可使用内置 Telnet 终端。

## Decision

- 桌面发行包暂时设置 `asar: false`。
- 打包后保留真实目录结构，例如 `Contents/Resources/app/src/server.mjs`。
- Electron 主进程仍通过 `app.getAppPath()` 和动态 `import()` 加载本地服务与 Telnet 模块。
- 发行包仍只监听 `127.0.0.1`，不扩大 HTTP API 或 Telnet 能力边界。

## Consequences

优点：

- 修复 macOS DMG 安装后本地服务启动失败。
- macOS 和 Windows 7 x64 包使用同一套目录结构，降低 ESM 动态加载差异。
- 便于现场排查包内资源和本地服务入口。

代价：

- 应用源码不再压缩进 `app.asar`，安装目录可直接看到应用文件。
- electron-builder 会提示不推荐关闭 asar。

## Follow-up

- 后续如果需要重新启用 `asar`，应改成 `asarUnpack` 精确解包 `src/**/*.mjs`、`data/*.example.json` 和其他必须以真实文件路径访问的资源，并重新验证 macOS 与 Win7 启动。
- 如果后续引入真正的构建产物后端 bundle，可重新评估是否恢复 `asar: true`。
