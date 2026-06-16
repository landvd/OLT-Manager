# Tests

当前仓库还没有正式测试框架。本目录用于逐步沉淀最小测试资产。

## 优先测试对象

- SNMP OID 输出解析。
- ZTE ONU 配置输出清洗。
- Huawei MA5800 ONT 索引映射。
- SQLite seed 初始化和路径处理。
- API 输入校验和危险操作拦截。

## 推荐策略

1. 先把真实设备输出脱敏后保存为 fixture。
2. 把解析逻辑从 `src/server.mjs` 中拆成纯函数。
3. 为纯函数写最小 Node 测试。
4. 再考虑引入 Vitest 或 Node 内置 test runner。

## 临时验证命令

```bash
pnpm build
node --check src/server.mjs
node --check src/db.mjs
node --check src/zte-telnet.mjs
```
