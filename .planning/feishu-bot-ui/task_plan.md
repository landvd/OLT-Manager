# 飞书机器人页面调整计划

## 目标

根据浏览器批注收敛飞书机器人设置页：删除不需要的说明/导入/查询范围内容，统一中文标签，并将飞书凭据保存与大模型配置保存拆开。

## 阶段

- [completed] 梳理现有 UI、Electron IPC 和测试边界
- [completed] 修改页面文案、结构与保存交互
- [completed] 补充最小回归测试并运行验证
- [completed] 更新变更记录并检查工作区

## 后续阶段：首页收敛与 NMSE-PON 定时任务

- [completed] 梳理首页、历史记录入口和现有资源管理同步链路
- [completed] 删除数据采集记录和首页告警卡片，修正运行时间显示
- [completed] 新增可持久化的一次性 NMSE-PON 用户信息定时任务
- [completed] 补充数据库/API/UI 回归测试并完成构建验证
- [completed] 更新 API、数据库说明和变更记录

## 后续阶段：重复用户信息同步任务

- [completed] 设计重复周期、下一次执行时间和历史结果字段
- [completed] 扩展 SQLite、API、调度器和任务页面
- [completed] 补充重复任务到点执行测试并完成浏览器验证
- [completed] 更新文档与变更记录

## 验证结果

- `node --check src/main.js electron/main.cjs electron/preload.cjs` 通过。
- `CI=true pnpm build` 通过。
- `CI=true pnpm test` 通过，193/193。
- 本地浏览器 DOM 与截图确认新文案、两个独立按钮和删除项均符合要求。

## 验收标准

- 菜单显示“飞书机器人”。
- App ID 显示“飞书APP ID”，API Key 显示“API KEY”。
- 运行边界、查询范围、CC Switch 导入、语言 provider 分隔说明不再显示。
- 有独立按钮保存飞书 APP ID 和 APP SECRET；大模型配置仍使用独立保存按钮。
- 保存飞书凭据时不要求填写大模型配置，且仍走原有 Keychain/DPAPI 存储。

## 后续阶段验收结果

- 删除“数据采集记录”菜单和首页“警告通知”卡片，后台历史 API 保留兼容，避免影响既有只读诊断记录。
- 首页 `119:14:15:13.00` 等 SNMP uptime 文本显示为 `119天 14小时 15分钟 13秒`。
- “定时任务”位于“专线项目管理”和“备份还原”之间，支持选择执行时间和目标 OLT，任务状态持久化并支持重启恢复、取消未执行任务。
- 到点测试自动连接模拟 NMSE-PON，完成用户快照同步；未执行任务取消测试通过。
- `CI=true pnpm build` 通过；完整 `CI=true pnpm test` 通过 195/195。
- 重复任务浏览器验证通过：启用“重复执行”后显示间隔天数控件，默认示例为 5 天；最新 WEB 后端任务 API 正常，页面无旧接口错误。

## 后续阶段：定时任务删除

- [completed] 增加任务列表删除操作与确认提示
- [completed] 增加本地删除 API，并清理未执行任务的调度器计时器
- [completed] 补充 API、UI 回归测试与文档

## 删除任务验收结果

- `node --check src/main.js src/server.mjs src/db.mjs` 通过。
- `CI=true pnpm build` 通过。
- 授权环境 `CI=true pnpm test` 通过，195/195。
- 本地浏览器确认已取消任务显示“删除”按钮；任务列表操作区正常渲染。
