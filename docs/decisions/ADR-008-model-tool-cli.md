# ADR-008: Local Read-Only CLI for Model Tools

## Status

Accepted

## Context

OLT Manager 的查询能力目前通过本机 HTTP API 提供。大模型编程工具可以稳定调用命令行程序，但不应因此获得任意设备命令、凭据读取或本地业务数据写入能力。

## Decision

- 提供 `olt-manager tools` 和 `olt-manager call <tool> --input <json>`。
- CLI 以严格白名单和 JSON Schema 暴露现有只读查询、SNMP get/walk、审计查询和配置方案预览。
- 每次调用在 `127.0.0.1` 随机端口启动现有 HTTP 服务，结束后关闭，不复制业务逻辑。
- CLI 不提供 OLT、项目、PON 台账写入，不提供任意 Telnet/SSH、终端输入或设备写操作。
- 配置方案仍然只生成预览；SNMP 仍然仅允许 get/walk。
- stdout 使用统一 JSON 信封和稳定退出码，错误输出不包含 community、Telnet 凭据或完整异常栈。

## Consequences

大模型工具可用统一方式查询 OLT Manager，并继续受既有 API、设备 profile 和配置预览安全规则约束。每次调用都会初始化本地服务和数据库，速度不如常驻服务，但减少了部署前置条件和额外认证面。

如果未来增加 MCP 或常驻远程服务，应另行评估认证、授权、审计和协议生命周期；不得直接扩大本 ADR 的工具白名单。
