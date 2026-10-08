# ADR-079：渲染端拆分为单文件组件

## 状态

已接受（2026-10-08）。第 1、2 阶段已完成，第 3 阶段逐页进行。

## 背景

渲染端原先全部写在 `src/main.js`（约 7800 行）：一个 `App` 对象带约 3400 行字符串模板和约 4200 行 `setup()`，并从 `vue/dist/vue.esm-bundler.js` 引入带运行时编译器的 Vue。问题：

- 每次启动都在浏览器里编译整段模板，`vendor-vue` 需要打包编译器（约 180 KB）；
- 模板没有编辑器高亮和静态检查，十几个页面和对话框挤在同一文件，改一处容易误伤别处；
- 无法按页面分包或按需加载。

## 决策

分三个阶段迁移，每阶段都保持行为不变并单独验证：

1. **根组件 SFC 化**：`App` 原样迁入 `src/App.vue`，`main.js` 只保留启动、Element Plus 组件注册和全局样式；改用不带编译器的 `vue` 运行时，模板在构建期由 `@vitejs/plugin-vue` 预编译。
2. **模板按页面拆分**：13 个页面拆为 `src/views/*View.vue`，12 个对话框拆为 `src/dialogs/*Dialog.vue`，模板内容不改。`App.vue` 的 `setup()` 把原返回对象通过 `provide(APP_CONTEXT_KEY)` 共享，子组件 `setup()` 直接返回 `useAppContext()`，因此模板绑定、`v-model` 赋值和字符串模板引用（如 `ref="terminalHost"`）都落在同一组响应式对象上。
3. **逻辑逐页迁出**：把只被某个页面使用的状态和函数从 `App.vue` 移入对应组件或 `src/composables/`，并从共享上下文删除；跨页面共享的状态（当前 OLT、认证、视图切换等）留在根组件。

## 后果

- `vendor-vue` 约 180 KB → 84 KB（gzip 67 KB → 33 KB），首屏不再运行时编译模板。
- 共享上下文是过渡方案：子组件目前仍能访问全部状态，依赖关系不显式。第 3 阶段每迁出一页，该页的依赖就变得显式。
- 源码断言类测试通过 `tests/renderer-source.mjs` 读取 `main.js` 加全部 `.vue` 文件；`scripts/check-version.mjs` 和增量包 `dist` 新鲜度检查同步覆盖 `.vue` 文件。
