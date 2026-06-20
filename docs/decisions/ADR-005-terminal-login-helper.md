# ADR-005: Embedded Telnet Terminal Enters Configuration Mode

## Status

Accepted

## Context

配置方案预览已经可以生成可复制的 OLT 命令。现场操作时，维护人员仍需要打开终端、Telnet 登录 OLT、进入配置模式，再粘贴命令确认。

为了减少重复登录步骤并兼容 Windows 7，系统采用 Electron 内置 Telnet 终端替代调用系统 Terminal、Expect 或系统 telnet。这个能力会自动登录设备并进入配置模式，因此它超出了 ADR-004 中“只打开终端”的边界，但仍不应变成自动下发器。

## Decision

- 配置方案弹窗和首页快捷入口提供“打开内置终端”。
- 配置方案弹窗会先复制命令，再通过 Electron IPC 请求主进程创建 Telnet 会话；首页快捷入口只创建 Telnet 会话，不复制或传递命令文本。
- Electron 主进程从本地 SQLite 读取当前 OLT 的 Telnet host、port、username 和 password。
- 内置 Telnet 终端使用 Node socket、Telnet IAC 协商和自动登录状态机，不调用系统 Terminal、Expect 或系统 telnet。
- ZTE 登录成功后自动发送 `con t`。
- Huawei 登录成功后自动发送 `enable` 和 `config`。
- 系统不把生成的配置命令传给 Telnet 会话。
- 系统不自动粘贴、不自动执行生成命令、不自动保存配置。
- 如果设备要求 enable 二次密码，脚本停止自动流程并交给人工处理。

## Consequences

优点：

- 减少现场重复登录步骤。
- macOS 和 Windows 7 x64 共用可控终端能力。
- 保留人工粘贴和确认配置命令的安全边界。
- Telnet 凭据集中在本地运行库中维护。

代价：

- 系统会自动进入配置模式，需要更明确的操作提示。
- Telnet 密码以本地运行数据形式保存，必须避免提交或共享。
- 内置终端只在 Electron 桌面环境启用，普通 Web 浏览器不提供真实 Telnet 终端。

## Follow-up

- 后续如要自动下发配置，必须新增独立 ADR，覆盖审批、审计、回滚和防误操作。
