# ADR-024：Element Plus 按需加载评估

## 状态

已评估，暂不改造入口。

## 背景

架构二期已用 Vite `manualChunks` 将浏览器依赖拆成稳定命名的 vendor chunk，但构建仍提示 Element Plus chunk 较大。本期要求在不改变现有模板行为、登录首屏和 Electron 22 兼容性的前提下评估按需加载。

当前 `src/main.js`：

- 默认导入 `ElementPlus`，并在 `createApp(App).use(ElementPlus)` 中全局注册组件和指令；
- 模板使用 31 类全局组件：`alert`、`aside`、`autocomplete`、`button`、`card`、`checkbox`、`checkbox-button`、`checkbox-group`、`col`、`container`、`date-picker`、`descriptions`、`descriptions-item`、`dialog`、`empty`、`form`、`form-item`、`header`、`input`、`input-number`、`main`、`menu`、`menu-item`、`option`、`pagination`、`progress`、`row`、`select`、`switch`、`table`、`table-column`、`tag`；
- 使用 `v-loading` 全局指令；
- 直接使用 `ElMessage` 和 `ElMessageBox` 两个服务 API；
- 同步加载 Element Plus CSS。

## 评估结果

本次基线 `pnpm build` 结果为：

| 产物 | 原始大小 | gzip |
| --- | ---: | ---: |
| `vendor-element-plus-*.js` | 773.56 kB | 244.63 kB |
| `vendor-element-plus-*.css` | 357.06 kB | 47.78 kB |
| `index-*.js` | 134.60 kB | 33.44 kB |

当前 `manualChunks` 只依据模块路径命名 chunk。它不会改变 `ElementPlus` 默认插件的注册范围，也不会把同步模板改为按组件导入，因此仅修改该函数不能减少 `vendor-element-plus` 的实际模块内容；改名或拆分 CSS 也不能解决 JavaScript 体积来源。

## 决策

本期不修改 `src/main.js`，不引入按需加载插件，也不把页面改成动态导入。保留现有全局注册方式，新增专项测试锁定：

1. 全局注册、Element Plus CSS、`v-loading`、`ElMessage` 和 `ElMessageBox` 的入口合同；
2. 当前模板使用的组件集合；
3. Vite 的 `dist` 输出和 `vendor-element-plus` 分类合同。

真正的按需加载需要在允许修改入口时，改为明确的组件/指令注册或采用已验证的自动导入插件，并对登录首屏、每个视图切换、对话框、表格加载态和 Electron 22 打包运行做回归验证。本期不在缺少该授权和验证条件时强行实施。

## 回滚与后续门槛

本期只有新增评估测试和本文档，删除两者即可回滚；没有改动入口、服务端、数据库或依赖声明。后续若要实施按需加载，必须先单独授权修改入口/依赖，并以构建产物实际下降、模板行为回归、登录首屏可用和 Electron 22 包运行作为门槛。
