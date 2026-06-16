# ADR-005: Terminal Login Helper Enters Configuration Mode

## Status

Accepted

## Context

配置方案预览已经可以生成可复制的 OLT 命令。现场操作时，维护人员仍需要手工打开终端、Telnet 登录 OLT、进入配置模式，再粘贴命令确认。

为了减少重复登录步骤，系统新增轻量 Terminal 登录辅助。这个能力会自动登录设备并进入配置模式，因此它超出了 ADR-004 中“只打开终端”的边界，但仍不应变成自动下发器。

## Decision

- 配置方案弹窗提供“复制并登录终端”。
- 前端先复制命令，再请求后端打开本机 Terminal 登录脚本。
- 后端从本地 SQLite 读取当前 OLT 的 Telnet host、port、username 和 password。
- ZTE 登录成功后自动发送 `con t`。
- Huawei 登录成功后自动发送 `enable` 和 `config`。
- 系统不把生成的配置命令传给后端登录脚本。
- 系统不自动粘贴、不自动执行生成命令、不自动保存配置。
- 如果设备要求 enable 二次密码，脚本停止自动流程并交给人工处理。

## Consequences

优点：

- 减少现场重复登录步骤。
- 保留人工粘贴和确认配置命令的安全边界。
- Telnet 凭据集中在本地运行库中维护。

代价：

- 系统会自动进入配置模式，需要更明确的操作提示。
- Telnet 密码以本地运行数据形式保存，必须避免提交或共享。
- 当前只支持 macOS Terminal，跨平台登录器另行设计。

## Follow-up

- 后续如要内置 Web Terminal，应复用免费 OLT 登录器的 Telnet codec、登录状态机和 Huawei 输入处理经验。
- 后续如要自动下发配置，必须新增独立 ADR，覆盖审批、审计、回滚和防误操作。
