# ADR-048：桌面发行验证门禁

## 状态

已接受，2026-08-19。

## 决策

桌面发行拆成三层门禁：本地目录包资源契约、目标平台启动/托盘验证、最终 ZIP/签名资产验证。前一层通过不能替代后一层，不能用 macOS 构建结果宣称 Win7 任务栏行为已验证。

本地目录包必须包含动态 ESM 模块、Feishu 运行时、Win7 legacy SQLite CLI 和生成的 PNG/ICO 图标。当前 `asar:false` 保持不变，直到目标平台验证动态模块加载和升级回滚。

## 证据与边界

- macOS arm64 目录包和 Windows unpacked 目录包的 `package-layout/v1` 契约均通过。
- `olt-manager.ico` 为包含多尺寸图像的 Windows 图标资源，Win7 SQLite 为 PE32 x86 文件。
- 当前 Apple Silicon 主机的旧版 x86 Wine 在 electron-builder 的 rcedit 阶段失败，报 `bad CPU type in executable`；因此本地不能验收最终 Windows ZIP、版本资源注入或真实 Win7 托盘。

## 后续动作

在 Windows 7 x64 或 GitHub Actions Windows runner 上重新生成 ZIP，并依次验证启动、最小化到任务栏/托盘、图标可见、退出菜单、用户数据目录和 SQLite 初始化。失败时保留目录包证据，不发布 ZIP。
