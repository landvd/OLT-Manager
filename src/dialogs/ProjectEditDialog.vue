<template>
  <el-dialog
    v-model="state.projectDialog.visible"
    :title="state.projectDialog.form.id ? '编辑项目' : '新增项目'"
    width="560px"
    destroy-on-close
  >
    <el-form label-width="108px" class="project-form">
      <el-form-item label="项目名称" required>
        <el-input v-model="state.projectDialog.form.name" maxlength="80" show-word-limit />
      </el-form-item>
      <el-form-item label="项目 VLAN" required>
        <el-input-number v-model="state.projectDialog.form.vlan" :min="1" :max="4094" controls-position="right" />
      </el-form-item>
      <el-form-item label="项目地址">
        <el-input v-model="state.projectDialog.form.address" maxlength="160" show-word-limit />
      </el-form-item>
      <el-form-item label="联系人姓名">
        <el-input v-model="state.projectDialog.form.contactName" maxlength="40" />
      </el-form-item>
      <el-form-item label="联系人电话">
        <el-input v-model="state.projectDialog.form.contactPhone" maxlength="40" />
      </el-form-item>
      <el-form-item label="联系人备注">
        <el-input v-model="state.projectDialog.form.contactNote" type="textarea" :rows="3" maxlength="240" show-word-limit />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="state.projectDialog.visible = false">取消</el-button>
      <el-button type="primary" :loading="state.projectDialog.loading" @click="saveProject">保存</el-button>
    </template>
  </el-dialog>
</template>

<script>
import { useAppContext } from "../app-context.js";

// 新增/编辑专线项目。状态与操作仍由 App.vue 统一提供，后续逐步迁入本组件。
export default {
  name: "ProjectEditDialog",
  setup() {
    return useAppContext();
  }
};
</script>
