<template>
  <el-dialog
    v-model="state.projectLoading.visible"
    width="420px"
    class="project-loading-dialog"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    :show-close="false"
  >
    <div class="project-loading-box">
      <div class="project-loading-icon">
        <span></span>
      </div>
      <div class="project-loading-copy">
        <strong>{{ state.projectLoading.title }}</strong>
        <p>{{ state.projectLoading.message }}</p>
      </div>
      <el-progress
        :percentage="state.projectLoading.percent"
        :stroke-width="10"
        :show-text="false"
        status="success"
      />
      <div class="project-loading-foot">
        <span>{{ state.projectLoading.percent }}%</span>
        <span>{{ state.projectLoading.step }}</span>
      </div>
    </div>
  </el-dialog>
</template>

<script>
import { useAppContext } from "../app-context.js";

// 专线项目加载进度。状态与操作仍由 App.vue 统一提供，后续逐步迁入本组件。
export default {
  name: "ProjectLoadingDialog",
  setup() {
    return useAppContext();
  }
};
</script>
