# ADR-018：Electron `asar` 恢复可行性评估

## 状态

评估完成；当前暂不恢复 `asar`。

## 背景

当前发行配置使用 `asar: false`。Electron 主进程不是只加载一个静态入口：

- `electron/main.cjs` 通过 `app.getAppPath()` 拼接真实路径，动态导入 `src/server.mjs`、`src/runtime-lifecycle.mjs`、`src/db.mjs`、Feishu 模块和 Telnet 模块；
- Feishu 生产运行时依赖从 `resources/feishu-runtime/node_modules` 加载，开发目录还允许从 `build/feishu-runtime/node_modules` 加载；
- Windows 7 发行包必须能从应用目录或 `resources/bin/win32/sqlite3.exe` 找到固定的 `sqlite3.exe`；
- 渲染进程依赖 `dist/index.html` 引用的多个带 hash 的 JS/CSS 资源；
- Electron 22 的 Win7 兼容性、未签名桌面发行和当前 `asar: false` 的真实文件路径已经经过现有启动流程验证。

如果只把 `package.json` 的开关改成 `true`，静态资源可能仍可由 Electron 读取，但基于真实 `app.getAppPath()` 的动态路径、外置 Feishu 运行库、Windows SQLite 路径和调试诊断会同时出现未验证的分叉。当前没有足够证据证明这些路径在 macOS 和 Win7 x64 包中都能保持一致。

## 决策

本阶段不修改 `package.json`，继续保持 `asar: false`。先以 `scripts/verify-package-layout.mjs` 建立只读布局契约，契约版本为 `olt-manager/package-layout/v1`：

- 校验 `appRoot`、`resourcesPath` 是可访问目录；
- 校验静态入口、Electron preload、Feishu CJS 入口、托盘图标和 `dist/index.html`；
- 读取 `dist/index.html` 的本地 `src`/`href` 引用并逐一校验资源存在，不执行任何包内代码；
- 校验 Electron 当前动态导入目标位于未打包应用目录、`app.asar.unpacked` 或资源目录；
- 校验 Feishu runtime 的 `@larksuiteoapi/node-sdk/package.json`；
- 在 `win32` 目标下校验 `bin/win32/sqlite3.exe` 至少存在于应用目录或 `resources/bin/win32`；
- 任一必需文件缺失、不是普通文件或路径解析失败时返回失败，不能降级为启动或自动修复。

脚本只做目录、文件和文本引用检查，不 `import`、`require`、启动子进程或写入现场数据。对应测试覆盖当前 `asar:false` 风格布局、缺失资源 fail-closed，以及 `app.asar` 下动态模块必须位于 `app.asar.unpacked` 的边界。

## 恢复 `asar` 的前置条件

恢复前必须全部满足：

1. 在 macOS arm64 和 Windows 7 x64 CI 中生成目录包和最终 ZIP，并对实际 `appRoot`/`resourcesPath` 运行布局校验；
2. 明确 `app.asar` 内的静态文件范围，明确 `app.asar.unpacked` 中的动态 `src` 文件范围，不依赖 Electron 或 Node 对压缩包内部真实路径的隐式行为；
3. 将 `electron/main.cjs` 的动态模块、Feishu runtime、SQLite、dist 资源和 preload 分别验证，覆盖首次启动、登录、Feishu 未配置降级、Feishu 已配置连接、ONU 查询和内置 Telnet 入口；
4. 在 Windows 7 x64 实机或等价 CI 环境验证最小化/托盘、SQLite 子进程路径、用户数据目录和升级后数据保留；
5. 完成失败包启动、缺失 Feishu runtime、缺失 SQLite、动态模块未解包时的可诊断错误，不把凭据或原始远端响应写入日志；
6. 将布局校验接入发行前流水线，并保存校验报告和包内路径清单作为构建产物。

本轮新增 `scripts/evaluate-asar-migration.mjs`，以只读方式输出候选 `asarUnpack` 白名单和阻断原因。当前候选范围限定为动态 server/runtime/db/Feishu/Telnet 模块、Feishu runtime 和 Win7 SQLite 工具，不使用全量 `**/*`；评估器在 `asar:false`、缺少实际目录包报告、动态运行时证据或未完成 Windows 验证时均 fail-closed。只有 macOS/Windows 证据接缝全部通过时才会返回 `ready:true`，且 Windows 评估要求证据平台标记匹配。

## 未来迁移步骤

1. 先在独立分支加入 `asar: true` 和最小 `asarUnpack` 白名单，不扩大到全量 `src` 或任意 `**/*`；
2. 生成 macOS/Windows 目录包，运行本 ADR 的布局脚本；
3. 逐项完成 Electron 主进程、Feishu runtime、SQLite 和 renderer 静态资源的启动与业务回归；
4. 通过后再生成 DMG/Win7 ZIP，核对 SHA256、包内路径和实际窗口/服务/托盘信号；
5. 将验证结果和确切 `asarUnpack` 白名单补充到新的迁移 ADR，再考虑合并开关变更。

## 回滚方案

如果任一平台启动、动态加载、Feishu、SQLite、托盘或数据目录验收失败，立即恢复 `asar: false`，重新生成目录包和发行包，并使用本契约再次检查。回滚只改变打包布局，不删除或覆盖用户数据；现场 SQLite、凭据加密密文和 Feishu 状态仍由既有用户数据目录管理。任何需要恢复现场数据的操作必须沿用现有备份和人工确认流程。

## 后果

当前继续承担未压缩 app 文件带来的包体和可见源码成本，但保留了已验证的真实路径、Win7 兼容性和诊断边界。`asar` 恢复被转化为可重复的发行验证任务，而不是单一配置开关；未来若动态模块范围、Feishu 依赖方式或 SQLite 路径改变，必须同步更新契约和测试。
