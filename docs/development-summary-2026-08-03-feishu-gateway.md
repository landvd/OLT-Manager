# Feishu ONU Query 集成与主干状态（2026-08-03）

## 主干合并状态

- `codex/olt-data-gateway` 已包含在 `main` 历史中；在当前 OLT Manager 工作区执行 `git merge --ff-only codex/olt-data-gateway` 的结果为 `Already up to date`。
- `main` 当前包含 Gateway v1 的状态、OLT 清单、用户/PON 查询、ONU 详情和 OLT IP 投影提交；没有额外的未合并 Gateway 分支提交。

## 对 Feishu ONU Query 的稳定接口边界

- Feishu 只能通过本机回环 Gateway 和 bearer token 调用版本化只读路由。
- Gateway 不读取或暴露 OLT Manager 数据库文件、设备凭据、NMSE-PON 会话、配置方案、审计记录或全量用户导出。
- OLT 与 PON 实时状态、接收光功率、已验证 ONU 详情以及最近离线原因均属于只读查询；不得增加 `snmpset`、Telnet/SSH 写命令、ONU 注册/删除/重启或配置保存路径。

## 联调经验

- Feishu 桌面端必须先启动并保持长连接；`回调服务当前未在线` 通常表示长连接未建立或已断开，不是 OLT 数据合同错误。
- Feishu 端遇到 `app_id or app_secret is invalid` 时，应由管理员在 Feishu 后台核对凭据；OLT Manager 不保存或回显 Feishu App Secret。
- Gateway 状态为 `connected` 只说明本机只读数据服务可用，不能推断 Feishu 长连接或 MiniMax 服务可用。
