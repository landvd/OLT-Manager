# CLI Design

`olt-manager` 是现有本地 HTTP API 的只读薄客户端，主要用于 Codex、Claude Code 或其他能够调用 shell 的大模型工具环境。它不复制数据库、SNMP、Telnet 或配置方案业务逻辑。

## Commands

```bash
pnpm cli tools --pretty
pnpm cli call olt_status --input '{}'
printf '%s' '{"q":"学校"}' | pnpm cli call project_list --input -
```

安装为 package bin 后也可直接使用 `olt-manager`。`tools` 返回工具名称、说明和 JSON Schema；`call` 只接受一个工具名和 `--input` JSON 对象。`--pretty` 可放在命令末尾。

默认 stdout 只包含一个 JSON 文档。成功退出码为 `0`，API 或设备调用失败为 `1`，命令、工具名或输入参数错误为 `2`。

## Result envelope

成功：

```json
{"ok":true,"data":{},"meta":{"tool":"olt_status","durationMs":12}}
```

失败：

```json
{"ok":false,"error":{"code":"OLT_NOT_FOUND","message":"OLT example 不存在。"},"meta":{"tool":"olt_status","durationMs":3}}
```

稳定错误代码包括 `INVALID_INPUT`、`UNKNOWN_TOOL`、`OLT_NOT_FOUND`、`RESOURCE_NOT_FOUND`、`DEVICE_TIMEOUT`、`INTERRUPTED`、`TOOL_UNAVAILABLE` 和 `API_ERROR`。

## Tool whitelist

- OLT：`olt_status`、`olt_list`
- ONU：`onu_list`、`onu_get_config`、`onu_list_unregistered`、`onu_list_recent`
- 本地资料：`pon_port_list`、`project_list`、`project_onu_list`
- 配置预览：`config_template_list`、`config_plan_preview`
- SNMP 与审计：`snmp_get`、`snmp_walk`、`snmp_history_list`、`admin_event_list`

SNMP 工具只映射到现有 `get/walk` 白名单。`config_plan_preview` 只生成文本预览。CLI 不提供本地业务数据写入、任意 Telnet/SSH、终端输入、`snmpset`、ONU 注册/删除/重启或保存配置。

## Runtime and security

每次 `call` 都在进程内启动 `127.0.0.1` 随机端口服务，调用完成、失败、超时或收到中断信号后关闭。CLI 使用与 Web/桌面版相同的数据目录和工具环境变量；测试可通过 `OLT_MANAGER_DATA_DIR` 隔离数据。

输出会移除已知凭据和异常栈，不返回 `/api/admin/olts` 的含密字段。SNMP get/walk 仍写入现有本地审计历史，但不会修改设备或业务台账。
