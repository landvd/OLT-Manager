<template>
  <section>
    <div class="page-head"><div><h1>备份还原</h1></div></div>
    <el-card shadow="never" class="content-card">
      <el-alert title="还原备份将覆盖当前系统数据，请在确认备份文件安全后操作。" type="warning" :closable="false" show-icon />
      <div class="toolbar" style="margin-top: 18px">
        <el-button type="primary" @click="exportProjectBackup">导出组合备份</el-button>
        <el-button type="danger" @click="triggerProjectRestore">导入并还原</el-button>
        <input id="project-backup-input" type="file" accept=".json,.oltbackup,.sqlite,.sqlite.enc,application/vnd.sqlite3,application/vnd.olt-manager.encrypted-backup" hidden @change="restoreProjectBackup" />
      </div>
    </el-card>
  </section>
</template>

<script>
import { useAppContext } from "../app-context.js";

// 备份还原。状态与操作仍由 App.vue 统一提供，后续逐步迁入本组件。
export default {
  name: "BackupRestoreView",
  setup() {
    return useAppContext();
  }
};
</script>
