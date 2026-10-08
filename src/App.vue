<template>
  <el-config-provider :locale="zhCn">
  <section v-if="!state.authenticated" class="login-shell">
    <el-card class="login-card" shadow="never">
      <div class="login-brand"><span class="brand-mark">OLT</span><div><strong>OLT 管理系统</strong><small>本机只读运维平台</small></div></div>
      <h1>{{ state.authSetupRequired ? "首次设置本地密码" : "登录系统" }}</h1>
      <p class="login-hint">{{ state.authSetupRequired ? "首次使用请设置一个至少 8 位的本地密码。" : "请输入本机管理密码后继续。" }}</p>
      <el-form @submit.prevent="submitAuth">
        <el-form-item>
          <el-input v-model="state.authPassword" type="password" show-password autocomplete="current-password" :placeholder="state.authSetupRequired ? '设置本地密码' : '本地管理密码'" @keyup.enter="submitAuth" />
        </el-form-item>
        <el-button type="primary" native-type="submit" :loading="state.authLoading" class="login-button">{{ state.authSetupRequired ? "设置并进入" : "登录" }}</el-button>
        <p v-if="state.authError" class="login-error">{{ state.authError }}</p>
      </el-form>
    </el-card>
  </section>
  <el-container v-else class="app-shell">
    <el-aside width="232px" class="app-aside">
      <div class="brand">
        <div class="brand-mark">OLT</div>
        <div>
          <strong>OLT 管理系统</strong>
          <span>v{{ state.version || "0.0.0" }}</span>
        </div>
      </div>
      <el-menu :default-active="state.activeView" class="side-menu" @select="setView">
        <div class="side-nav-group-title">监控与查询</div>
        <el-menu-item index="dashboard">首页</el-menu-item>
        <el-menu-item index="install">ONU 安装查询</el-menu-item>
        <el-menu-item index="onus">ONU 数据查询</el-menu-item>
        <div class="side-nav-group-title">设备与台账</div>
        <el-menu-item index="adminOlts">OLT 设备管理</el-menu-item>
        <el-menu-item index="adminPonPorts">ONU 数据管理</el-menu-item>
        <el-menu-item index="resourceManagement">用户资源管理</el-menu-item>
        <el-menu-item index="configTemplates">配置方案管理</el-menu-item>
        <div class="side-nav-group-title">智能外勤对接</div>
        <el-menu-item index="feishuSettings">飞书机器人</el-menu-item>
        <el-menu-item index="adminProjects">专线项目管理</el-menu-item>
        <div class="side-nav-group-title">系统与运维</div>
        <el-menu-item index="wizard">系统配置向导</el-menu-item>
        <el-menu-item index="resourceSchedule">定时任务</el-menu-item>
        <el-menu-item index="backupRestore">备份还原</el-menu-item>
        <el-menu-item index="systemUpdate">系统更新</el-menu-item>
      </el-menu>
    </el-aside>

    <el-container>
      <el-header class="app-header">
        <div v-if="showOltSelector" class="header-left">
          <span class="header-label">当前 OLT</span>
          <el-select v-model="state.selectedOltId" filterable class="olt-select" @change="handleOltChange">
            <el-option v-for="olt in state.olts" :key="olt.id" :label="olt.name" :value="olt.id" />
          </el-select>
        </div>
        <div v-else />
        <div class="header-actions">
          <el-button size="small" type="primary" plain @click="setView('wizard')" title="进入系统配置向导">
            系统配置向导
          </el-button>
          <el-tag v-if="showOltSelector" :type="state.status.reachable ? 'success' : 'warning'" size="large" effect="light">
            {{ state.status.snmpState || "SNMP 检测中" }}
          </el-tag>
          <el-tag :type="state.authRequired ? 'success' : 'danger'" size="large" effect="light">
            {{ state.authRequired ? "密码保护" : "免登录调试" }}
          </el-tag>
          <el-switch v-model="state.authRequired" :loading="state.authToggleLoading" active-text="密码开" inactive-text="免登录" @change="toggleAuthRequirement" />
          <el-button @click="refreshCurrent">刷新</el-button>
        </div>
      </el-header>

      <el-main class="app-main">
        <DashboardView v-if="state.activeView === 'dashboard'" />
        <SetupWizardView v-else-if="state.activeView === 'wizard'" />
        <FeishuSettingsView v-else-if="state.activeView === 'feishuSettings'" />
        <OnuInstallView v-else-if="state.activeView === 'install'" />
        <OnuQueryView v-else-if="state.activeView === 'onus'" />
        <OltAdminView v-else-if="state.activeView === 'adminOlts'" />
        <ResourceManagementView v-else-if="state.activeView === 'resourceManagement'" />
        <BackupRestoreView v-else-if="state.activeView === 'backupRestore'" />
        <SystemUpdateView v-else-if="state.activeView === 'systemUpdate'" />
        <ConfigTemplatesView v-else-if="state.activeView === 'configTemplates'" />
        <ProjectAdminView v-else-if="state.activeView === 'adminProjects'" />
        <PonPortAdminView v-else-if="state.activeView === 'adminPonPorts'" />
        <ResourceScheduleView v-else-if="state.activeView === 'resourceSchedule'" />
        <OnuConfigDialog />
        <OnuDetailDialog />
        <ConfigPlanDialog />
        <TerminalDialog />
        <AnySearchConfigDialog />
        <ProjectEditDialog />
        <ProjectLoadingDialog />
        <OnuLoadingDialog />
        <PonImportPreviewDialog />
        <!-- 双端冲突自主智能裁决与对齐明细对话框 -->
        <MergedConflictDialog />
        <!-- 核心交互：OLT 重点关注 PON 业务端口预警与弱光排查弹窗 -->
        <OltAlertsDialog />
        <!-- 弱光用户详细资料与光功率弹窗 (大屏完整展示门牌地址) -->
        <WeakUsersDialog />
      </el-main>
    </el-container>
  </el-container>
  </el-config-provider>
</template>

<script>
import { computed, nextTick, onBeforeUnmount, onMounted, provide, reactive, ref } from "vue";
import { APP_CONTEXT_KEY } from "./app-context.js";
import { downloadBlob, localAuthClient, projectApi } from "./renderer-services.js";
import { createInitialAppState } from "./app-state.mjs";
import DashboardView from "./views/DashboardView.vue";
import SetupWizardView from "./views/SetupWizardView.vue";
import FeishuSettingsView from "./views/FeishuSettingsView.vue";
import OnuInstallView from "./views/OnuInstallView.vue";
import OnuQueryView from "./views/OnuQueryView.vue";
import OltAdminView from "./views/OltAdminView.vue";
import ResourceManagementView from "./views/ResourceManagementView.vue";
import BackupRestoreView from "./views/BackupRestoreView.vue";
import SystemUpdateView from "./views/SystemUpdateView.vue";
import ConfigTemplatesView from "./views/ConfigTemplatesView.vue";
import ProjectAdminView from "./views/ProjectAdminView.vue";
import PonPortAdminView from "./views/PonPortAdminView.vue";
import ResourceScheduleView from "./views/ResourceScheduleView.vue";
import OnuConfigDialog from "./dialogs/OnuConfigDialog.vue";
import OnuDetailDialog from "./dialogs/OnuDetailDialog.vue";
import ConfigPlanDialog from "./dialogs/ConfigPlanDialog.vue";
import TerminalDialog from "./dialogs/TerminalDialog.vue";
import AnySearchConfigDialog from "./dialogs/AnySearchConfigDialog.vue";
import ProjectEditDialog from "./dialogs/ProjectEditDialog.vue";
import ProjectLoadingDialog from "./dialogs/ProjectLoadingDialog.vue";
import OnuLoadingDialog from "./dialogs/OnuLoadingDialog.vue";
import PonImportPreviewDialog from "./dialogs/PonImportPreviewDialog.vue";
import MergedConflictDialog from "./dialogs/MergedConflictDialog.vue";
import OltAlertsDialog from "./dialogs/OltAlertsDialog.vue";
import WeakUsersDialog from "./dialogs/WeakUsersDialog.vue";
import zhCn from "element-plus/es/locale/lang/zh-cn.mjs";
import { ElMessage } from "element-plus/es/components/message/index.mjs";
import { ElMessageBox } from "element-plus/es/components/message-box/index.mjs";
import { terminalPasteCharDelayMs, terminalPasteFrames, terminalPasteLineDelayMs, terminalPasteNeedsExtraEnter } from "./terminal-paste.mjs";
import {
  deriveManagementHostFromResourceIp,
  inferOltVendorAndProfile,
  isSystemFullyConfigured
} from "./setup-wizard.mjs";
import { defaultProfileForModel, defaultProfileForVendor, profileById, profilesForVendor } from "./device-profiles.mjs";
import { createPonPortFilterState } from "./pon-admin-filter.mjs";
import { onuCoordinateLabel, ponCoordinateKey } from "./pon-coordinate.mjs";
import { createLocalAuthApi } from "./local-auth-api.mjs";
import { createOnuListState, findPonAddressMatch } from "./onu-list-state.mjs";
import { opticalValue, onuMgmtCli, rxHistoryPoints, servicePortCli } from "./onu-detail-view-state.mjs";
import { replaceProjectOnuRows, selectProjectFromList } from "./project-onu-state.mjs";
import { createResourceManagementApi } from "./resource-management-api.mjs";
import { createResourceSyncApi } from "./resource-sync-api.mjs";
import { createOssResourceApi } from "./oss-resource-api.mjs";
import { createPonAdminApi } from "./pon-admin-api.mjs";
import { createBackupApi } from "./backup-api.mjs";
import { loadXlsx } from "./xlsx-runtime.mjs";
import { loadXtermRuntime } from "./xterm-runtime.mjs";
import { createOnuApi } from "./onu-api.mjs";
import { getConflictGuide } from "./merged-conflict-guide.mjs";
import { createOltAdminApi } from "./olt-admin-api.mjs";
import {
  ossLoginProjection,
  ossResourceConfigProjection,
  resourceManagementConfigProjection
} from "./resource-page-state.mjs";
import {
  countOnuGroups,
  filterStorageKey,
  phaseInfo,
  ponRowsForExport,
  rxPowerInfo,
  rxPowerHint,
  inspectPonExcelImport,
  diagnoseOfflineCause,
  analyzeHistoricalOpticalSeries,
  buildOnuConfigTerminalCommands
} from "./main-view-state.mjs";
import {
  resourceScheduleLastResult,
  resourceScheduleOperationText,
  resourceScheduleRepeatText,
  resourceScheduleStatusText,
  resourceScheduleStatusType
} from "./resource-schedule-view-state.mjs";
import {
  formatDate,
  mergedOnuSyncPercent,
  mergedOnuSyncPhaseText,
  mergedOnuSyncStatusText
} from "./merged-onu-view-state.mjs";

