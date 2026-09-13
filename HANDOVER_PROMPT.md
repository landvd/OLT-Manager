# Antigravity CLI 接手启动提示

将下面代码块完整复制为 Antigravity CLI 新会话的第一条消息。若同时交付具体开发需求，请把需求追加在代码块之后；不要删除安全边界和接手核对步骤。

```text
你现在接手 OLT Manager 项目继续开发。

固定工作目录：/Users/mac/Documents/OLT Manager
远程仓库：https://github.com/landvd/OLT-Manager.git
交接快照：main@fe383ce94601a4a08f3da35ccc2c7ff35d0c3e68，版本/tag v1.1.7。
如果用户尚未提交本次交接文档，git status 预期只显示 HANDOVER.md 和 HANDOVER_PROMPT.md 两项修改；它们是用户交接资产，必须保留，不得回滚或覆盖。

Antigravity CLI 是否自动加载 AGENTS.md 不确定，因此你必须主动完整读取它。开始时只做只读接手审计，不修改文件、不登录远端系统、不运行同步、不启动设备查询：

1. 执行 pwd、git status --short --branch、git rev-parse HEAD、git rev-parse origin/main、git branch -a、git tag --points-at HEAD。
2. 按顺序完整阅读 AGENTS.md、DEVELOPMENT_STATE.md、HANDOVER.md、docs/requirements/PRD.md、ARCHITECTURE.md、docs/design/api.md、docs/design/database.md、docs/design/sequence.md；再按当前任务读取相关 ADR、EXPERIMENTS.md 和 CHANGELOG.md。
3. 注意 DEVELOPMENT_STATE.md、本地 data/、release/ 和运行数据库可能含敏感或现场信息，不能提交、不能复制到回复、不能覆盖。
4. 报告实际 cwd、分支、HEAD、工作区是否干净、交接快照是否漂移、当前任务理解、拟修改文件、验证和回滚计划。没有具体任务时只报告接手结果并等待用户选择优先级。

最高优先级边界：

- OLT/ONU 设备自动化严格只读：只允许 SNMP v2c get/walk 和程序现有固定白名单 ZTE show 查询。
- 禁止 snmpset、任意 Telnet/SSH、ONU 注册/删除/重启、自动配置、保存配置。
- 配置方案只生成文本。内置 Telnet 终端可以由人工打开和登录，但你不得自动粘贴或执行任何配置命令。
- NMSE-PON、BOSS、OSS/NGB 和飞书只使用现有固定只读接口；真实请求必须有用户明确授权和精确范围。
- 不得输出或提交真实 IP、community、账号、密码、Cookie、Token、CUID/FDN、用户资料、原始远端响应、现场 SQLite、备份或日志。
- 修改前先做不覆盖旧文件的可恢复备份；只做最小授权改动。不要未经授权 commit、push、tag、Release、删分支或重置数据。
- 保留现有核心算法、字段、动作顺序、自动/手动边界和失败关闭语义；不要以重构名义重写业务。

当前真实状态和重点：

- v1.1.7 代码库最新测试基线提升至 578/578（CI=true pnpm test 全部通过，pnpm build 成功）。
- 最新沉淀交接：`docs/development-summary-2026-09-13-merged-sync-tolerance-and-clean-ui.md`（合并 Manifest 规范排序与集合对称校验、二期 IP 映射现场规则自动推导与零配置自愈、前端 UI 全面极简与现代重构）。
- 最新交付产物：Win7 x64 ZIP 桌面包 `release/OLT Manager-1.1.7-win7-x64.zip` 与 29.19 MB 组合备份 `release/olt-manager-combined-backup-2026-09-12.oltbackup.json` 已同步更新。
- v1.1.7 修复了 BOSS 多年历史读取期间的同步租约心跳/提交守卫，并支持飞书“OLT-IP 空格 板卡/PON”只读直查。
- 正式 Win7 ZIP 已做 ZIP、PE 架构和内置 SQLite 静态验收，但没有真实 Win7 启动验收。
- 现场曾完成 17,818 条 BOSS 姓名目录读取和原子提交，但旧外层任务因固定 30 分钟租约失效；v1.1.7 升级后应先检查完成状态和 watermark，再走短增量，不要盲目重跑多年历史。
- ADR-076 五个上海自然日的断纤恢复监控仍是“已规划，待实现”；当前一次性村级抽样不能宣称五天稳定恢复。
- macOS DMG 未签名、未公证。

建议第一优先级是只读验收而不是继续改算法：真实 Win7 v1.1.7 冒烟、BOSS 短增量与手动合并闭环、飞书两种 PON 输入格式。任何现场操作仍需用户明确授权。

验证最低门槛：pnpm run check:version、相关 node --check、CI=true pnpm test、CI=true pnpm build、git diff --check。若测试因受限沙箱报 listen EPERM，必须在允许绑定 127.0.0.1 的环境重跑，不得把它忽略或误判为代码故障。

最终报告必须分开写：静态/测试证据、本地运行证据、目标平台包证据、真实现场证据、未验证项和回滚方式。
```
