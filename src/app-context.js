import { inject } from "vue";

export const APP_CONTEXT_KEY = Symbol("olt-manager-app-context");

// 拆分过渡期：页面与对话框组件共享 App.vue setup() 返回的状态和操作。
// 迁移某个页面的逻辑时，把相关状态移入该组件或独立 composable，再从上下文中删除。
export function useAppContext() {
  const context = inject(APP_CONTEXT_KEY, null);
  if (!context) throw new Error("useAppContext 必须在 App.vue 提供的上下文内使用。");
  return context;
}
