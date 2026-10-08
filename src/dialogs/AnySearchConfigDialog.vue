<template>
  <el-dialog
    v-model="state.anysearch.dialogVisible"
    title="AnySearch 智能联网搜索配置"
    width="500px"
    destroy-on-close
  >
    <el-form label-position="top" size="small">
      <el-form-item label="AnySearch API Key">
        <el-input
          v-model="state.anysearch.apiKey"
          placeholder="as_sk_..."
          show-password
          clearable
        />
      </el-form-item>
      <div style="font-size: 12px; color: var(--el-text-color-secondary); margin-bottom: 12px; line-height: 1.6;">
        用于 Pi 智能助手排障时通过 AnySearch 在公网查询厂商权威文档、光模块规范与冷门告警代码。系统已内置严格隐私脱敏机制，自动消除私网 IP、手机号与凭据，保障数据安全。
      </div>
    </el-form>
    <template #footer>
      <el-button size="small" @click="state.anysearch.dialogVisible = false">取消</el-button>
      <el-button size="small" type="primary" :loading="state.anysearch.saving" @click="saveAnySearchConfig">保存并生效</el-button>
    </template>
  </el-dialog>
</template>

<script>
import { useAppContext } from "../app-context.js";

// AnySearch 联网搜索配置。状态与操作仍由 App.vue 统一提供，后续逐步迁入本组件。
export default {
  name: "AnySearchConfigDialog",
  setup() {
    return useAppContext();
  }
};
</script>
