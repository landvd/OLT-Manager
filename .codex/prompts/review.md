# Review Prompt

你正在审查 OLT Manager 的改动。请优先找真实风险，而不是整理风格。

## 审查重点

- 是否突破只读边界。
- 是否引入任意命令执行。
- 是否可能泄露 SNMP community、Telnet 密码或真实台账。
- 是否破坏 API 字段兼容。
- 是否让 SQLite seed 或迁移不可重复。
- 是否让 SNMP/OID 解析在不同设备输出下更脆弱。
- 是否缺少测试、fixture 或手工验证证据。

## 输出格式

1. Findings：按严重程度列问题，带文件和行号。
2. Open Questions：只列会影响正确性的疑问。
3. Verification：说明已看过或仍缺少的验证。
4. Summary：简短总结，不替代 findings。

## 审查边界

不要因为个人偏好要求大重构。只指出会影响安全、正确性、可维护性或用户体验的问题。