export default {
  name: "App",
  components: {
    DashboardView,
    SetupWizardView,
    FeishuSettingsView,
    OnuInstallView,
    OnuQueryView,
    OltAdminView,
    ResourceManagementView,
    BackupRestoreView,
    SystemUpdateView,
    ConfigTemplatesView,
    ProjectAdminView,
    PonPortAdminView,
    ResourceScheduleView,
    OnuConfigDialog,
    OnuDetailDialog,
    ConfigPlanDialog,
    TerminalDialog,
    AnySearchConfigDialog,
    ProjectEditDialog,
    ProjectLoadingDialog,
    OnuLoadingDialog,
    PonImportPreviewDialog,
    MergedConflictDialog,
    OltAlertsDialog,
    WeakUsersDialog
  },
  setup() {
    const terminalHost = ref(null);
    let terminalInstance;
    let terminalFitAddon;
    let terminalUnsubscribe;
    let terminalKeydownTarget;
    let terminalKeydownHandler;
    let terminalPasteTarget;
    let terminalPasteHandler;
    let terminalPasteRun = 0;
    let terminalResizeObserver;
    let terminalFitFrame = 0;
    let terminalLastSize = "";
    let projectLoadingTimer;
    let onuLoadingTimer;
    let feishuStatusTimer;
    let feishuStatusRefreshing = false;
    const state = reactive({ ...createInitialAppState(), ...createOnuListState() });
    state.terminal.pasteMode = readTerminalPasteMode();

    const selectedOlt = computed(() => state.olts.find((olt) => olt.id === state.selectedOltId) || state.olts[0] || {});
    let mergedOnuSyncTimer = null;
    const showOltSelector = computed(() => !["dashboard", "install"].includes(state.activeView));
    const activePlanOlt = computed(() => {
      const row = state.configPlan.row;
      if (!row) return selectedOlt.value;
      return state.olts.find((o) => o.id === row.oltId || o.host === row.oltHost) || selectedOlt.value;
    });
    const currentPonPorts = computed(() => state.ponPorts.filter((port) => !selectedOlt.value.host || port.oltIp === selectedOlt.value.host));
    const ponPortFilterState = createPonPortFilterState();
    const currentConfigTemplates = computed(() => state.configTemplates.filter((template) => {
      const target = activePlanOlt.value;
      if (!target) return false;
      if (Array.isArray(template.deviceProfiles) && template.deviceProfiles.length) {
        return template.deviceProfiles.includes(target.deviceProfile);
      }
      return template.vendor === target.vendor;
    }));
    const currentConfigTemplate = computed(() => currentConfigTemplates.value.find((template) => template.id === state.configPlan.templateId) || currentConfigTemplates.value[0] || {});
    const currentEthPortOptions = computed(() => {
      if (currentConfigTemplate.value.portRules?.allowed?.length) {
        return currentConfigTemplate.value.portRules.allowed;
      }
      const target = activePlanOlt.value || state.configPlan.row || {};
      const vendor = String(currentConfigTemplate.value.vendor || target.vendor || "").toLowerCase();
      const profile = String(target.deviceProfile || (currentConfigTemplate.value.deviceProfiles?.[0]) || "").toLowerCase();
      if (vendor === "huawei" || profile.includes("huawei") || profile.includes("ma5800")) {
        return ["eth 1", "eth 2", "eth 3", "eth 4"];
      }
      if (profile.includes("c600")) {
        return ["eth_0/1", "eth_0/2", "eth_0/3", "eth_0/4", "veip_1"];
      }
      return ["eth_0/1", "eth_0/2", "eth_0/3", "eth_0/4"];
    });
    const defaultEthPortsForTemplate = computed(() => {
      if (currentConfigTemplate.value.portRules?.defaults?.length) {
        return currentConfigTemplate.value.portRules.defaults;
      }
      const defaultPort = currentConfigTemplate.value.defaultParams?.defaultPort;
      if (defaultPort) return [defaultPort];
      const options = currentEthPortOptions.value;
      return options.length ? [options[0]] : ["eth_0/1"];
    });
    const configPlanUnsupportedMessage = computed(() => {
      const target = activePlanOlt.value;
      if (!target?.id || currentConfigTemplates.value.length) return "";
      const profile = profileById(target.deviceProfile);
      const label = profile ? `${profile.vendorLabel} ${profile.model}` : `${target.vendor || ""} ${target.model || ""}`.trim();
      return `${label || "当前设备型号"} 暂未配置可用模板，已阻止生成配置方案。`;
    });
    const onuGroupCounts = computed(() => countOnuGroups(state.onuRows));
    async function api(path, options) {
      const sep = path.includes("?") ? "&" : "?";
      const isGlobalApi = path.startsWith("/api/bootstrap") ||
        path.startsWith("/api/admin/") ||
        path.startsWith("/api/unregistered-onus") ||
        path.startsWith("/api/config-templates");
      const url = isGlobalApi || path.includes("oltId=")
        ? path
        : `${path}${sep}oltId=${encodeURIComponent(state.selectedOltId)}`;
      const response = await localAuthClient.fetch(url, options);
      const data = await response.json();
      if (response.status === 401) {
        localAuthClient.clearToken();
        state.authenticated = false;
        state.authError = data.error || "登录已失效，请重新登录。";
      }
      if (!response.ok) throw new Error(data.message || data.error || "请求失败");
      return data;
    }

    const resourceSyncApi = createResourceSyncApi({ request: api });
    const resourceManagementApi = createResourceManagementApi({ request: api });
    const ossResourceApi = createOssResourceApi({ request: api });
    const ponAdminApi = createPonAdminApi({ fetch: (path, options) => localAuthClient.fetch(path, options) });
    const backupApi = createBackupApi({ fetch: (path, options) => localAuthClient.fetch(path, options) });
    const onuApi = createOnuApi({ request: api });
    const oltAdminApi = createOltAdminApi({ fetch: (path, options) => localAuthClient.fetch(path, options) });
    const localAuthApi = createLocalAuthApi({ fetch: (path, options) => localAuthClient.fetch(path, options) });

    async function initializeAuth() {
      const token = localAuthClient.getToken();
      const data = await localAuthApi.session(token);
      state.authSetupRequired = !data.configured;
      state.authRequired = data.required !== false;
      if (data.authenticated && (data.required === false || localAuthClient.getToken())) state.authenticated = true;
      else localAuthClient.clearToken();
    }

    async function toggleAuthRequirement(nextValue) {
      const enabled = nextValue !== false;
      const previous = state.authRequired;
      if (!enabled) {
        try {
          await ElMessageBox.confirm("关闭后本机管理页面将免密码进入，仅建议在本机调试时使用。局域网监听仍会强制要求密码。", "关闭登录保护", { type: "warning", confirmButtonText: "关闭保护", cancelButtonText: "保留保护" });
        } catch {
          state.authRequired = previous;
          return;
        }
      }
      state.authToggleLoading = true;
      try {
        const token = localAuthClient.getToken();
        const data = await localAuthApi.updateRequirement(enabled, token);
        state.authRequired = data.required !== false;
        localAuthClient.clearToken();
        if (state.authRequired) {
          state.authenticated = false;
          state.authError = "登录保护已开启，请重新输入本地管理密码。";
        } else {
          ElMessage.warning("已关闭登录保护，仅建议在本机调试时使用。");
        }
      } catch (error) {
        state.authRequired = previous;
        ElMessage.error(error.message || "登录保护设置失败。");
      } finally {
        state.authToggleLoading = false;
      }
    }

    async function submitAuth() {
      state.authLoading = true;
      state.authError = "";
      try {
        const data = await localAuthApi.authenticate({ setupRequired: state.authSetupRequired, password: state.authPassword });
        localAuthClient.setToken(data.token);
        state.authPassword = "";
        state.authenticated = true;
        await loadApplication();
      } catch (error) {
        state.authError = error.message || "登录失败。";
      } finally {
        state.authLoading = false;
      }
    }

    async function loadApplication() {
      const bootstrap = await localAuthApi.bootstrap();
      state.version = bootstrap.version;
      state.update.currentVersion = bootstrap.version;
      state.olts = bootstrap.olts || [];
      state.ponPorts = bootstrap.ponPorts || [];
      ponPortFilterState.reset(state.ponPorts);
      state.selectedOltId = state.olts[0]?.id || "";
      restoreFilters();
      await Promise.all([loadConfigTemplates(), loadTemplateVariables(), loadDashboard()]);
      state.projects = await fetchProjects();
      await syncSelectedProjectAfterProjectListChange();
      void loadAnySearchConfig();
    }

    function stopFeishuStatusPolling() {
      if (!feishuStatusTimer) return;
      clearInterval(feishuStatusTimer);
      feishuStatusTimer = undefined;
    }

    function startFeishuStatusPolling() {
      stopFeishuStatusPolling();
      feishuStatusTimer = setInterval(() => {
        if (state.activeView !== "feishuSettings") {
          stopFeishuStatusPolling();
          return;
        }
        void refreshFeishuConnection();
      }, 2000);
    }

    function applyFeishuSettings(settings, { syncForm = false, clearSecrets = false } = {}) {
      const next = {
        enabled: settings.enabled,
        configured: settings.configured,
        credentialConfigured: settings.credentialConfigured,
        languageApiKeyConfigured: settings.languageApiKeyConfigured,
        languageProviderReady: settings.languageProviderReady,
        piAgentLanguageApiKeyConfigured: settings.piAgentLanguageApiKeyConfigured,
        connection: settings.connection || { state: "stopped", lastError: null },
        error: settings.connection?.lastError || ""
      };
      if (syncForm) {
        Object.assign(next, {
          appId: settings.appId || "",
          appSecret: settings.appSecret || state.feishu.appSecret || "",
          languageProvider: settings.languageProvider || "production",
          languageProviderName: settings.languageProviderName || "",
          languageEndpoint: settings.languageEndpoint || "",
          languageModel: settings.languageModel || "",
          languageFormat: settings.languageFormat || "chat-completions",
          languageApiKey: settings.languageApiKey || state.feishu.languageApiKey || "",
          piAgentLanguageProviderName: settings.piAgentLanguageProviderName || "",
          piAgentLanguageEndpoint: settings.piAgentLanguageEndpoint || "",
          piAgentLanguageModel: settings.piAgentLanguageModel || "",
          piAgentLanguageFormat: settings.piAgentLanguageFormat || "chat-completions",
          piAgentLanguageApiKey: settings.piAgentLanguageApiKey || state.feishu.piAgentLanguageApiKey || ""
        });
      }
      if (clearSecrets) {
        Object.assign(next, { appSecret: "", languageApiKey: "", piAgentLanguageApiKey: "" });
      }
      Object.assign(state.feishu, next);
    }

    async function refreshFeishuConnection({ syncForm = false } = {}) {
      if (!window.oltManagerDesktop?.feishu) return;
      if (feishuStatusRefreshing) return;
      feishuStatusRefreshing = true;
      try {
        const settings = await window.oltManagerDesktop.feishu.read();
        applyFeishuSettings(settings, { syncForm });
      } catch (error) {
        state.feishu.error = error.message || "飞书机器人状态读取失败";
      } finally {
        feishuStatusRefreshing = false;
      }
    }

    async function loadFeishuSettings() {
      void loadAnySearchConfig();
      if (!window.oltManagerDesktop?.feishu) {
        try {
          const res = await fetch("/api/admin/bot-ai/config");
          const data = await res.json();
          if (data && data.ok) {
            if (data.feishuAppId) state.feishu.appId = data.feishuAppId;
            if (data.feishuAppSecret) state.feishu.appSecret = data.feishuAppSecret;
            if (data.anysearchApiKey) state.anysearch.apiKey = data.anysearchApiKey;
            if (data.piProviderName) state.feishu.piAgentLanguageProviderName = data.piProviderName;
            if (data.piEndpoint) state.feishu.piAgentLanguageEndpoint = data.piEndpoint;
            if (data.piModel) state.feishu.piAgentLanguageModel = data.piModel;
            if (data.piApiKey) state.feishu.piAgentLanguageApiKey = data.piApiKey;
            if (data.jevProviderName) state.feishu.languageProviderName = data.jevProviderName;
            if (data.jevEndpoint) state.feishu.languageEndpoint = data.jevEndpoint;
            if (data.jevModel) state.feishu.languageModel = data.jevModel;
            if (data.jevApiKey) state.feishu.languageApiKey = data.jevApiKey;
          }
        } catch (error) {
          console.warn("[web] 读取 bot-ai 配置失败:", error);
        }
        return;
      }
      try {
        await refreshFeishuConnection({ syncForm: true });
      } catch (error) {
        state.feishu.error = error.message || "飞书机器人状态读取失败";
      }
    }

    async function saveFeishuCredentials() {
      state.feishu.credentialSaving = true;
      try {
        const settings = await window.oltManagerDesktop.feishu.configureCredentials({
          appId: state.feishu.appId,
          appSecret: state.feishu.appSecret
        });
        applyFeishuSettings(settings, { syncForm: true, clearSecrets: true });
        ElMessage.success("飞书APP ID和APP SECRET已加密保存");
      } catch (error) {
        state.feishu.error = error.message || "飞书机器人凭据保存失败";
        ElMessage.error(state.feishu.error);
      } finally {
        state.feishu.credentialSaving = false;
      }
    }

    async function saveLanguageProvider() {
      state.feishu.languageSaving = true;
      try {
        const settings = await window.oltManagerDesktop.feishu.configureLanguageProvider({
          languageProviderName: state.feishu.languageProviderName,
          languageEndpoint: state.feishu.languageEndpoint,
          languageModel: state.feishu.languageModel,
          languageFormat: state.feishu.languageFormat,
          languageApiKey: state.feishu.languageApiKey
        });
        applyFeishuSettings(settings, { syncForm: true, clearSecrets: true });
        ElMessage.success("Jev 路由配置已加密保存");
      } catch (error) {
        state.feishu.error = error.message || "大模型配置保存失败";
        ElMessage.error(state.feishu.error);
      } finally {
        state.feishu.languageSaving = false;
      }
    }

    async function savePiAgentLanguage() {
      state.feishu.piAgentLanguageSaving = true;
      try {
        const settings = await window.oltManagerDesktop.feishu.configurePiAgentLanguage({
          piAgentLanguageProviderName: state.feishu.piAgentLanguageProviderName,
          piAgentLanguageEndpoint: state.feishu.piAgentLanguageEndpoint,
          piAgentLanguageModel: state.feishu.piAgentLanguageModel,
          piAgentLanguageFormat: state.feishu.piAgentLanguageFormat,
          piAgentLanguageApiKey: state.feishu.piAgentLanguageApiKey
        });
        applyFeishuSettings(settings, { syncForm: true, clearSecrets: true });
        ElMessage.success("Pi Agent 原大模型配置已加密保存");
      } catch (error) {
        state.feishu.error = error.message || "Pi Agent 原大模型配置保存失败";
        ElMessage.error(state.feishu.error);
      } finally {
        state.feishu.piAgentLanguageSaving = false;
      }
    }


    function saveFilters() {
      localStorage.setItem(filterStorageKey(state.selectedOltId), JSON.stringify(state.filters));
    }

    function restoreFilters() {
      let filters = {};
      try {
        filters = JSON.parse(localStorage.getItem(filterStorageKey(state.selectedOltId)) || "{}");
      } catch {
        filters = {};
      }
      state.filters.search = filters.search || "";
      state.filters.chassis = filters.chassis || "";
      state.filters.slot = filters.slot || "";
      state.filters.pon = filters.pon || "";
    }

    function oltIdByHost(host) {
      return state.olts.find((olt) => olt.host === host)?.id || "";
    }

    async function switchOltForGlobalSearch(oltIp) {
      const nextOltId = oltIdByHost(oltIp);
      if (!nextOltId || nextOltId === state.selectedOltId) return false;
      state.selectedOltId = nextOltId;
      await Promise.all([loadStatus(), loadInstallOnus()]);
      return true;
    }

    function applyAddressSearchToPon() {
      const keyword = state.filters.search.trim().toLowerCase();
      if (!keyword || state.filters.chassis || state.filters.slot || state.filters.pon) return;
      const match = findPonAddressMatch(state.ponPorts, keyword);
      if (!match) return;
      state.filters.chassis = match.chassis || "";
      state.filters.slot = match.board || match.slot || "";
      state.filters.pon = match.pon || "";
      return match;
    }

    async function loadStatus() {
      state.loading.status = true;
      try {
        state.status = await onuApi.status();
      } catch (error) {
        ElMessage.error(error.message);
      } finally {
        state.loading.status = false;
      }
    }

    async function loadInstallOnus() {
      state.loading.install = true;
      try {
        const data = await onuApi.unregistered();
        state.unregisteredRows = data.rows || [];
        state.unregisteredOltSummaries = data.oltSummaries || [];
        state.installMessage = data.message || "";
      } catch (error) {
        state.unregisteredRows = [];
        state.unregisteredOltSummaries = [];
        state.installMessage = error.message;
        ElMessage.error(error.message);
      } finally {
        state.loading.install = false;
      }
    }

    async function loadConfigTemplates(options = {}) {
      try {
        const data = await onuApi.configTemplates();
        const rows = data.rows || [];
        state.configTemplates = rows;
        state.templateEditor.templates = rows;
        if (!state.templateEditor.selectedId && rows.length) {
          selectTemplate(rows[0]);
        }
        syncConfigTemplateSelection();
      } catch (error) {
        state.configTemplates = [];
        ElMessage.error(error.message);
      }
    }

    async function loadTemplateVariables() {
      try {
        const data = await onuApi.configTemplateVariables();
        state.templateEditor.variables = data.rows || [];
      } catch (error) {
        console.error("加载方案变量元数据失败:", error);
      }
    }

    function handleConfigTemplateChange() {
      state.configPlan.result = null;
      state.configPlan.ethPorts = [...defaultEthPortsForTemplate.value];
      if (currentConfigTemplate.value.businessType !== "custom-vlan") state.configPlan.customVlan = undefined;
    }

    const templateContextMenu = reactive({
      visible: false,
      x: 0,
      y: 0,
      selectionStart: 0,
      selectionEnd: 0
    });
    const showVariablePalette = ref(false);

    function selectTemplate(tpl) {
      if (!tpl) return;
      state.templateEditor.selectedId = tpl.id;
      state.templateEditor.form = {
        id: tpl.id,
        name: tpl.name || "",
        vendor: tpl.vendor || "zte",
        deviceProfiles: Array.isArray(tpl.deviceProfiles) ? [...tpl.deviceProfiles] : [],
        businessType: tpl.businessType || "self-operated-internet",
        portMode: tpl.portMode || "single",
        defaultParams: tpl.defaultParams ? { ...tpl.defaultParams } : {},
        commandTemplate: tpl.commandTemplate || "",
        remark: tpl.remark || "",
        isBuiltin: Boolean(tpl.isBuiltin)
      };
      if (tpl.vendor === "huawei") {
        state.templateEditor.testParams.chassis = "0";
        state.templateEditor.testParams.ethPort = "eth1";
      } else {
        state.templateEditor.testParams.chassis = "1";
        state.templateEditor.testParams.ethPort = tpl.deviceProfiles?.includes("zte-c600") ? "veip_1" : "eth_0/1";
      }
    }

    function closeTemplateContextMenu() {
      if (templateContextMenu.visible) {
        templateContextMenu.visible = false;
      }
    }

    function syncConfigTemplateSelection() {
      if (!currentConfigTemplates.value.some((template) => template.id === state.configPlan.templateId)) {
        state.configPlan.templateId = currentConfigTemplates.value[0]?.id || "";
      }
    }

    async function generateConfigPlan() {
      const row = state.configPlan.row;
      if (!row) return;
      if (!state.configPlan.templateId) {
        ElMessage.error(configPlanUnsupportedMessage.value || "当前设备型号暂无可用配置模板。");
        return;
      }
      state.configPlan.loading = true;
      try {
        const targetOltId = row.oltId || activePlanOlt.value?.id;
        const data = await onuApi.configPlan(row, {
          oltId: targetOltId,
          chassis: row.chassis,
          board: row.board || row.slot,
          slot: row.board || row.slot,
          pon: row.pon,
          serial: row.serial,
          templateId: state.configPlan.templateId,
          ethPorts: state.configPlan.ethPorts,
          customVlan: state.configPlan.customVlan
        });
        state.configPlan.result = data;
      } catch (error) {
        ElMessage.error(error.message);
      } finally {
        state.configPlan.loading = false;
      }
    }

    async function copyConfigPlan() {
      const commands = state.configPlan.result?.commands || "";
      if (!commands) return;
      const copied = await copyText(commands);
      if (copied) {
        ElMessage.success("配置命令已复制");
      } else {
        ElMessage.error("复制失败，请手工选择命令文本复制");
      }
    }

    async function quickCopy(text, label = "内容") {
      if (!text && text !== 0) return;
      const str = String(text).trim();
      if (!str) return;
      const copied = await copyText(str);
      if (copied) {
        ElMessage.success(`${label}已复制到剪贴板`);
      } else {
        ElMessage.info(str);
      }
    }

    async function copyText(text) {
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
          return true;
        }
      } catch {
        // Fall through to the textarea-based copy path for embedded browsers.
      }
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      textarea.style.top = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);
      try {
        return document.execCommand("copy");
      } catch {
        return false;
      } finally {
        document.body.removeChild(textarea);
      }
    }

    function openTerminalFromDashboard() {
      if (!window.oltManagerDesktop?.terminal) {
        ElMessage.warning("内置 Telnet 终端仅桌面版支持。");
        return;
      }
      state.terminal.status = "正在打开内置终端并自动登录...";
      state.terminal.visible = true;
    }

    async function mountTerminal() {
      await nextTick();
      initPiAssistantForCurrentOlt();
      if (!window.oltManagerDesktop?.terminal || !terminalHost.value) return;
      closeTerminalSession();
      let xtermRuntime;
      try {
        xtermRuntime = await loadXtermRuntime();
      } catch (error) {
        const message = error.message || "内置终端组件加载失败";
        state.terminal.status = message;
        ElMessage.error(state.terminal.status);
        return;
      }
      terminalInstance = new xtermRuntime.Terminal({
        cursorBlink: true,
        convertEol: true,
        // OLT 的 show running-config 等输出常有数千行，默认 1000 行会丢失前文。
        scrollback: 10000,
        rightClickSelectsWord: false,
        fontFamily: "Menlo, Consolas, 'Liberation Mono', monospace",
        fontSize: 13,
        theme: { background: "#0f172a", foreground: "#dbeafe", cursor: "#fbbf24" }
      });
      state.terminal.recentOutput = "";
      state.terminal.connected = false;
      state.terminal.ended = false;
      terminalLastSize = "";
      terminalFitAddon = new xtermRuntime.FitAddon();
      terminalInstance.loadAddon(terminalFitAddon);
      terminalInstance.open(terminalHost.value);
      terminalFitAddon.fit();
      // 窗口缩放、对话框最大化、助手面板拖拽都会改变容器尺寸，统一由观察器触发适配。
      terminalResizeObserver = new ResizeObserver(() => scheduleTerminalFit());
      terminalResizeObserver.observe(terminalHost.value);
      terminalInstance.focus();
      terminalInstance.writeln("OLT Manager 内置 Telnet 终端");
      terminalInstance.writeln("系统不会自动粘贴或执行配置方案；可用鼠标点击“粘贴剪贴板”后人工确认。");

      const isHuawei = String(selectedOlt.value.vendor || "").toLowerCase() === "huawei";
      attachTerminalKeydownGuard(isHuawei);
      attachTerminalPasteGuard();
      terminalInstance.attachCustomKeyEventHandler((event) => {
        if (event.type !== "keydown") return true;
        // 有选中内容时 Ctrl/Cmd+C 复制；没有选中时 Ctrl+C 仍作为中断键发给设备。
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c" && terminalInstance?.hasSelection()) {
          event.preventDefault();
          event.stopPropagation();
          void copyTerminalSelection();
          return false;
        }
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v") {
          event.preventDefault();
          event.stopPropagation();
          void pasteClipboardToTerminal();
          return false;
        }
        if (event.key === "Tab") {
          sendTerminalInput("\t");
          event.preventDefault();
          return false;
        }
        if (isHuawei && event.key === "Backspace") {
          sendTerminalInput("\b");
          event.preventDefault();
          return false;
        }
        return true;
      });
      terminalInstance.onData((input) => {
        const isEscapeSequence = input.startsWith("\u001b");
        if (input.length > 1 && !isEscapeSequence) {
          void sendPastedTerminalText(input);
          return;
        }
        sendTerminalInput(prepareTerminalInput(input));
      });
      terminalUnsubscribe = window.oltManagerDesktop.terminal.onEvent((event) => {
        if (event.sessionId !== state.terminal.sessionId) return;
        if (event.type === "data") {
          const data = String(event.data || "");
          terminalInstance?.write(data);
          state.terminal.recentOutput = `${state.terminal.recentOutput || ""}${data}`.slice(-12000);
        }
        if (event.type === "paste-progress") {
          state.terminal.pasteProgress = `${event.sent}/${event.total}`;
          state.terminal.status = `正在逐行发送 ${event.sent}/${event.total} 行...`;
          return;
        }
        if (event.message) state.terminal.status = event.message;
        if (event.type === "connected") state.terminal.connected = true;
        if (event.type === "disconnected" || event.type === "error") {
          state.terminal.connected = false;
          state.terminal.ended = true;
        }
        if (event.type === "notice") terminalInstance?.writeln(`\r\n${event.message}`);
        if (event.type === "error") terminalInstance?.writeln(`\r\n错误：${event.message}`);
        if (event.type === "connected" && (state.terminal.pendingCommands?.length || state.terminal.pendingCommand)) {
          const cmds = state.terminal.pendingCommands?.length
            ? [...state.terminal.pendingCommands]
            : [state.terminal.pendingCommand];
          state.terminal.pendingCommand = "";
          state.terminal.pendingCommands = [];
          const isHuawei = String(selectedOlt.value?.vendor || "").toLowerCase().includes("huawei");
          cmds.forEach((cmd, idx) => {
            setTimeout(() => {
              sendTerminalInput(cmd + "\r");
              if (isHuawei) {
                setTimeout(() => {
                  sendTerminalInput("\r");
                }, 200);
              }
            }, 350 + idx * 600);
          });
          state.terminal.status = `已自动执行只读查看命令：${cmds.join(" & ")}`;
        }
      });
      try {
        const result = await window.oltManagerDesktop.terminal.create({ oltId: state.selectedOltId });
        state.terminal.sessionId = result.sessionId;
        terminalFitAddon.fit();
        const dims = terminalInstance.cols && terminalInstance.rows
          ? { cols: terminalInstance.cols, rows: terminalInstance.rows }
          : { cols: 80, rows: 24 };
        window.oltManagerDesktop.terminal.resize({ sessionId: result.sessionId, ...dims });
        terminalLastSize = `${dims.cols}x${dims.rows}`;
      } catch (error) {
        const message = error.message || "内置终端启动失败";
        state.terminal.ended = true;
        state.terminal.status = message.includes("TELNET 用户名或密码未配置")
          ? "TELNET 用户名或密码未配置，请先到 OLT 设备管理维护凭据。"
          : message;
        ElMessage.error(state.terminal.status);
      }
    }

    function sendTerminalInput(input) {
      if (!state.terminal.sessionId || !window.oltManagerDesktop?.terminal) return;
      window.oltManagerDesktop.terminal.input({ sessionId: state.terminal.sessionId, input });
    }

    function waitForTerminalPaste(delayMs) {
      return new Promise((resolve) => window.setTimeout(resolve, delayMs));
    }

    const TERMINAL_PASTE_MODE_KEY = "olt-manager.terminal-paste-mode";

    function readTerminalPasteMode() {
      try {
        return window.localStorage.getItem(TERMINAL_PASTE_MODE_KEY) === "line" ? "line" : "char";
      } catch {
        return "char";
      }
    }

    function toggleTerminalPasteMode() {
      if (state.terminal.pasting) return;
      state.terminal.pasteMode = state.terminal.pasteMode === "line" ? "char" : "line";
      try {
        window.localStorage.setItem(TERMINAL_PASTE_MODE_KEY, state.terminal.pasteMode);
      } catch {
        // 本机存储不可用时只在本次会话生效。
      }
      state.terminal.status = state.terminal.pasteMode === "line"
        ? "粘贴模式：逐行（整行发送，等设备回到提示符再发下一行）"
        : "粘贴模式：逐字符（每个字符间隔发送，最稳妥）";
    }

    function cancelTerminalPaste() {
      if (!state.terminal.pasting) return;
      terminalPasteRun += 1;
      if (state.terminal.sessionId) window.oltManagerDesktop?.terminal?.cancelPaste?.({ sessionId: state.terminal.sessionId });
    }

    function pasteElapsedText(startedAt) {
      return `${((Date.now() - startedAt) / 1000).toFixed(1)} 秒`;
    }

    // 逐行模式：由主进程按设备提示符控制节奏，见 InteractiveTelnetSession.pasteLines。
    async function sendPastedLinesByPrompt(frames) {
      const startedAt = Date.now();
      state.terminal.pasting = true;
      state.terminal.pasteProgress = `0/${frames.length}`;
      state.terminal.status = `正在逐行发送 ${frames.length} 行...`;
      try {
        const result = await window.oltManagerDesktop.terminal.paste({
          sessionId: state.terminal.sessionId,
          lines: frames.map((frame) => frame.line)
        });
        const timeoutText = result.timeouts ? `，其中 ${result.timeouts} 行未等到提示符（已按超时继续）` : "";
        if (result.confirmLine) {
          state.terminal.status = `设备要求人工确认「${result.confirmLine}」，已暂停发送（已发送 ${result.sent}/${result.total} 行）。请在终端中自行确认，剩余命令需重新粘贴。`;
          ElMessage.warning("设备正在等待 y/n 确认，系统不会代为回答，已暂停发送剩余命令。");
          return;
        }
        state.terminal.status = result.cancelled
          ? `已停止发送：已发送 ${result.sent}/${result.total} 行，用时 ${pasteElapsedText(startedAt)}。`
          : `逐行发送完成：${result.sent} 行，用时 ${pasteElapsedText(startedAt)}${timeoutText}。请检查终端回显。`;
      } catch (error) {
        state.terminal.status = `逐行发送失败：${error.message || error}`;
      } finally {
        state.terminal.pasting = false;
        state.terminal.pasteProgress = "";
        terminalInstance?.focus();
      }
    }

    async function sendPastedTerminalText(text) {
      if (!state.terminal.sessionId || state.terminal.pasting) return;
      const prepared = prepareTerminalInput(text);
      const frames = terminalPasteFrames(prepared);
      const isHuawei = String(selectedOlt.value.vendor || "").toLowerCase().includes("huawei");
      if (!frames.length) return;
      if (state.terminal.pasteMode === "line" && window.oltManagerDesktop?.terminal?.paste) {
        await sendPastedLinesByPrompt(frames);
        return;
      }
      const startedAt = Date.now();
      const runId = ++terminalPasteRun;
      state.terminal.pasting = true;
      state.terminal.status = `正在缓速发送 ${frames.length} 条命令...`;
      try {
        for (const frame of frames) {
          for (const character of frame.line) {
            if (runId !== terminalPasteRun || !state.terminal.sessionId) return;
            sendTerminalInput(character);
            await waitForTerminalPaste(terminalPasteCharDelayMs);
          }
          if (runId !== terminalPasteRun || !state.terminal.sessionId) return;
          sendTerminalInput("\r");
          await waitForTerminalPaste(terminalPasteLineDelayMs);
          if (isHuawei && terminalPasteNeedsExtraEnter(frame.line, selectedOlt.value.vendor)) {
            sendTerminalInput("\r");
            await waitForTerminalPaste(terminalPasteLineDelayMs);
          }
        }
        state.terminal.status = `逐字符发送完成：${frames.length} 行，用时 ${pasteElapsedText(startedAt)}。请检查终端回显。`;
      } finally {
        if (runId === terminalPasteRun) state.terminal.pasting = false;
        else {
          state.terminal.pasting = false;
          state.terminal.status = `已停止发送，用时 ${pasteElapsedText(startedAt)}。`;
        }
      }
    }

    // 桌面版通过主进程读写系统剪贴板；浏览器调试时退回 navigator.clipboard。
    async function readClipboardText() {
      if (window.oltManagerDesktop?.clipboard) return String(await window.oltManagerDesktop.clipboard.readText() || "");
      return String(await navigator.clipboard?.readText?.() || "");
    }

    async function writeClipboardText(text) {
      if (window.oltManagerDesktop?.clipboard) await window.oltManagerDesktop.clipboard.writeText(text);
      else await navigator.clipboard.writeText(text);
    }

    async function copyTerminalSelection() {
      const text = terminalInstance?.getSelection() || "";
      if (!text) return;
      try {
        await writeClipboardText(text);
        state.terminal.status = `已复制 ${text.length} 个字符`;
      } catch {
        ElMessage.warning("复制失败，请重试。");
      }
      terminalInstance?.focus();
    }

    async function pasteClipboardToTerminal() {
      if (!state.terminal.sessionId || state.terminal.pasting) return;
      try {
        const text = await readClipboardText();
        if (!text) {
          ElMessage.warning("剪贴板为空，或当前环境不允许读取剪贴板。");
          return;
        }
        await sendPastedTerminalText(text);
        terminalInstance?.focus();
      } catch (error) {
        ElMessage.warning("读取剪贴板失败，可使用 Ctrl+V 或右键粘贴。");
      }
    }

    function prepareTerminalInput(input) {
      const text = String(input || "");
      if (!text.includes("\n") && !text.includes("\r")) return text;
      const verificationCommands = zteVerificationCommandsForCurrentPlan();
      if (!verificationCommands.length) return text;
      if (verificationCommands.every((command) => text.toLowerCase().includes(command.toLowerCase()))) return text;
      if (!looksLikeCurrentConfigPlan(text)) return text;
      const normalized = text.replace(/\r?\n/g, "\r\n").replace(/\r\n?$/, "");
      return `${normalized}\r\n${verificationCommands.join("\r\n")}\r\n`;
    }

    function looksLikeCurrentConfigPlan(text) {
      const commands = state.configPlan.result?.commands || "";
      const sampleLines = commands
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((line) => !line.toLowerCase().startsWith("show "))
        .slice(0, 3);
      return sampleLines.length > 0 && sampleLines.every((line) => text.includes(line));
    }

    function zteVerificationCommandsForCurrentPlan() {
      const result = state.configPlan.result;
      if (String(result?.vendor || "").toLowerCase() !== "zte") return [];
      const variables = result?.variables || {};
      // 兼容 C300 (show running-config interface / show onu running config) 与 C600 TITAN 架构 (show this)
      return buildOnuConfigTerminalCommands({
        vendor: "zte",
        model: result?.model || selectedOlt.value?.model,
        deviceProfile: result?.deviceProfile || selectedOlt.value?.deviceProfile,
        chassis: variables.chassis,
        board: variables.board || variables.slot,
        pon: variables.pon,
        onuId: variables.onuId
      });
    }

    function attachTerminalKeydownGuard(isHuawei) {
      detachTerminalKeydownGuard();
      terminalKeydownTarget = terminalHost.value;
      terminalKeydownHandler = (event) => {
        if (event.key === "Tab") {
          event.preventDefault();
          event.stopPropagation();
          sendTerminalInput("\t");
        } else if (isHuawei && event.key === "Backspace") {
          event.preventDefault();
          event.stopPropagation();
          sendTerminalInput("\b");
        }
      };
      terminalKeydownTarget?.addEventListener("keydown", terminalKeydownHandler, true);
    }

    function detachTerminalKeydownGuard() {
      if (terminalKeydownTarget && terminalKeydownHandler) {
        terminalKeydownTarget.removeEventListener("keydown", terminalKeydownHandler, true);
      }
      terminalKeydownTarget = undefined;
      terminalKeydownHandler = undefined;
    }

    function attachTerminalPasteGuard() {
      detachTerminalPasteGuard();
      terminalPasteTarget = terminalHost.value;
      terminalPasteHandler = (event) => {
        event.preventDefault();
        event.stopPropagation();
        void (async () => {
          const text = event.clipboardData?.getData("text/plain") || await readClipboardText();
          if (text) await sendPastedTerminalText(text);
        })();
      };
      terminalPasteTarget?.addEventListener("paste", terminalPasteHandler, true);
    }

    function detachTerminalPasteGuard() {
      if (terminalPasteTarget && terminalPasteHandler) {
        terminalPasteTarget.removeEventListener("paste", terminalPasteHandler, true);
      }
      terminalPasteTarget = undefined;
      terminalPasteHandler = undefined;
    }

    function closeTerminalSession() {
      if (state.terminal.sessionId && window.oltManagerDesktop?.terminal) {
        window.oltManagerDesktop.terminal.close({ sessionId: state.terminal.sessionId });
      }
      state.terminal.sessionId = "";
      state.terminal.recentOutput = "";
      state.terminal.connected = false;
      state.terminal.contextMenu.visible = false;
      terminalResizeObserver?.disconnect();
      terminalResizeObserver = undefined;
      cancelAnimationFrame(terminalFitFrame);
      terminalFitFrame = 0;
      detachTerminalKeydownGuard();
      detachTerminalPasteGuard();
      terminalUnsubscribe?.();
      terminalUnsubscribe = undefined;
      terminalInstance?.dispose();
      terminalInstance = undefined;
      terminalFitAddon = undefined;
    }

    const piMessagesContainer = ref(null);

    function togglePiAssistant() {
      state.terminal.showAssistant = !state.terminal.showAssistant;
      nextTick(() => {
        terminalFitAddon?.fit();
        if (state.terminal.sessionId && window.oltManagerDesktop?.terminal) {
          const dims = terminalInstance?.cols && terminalInstance?.rows
            ? { cols: terminalInstance.cols, rows: terminalInstance.rows }
            : { cols: 80, rows: 24 };
          window.oltManagerDesktop.terminal.resize({ sessionId: state.terminal.sessionId, ...dims });
        }
      });
    }

    function initPiAssistantForCurrentOlt() {
      const olt = selectedOlt.value || {};
      const vendorName = String(olt.vendor || "OLT").toUpperCase();
      const modelName = olt.model || olt.name || "";
      if (!state.terminal.assistantMessages || state.terminal.assistantMessages.length === 0) {
        state.terminal.assistantMessages = [
          {
            role: "assistant",
            content: `### 💡 终端运维连接就绪\n当前终端已安全连接 **${olt.name || "设备"}**（${vendorName} ${modelName}）。\n\n### 📋 智能运维问答能力\n您可以随时向我询问：\n- 常用只读命令与参数（光功率、未注册 ONT、板卡、测距等）\n- 掉线离线原因分析（区分停电 DyingGasp 与断纤 LOS）\n- 流氓 ONU（连续常发光）故障排查\n- 中兴 C600 TITAN 相比传统 C300 的避坑与命令反转差异\n- 或直接点击下方的快捷提问胶囊。`,
            commands: []
          }
        ];
      }
    }

    async function loadAnySearchConfig() {
      try {
        const res = await localAuthClient.fetch("/api/pi-agent/config");
        if (res.ok) {
          const data = await res.json();
          if (data.anysearchApiKey) {
            state.anysearch.apiKey = data.anysearchApiKey;
            state.anysearch.maskedKey = data.maskedKey || "";
          }
        }
      } catch (err) {
        console.warn("[pi-agent] 获取 AnySearch 配置异常:", err);
      }
    }

    async function saveAnySearchConfig() {
      state.anysearch.saving = true;
      try {
        const res = await localAuthClient.fetch("/api/pi-agent/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ anysearchApiKey: state.anysearch.apiKey })
        });
        const data = await res.json();
        if (data.ok) {
          state.anysearch.apiKey = data.anysearchApiKey;
          state.anysearch.maskedKey = data.maskedKey || "";
          state.anysearch.dialogVisible = false;
          ElMessage.success("AnySearch API Key 已保存并立即生效！");
        } else {
          ElMessage.error(data.error || "AnySearch 配置保存失败");
        }
      } catch (err) {
        ElMessage.error(err.message || "请求异常，保存配置失败");
      } finally {
        state.anysearch.saving = false;
      }
    }

    // 挂载全局便捷复制事件
    if (typeof window !== "undefined") {
      window.copyPiCode = function(buttonEl) {
        const code = buttonEl.getAttribute("data-code") || buttonEl.closest(".pi-code-card")?.querySelector("code")?.innerText || "";
        if (code) {
          copyText(code);
          buttonEl.innerText = "已复制";
          setTimeout(() => { buttonEl.innerText = "复制"; }, 1500);
        }
      };

      window.copyPiInlineCode = function(codeEl) {
        const text = codeEl.innerText || "";
        if (text) {
          copyText(text);
        }
      };
    }

    // 拖拽调整终端与助手宽度
    function fitTerminal() {
      if (!terminalInstance || !terminalFitAddon) return;
      try {
        terminalFitAddon.fit();
        const size = `${terminalInstance.cols}x${terminalInstance.rows}`;
        if (size === terminalLastSize) return;
        terminalLastSize = size;
        if (state.terminal.sessionId && window.oltManagerDesktop?.terminal?.resize) {
          window.oltManagerDesktop.terminal.resize({
            sessionId: state.terminal.sessionId,
            cols: terminalInstance.cols,
            rows: terminalInstance.rows
          });
        }
      } catch (_e) {
        // 忽略终端尺寸边界异常
      }
    }

    function scheduleTerminalFit() {
      if (terminalFitFrame) return;
      terminalFitFrame = requestAnimationFrame(() => {
        terminalFitFrame = 0;
        fitTerminal();
      });
    }

    function reconnectTerminal() {
      if (!state.terminal.visible) return;
      state.terminal.status = "正在重新连接并自动登录...";
      void mountTerminal();
    }

    function toggleTerminalMaximize() {
      state.terminal.maximized = !state.terminal.maximized;
      nextTick(() => terminalInstance?.focus());
    }

    // 导出终端缓冲区（含滚动历史）为文本日志，自动换行的行会拼回原始行。
    function exportTerminalLog() {
      if (!terminalInstance) return;
      const buffer = terminalInstance.buffer.active;
      const lines = [];
      for (let index = 0; index < buffer.length; index += 1) {
        const line = buffer.getLine(index);
        if (!line) continue;
        const text = line.translateToString(true);
        if (line.isWrapped && lines.length) lines[lines.length - 1] += text;
        else lines.push(text);
      }
      while (lines.length && !lines.at(-1).trim()) lines.pop();
      const olt = selectedOlt.value || {};
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      downloadBlob(new Blob([`${lines.join("\r\n")}\r\n`], { type: "text/plain;charset=utf-8" }), `olt-terminal-${olt.host || olt.id || "session"}-${stamp}.log`);
      state.terminal.status = `已导出 ${lines.length} 行终端日志`;
    }

    function hideTerminalContextMenu(event) {
      if (event?.target?.closest?.(".terminal-context-menu")) return;
      state.terminal.contextMenu.visible = false;
      window.removeEventListener("mousedown", hideTerminalContextMenu, true);
    }

    function openTerminalContextMenu(event) {
      if (!terminalInstance) return;
      state.terminal.contextMenu = {
        visible: true,
        x: event.clientX,
        y: event.clientY,
        hasSelection: terminalInstance.hasSelection()
      };
      window.addEventListener("mousedown", hideTerminalContextMenu, true);
    }

    async function runTerminalContextAction(action) {
      state.terminal.contextMenu.visible = false;
      window.removeEventListener("mousedown", hideTerminalContextMenu, true);
      if (action === "copy") await copyTerminalSelection();
      else if (action === "paste") await pasteClipboardToTerminal();
      else if (action === "selectAll") terminalInstance?.selectAll();
      else if (action === "clear") terminalInstance?.clear();
      else if (action === "export") exportTerminalLog();
      terminalInstance?.focus();
    }

    function currentOnuQueryLabel() {
      if (state.filters.search.trim()) return "全局搜索 ONU 数据";
      const parts = [state.filters.chassis, state.filters.slot, state.filters.pon].filter((value) => String(value || "").trim());
      if (parts.length) return `正在查询 ${parts.join("/")}`;
      return "正在查询当前 OLT ONU 数据";
    }

    function setOnuLoadingProgress(percent, message, step) {
      state.onuLoading.percent = Math.max(state.onuLoading.percent, Math.min(100, percent));
      if (message) state.onuLoading.message = message;
      if (step) state.onuLoading.step = step;
    }

    function startOnuLoading() {
      window.clearInterval(onuLoadingTimer);
      state.onuLoading.visible = true;
      state.onuLoading.title = currentOnuQueryLabel();
      state.onuLoading.message = "正在准备查询条件...";
      state.onuLoading.step = "准备查询";
      state.onuLoading.percent = 8;
      onuLoadingTimer = window.setInterval(() => {
        if (!state.onuLoading.visible || state.onuLoading.percent >= 84) return;
        state.onuLoading.percent = Math.min(84, state.onuLoading.percent + 4);
        if (state.onuLoading.percent >= 58) {
          state.onuLoading.message = "正在读取 ONU 在线状态、光功率和距离...";
          state.onuLoading.step = "读取 ONU";
        } else if (state.onuLoading.percent >= 30) {
          state.onuLoading.message = "正在匹配地址、槽板和 PON 条件...";
          state.onuLoading.step = "解析条件";
        }
      }, 260);
    }

    async function finishOnuLoading(success, count = 0) {
      window.clearInterval(onuLoadingTimer);
      if (success) {
        setOnuLoadingProgress(100, `已查询到 ${count} 条 ONU 数据，正在更新页面。`, "完成");
        await new Promise((resolve) => window.setTimeout(resolve, 320));
      } else {
        state.onuLoading.message = "查询失败，请检查当前 OLT 连接或查询条件。";
        state.onuLoading.step = "失败";
        await new Promise((resolve) => window.setTimeout(resolve, 600));
      }
      state.onuLoading.visible = false;
    }

    async function loadOnus(options = {}) {
      const showProgress = options.showProgress ?? state.activeView === "onus";
      state.loading.onus = true;
      if (showProgress) startOnuLoading();
      try {
        if (showProgress) setOnuLoadingProgress(18, "正在匹配地址、槽板和 PON 条件...", "解析条件");
        const matchedPort = applyAddressSearchToPon();
        if (matchedPort) {
          if (showProgress) setOnuLoadingProgress(38, `已匹配 ${matchedPort.oltIp}，正在切换当前 OLT...`, "切换 OLT");
          await switchOltForGlobalSearch(matchedPort.oltIp);
        }
        saveFilters();
        const params = new URLSearchParams();
        if (state.filters.search.trim()) params.set("search", state.filters.search.trim());
        if (state.filters.chassis.trim()) params.set("chassis", state.filters.chassis.trim());
        if (state.filters.slot.trim()) params.set("board", state.filters.slot.trim());
        if (state.filters.pon.trim()) params.set("pon", state.filters.pon.trim());
        if (showProgress) setOnuLoadingProgress(64, "正在读取 ONU 在线状态、光功率和距离...", "读取 ONU");
        state.onuRows = await onuApi.list(params);
        if (showProgress) await finishOnuLoading(true, state.onuRows.length);
      } catch (error) {
        state.onuRows = [];
        if (showProgress) await finishOnuLoading(false);
        ElMessage.error(error.message);
      } finally {
        state.loading.onus = false;
      }
    }

    async function loadAdminData() {
      state.loading.admin = true;
      try {
        const [olts, ponPorts, projects] = await Promise.all([
          oltAdminApi.list(),
          fetchPonPorts(),
          fetchProjects()
        ]);
        state.adminOlts = (olts.adminOlts || olts.olts || []).map(normalizeAdminOltRow);
        state.ponPorts = ponPorts;
        state.projects = projects;
        await syncSelectedProjectAfterProjectListChange();
        ponPortFilterState.reset(state.ponPorts);
      } catch (error) {
        ElMessage.error(error.message);
      } finally {
        state.loading.admin = false;
      }
    }

    async function loadResourceSchedules() {
      state.resourceSchedule.loading = true;
      try {
        state.resourceSchedule.tasks = await resourceSyncApi.listTasks();
      } catch (error) {
        ElMessage.error(error.message || "定时任务加载失败");
      } finally {
        state.resourceSchedule.loading = false;
      }
    }

    async function loadResourceUsers() {
      const keyword = state.resource.search.trim();
      if (!keyword && !selectedOlt.value.id) return;
      const data = await resourceSyncApi.listMergedSnapshots({ oltId: selectedOlt.value.id, keyword });
      state.resource.users = data.rows || [];
      state.resource.userPage = 1;
      return data;
    }

    function applyMergedOnuSyncState(data = {}) {
      const progress = data.progress || data;
      state.mergedOnu.dataset = {
        ...state.mergedOnu.dataset,
        synced: Boolean(data.synced),
        revision: data.revision || "",
        updatedAt: data.updatedAt || "",
        mergedAt: data.mergedAt || data.updatedAt || "",
        lastCompletedAt: data.lastCompletedAt || "",
        snapshotCount: Number(data.snapshotCount || 0),
        lastConflictCount: Number(data.lastConflictCount || 0),
        lastArbitratedCount: Number(data.lastArbitratedCount || 0),
        allConflictsResolved: Boolean(data.allConflictsResolved)
      };
      state.mergedOnu.sources = {
        ...state.mergedOnu.sources,
        ...(data.sources || {}),
        network: { ...state.mergedOnu.sources.network, ...(data.sources?.network || {}) },
        nmse: { ...state.mergedOnu.sources.nmse, ...(data.sources?.nmse || {}) }
      };
      if (data.bossSync) state.mergedOnu.bossSync = { ...state.mergedOnu.bossSync, ...data.bossSync };
      state.mergedOnu.progress = { ...state.mergedOnu.progress, ...progress };
      if (!state.mergedOnu.syncing && progress.status !== "running") state.mergedOnu.error = progress.error || "";
    }

    function stopMergedOnuSyncPolling() {
      if (!mergedOnuSyncTimer) return;
      window.clearInterval(mergedOnuSyncTimer);
      mergedOnuSyncTimer = null;
    }

    async function loadMergedOnuSyncState() {
      const data = await resourceSyncApi.mergedStatus();
      applyMergedOnuSyncState(data);
      return data;
    }

    async function loadMergedOnuSyncProgress() {
      const progress = await resourceSyncApi.mergedProgress();
      state.mergedOnu.progress = { ...state.mergedOnu.progress, ...progress };
      if (!state.mergedOnu.syncing && progress.status !== "running") state.mergedOnu.error = progress.error || "";
      return progress;
    }

    function startMergedOnuSyncPolling() {
      stopMergedOnuSyncPolling();
      const refresh = async () => {
        try {
          await loadMergedOnuSyncProgress();
        } catch {
          // The foreground request reports failures; polling remains quiet.
        }
      };
      void refresh();
      mergedOnuSyncTimer = window.setInterval(refresh, 500);
    }

    async function syncMergedOnuOperation(operation = "full") {
      if (state.mergedOnu.syncing) return;
      const initializingBossNameHistory = (operation === "nmse" || operation === "full") && !state.mergedOnu.bossSync.nameHistoryCompletedAt;
      state.mergedOnu.syncing = true;
      state.mergedOnu.error = "";
      state.mergedOnu.progress = {
        ...state.mergedOnu.progress,
        running: true,
        status: "running",
        operation,
        phase: "backing-up",
        error: ""
      };
      startMergedOnuSyncPolling();
      try {
        const data = await resourceSyncApi.syncMerged(operation);
        await loadMergedOnuSyncState();
        if (initializingBossNameHistory) {
          const suffix = operation === "full" ? `；同时完成 ${data.mergedCount || 0} 条统一数据合并` : "";
          ElMessage.success(`一期 BOSS 历史姓名初始化完成，已按 LOID 收录 ${state.mergedOnu.bossSync.nameHistoryCount || 0} 个姓名${suffix}；后续将执行增量同步`);
        } else if (operation === "merge" || operation === "full") {
          ElMessage.success(`合并 ONU 同步完成，共 ${data.mergedCount || 0} 条，冲突 ${data.conflictCount || 0} 条`);
        } else {
          ElMessage.success(`${operation === "network" ? "网管二期" : "一期 BOSS"} 源数据同步完成，共 ${data.count || 0} 条`);
        }
      } catch (error) {
        state.mergedOnu.error = error.message || "合并 ONU 同步失败";
        ElMessage.error(state.mergedOnu.error);
      } finally {
        stopMergedOnuSyncPolling();
        try {
          await loadMergedOnuSyncState();
        } catch {
          // Keep the foreground error visible if the final status request fails.
        }
        state.mergedOnu.syncing = false;
      }
    }

    // ===== 首页 OLT 设备状态与核心运维态势大盘 =====
    async function loadRemediationWorkdesk(customRoomName) {
      state.dashboardWorkdesk.loading = true;
      try {
        const roomName = customRoomName || state.dashboardWorkdesk.roomName || state.oss.config.roomName || "";
        const res = await resourceSyncApi.getRemediationWorkdesk({ roomName });
        if (res && res.ok) {
          state.dashboardWorkdesk.roomName = res.roomName || roomName || "厚街机房";
          state.dashboardWorkdesk.organizationName = res.organizationName || state.oss.config.organizationName || "东莞分公司";
          state.dashboardWorkdesk.summary = res.summary || {
            totalOlts: 0,
            onlineOlts: 0,
            totalOnus: 0,
            onlineOnus: 0,
            onlineRate: "100%",
            totalPonPorts: 0,
            activePonPorts: 0,
            abnormalPortCount: 0,
            weakCount: 0,
            repeatLoidCount: 0,
            conflictCount: 0
          };
          state.dashboardWorkdesk.donutCharts = res.donutCharts || null;
          state.dashboardWorkdesk.oltMatrix = res.oltMatrix || [];
          state.dashboardWorkdesk.topAlertPorts = res.topAlertPorts || [];
          state.dashboardWorkdesk.olts = res.olts || [];
        }
      } catch (error) {
        ElMessage.error(error.message || "加载机房 OLT 运维大盘数据失败");
      } finally {
        state.dashboardWorkdesk.loading = false;
      }
    }


    async function loadResourceManagement() {
      const oltId = selectedOlt.value.id;
      const [configResult, usersResult, ossResult, mergedResult] = await Promise.allSettled([
        resourceManagementApi.config(),
        oltId ? loadResourceUsers() : Promise.resolve({ rows: [] }),
        ossResourceApi.config(),
        loadMergedOnuSyncState()
      ]);
      if (configResult.status === "fulfilled") {
        const projection = resourceManagementConfigProjection(configResult.value);
        Object.assign(state.resource.config, projection.config);
        state.resource.loggedIn = projection.loggedIn;
      }
      if (usersResult.status === "fulfilled") {
        state.resource.users = usersResult.value.rows || [];
        state.resource.userPage = 1;
      }
      if (ossResult.status === "fulfilled") applyOssResourceConfig(ossResult.value);
      if (ossResult.status === "fulfilled" && ossResult.value.autoLoginConfigured && !ossResult.value.loggedIn) {
        void loginOssResource({ autoLogin: true, quiet: true });
      }
      const failures = [configResult, usersResult, ossResult, mergedResult].filter((item) => item.status === "rejected");
      if (failures.length) ElMessage.warning(`资源管理部分数据加载失败（${failures.length} 项），已保留其余本地快照`);
    }

    function applyOssResourceConfig(config = {}) {
      const projection = ossResourceConfigProjection(config);
      const { config: projectedConfig, password: projectedPassword, ...meta } = projection;
      Object.assign(state.oss.config, projectedConfig);
      Object.assign(state.oss, meta);
      if (projectedPassword) state.oss.password = projectedPassword;
      if (!projection.loggedIn) state.oss.olts = [];
    }

    async function saveOssResourceConfig({ quiet = false } = {}) {
      state.oss.configLoading = true;
      try {
        const config = await ossResourceApi.saveConfig({
          ...state.oss.config,
          password: state.oss.password,
          rememberPassword: state.oss.autoLoginAvailable ? true : Boolean(state.oss.rememberPassword)
        });
        applyOssResourceConfig(config);
        if (!quiet) ElMessage.success("网管二期配置已保存");
        void loadRemediationWorkdesk(state.oss.config.roomName);
        return true;
      } catch (error) {
        if (!quiet) ElMessage.error(error.message || "网管二期配置保存失败");
        return false;
      } finally {
        state.oss.configLoading = false;
      }
    }

    async function loginOssResource({ autoLogin = false, quiet = false } = {}) {
      const loginPassword = String(state.oss.password || "");
      const usingAutoLogin = autoLogin || (state.oss.autoLoginConfigured && !loginPassword);
      if (!loginPassword && !state.oss.credentialConfigured && !state.oss.autoLoginConfigured) {
        ElMessage.warning("首次保存请填写网管二期登录密码");
        return;
      }
      state.oss.loginLoading = true;
      try {
        if (!await saveOssResourceConfig({ quiet: true })) throw new Error("网管二期配置保存失败");
        const shouldRemember = state.oss.autoLoginAvailable ? true : Boolean(state.oss.rememberPassword);
        const result = await ossResourceApi.login({
          password: loginPassword,
          rememberPassword: shouldRemember,
          autoLogin: usingAutoLogin
        });
        if (loginPassword) state.oss.password = loginPassword;
        Object.assign(state.oss, ossLoginProjection(result, {
          rememberPassword: shouldRemember,
          autoLoginConfigured: state.oss.autoLoginConfigured
        }));
        if (!quiet) ElMessage.success(`网管二期登录成功，发现 ${result.oltCount} 台已投影 OLT`);
      } catch (error) {
        state.oss.loggedIn = false;
        if (!quiet) ElMessage.error(error.message || "网管二期登录失败");
      } finally {
        state.oss.loginLoading = false;
      }
    }

    const currentOrgRoomOptions = computed(() => {
      const selectedOrg = state.oss.config.organizationName?.trim();
      if (selectedOrg && state.oss.discoveredOrgs?.length > 0) {
        const found = state.oss.discoveredOrgs.find((o) => o.name === selectedOrg);
        if (found && found.rooms?.length > 0) return found.rooms;
      }
      return state.oss.discoveredRooms || [];
    });

    function handleWizardOrgChange(orgName) {
      if (!orgName || !state.oss.discoveredOrgs?.length) return;
      const found = state.oss.discoveredOrgs.find((o) => o.name === orgName);
      if (found && found.rooms?.length > 0) {
        if (!found.rooms.includes(state.oss.config.roomName)) {
          state.oss.config.roomName = found.rooms[0];
        }
      }
    }

    async function fetchOssRoomInfo() {
      const username = String(state.oss.config.username || "").trim();
      const password = String(state.oss.password || "");
      if (!username) {
        ElMessage.warning("请先输入二期网管登录账号");
        return;
      }
      if (!password && !state.oss.credentialConfigured && !state.oss.autoLoginConfigured) {
        ElMessage.warning("请先输入二期网管登录密码");
        return;
      }
      state.oss.roomsLoading = true;
      try {
        const res = await ossResourceApi.readRooms({
          username,
          password,
          authBaseUrl: state.oss.config.authBaseUrl,
          ngbBaseUrl: state.oss.config.ngbBaseUrl
        });
        if (res && res.ok) {
          state.oss.discoveredOrgs = res.organizations || [];
          state.oss.discoveredRooms = res.allRooms || [];
          const validOrgNames = state.oss.discoveredOrgs.map((o) => o.name);
          const currentOrgValid = state.oss.config.organizationName && validOrgNames.includes(state.oss.config.organizationName);
          if (!currentOrgValid && state.oss.discoveredOrgs.length > 0) {
            const preferred = state.oss.discoveredOrgs.find((o) => /南区|东区/.test(o.name)) || state.oss.discoveredOrgs[0];
            state.oss.config.organizationName = preferred.name;
          }
          const currentOrg = state.oss.discoveredOrgs.find((o) => o.name === state.oss.config.organizationName);
          const currentOrgRooms = currentOrg ? currentOrg.rooms || [] : state.oss.discoveredRooms;
          const currentRoomValid = state.oss.config.roomName && currentOrgRooms.includes(state.oss.config.roomName);
          if (!currentRoomValid) {
            const preferredRoom = currentOrgRooms.find((r) => /厚街/.test(r)) || currentOrgRooms[0] || "";
            state.oss.config.roomName = preferredRoom;
          }
          ElMessage.success(`成功读取到 ${state.oss.discoveredOrgs.length} 个片区机构与 ${state.oss.discoveredRooms.length} 个机房信息！`);
        } else {
          throw new Error(res?.error || "读取机房信息失败");
        }
      } catch (error) {
        ElMessage.error(error.message || "读取机房信息失败");
      } finally {
        state.oss.roomsLoading = false;
      }
    }

    async function saveResourceManagementConfig() {
      state.resource.configLoading = true;
      try {
        const data = await resourceManagementApi.saveConfig(state.resource.config);
        state.resource.config.serverUrl = data.serverUrl || "http://172.18.254.7:9000";
        state.resource.config.username = data.username || "";
        state.resource.config.password = data.password || state.resource.config.password || "";
        state.resource.loggedIn = false;
        ElMessage.success("资源管理配置已保存");
      } catch (error) {
        ElMessage.error(error.message || "保存资源管理配置失败");
      } finally {
        state.resource.configLoading = false;
      }
    }

    async function loadDashboard() {
      await Promise.all([
        loadStatus(),
        loadInstallOnus(),
        loadOnus({ showProgress: false }),
        loadRemediationWorkdesk()
      ]);
    }

    function setView(name) {
      if (name !== "feishuSettings") stopFeishuStatusPolling();
      if (name !== "resourceManagement") stopMergedOnuSyncPolling();
      state.activeView = name;
      if (name === "dashboard") loadDashboard();
      if (name === "install") loadInstallOnus();
      if (name === "wizard") initWizard();
      if (name === "resourceManagement") loadResourceManagement();
      if (name === "resourceSchedule") loadResourceSchedules();
      if (name === "feishuSettings") {
        startFeishuStatusPolling();
        void loadFeishuSettings();
      }
      if (name.startsWith("admin")) loadAdminData();
    }

    async function refreshCurrent() {
      if (state.activeView === "dashboard") return loadDashboard();
      if (state.activeView === "wizard") return initWizard();
      if (state.activeView === "install") return loadInstallOnus();
      if (state.activeView === "onus") return loadOnus();
      if (state.activeView === "resourceManagement") return loadResourceManagement();
      if (state.activeView === "resourceSchedule") return loadResourceSchedules();
      if (state.activeView === "feishuSettings") return loadFeishuSettings();
      return loadAdminData();
    }

    async function handleOltChange() {
      restoreFilters();
      syncConfigTemplateSelection();
      await Promise.all([loadStatus(), loadInstallOnus(), loadOnus({ showProgress: state.activeView === "onus" })]);
      if (state.activeView === "resourceManagement") await loadResourceManagement();
    }

    function normalizeAdminOltRow(row) {
      const profile = profileById(row.deviceProfile) || defaultProfileForModel(row.vendor, row.model);
      if (!profile) return { ...row };
      return {
        ...row,
        vendor: profile.vendor,
        model: profile.model,
        deviceProfile: profile.id
      };
    }

    function handleAdminVendorChange(row) {
      const profile = defaultProfileForVendor(row.vendor);
      if (!profile) return;
      row.vendor = profile.vendor;
      row.model = profile.model;
      row.deviceProfile = profile.id;
    }

    function handleAdminProfileChange(row) {
      const profile = profileById(row.deviceProfile);
      if (!profile) return;
      row.vendor = profile.vendor;
      row.model = profile.model;
      row.deviceProfile = profile.id;
    }

    async function fetchProjects() {
      return projectApi.list(state.projectSearch);
    }

    async function syncSelectedProjectAfterProjectListChange(preferredProject, options = {}) {
      const nextProject = selectProjectFromList(state.projects, preferredProject?.id, state.projectDetail.project?.id);
      const shouldLoadOnus = options.loadOnus === true;
      if (!nextProject) {
        state.projectDetail.project = null;
        state.projectDetail.onus = [];
        state.projectDetail.selectedOnu = null;
        state.projectDetail.loadedProjectId = "";
        return;
      }
      await selectProjectDetail(nextProject, { reload: shouldLoadOnus, loadOnus: shouldLoadOnus });
    }

    async function selectProjectDetail(project, options = {}) {
      if (!project?.id) return;
      const sameProject = state.projectDetail.project?.id === project.id;
      const shouldLoadOnus = options.loadOnus !== false;
      state.projectDetail.project = project;
      if (!sameProject) {
        state.projectDetail.onus = [];
        state.projectDetail.selectedOnu = null;
        state.projectDetail.loadedProjectId = "";
      }
      if (shouldLoadOnus && (options.reload || state.projectDetail.loadedProjectId !== project.id)) {
        await loadProjectOnus();
      }
    }

    function setProjectLoadingProgress(percent, message, step) {
      state.projectLoading.percent = Math.max(state.projectLoading.percent, Math.min(100, percent));
      if (message) state.projectLoading.message = message;
      if (step) state.projectLoading.step = step;
    }

    function startProjectLoading(project) {
      window.clearInterval(projectLoadingTimer);
      state.projectLoading.visible = true;
      state.projectLoading.title = `正在刷新「${project.name}」ONU 台账`;
      state.projectLoading.message = "正在连接本地台账与当前 OLT 状态...";
      state.projectLoading.step = "准备读取";
      state.projectLoading.percent = 8;
      projectLoadingTimer = window.setInterval(() => {
        if (!state.projectLoading.visible || state.projectLoading.percent >= 82) return;
        state.projectLoading.percent = Math.min(82, state.projectLoading.percent + 4);
        if (state.projectLoading.percent >= 56) {
          state.projectLoading.message = "正在刷新 ONU 在线状态、光功率和距离...";
          state.projectLoading.step = "同步设备状态";
        } else if (state.projectLoading.percent >= 28) {
          state.projectLoading.message = "正在读取项目绑定的 ONU 列表...";
          state.projectLoading.step = "读取台账";
        }
      }, 260);
    }

    async function finishProjectLoading(success, count = 0) {
      window.clearInterval(projectLoadingTimer);
      if (success) {
        setProjectLoadingProgress(100, `已刷新 ${count} 台 ONU，正在更新页面。`, "完成");
        await new Promise((resolve) => window.setTimeout(resolve, 360));
      } else {
        state.projectLoading.message = "刷新失败，请稍后重试或检查 OLT 连接状态。";
        state.projectLoading.step = "失败";
        await new Promise((resolve) => window.setTimeout(resolve, 600));
      }
      state.projectLoading.visible = false;
    }

    async function loadProjectOnus() {
      const project = state.projectDetail.project;
      if (!project?.id) return;
      state.projectDetail.loading = true;
      startProjectLoading(project);
      try {
        setProjectLoadingProgress(24, "正在读取项目绑定的 ONU 列表...", "读取台账");
        setProjectLoadingProgress(76, "正在整理 ONU 状态和安装地址...", "整理数据");
        const rows = await projectApi.listOnus(project.id);
        const projectOnuState = replaceProjectOnuRows(rows, state.projectDetail.selectedOnu?.id);
        state.projectDetail.onus = projectOnuState.rows;
        state.projectDetail.selectedOnu = projectOnuState.selectedOnu;
        state.projectDetail.loadedProjectId = project.id;
        await finishProjectLoading(true, state.projectDetail.onus.length);
      } catch (error) {
        await finishProjectLoading(false);
        ElMessage.error(error.message || "读取项目 ONU 失败");
      } finally {
        state.projectDetail.loading = false;
      }
    }

    async function fetchPonPorts() {
      return ponAdminApi.list();
    }

    async function exportPonPortsExcel() {
      try {
        const XLSX = await loadXlsx();
        const worksheet = XLSX.utils.json_to_sheet(ponRowsForExport(state.ponPorts), {
          header: ["OLT IP", "槽", "板卡", "PON", "板槽端口", "外层 VLAN", "地址"]
        });
        worksheet["!cols"] = [
          { wch: 16 },
          { wch: 12 },
          { wch: 12 },
          { wch: 34 }
        ];
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "ONU数据管理");
        const data = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
        const blob = new Blob([data], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        });
        downloadBlob(blob, `onu-data-${new Date().toISOString().slice(0, 10)}.xlsx`);
        ElMessage.success("已导出 Excel");
      } catch (error) {
        ElMessage.error(error.message || "导出 Excel 失败");
      }
    }

    async function importPonPortsExcel(event) {
      const input = event.target;
      const file = input.files?.[0];
      if (!file) return;
      try {
        const data = await file.arrayBuffer();
        const XLSX = await loadXlsx();
        const workbook = XLSX.read(data, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rawJson = XLSX.utils.sheet_to_json(sheet, { defval: "" });
        const report = inspectPonExcelImport(rawJson, state.ponPorts);

        state.ponImportPreview.fileName = file.name;
        state.ponImportPreview.totalRaw = report.totalRaw;
        state.ponImportPreview.validCount = report.validCount;
        state.ponImportPreview.emptyCount = report.emptyCount;
        state.ponImportPreview.invalidRows = report.invalidRows;
        state.ponImportPreview.overrideCount = report.overrideCount;
        state.ponImportPreview.newCount = report.newCount;
        state.ponImportPreview.validRows = report.validRows;
        state.ponImportPreview.visible = true;

        if (report.validCount === 0) {
          ElMessage.warning("Excel 中未解析到任何合规的 PON 台账记录，请核对表头和内容。");
        }
      } catch (error) {
        ElMessage.error(error.message || "读取 Excel 失败");
      } finally {
        input.value = "";
      }
    }

    const isSystemConfigured = computed(() => {
      const hasCompleted = Boolean(state.wizard?.completed)
        || (typeof localStorage !== "undefined" && localStorage.getItem("olt_wizard_completed") === "true");
      if (hasCompleted) return true;
      return isSystemFullyConfigured({
        adminOlts: (state.adminOlts && state.adminOlts.length > 0) ? state.adminOlts : state.olts,
        oss: state.oss,
        resource: state.resource,
        mergedOnu: state.mergedOnu,
        wizardCompleted: hasCompleted
      });
    });

    let wizardRowSeed = 1;
    function ensureWizardRowUid(row) {
      if (!row) return "";
      if (!row._wizardUid) {
        row._wizardUid = `wz-${Date.now().toString(36)}-${wizardRowSeed++}`;
      }
      return row._wizardUid;
    }

    function getOssOltRowKey(olt) {
      if (!olt) return "";
      return ensureWizardRowUid(olt);
    }

    function enrichOssOltsWithExisting(ossOlts = []) {
      const existing = state.adminOlts.length > 0 ? state.adminOlts : state.olts;
      return ossOlts.map((item, index) => {
        const rawIp = item.resourceIp || item.host || "";
        const locationIp = item.locationIp || "";
        let matched = existing.find((o) => (locationIp && o.host === locationIp) || o.host === rawIp || o.resourceIp === rawIp);
        if (!matched && rawIp) {
          const m = String(rawIp).match(/^22\.0\.(\d+)\.(\d+)$/);
          if (m) {
            matched = existing.find((o) => o.host && (o.host.includes(`10${m[1]}.${m[2]}`) || o.host.endsWith(`.${m[2]}`)));
          }
        }
        const host = locationIp || item.host || matched?.host || deriveManagementHostFromResourceIp(rawIp, existing);
        const inferred = inferOltVendorAndProfile(item.name || matched?.name || "");
        const vendor = item.vendor || matched?.vendor || inferred.vendor;
        const deviceProfile = item.deviceProfile || matched?.deviceProfile || inferred.deviceProfile;
        const name = item.name || matched?.name || (item.roomName ? `${item.roomName} OLT ${host}` : `OLT ${host}`);
        const _wizardUid = item._wizardUid || ensureWizardRowUid(item);
        return {
          ...item,
          _wizardUid,
          id: item.id || matched?.id || `olt-${index + 1}`,
          name,
          host,
          vendor,
          deviceProfile,
          roomName: item.roomName || matched?.roomName || "",
          resourceIp: rawIp,
          locationIp
        };
      });
    }

    async function initWizard() {
      try {
        const [configRes, ossRes] = await Promise.allSettled([
          resourceManagementApi.config(),
          ossResourceApi.config(),
          loadAdminData(),
          loadFeishuSettings(),
          loadAnySearchConfig()
        ]);
        if (configRes.status === "fulfilled") {
          const projection = resourceManagementConfigProjection(configRes.value);
          Object.assign(state.resource.config, projection.config);
          state.resource.loggedIn = projection.loggedIn;
          if (configRes.value?.password && !state.resource.config.password) {
            state.resource.config.password = configRes.value.password;
          }
        }
        if (ossRes.status === "fulfilled") {
          applyOssResourceConfig(ossRes.value);
          if (ossRes.value?.password && !state.oss.password) {
            state.oss.password = ossRes.value.password;
          }
        }
        // 如果系统已有二期网管凭据，自动后台读取一次组织与机房选项
        if (state.oss.config.username && (state.oss.password || state.oss.credentialConfigured) && (!state.oss.discoveredOrgs || state.oss.discoveredOrgs.length === 0)) {
          void fetchOssRoomInfo().catch(() => {});
        }
        // 读取系统现存 OLT 的真实凭据（Community 和 Telnet 用户名）用于向导回显
        try {
          const defsRes = await fetch("/api/admin/wizard/defaults");
          if (defsRes.ok) {
            const defs = await defsRes.json();
            if (defs?.ok) {
              if (defs.defaultCommunity) state.wizard.batchCredentials.community = defs.defaultCommunity;
              if (defs.defaultTelnetUser) state.wizard.batchCredentials.telnetUser = defs.defaultTelnetUser;
              if (Array.isArray(defs.olts) && defs.olts.length > 0) {
                const defMap = new Map(defs.olts.map((o) => [o.id, o]));
                (state.adminOlts || []).forEach((o) => {
                  const d = defMap.get(o.id);
                  if (d) {
                    if (d.readCommunity) o.readCommunity = d.readCommunity;
                    if (d.telnetUsername) o.telnetUsername = d.telnetUsername;
                  }
                });
              }
            }
          }
        } catch (_) {}
        // 自动将系统现存的真实已纳管 OLT 载入到向导第 2 步中
        const existing = state.adminOlts.length > 0 ? state.adminOlts : state.olts;
        if (existing.length > 0) {
          if (!state.oss.olts || state.oss.olts.length === 0) {
            loadExistingOltsIntoWizard();
          }
          // 提取现有设备的真实 Community 和 Telnet 用户名作为第 3 步批量填充默认值
          const sample = existing.find((o) => o.readCommunity && o.readCommunity !== "public") || existing[0];
          if (sample) {
            if (sample.readCommunity) state.wizard.batchCredentials.community = sample.readCommunity;
            if (sample.telnetUsername) state.wizard.batchCredentials.telnetUser = sample.telnetUsername;
          }
        } else if (Array.isArray(state.oss.olts) && state.oss.olts.length > 0) {
          state.oss.olts = enrichOssOltsWithExisting(state.oss.olts);
          if (state.wizard.selectedOssOlts.length === 0) {
            state.wizard.selectedOssOlts = state.oss.olts.map(getOssOltRowKey);
          }
        }
        if (state.wizard.oltDrafts.length === 0 && existing.length > 0) {
          state.wizard.oltDrafts = existing.map((item) => ({ ...item }));
        }
      } catch (err) {
        console.warn("[wizard] 初始化向导配置异常:", err);
      }
    }

    function loadExistingOltsIntoWizard() {
      const source = state.adminOlts.length > 0 ? state.adminOlts : state.olts;
      if (!source.length) {
        ElMessage.warning("系统中暂无可载入的已纳管 OLT 设备");
        return;
      }
      state.oss.olts = source.map((item) => ({
        ...item,
        resourceIp: item.resourceIp || "",
        host: item.host,
        name: item.name
      }));
      state.wizard.selectedOssOlts = state.oss.olts.map(getOssOltRowKey);
      ElMessage.success(`已载入系统现有 ${state.oss.olts.length} 台 OLT 设备！本地 IP 和名称均已回显就绪。`);
    }

    function handleGlobalKeyDownForContextMenu(e) {
      if (e.key === "Escape" && templateContextMenu.visible) {
        closeTemplateContextMenu();
      }
    }

    onBeforeUnmount(() => {
      stopFeishuStatusPolling();
      stopMergedOnuSyncPolling();
      window.removeEventListener("click", closeTemplateContextMenu);
      window.removeEventListener("keydown", handleGlobalKeyDownForContextMenu);
    });

    onMounted(async () => {
      window.addEventListener("click", closeTemplateContextMenu);
      window.addEventListener("keydown", handleGlobalKeyDownForContextMenu);
      try {
        await initializeAuth();
        if (state.authenticated) {
          await loadApplication();
        }
      } catch (error) {
        state.authError = error.message || "本地登录服务不可用。";
      }
    });

    const appContext = {
      loadAnySearchConfig,
      fitTerminal,
      reconnectTerminal,
      toggleTerminalPasteMode,
      cancelTerminalPaste,
      toggleTerminalMaximize,
      exportTerminalLog,
      openTerminalContextMenu,
      runTerminalContextAction,
      currentConfigTemplate,
      ponAdminApi,
      syncSelectedProjectAfterProjectListChange,
      resourceSyncApi,
      currentPonPorts,
      onuGroupCounts,
      fetchProjects,
      ossResourceApi,
      applyOssResourceConfig,
      switchOltForGlobalSearch,
      onuApi,
      sendTerminalInput,
      defaultEthPortsForTemplate,
      applyFeishuSettings,
      getOssOltRowKey,
      resourceManagementApi,
      enrichOssOltsWithExisting,
      normalizeAdminOltRow,
      oltAdminApi,
      fetchPonPorts,
      ponPortFilterState,
      openTerminalFromDashboard,
      backupApi,
      copyText,
      diagnoseOfflineCause,
      analyzeHistoricalOpticalSeries,
      terminalHost,
      state,
      showOltSelector,
      activePlanOlt,
      selectedOlt,
      currentConfigTemplates,
      currentEthPortOptions,
      templateContextMenu,
      showVariablePalette,
      closeTemplateContextMenu,
      selectTemplate,
      configPlanUnsupportedMessage,
      phaseInfo,
      rxPowerInfo,
      ponCoordinateKey,
      onuCoordinateLabel,
      setView,
      refreshCurrent,
      loadInstallOnus,
      loadConfigTemplates,
      loadOnus,
      loadResourceUsers,
      loadMergedOnuSyncState,
      syncMergedOnuOperation,
      // 方案 4：机房排障与隐患清零工作台
      loadRemediationWorkdesk,
      getConflictGuide,
      mergedOnuSyncPhaseText,
      mergedOnuSyncStatusText,
      mergedOnuSyncPercent,
      loadFeishuSettings,
      saveFeishuCredentials,
      saveLanguageProvider,
      savePiAgentLanguage,
      saveResourceManagementConfig,
      loadResourceSchedules,
      resourceScheduleStatusText,
      resourceScheduleStatusType,
      resourceScheduleOperationText,
      resourceScheduleRepeatText,
      resourceScheduleLastResult,
      loadProjectOnus,
      handleOltChange,
      saveOssResourceConfig,
      loginOssResource,
      handleConfigTemplateChange,
      generateConfigPlan,
      copyConfigPlan,
      mountTerminal,
      pasteClipboardToTerminal,
      closeTerminalSession,
      piMessagesContainer,
      togglePiAssistant,
      saveAnySearchConfig,
      handleAdminVendorChange,
      handleAdminProfileChange,
      selectProjectDetail,
      exportPonPortsExcel,
      importPonPortsExcel,
      formatDate,
      opticalValue,
      rxHistoryPoints,
      servicePortCli,
      onuMgmtCli,
      saveFilters,
      submitAuth,
      toggleAuthRequirement,
      quickCopy,
      rxPowerHint,
      zhCn,
      // 配置向导导出
      isSystemConfigured,
      loadExistingOltsIntoWizard,
      profilesForVendor,
      currentOrgRoomOptions,
      handleWizardOrgChange,
      fetchOssRoomInfo
    };
    provide(APP_CONTEXT_KEY, appContext);
    return appContext;
  }
};
</script>
