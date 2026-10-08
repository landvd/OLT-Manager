<template>
  <el-dialog
    v-model="state.onuLoading.visible"
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
        <strong>{{ state.onuLoading.title }}</strong>
        <p>{{ state.onuLoading.message }}</p>
      </div>
      <el-progress
        :percentage="state.onuLoading.percent"
        :stroke-width="10"
        :show-text="false"
        status="success"
      />
      <div class="project-loading-foot">
        <span>{{ state.onuLoading.percent }}%</span>
        <span>{{ state.onuLoading.step }}</span>
      </div>
    </div>
  </el-dialog>
</template>

<script>
import { useAppContext } from "../app-context.js";

// ONU 数据加载进度。状态与操作仍由 App.vue 统一提供，后续逐步迁入本组件。
export default {
  name: "OnuLoadingDialog",
  setup() {
    return useAppContext();
  }
};
</script>
