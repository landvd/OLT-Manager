# Development Summary 2026-06-17

## 背景

本轮工作围绕 Huawei MA5800 自营上网配置方案展开。用户通过 Word 文档和终端截图提供了现场命令依据，重点校验未注册 ONT 的 SN 获取方式，以及 Huawei `ont add ... sn-auth` 应使用哪种 SN 格式。

## 已验证事实

- Huawei `display ont autofind all` 返回的 `Ont SN` 同时包含原始十六进制 SN 和括号内可读 SN。
- SNMP `1.3.6.1.4.1.2011.6.128.1.1.2.52.1.2` 返回的 Hex-STRING 与 CLI 原始十六进制 SN 一致。
- Huawei `sn-auth` 应使用原始十六进制 SN，例如 `5A544547030C0914`，不是 `ZTEG-030C0914`。
- Huawei CLI 的 `display ont autofind all` 有 `{ <cr>||<K> }:` 二次回车提示，自动化读取时必须处理该提示。
- 内嵌浏览器环境下 `navigator.clipboard.writeText()` 可能因权限或焦点失败，需要保留传统文本域复制兜底。

## 代码变更

- `src/config-plan.mjs`
  - 新增 `huawei-self-operated-internet` 模板。
  - 新增 Huawei SN 转换逻辑，将 `ZTEG-030C0914` 或 `ZTEG030C0914` 转为 `5A544547030C0914`。
  - Huawei 自营上网模板生成 `ont add`、`ont port native-vlan` 和 `service-port` 预览命令。
- `src/server.mjs`
  - 未注册 ONU 配置方案接口支持 Huawei。
  - 保留 ZTE MDU+OTT 的样板 ONU 动态 VLAN 逻辑，仅在 ZTE 模板下启用。
  - 新增本机 Terminal 打开接口，只调用 macOS `open -a Terminal`，不接收、不粘贴、不执行命令。
- `src/main.js`
  - 前端按当前 OLT 厂商过滤配置模板。
  - Huawei 模板不显示 ZTE 物理口多选。
  - 配置方案弹窗新增“打开终端”按钮。
  - 复制命令增加 Clipboard API 失败后的隐藏文本域兜底。
- `tests/config-plan.test.mjs`
  - 新增 Huawei 自营上网模板测试。
  - 覆盖 `sn-auth` 原始十六进制 SN 转换。

## 文档变更

- 更新 `AGENTS.md`、`DEVELOPMENT_STATE.md`、`ARCHITECTURE.md`、`CHANGELOG.md`、`EXPERIMENTS.md`。
- 更新 README、PRD、API、Sequence 和 Tests README。
- 新增 `docs/decisions/ADR-004-config-plan-preview.md`。
- 检查 ADR 后未新增 ADR-005；打开终端和复制兜底属于 ADR-004 的“预览、复制、人工确认”范围。

## 验证

```bash
pnpm test
pnpm build
node --check src/config-plan.mjs
node --check src/server.mjs
node --check src/main.js
```

## 剩余风险

- Huawei 已注册 ONT SN OID 尚未完成验证。
- Huawei profile ID、gemport 和 VLAN 规则来自当前 Word 文档和现场经验，其他站点可能存在差异。
- 配置方案只生成预览；真正下发仍需人工在 OLT 上确认。
- 打开 Terminal 目前只支持 macOS 本地运行；非 macOS 环境会返回不支持。
