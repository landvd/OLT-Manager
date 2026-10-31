<template>
  <section>
    <div class="page-head"><div><h1>系统更新</h1></div></div>
    <el-card v-if="autoUpdate.supported" shadow="never" class="content-card" style="margin-bottom: 16px">
      <template #header>启动自动更新</template>
      <div class="toolbar">
        <el-input v-model="autoUpdate.baseUrl" placeholder="更新服务器地址，例如 http://192.168.1.10:8089；留空表示关闭" style="max-width: 460px" />
        <el-button type="primary" :loading="autoUpdate.saving" @click="saveAutoUpdate">保存</el-button>
        <el-button :loading="autoUpdate.testing" :disabled="!autoUpdate.baseUrl" @click="testAutoUpdate">测试连接</el-button>
      </div>
      <div class="muted-hint" style="margin-top: 12px">每次启动检查一次，服务器版本更高就自动下载、校验签名、更新并重启；连不上时照常启动。新版本启动失败会自动恢复旧版本并跳过该版本。</div>
      <el-alert v-if="autoUpdate.testResult" :title="autoUpdate.testResult" :type="autoUpdate.testFailed ? 'error' : 'success'" :closable="false" show-icon style="margin-top: 12px" />
      <el-alert v-if="autoUpdate.lastResult" :title="`最近一次（${autoUpdate.lastResult.at}）：${autoUpdate.lastResult.message}`" :type="autoUpdate.lastResult.ok ? 'info' : 'warning'" :closable="false" show-icon style="margin-top: 12px" />
    </el-card>
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
import { onMounted, reactive } from "vue";
import { ElMessage } from "element-plus/es/components/message/index.mjs";
import { ElMessageBox } from "element-plus/es/components/message-box/index.mjs";
import { useAppContext } from "../app-context.js";

// 系统更新。页面专属状态与操作在本组件内维护，跨页面共享部分来自 App.vue 上下文。
export default {
  name: "SystemUpdateView",
  setup() {
    const ctx = useAppContext();
    const { state } = ctx;
    const autoUpdate = reactive({ supported: false, baseUrl: "", lastResult: null, saving: false, testing: false, testResult: "", testFailed: false });

    onMounted(async () => {
      if (!window.oltManagerDesktop?.update?.autoRead) return;
      const settings = await window.oltManagerDesktop.update.autoRead();
      Object.assign(autoUpdate, { supported: true, baseUrl: settings.baseUrl, lastResult: settings.lastResult });
    });

    async function saveAutoUpdate() {
      autoUpdate.saving = true;
      try {
        const settings = await window.oltManagerDesktop.update.autoSave({ baseUrl: autoUpdate.baseUrl });
        autoUpdate.baseUrl = settings.baseUrl;
        ElMessage.success(settings.baseUrl ? "已保存，下次启动时检查更新。" : "已关闭启动自动更新。");
      } catch (error) {
        ElMessage.error(error.message || "保存失败。");
      } finally {
        autoUpdate.saving = false;
      }
    }

    async function testAutoUpdate() {
      autoUpdate.testing = true;
      autoUpdate.testResult = "";
      try {
        const result = await window.oltManagerDesktop.update.autoTest({ baseUrl: autoUpdate.baseUrl });
        autoUpdate.testFailed = false;
        autoUpdate.testResult = result.available ? `连接正常，发现新版本 v${result.version}，下次启动时自动更新。` : `连接正常：${result.reason}`;
      } catch (error) {
        autoUpdate.testFailed = true;
        autoUpdate.testResult = `连接失败：${error.message || error}`;
      } finally {
        autoUpdate.testing = false;
      }
    }

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
        await ElMessageBox.alert("更新文件已校验，程序将关闭并完成更新，更新完成后会自动重新打开。", "准备更新", { type: "success", confirmButtonText: "确定" });
      } catch (error) {
        state.update.error = error.message || "安装更新失败。";
        ElMessage.error(state.update.error);
      } finally {
        state.update.installing = false;
      }
    }

    return { ...ctx, autoUpdate, saveAutoUpdate, testAutoUpdate, selectManualUpdate, installManualUpdate };
  }
};
</script>
