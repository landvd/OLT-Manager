# Tests

当前仓库使用 Node 内置 test runner。本目录用于逐步沉淀最小测试资产。

## 当前命令

```bash
pnpm test
node --test tests/config-plan.test.mjs
```

## 优先测试对象

- SNMP OID 输出解析。
- ZTE ONU 配置输出清洗。
- Huawei MA5800 ONT 索引映射。
- SQLite seed 初始化和路径处理。
- API 输入校验和危险操作拦截。
- 配置方案模板渲染，尤其 Huawei `sn-auth` 原始十六进制 SN 转换。
- 前端配置方案弹窗的复制和本机终端辅助流程。

## 推荐策略

1. 先把真实设备输出脱敏后保存为 fixture。
2. 把解析逻辑从 `src/server.mjs` 中拆成纯函数。
3. 为纯函数写最小 Node 测试。
4. 再考虑引入 Vitest 或 Node 内置 test runner。

## 临时验证命令

```bash
pnpm build
node --check src/server.mjs
node --check src/main.js
node --check src/db.mjs
node --check src/zte-telnet.mjs
```
