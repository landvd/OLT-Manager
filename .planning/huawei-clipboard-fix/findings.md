# Findings

## 现象与证据

- 生成器 `src/config-plan.mjs` 输出的 Huawei 命令包含正常空格，且包含完整的 `config` 前缀；用户确认生成器原文没有问题。
- `src/main.js` 的 `pasteClipboardToTerminal` 读取剪贴板后调用 `sendTerminalInput`，当前一次性发送整段文本。
- `electron/main.cjs` 将输入原样转给 Telnet 会话；`src/telnet-client.mjs` 最终对 socket 执行单次 `socket.write(data)`。
- Huawei 内置登录流程曾自动发送 `enable`、`config`，因此终端打开时已经在配置模式；截图确认多出的 `config` 来自该登录流程，而不是生成器或剪贴板原文。

## 待验证假设

- Huawei 设备在整段高速 Telnet 输入时丢失空格或未正确处理 LF，是截图中命令粘连的主要原因。
- 将剪贴板文本拆成命令行，统一以 `\\r` 结束并加入短暂发送间隔，可避免该问题。

## 实现决策

- 剪贴板按钮和 xterm 多字符粘贴共用 `src/terminal-paste.mjs`。
- Huawei 内置登录改为只发送 `enable`，停在用户视图；粘贴链路保留方案首行 `config`，复制到系统剪贴板和发送内容一致。
- 空白分隔行不发送，避免被设备解释为额外回车；非空命令按字符发送，行尾只发送一个 `\\r`。
- Huawei 配置方案此前在服务端把同 PON 最大 ONT ID 加一直接作为后续命令 ID；对 `0/2/3/1` 这类低位空洞会生成错误的 `ont 18`。现改为扫描已占用 ID，优先选第一个空位，没有空位才使用最大 ID + 1，并让注册后的 `native-vlan` 与 `service-port` 共用该 ID。

## 2026-08-24：Huawei 未注册列表误报

- 当前桌面版刷新 Huawei 自动发现列表返回 5 条，但现场 CLI 只确认 2 条。
- 根因是 `hwGponDeviceOntRegisterSn`（52.1.2）在该设备上包含历史记录；CLI `display ont autofind all` 对应的 `hwGponDeviceAutoFindOntInfoSn`（48.1.2）只返回 2 条。
- 服务端现使用 `...48.1.2`，并保留 `...52.1.3` 未确认校验及已注册 ONT SN 去重；前端安装查询丢弃不属于当前 OLT 的迟到响应。
- 最新桌面版现场刷新已显示 2 条，修复保持只读边界，不执行配置命令，也不修改 OLT。

## 2026-08-24：Win7 Huawei OID 错误

- 截图中的错误为 `Invalid OID: 1.3.6.1.2.1.31.1.1.1.1.1.-100653312`。
- `HUAWEI_IF_NAME_OID` 的接口索引在部分 MA5800 上是大于 `2^31` 的无符号 32 位值；`-100653312` 对应 `4194313984`（十六进制 `0xFA002700`）。
- `src/snmp-parsers.mjs` 当前用 `Number` 直接解析 OID 尾部，保留了 Win7 SNMP 工具输出的负号；Huawei 查询再把该值拼到后续 OID，`src/snmp-client.mjs` 的 OID 编码器因此拒绝请求。
- 修复边界应集中在 OID 子标识解析/编码：仅将负数 32 位表示还原为无符号值，保留正常非负 OID；不改变 SNMP 读操作和 OLT 配置边界。

## 2026-08-24：Win7 Huawei 光功率显示异常

- 截图中的 `641.77 dBm` 和 `638.83 dBm` 对应原始值 `64177`、`63883`，不可能是真实正光功率。
- Huawei 部分光功率表以 16 位补码原始值返回；`64177 - 65536 = -1359`，应显示为 `-13.59 dBm`；`63883 - 65536 = -1653`，应显示为 `-16.53 dBm`。
- 修复边界集中在 `decodeHuaweiRxPower`：保留正常正值，转换 16 位高位值，并将 `65534`、`65535` 和 `2147483647` 作为无效标记；不连接或写入真实 OLT。
