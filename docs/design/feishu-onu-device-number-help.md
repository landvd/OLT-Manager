# Feishu ONU 设备号与帮助合同

## 当前实现

- ONU 详情卡片仅在只读数据服务候选中明确提供字符串字段 `deviceNumber` 时显示“ONU 设备号”。
- `serialNumber`（ONU 序列号/SN）不会回填为 `deviceNumber`，避免把两个现场字段混淆。
- Feishu application 对候选做显式字段投影，只保留用户查询所需的非敏感字段；未知字段不会进入卡片或回调绑定。
- `帮助`、`help`、`使用帮助`、`查询帮助`、`命令帮助`、`指令`由本地 application 处理，不调用语言 provider 或远端数据服务。

## 设备号查询边界

设备号查询使用独立的只读 Gateway seam：

```text
gateway.queryUsersByDeviceNumber({ value, oltIds, limit })
```

当前生产只读 Gateway 已提供 `queryUsersByDeviceNumber`，设备号搜索不会退回调用 `find_by_sn`，也不会把序列号误当设备号。若宿主注入的 Gateway 缺少该方法，Feishu 仍会安全返回未接入提示。

## 帮助示例

支持姓名、手机、装机地址、ONU 序列号/SN、ONU 设备号、LOID、MAC、ONU 坐标和 PON 地址查询。唯一匹配返回 ONU 详情，多条匹配返回可分页候选；输入“帮助”或“help”可重新显示说明。

本变更不连接现场、不执行 OLT 命令、不刷新远端数据，也不持久化或返回凭据、Cookie、token、CUID、FDN 或原始远端响应。
