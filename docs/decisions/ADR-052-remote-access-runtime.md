# ADR-052：远端访问运行时深模块

## 状态

已接受，2026-08-20。

## 决策

新增 `src/remote-access-runtime.mjs` 作为远端访问的深模块。它通过注入的配置读取器、凭据适配器、客户端构造器和会话状态容器，统一承载：

- NMSE-PON 登录、OLT 发现和网格映射；
- 网管二期登录、自动登录/迁移主密码解锁和密文保存；
- 当前会话读取、会话失效错误和内存会话写回。

调用方只依赖 `activeNmseSession`、`ensureNmseSession`、`resourceGridRank`、`activeOssNgbSession`、`loginNmseSession` 和 `loginOssNgbSession`，不再复制密码解锁或客户端登录细节。该模块不扩大远端白名单，不返回密码、Cookie、token 或 CUID。

## 接缝与验证

客户端、数据库配置、凭据提供器和远端会话状态均通过适配器注入；专项测试使用假客户端验证登录、发现、映射、密文保存和会话投影。真实远端登录仍属于用户自行处理的现场门禁。
