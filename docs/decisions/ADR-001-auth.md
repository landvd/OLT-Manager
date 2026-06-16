# ADR-001: Local-First Access Boundary

## Status

Accepted

## Context

OLT Manager 当前没有用户系统和权限模型。它会读取本地 OLT 配置、PON 台账、SNMP community，以及可能的只读 Telnet 凭据。如果直接暴露到不可信网络，风险过高。

## Decision

当前版本保持 local-first：

- 默认监听 `127.0.0.1`。
- 不承诺公网或多人访问安全。
- 真实凭据放在 `.env.local` 或本地数据文件中，不提交。
- 在引入远程访问前，必须新增认证、授权、审计和部署 ADR。

## Consequences

优点：

- MVP 简单，适合本机维护工具。
- 避免过早设计复杂用户系统。
- 降低凭据暴露面。

代价：

- 不适合直接给多人远程使用。
- 若需要部署到服务器，必须先补安全设计。

## Follow-up

- 评估最小登录口令。
- 评估反向代理下的访问控制。
- 评估敏感字段脱敏和审计日志策略。
