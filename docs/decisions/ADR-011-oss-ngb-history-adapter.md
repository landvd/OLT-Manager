# ADR-011: Integrate OSS/NGB history through a fixed read-only adapter

## Status

Accepted

## Context

网管二期页面已经验证可以通过会话绑定的 DWR 调用读取组织树、OLT 列表、ONU 列表和历史光功率，但页面响应同时携带内部 CUID、用户资料和设备访问字段。把浏览器自动化、任意 DWR 代理或原始响应直接接入 OLT Manager，会扩大敏感数据和远端操作边界，也无法形成稳定的产品界面。

OLT Manager 已有人工确认的 `resource_olt_ip_mappings`，可以把网管二期支撑网 IP 与本机 `olts.host` 一一关联。用户需要从现有 ONU 详情直接读取指定坐标的历史光功率，不希望依赖终端或外部浏览器操作。

## Decision

新增 `src/oss-ngb-client.mjs` 作为唯一 OSS/NGB seam。它只允许统一登录以及三项固定 DWR method：`TreePanelAction.loadData`、`GridViewAction.getGridPageInfo`、`GridViewAction.getGridData`。页面路径、模板名、查询对象和过滤字段由适配器固定构造，不接受前端传入任意 method、URL、CUID 或 DWR 对象。

用户在 OLT Manager 页面保存认证/NGB 基地址、用户名、组织名称和机房名称；这些非敏感字段进入单行 SQLite 配置。首次登录时用户同时输入网管二期密码和迁移主密码，成功后密码使用 scrypt 派生密钥和 AES-256-GCM 写入独立密文表；迁移主密码不保存。登录后的 Cookie、token、组织树和 CUID 只存在内存，服务重启或显式退出后丢弃；迁移到 Win7 后可用同一迁移主密码解锁密文。

历史光功率读取从本机 `oltId` 和完整 ONU 坐标开始。后端使用一一映射定位当前会话中的支撑网 OLT，再从固定 ONU 列表精确匹配 CUID，最后调用固定历史模板。适配器在每层立即投影：OLT 只保留支撑网 IP、CUID 和机房；ONU 查找只短暂保留匹配 CUID；最终响应只保留采集时间、ONU 收发光功率、OLT 收光功率和光衰。

登录后的页面会话按真实成功页面的顺序建立：使用同一页面版本先打开 NGB 框架和设备配置页，再以 `batchId=0` 自然递增加载组织树节点；组织树从空查询根节点开始逐层展开，不发送带组织名称的合成搜索请求。登录跳转后不再探测用户权限接口、伪造兼容请求头或在 OSS/NGB 多路径之间回退。

本功能只读取已有历史记录，不调用单 ONU 光功率刷新、PON 全量刷新、SNMP set、Telnet/SSH 或任何配置接口。验证码、多登录部门歧义、会话失效、映射缺失和坐标不唯一均失败关闭，不猜测或降级到更宽范围。

## Consequences

- 用户可以完全在 OLT Manager 页面完成配置、登录和历史查询，不需要终端或浏览器自动化。
- 原始密码、迁移主密码和会话不会进入 API 响应或审计；SQLite/备份只保存登录密码的加密密文和参数，服务重启或迁移后需要重新输入迁移主密码。
- 当前实现依赖已验证的内部页面合同；OSS/NGB 升级后可能需要更新适配器和合成测试。
- 当前切片不自动发现或写入 IP 映射，不保存历史明细，不提供全量 ONU 导出，也不接入定时任务。
