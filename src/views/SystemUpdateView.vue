<template>
  <section>
    <div class="page-head"><div><h1>系统更新</h1></div></div>
    <el-card shadow="never" class="content-card">
      <el-alert title="支持直接选择下载的 ZIP 增量更新包（免解压直接安装），或选择已解压目录中的 latest.json 清单。系统将自动进行 SHA-256 完整性与版本基线校验。" type="info" :closable="false" show-icon />
      <div class="toolbar" style="margin-top: 18px">
        <el-button type="primary" :loading="state.update.selecting" @click="selectManualUpdate">选择增量包 (.zip 或 latest.json)</el-button>
        <el-button v-if="state.update.available" type="success" :loading="state.update.installing" @click="installManualUpdate">立即安装并重启 (v{{ state.update.version }})</el-button>
      </div>
      <el-alert v-if="state.update.available" :title="'发现 v' + state.update.version + ' 更新（' + (state.update.mode || 'full') + '）' + (state.update.packageName ? ' · ' + state.update.packageName : '')" :description="state.update.releaseNotes || '有可用更新。'" type="success" :closable="false" show-icon style="margin-top: 16px;" />
      <el-alert v-if="state.update.error" :title="state.update.error" type="error" :closable="false" show-icon style="margin-top: 16px;" />
      <div class="muted-hint" style="margin-top: 12px">当前版本：{{ state.update.currentVersion || state.version }} · 手动更新只替换清单中的程序文件，绝对不覆盖用户数据与 SQLite 数据库。</div>
    </el-card>
  </section>
</template>

<script>
import { useAppContext } from "../app-context.js";

// 系统更新。状态与操作仍由 App.vue 统一提供，后续逐步迁入本组件。
export default {
  name: "SystemUpdateView",
  setup() {
    return useAppContext();
  }
};
</script>
