# Task Template

## 背景

- 需求来源：
- 相关文档：
- 相关代码：

## 目标

- 用户可见目标：
- 工程目标：
- 不做什么：

## 安全边界

- 是否访问 OLT：
- 是否只读：
- 是否涉及敏感数据：
- 禁止操作：

## 实施计划

- [ ] 读取上下文
- [ ] 补测试或 fixture
- [ ] 实现最小改动
- [ ] 更新文档
- [ ] 运行验证

## 验证

```bash
pnpm build
node --check src/server.mjs
node --check src/db.mjs
node --check src/zte-telnet.mjs
```

## 完成记录

- 修改文件：
- 验证结果：
- 剩余风险：
