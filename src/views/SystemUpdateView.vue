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
import { ElMessage } from "element-plus/es/components/message/index.mjs";
import { ElMessageBox } from "element-plus/es/components/message-box/index.mjs";
import { useAppContext } from "../app-context.js";

// 系统更新。页面专属状态与操作在本组件内维护，跨页面共享部分来自 App.vue 上下文。
export default {
  name: "SystemUpdateView",
  setup() {
    const ctx = useAppContext();
    const { state } = ctx;

    function applyManualUpdateResult(settings = {}) {
      Object.assign(state.update, {
        currentVersion: settings.currentVersion || state.version || "0.0.0",
        platform: settings.platform || state.update.platform || "",
        arch: settings.arch || state.update.arch || "",
        available: Boolean(settings.available),
        version: settings.version || "",
        mode: settings.mode || "",
        releaseNotes: settings.releaseNotes || "",
        error: ""
      });
    }

    async function selectManualUpdate() {
      if (!window.oltManagerDesktop?.update) return;
      state.update.selecting = true;
      state.update.error = "";
      try {
        const result = await window.oltManagerDesktop.update.chooseManual();
        if (result.cancelled) return;
        applyManualUpdateResult(result);
        if (result.available) {
          ElMessage.success(`增量包已校验，请确认安装 v${result.version}。`);
        } else {
          const reason = result.reason || "该增量包不适用于当前版本，或已经是最新版本。";
          state.update.error = reason;
          ElMessage.warning(reason);
        }
      } catch (error) {
        state.update.error = error.message || "手动增量包校验失败。";
        ElMessage.error(state.update.error);
      } finally {
        state.update.selecting = false;
      }
    }

    async function installManualUpdate() {
      if (!window.oltManagerDesktop?.update || state.update.installing) return;
      state.update.installing = true;
      try {
        const result = await window.oltManagerDesktop.update.installManual();
        if (!result.restarting) {
          state.update.available = false;
          ElMessage.info("没有可安装的更新。" );
          return;
        }
        await ElMessageBox.alert("更新文件已校验，程序将关闭并完成更新。更新完成后请重新打开 OLT Manager。", "准备更新", { type: "success", confirmButtonText: "确定" });
      } catch (error) {
        state.update.error = error.message || "安装更新失败。";
        ElMessage.error(state.update.error);
      } finally {
        state.update.installing = false;
      }
    }

    return { ...ctx, selectManualUpdate, installManualUpdate };
  }
};
</script>
