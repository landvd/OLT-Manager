<template>
  <section>
    <div class="page-head"><div><h1>系统设置</h1></div></div>
    <el-card shadow="never" class="content-card settings-card">
      <template #header>本机登录保护</template>
      <div class="settings-row">
        <div class="settings-text">
          <strong>{{ state.authRequired ? "已开启：打开管理页面需要输入本地密码" : "已关闭：本机打开管理页面无需密码" }}</strong>
          <p class="muted">关闭后仅本机访问免密码，局域网访问仍强制要求密码。现场正式使用建议保持开启。</p>
        </div>
        <!-- 不用 v-model：确认框取消时开关状态保持不变 -->
        <el-switch
          :model-value="state.authRequired"
          :loading="state.authToggleLoading"
          active-text="开启"
          inactive-text="关闭"
          @change="toggleAuthRequirement"
        />
      </div>
    </el-card>
    <el-card shadow="never" class="content-card settings-card">
      <template #header>版本信息</template>
      <div class="settings-row">
        <div class="settings-text">
          <strong>OLT 管理系统 v{{ state.version || "0.0.0" }}</strong>
          <p class="muted">升级请使用“系统更新”页选择增量包。</p>
        </div>
        <el-button @click="setView('systemUpdate')">前往系统更新</el-button>
      </div>
    </el-card>
  </section>
</template>

<script>
import { useAppContext } from "../app-context.js";

// 系统设置：本机登录保护等系统级开关，从顶栏移入此处。
export default {
  name: "SystemSettingsView",
  setup() {
    return useAppContext();
  }
};
</script>
