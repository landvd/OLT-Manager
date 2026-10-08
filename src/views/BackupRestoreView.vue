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
import { downloadBlob } from "../renderer-services.js";
import { ElMessage } from "element-plus/es/components/message/index.mjs";
import { ElMessageBox } from "element-plus/es/components/message-box/index.mjs";
import { detectBackupFormat } from "../backup-format.mjs";
import { clearEncryptedBackupPasswords, isEncryptedBackupFile, validateEncryptedBackupPassword } from "../backup-view-state.mjs";
import { useAppContext } from "../app-context.js";

// 备份还原。页面专属状态与操作在本组件内维护，跨页面共享部分来自 App.vue 上下文。
export default {
  name: "BackupRestoreView",
  setup() {
    const ctx = useAppContext();
    const { backupApi, state } = ctx;

    async function exportProjectBackup() {
      try {
        if (window.oltManagerDesktop?.feishuBackup) {
          const bytes = await window.oltManagerDesktop.feishuBackup.export();
          downloadBlob(new Blob([bytes], { type: "application/json" }), `olt-manager-combined-backup-${new Date().toISOString().slice(0, 10)}.oltbackup.json`);
          ElMessage.success("OLT 与 Feishu 组合备份已导出");
          return;
        }
        downloadBlob(await backupApi.exportSqlite(), `olt-manager-backup-${new Date().toISOString().slice(0, 10)}.sqlite`);
        ElMessage.success("完整项目备份已导出");
      } catch (error) { ElMessage.error(error.message); }
    }

    function triggerProjectRestore() { document.getElementById("project-backup-input")?.click(); }

    async function restoreProjectBackup(event) {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const format = detectBackupFormat({ name: file.name, type: file.type, bytes });
        const isEncrypted = isEncryptedBackupFile(file);
        if (format === "unknown" && !isEncrypted) throw new Error("无法识别备份文件，请选择 WEB 导出的 .sqlite、.sqlite.enc 或桌面端导出的 .oltbackup.json。");
        if (isEncrypted) {
          const password = state.encryptedBackup.password;
          if (!validateEncryptedBackupPassword(password).valid) throw new Error("请输入至少 8 位的备份主密码");
          state.encryptedBackup.importing = true;
          try {
            await ElMessageBox.confirm("还原会覆盖当前本机 SQLite 数据，且无法撤销。确认继续？", "确认还原加密 SQLite 备份", { type: "warning", confirmButtonText: "确认还原" });
            await backupApi.restoreEncrypted(file, password);
            ElMessage.success("加密 SQLite 备份还原成功，正在刷新页面");
            window.setTimeout(() => window.location.reload(), 500);
          } catch (error) {
            if (error !== "cancel" && error !== "close") ElMessage.error(error.message || "加密备份还原失败");
          } finally {
            state.encryptedBackup = clearEncryptedBackupPasswords(state.encryptedBackup);
            state.encryptedBackup.importing = false;
          }
          return;
        }
        const isCombined = format === "combined-json";
        const title = isCombined ? "确认还原组合备份" : "确认还原 SQLite 备份";
        const message = isCombined
          ? "还原会覆盖当前本机 SQLite、Feishu 加密状态和授权配置，且无法撤销。确认继续？"
          : "还原会覆盖当前本机 SQLite 数据，且无法撤销。Feishu 加密状态不会随 WEB 的 SQLite 文件迁移。确认继续？";
        await ElMessageBox.confirm(message, title, { type: "warning", confirmButtonText: "确认还原" });
        if (isCombined) {
          if (!window.oltManagerDesktop?.feishuBackup) {
            throw new Error("WEB 模式不能还原桌面组合备份，请在桌面程序中导入。");
          }
          const result = await window.oltManagerDesktop.feishuBackup.restore({ bytes, confirmed: true });
          ElMessage.success(result.warnings?.join("；") || "组合备份还原成功，正在刷新页面");
          window.setTimeout(() => window.location.reload(), 500);
          return;
        }
        if (window.oltManagerDesktop?.databaseBackup) {
          const result = await window.oltManagerDesktop.databaseBackup.restore({ bytes, confirmed: true });
          ElMessage.success(result.warnings?.join("；") || "SQLite 数据库还原成功，正在刷新页面");
          window.setTimeout(() => window.location.reload(), 500);
          return;
        }
        await backupApi.restoreSqlite(file);
        ElMessage.success("还原成功，正在刷新页面");
        window.setTimeout(() => window.location.reload(), 500);
      } catch (error) {
        if (error !== "cancel") ElMessage.error(error.message || "备份还原失败");
      }
    }

    return { ...ctx, exportProjectBackup, triggerProjectRestore, restoreProjectBackup };
  }
};
</script>
