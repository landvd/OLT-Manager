# ADR-007: PON Coordinate Uses Chassis Board Port ID

## Status

Accepted

## Context

早期实现把 `slot` 同时当成“槽”和“板卡”使用，并把 PON 台账保存为 `板卡/PON` 两段格式。这会让中兴命令中的 `gpon-onu_1/...` 和华为坐标 `0/1/0:1` 被误读。

现场语义应为四元组：

- `chassis`：槽。
- `board`：板卡。
- `pon`：PON 口。
- `onuId`：ONU/ONT ID。

中兴命令格式为 `gpon-onu_<槽>/<板卡>/<PON>:<ONU ID>`，例如 `gpon-onu_1/9/16:3`。

华为板槽端口格式为 `<槽>/<板卡>/<PON>:<ONT ID>`，例如 `0/1/0:1` 表示 `0` 槽、`1` 板卡、`0` PON 口、`1` ONT ID。

## Decision

- 数据库 `pon_ports` 增加结构化字段 `chassis`、`board`、`pon`。
- `pon_port` 继续保留为兼容显示和旧 Excel 导入导出字段，规范格式改为 `槽/板卡/PON`。
- 旧 `板卡/PON` 台账启动迁移时按厂商默认槽补齐：ZTE 默认 `1`，Huawei 默认 `0`。
- API 返回 `chassis`、`board`、`pon`、`onuId`，同时保留 `slot=board` 作为兼容别名。
- 配置方案和只读 Telnet 查询必须从结构化坐标生成命令，不得把中兴 `_1` 或华为 `0/` 写死。
- 前端中文显示使用 `槽/板卡/PON/ID` 或华为常用的 `板槽端口` 语义。

## Consequences

优点：

- 中兴和华为坐标语义一致，避免把槽误当板卡。
- Huawei PON `0` 能被正确识别，不会被当作空值。
- 旧台账和旧 API 参数仍有兼容层，降低升级风险。

代价：

- 前端内部仍暂时保留 `slot` 过滤状态作为 `board` 兼容别名。
- 外部 Excel 模板需要逐步迁移到 `槽`、`板卡`、`PON` 三列或 `槽/板卡/PON` 三段格式。

## Follow-up

- 后续可在前端把 `slot` 状态变量重命名为 `board`。
- 为 PON 台账导入增加字段级错误报告，明确指出槽、板卡、PON 缺失或格式错误。
