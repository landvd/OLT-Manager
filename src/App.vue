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
import { renderTemplateString, SUPPORTED_TEMPLATE_VARIABLES } from "./config-plan-engine.mjs";
import {
  WIZARD_STEPS,
  deriveManagementHostFromResourceIp,
  inferOltVendorAndProfile,
  buildOltsFromOssSelection,
  validateOltListCredentials,
  canProceedToNextStep,
  isSystemFullyConfigured
} from "./setup-wizard.mjs";
import { defaultProfileForModel, defaultProfileForVendor, profileById, profilesForVendor } from "./device-profiles.mjs";
import { createPonPortFilterState } from "./pon-admin-filter.mjs";
import { defaultChassisForVendor, onuCoordinateLabel, ponCoordinateKey } from "./pon-coordinate.mjs";
import { detectBackupFormat } from "./backup-format.mjs";
import {
  clearEncryptedBackupPasswords,
  createEncryptedBackupState,
  isEncryptedBackupFile,
  validateEncryptedBackupPassword
} from "./backup-view-state.mjs";
import { createInitialAppState } from "./app-state.mjs";
import { createLocalAuthClient } from "./local-auth-client.mjs";
import { createLocalAuthApi } from "./local-auth-api.mjs";
import { createOnuListState, findPonAddressMatch, sortOnuRows } from "./onu-list-state.mjs";
import { opticalValue, onuMgmtCli, rxHistoryPoints, servicePortCli } from "./onu-detail-view-state.mjs";
import { removeProjectOnuRow, replaceProjectOnuRows, selectProjectFromList } from "./project-onu-state.mjs";
import { projectFormFor, projectOnuRowClassName as projectOnuRowClassNameFor } from "./project-view-state.mjs";
import { createProjectApi } from "./project-api.mjs";
import { createResourceManagementApi } from "./resource-management-api.mjs";
import { createResourceSyncApi } from "./resource-sync-api.mjs";
import { createOssResourceApi } from "./oss-resource-api.mjs";
import { createPonAdminApi } from "./pon-admin-api.mjs";
import { createBackupApi } from "./backup-api.mjs";
import { loadXlsx } from "./xlsx-runtime.mjs";
import { loadXtermRuntime } from "./xterm-runtime.mjs";
import { createOnuApi } from "./onu-api.mjs";
import {
  getConflictGuide,
  summarizeConflicts,
  filterConflictRows
} from "./merged-conflict-guide.mjs";
import { createOltAdminApi } from "./olt-admin-api.mjs";
import {
  ossLoginProjection,
  ossLogoutProjection,
  ossResourceConfigProjection,
  resourceManagementConfigProjection
} from "./resource-page-state.mjs";
import {
  countDuplicateAddresses,
  countOnuGroups,
  excelRowsToPonRows,
  filterStorageKey,
  phaseInfo,
  ponRowsForExport,
  rxPowerInfo,
  rxPowerHint,
  uniqueSorted,
  inspectPonExcelImport,
  diagnoseOfflineCause,
  analyzeHistoricalOpticalSeries,
  buildOnuConfigTerminalCommands
} from "./main-view-state.mjs";
import {
  dashboardFreshnessFor,
  dashboardMetricsFor,
  dashboardWorkItemsFor,
  onuEmptyTextFor,
  onuSummaryFor
} from "./dashboard-view-state.mjs";
import {
  RESOURCE_SYNC_OPERATIONS,
  resourceScheduleLastResult,
  resourceScheduleOperationText,
  resourceScheduleRepeatText,
  resourceScheduleStatusText,
  resourceScheduleStatusType
} from "./resource-schedule-view-state.mjs";
import { ossHistoricalOpticalRequestFor, ossHistoryRowsFromResponse } from "./oss-history-view-state.mjs";
import {
  formatDate,
  mergedOnuSourceStatusText,
  mergedOnuSyncPercent,
  mergedOnuSyncPhaseText,
  mergedOnuSyncStatusText
} from "./merged-onu-view-state.mjs";

const localAuthClient = createLocalAuthClient();
const projectApi = createProjectApi({ fetch: (path, options) => localAuthClient.fetch(path, options) });

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

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
    const terminalLayoutRef = ref(null);
    let terminalInstance;
    let terminalFitAddon;
    let terminalUnsubscribe;
    let terminalKeydownTarget;
    let terminalKeydownHandler;
    let terminalPasteTarget;
    let terminalPasteHandler;
    let terminalPasteRun = 0;
    let projectLoadingTimer;
    let onuLoadingTimer;
    let feishuStatusTimer;
    let feishuStatusRefreshing = false;
    const state = reactive({ ...createInitialAppState(), ...createOnuListState() });
    state.encryptedBackup = createEncryptedBackupState();

    const selectedOlt = computed(() => state.olts.find((olt) => olt.id === state.selectedOltId) || state.olts[0] || {});
    const resourceUserPageRows = computed(() => {
      const start = (state.resource.userPage - 1) * state.resource.pageSize;
      return state.resource.users.slice(start, start + state.resource.pageSize);
    });
    let mergedOnuSyncTimer = null;
    const showOltSelector = computed(() => !["dashboard", "install"].includes(state.activeView));
    const filteredUnregisteredRows = computed(() => {
      let rows = state.unregisteredRows || [];
      const filterOltHost = (state.installFilterOltHost || "").trim().toLowerCase();
      if (filterOltHost) {
        rows = rows.filter((r) => (r.oltHost || "").toLowerCase() === filterOltHost || (r.oltId || "").toLowerCase() === filterOltHost);
      }
      const kw = (state.installSearchKeyword || "").trim().toLowerCase();
      if (kw) {
        rows = rows.filter((r) => {
          const serial = (r.serial || "").toLowerCase();
          const addr = (r.address || "").toLowerCase();
          const host = (r.oltHost || "").toLowerCase();
          const coord = onuCoordinateLabel(r).toLowerCase();
          return serial.includes(kw) || addr.includes(kw) || host.includes(kw) || coord.includes(kw);
        });
      }
      return rows;
    });
    function getOltUnregisteredCount(oltHost) {
      if (!oltHost) return (state.unregisteredRows || []).length;
      const target = String(oltHost).toLowerCase();
      return (state.unregisteredRows || []).filter((r) => (r.oltHost || "").toLowerCase() === target || (r.oltId || "").toLowerCase() === target).length;
    }
    function selectInstallFilterOlt(host) {
      if (state.installFilterOltHost === host) {
        state.installFilterOltHost = "";
      } else {
        state.installFilterOltHost = host || "";
      }
    }
    const installEmptyText = computed(() => {
      if (state.loading.install) return "正在并发扫描全网各 OLT 未注册 ONU，请稍候...";
      if (state.installFilterOltHost) {
        return "当前选中的 OLT (" + state.installFilterOltHost + ") 暂无未注册 ONU 设备。";
      }
      if (state.installSearchKeyword) {
        return "未匹配到包含「" + state.installSearchKeyword + "」的未注册 ONU。";
      }
      return state.installMessage || "全网所有已启用 OLT 暂未发现未注册 ONU 设备。";
    });
    const activePlanOlt = computed(() => {
      const row = state.configPlan.row;
      if (!row) return selectedOlt.value;
      return state.olts.find((o) => o.id === row.oltId || o.host === row.oltHost) || selectedOlt.value;
    });
    const configPlanDialogTitle = computed(() => {
      const olt = activePlanOlt.value;
      const vendorName = olt?.vendor === "huawei" ? "华为" : "中兴";
      const host = olt?.host ? ` ${olt.host}` : "";
      const model = olt?.model ? ` (${olt.model})` : "";
      return `未注册 ONU 配置方案 - ${vendorName}${host}${model}`;
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
    const isCurrentTemplateMultiPort = computed(() => currentConfigTemplate.value.portMode === "multi");
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
    const selectedProjectTemplate = computed(() => currentConfigTemplate.value.projectId ? currentConfigTemplate.value : null);
    const showEthPortSelector = computed(() => {
      if (state.configPlan.templateId === "zte-mdu-ott") return false;
      const cmd = currentConfigTemplate.value.commandTemplate || "";
      return cmd.includes("{{ethPort}}") || currentEthPortOptions.value.length > 0;
    });
    const showCustomVlanInput = computed(() => currentConfigTemplate.value.businessType === "custom-vlan");
    const cleanConfigPlanVariables = computed(() => {
      const vars = state.configPlan.result?.variables || {};
      const ignoredKeys = new Set(["sampleOnuId", "snAuthSerial", "slot"]);
      const result = {};
      for (const [key, value] of Object.entries(vars)) {
        if (ignoredKeys.has(key)) continue;
        if (key.startsWith("port1_") || key.startsWith("port2_") || key.startsWith("port3_") || key.startsWith("port4_")) continue;
        if (value === "" || value === null || value === undefined) continue;
        if (Array.isArray(value) && value.length === 0) continue;
        result[key] = value;
      }
      return result;
    });
    const configPlanUnsupportedMessage = computed(() => {
      const target = activePlanOlt.value;
      if (!target?.id || currentConfigTemplates.value.length) return "";
      const profile = profileById(target.deviceProfile);
      const label = profile ? `${profile.vendorLabel} ${profile.model}` : `${target.vendor || ""} ${target.model || ""}`.trim();
      return `${label || "当前设备型号"} 暂未配置可用模板，已阻止生成配置方案。`;
    });
    const chassisOptions = computed(() => uniqueSorted(currentPonPorts.value.map((port) => port.chassis), true));
    const slotOptions = computed(() => uniqueSorted(
      currentPonPorts.value
        .filter((port) => !state.filters.chassis || String(port.chassis) === String(state.filters.chassis))
        .map((port) => port.board || port.slot),
      true
    ));
    const ponOptions = computed(() => uniqueSorted(
      currentPonPorts.value
        .filter((port) => !state.filters.chassis || String(port.chassis) === String(state.filters.chassis))
        .filter((port) => !state.filters.slot || String(port.board || port.slot) === String(state.filters.slot))
        .map((port) => port.pon),
      true
    ));
    const onuGroupCounts = computed(() => countOnuGroups(state.onuRows));
    const emptyLedgerCount = computed(() => currentPonPorts.value.filter((port) => !port.address).length);
    const duplicateLedgerCount = computed(() => countDuplicateAddresses(currentPonPorts.value));
    const dashboardMetrics = computed(() => dashboardMetricsFor({
      selectedOlt: selectedOlt.value,
      status: state.status,
      unregisteredCount: state.unregisteredRows.length,
      ponPortCount: currentPonPorts.value.length,
      emptyLedgerCount: emptyLedgerCount.value
    }));
    const dashboardWorkItems = computed(() => dashboardWorkItemsFor({
      unregisteredCount: state.unregisteredRows.length,
      counts: onuGroupCounts.value,
      emptyLedgerCount: emptyLedgerCount.value,
      duplicateLedgerCount: duplicateLedgerCount.value
    }));
    const dashboardQuickActions = [
      { title: "系统配置向导", description: "一二期网管认证、OLT 纳管集成、台账与智能配置", view: "wizard" },
      { title: "打开终端", description: "自动登录当前 OLT，等待人工粘贴配置方案", action: "terminal" },
      { title: "查看未注册 ONU", description: "发现新接入设备并生成配置预览", view: "install" },
      { title: "查询 ONU 数据", description: "按地址、槽、板卡、PON 查询光功率和状态", view: "onus" },
      { title: "维护 ONU 台账", description: "编辑地址、PON 和外层 VLAN", view: "adminPonPorts" }
    ];
    const dashboardFreshness = computed(() => dashboardFreshnessFor({
      selectedOlt: selectedOlt.value,
      status: state.status,
      counts: onuGroupCounts.value,
      onuCount: state.onuRows.length,
      installMessage: state.installMessage,
      duplicateLedgerCount: duplicateLedgerCount.value,
      emptyLedgerCount: emptyLedgerCount.value
    }));
    const onuSummary = computed(() => onuSummaryFor(onuGroupCounts.value));
    const sortedOnuRows = computed(() => sortOnuRows(state.onuRows, state.sort));
    const onuEmptyText = computed(() => onuEmptyTextFor(state.filters));
    const filteredPonPorts = computed(() => {
      return ponPortFilterState.rows({
        ponPorts: state.ponPorts,
        keyword: state.ponAdminSearch,
        selectedHost: selectedOlt.value.host || ""
      });
    });
    const ponStats = computed(() => {
      const duplicateCount = countDuplicateAddresses(currentPonPorts.value);
      const emptyCount = currentPonPorts.value.filter((port) => !port.address).length;
      return `显示 ${filteredPonPorts.value.length} 条 / 当前 OLT 共 ${currentPonPorts.value.length} 条 · 全部 ${state.ponPorts.length} 条 · 重复地址 ${duplicateCount} 个 · 空地址 ${emptyCount} 条`;
    });

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

    async function enableFeishu() {
      state.feishu.saving = true;
      try {
        let settings = await window.oltManagerDesktop.feishu.enable();
        applyFeishuSettings(settings);
        for (let attempt = 0; attempt < 12 && settings.connection?.state === "connecting"; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          settings = await window.oltManagerDesktop.feishu.read();
          applyFeishuSettings(settings);
        }
        if (settings.connection?.state === "connected") {
          ElMessage.success("飞书机器人已启用并连接");
        } else if (["connecting", "reconnecting"].includes(settings.connection?.state)) {
          ElMessage.warning("飞书长连接仍在重试，请确认开放平台已启用机器人和长连接事件订阅");
        } else {
          ElMessage.warning(settings.connection?.lastError || "飞书机器人已启用，但尚未连接；请检查应用配置后重试");
        }
      } catch (error) {
        state.feishu.error = error.message || "飞书机器人启用失败";
        ElMessage.error(state.feishu.error);
      } finally {
        state.feishu.saving = false;
      }
    }

    async function stopFeishu() {
      state.feishu.saving = true;
      try {
        const settings = await window.oltManagerDesktop.feishu.stop();
        applyFeishuSettings(settings);
        ElMessage.success("飞书机器人已停止");
      } catch (error) {
        state.feishu.error = error.message || "飞书机器人停止失败";
        ElMessage.error(state.feishu.error);
      } finally {
        state.feishu.saving = false;
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

    const templateEditorInputRef = ref(null);
    const templateContextMenu = reactive({
      visible: false,
      x: 0,
      y: 0,
      selectionStart: 0,
      selectionEnd: 0
    });
    const showVariablePalette = ref(false);

    const groupedTemplateVariables = computed(() => {
      const vars = state.templateEditor.variables || [];
      const groups = [
        { key: "coordinate", title: "设备与坐标", items: [] },
        { key: "business", title: "业务与VLAN", items: [] },
        { key: "port", title: "物理端口 (支持逐行展开)", items: [] },
        { key: "onu", title: "终端与SN", items: [] }
      ];
      const groupMap = new Map(groups.map((g) => [g.key, g]));
      const otherGroup = { key: "other", title: "其他参数", items: [] };

      for (const v of vars) {
        const cat = v.category || "other";
        const target = groupMap.get(cat) || otherGroup;
        target.items.push(v);
      }

      const res = groups.filter((g) => g.items.length > 0);
      if (otherGroup.items.length > 0) res.push(otherGroup);
      return res;
    });

    const filteredEditorTemplates = computed(() => {
      const list = state.templateEditor.templates || [];
      const vendor = state.templateEditor.filterVendor;
      const kw = (state.templateEditor.searchKeyword || "").trim().toLowerCase();
      return list.filter((t) => {
        if (vendor && t.vendor?.toLowerCase() !== vendor.toLowerCase()) return false;
        if (kw) {
          const matchName = t.name?.toLowerCase().includes(kw);
          const matchRemark = t.remark?.toLowerCase().includes(kw);
          const matchId = t.id?.toLowerCase().includes(kw);
          if (!matchName && !matchRemark && !matchId) return false;
        }
        return true;
      });
    });

    const renderedEditorPreview = computed(() => {
      const cmd = state.templateEditor.form.commandTemplate || "";
      if (!cmd) return "";
      const test = { ...state.templateEditor.testParams, vendor: state.templateEditor.form.vendor };
      const serial = test.serial || "ZTEG030C0914";
      const clean = serial.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
      let snAuth = serial;
      const m = clean.match(/^([A-Z0-9]{4})([0-9A-F]{8})$/);
      if (m) {
        snAuth = [...m[1]].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0").toUpperCase()).join("") + m[2];
      }
      const vars = {
        ...test,
        slot: test.board,
        snAuthSerial: snAuth
      };
      return renderTemplateString(cmd, vars);
    });

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

    function createNewTemplate() {
      state.templateEditor.selectedId = "";
      state.templateEditor.form = {
        id: "",
        name: "新建自定义配置方案",
        vendor: "zte",
        deviceProfiles: ["zte-c300"],
        businessType: "custom",
        portMode: "single",
        defaultParams: {
          innerVlan: "3301",
          defaultPort: "eth_0/1"
        },
        commandTemplate: `interface gpon-olt_{{chassis}}/{{board}}/{{pon}}
onu {{onuId}} type GPON-SFU sn {{serial}}
exit

interface gpon-onu_{{chassis}}/{{board}}/{{pon}}:{{onuId}}
service-port 1 vport 1 user-vlan {{innerVlan}} vlan {{innerVlan}} svlan {{outerVlan}}
exit`,
        remark: "用户自定义方案",
        isBuiltin: false
      };
    }

    function handleTemplateVendorChange(val) {
      if (val === "huawei") {
        state.templateEditor.form.deviceProfiles = ["huawei-ma5800"];
        state.templateEditor.testParams.chassis = "0";
        state.templateEditor.testParams.ethPort = "eth1";
      } else {
        state.templateEditor.form.deviceProfiles = ["zte-c300"];
        state.templateEditor.testParams.chassis = "1";
        state.templateEditor.testParams.ethPort = "eth_0/1";
      }
    }

    function insertTemplateVariable(varName) {
      const tag = `{{${varName}}}`;
      const textarea = templateEditorInputRef.value?.$el?.querySelector("textarea");
      if (!textarea) {
        state.templateEditor.form.commandTemplate += tag;
        return;
      }
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const original = state.templateEditor.form.commandTemplate || "";
      state.templateEditor.form.commandTemplate = original.slice(0, start) + tag + original.slice(end);
      nextTick(() => {
        textarea.focus();
        textarea.setSelectionRange(start + tag.length, start + tag.length);
      });
    }

    function handleTemplateEditorContextMenu(event) {
      event.preventDefault();
      const textarea = templateEditorInputRef.value?.$el?.querySelector("textarea") || event.target;
      const start = textarea?.selectionStart ?? 0;
      const end = textarea?.selectionEnd ?? start;

      const menuWidth = 320;
      const menuHeight = 440;
      let x = event.clientX;
      let y = event.clientY;

      if (x + menuWidth > window.innerWidth) {
        x = Math.max(10, window.innerWidth - menuWidth - 10);
      }
      if (y + menuHeight > window.innerHeight) {
        y = Math.max(10, window.innerHeight - menuHeight - 10);
      }

      templateContextMenu.visible = true;
      templateContextMenu.x = x;
      templateContextMenu.y = y;
      templateContextMenu.selectionStart = start;
      templateContextMenu.selectionEnd = end;
    }

    function closeTemplateContextMenu() {
      if (templateContextMenu.visible) {
        templateContextMenu.visible = false;
      }
    }

    function insertVariableFromContextMenu(varName) {
      const tag = `{{${varName}}}`;
      const textarea = templateEditorInputRef.value?.$el?.querySelector("textarea");
      if (!textarea) {
        state.templateEditor.form.commandTemplate += tag;
        closeTemplateContextMenu();
        return;
      }
      const start = templateContextMenu.selectionStart ?? textarea.selectionStart ?? 0;
      const end = templateContextMenu.selectionEnd ?? textarea.selectionEnd ?? start;
      const original = state.templateEditor.form.commandTemplate || "";
      state.templateEditor.form.commandTemplate = original.slice(0, start) + tag + original.slice(end);
      closeTemplateContextMenu();
      nextTick(() => {
        textarea.focus();
        const newPos = start + tag.length;
        textarea.setSelectionRange(newPos, newPos);
      });
    }

    async function copyAllTemplateText() {
      const text = state.templateEditor.form.commandTemplate || "";
      if (!text) {
        ElMessage.info("模板内容为空。");
        closeTemplateContextMenu();
        return;
      }
      const copied = await copyText(text);
      if (copied) ElMessage.success("已复制全部模板内容到剪贴板");
      else ElMessage.error("复制失败，请手工选择文本复制");
      closeTemplateContextMenu();
    }

    function clearTemplateText() {
      state.templateEditor.form.commandTemplate = "";
      ElMessage.info("已清空模板文本");
      closeTemplateContextMenu();
    }

    async function saveTemplate() {
      const form = state.templateEditor.form;
      if (!form.name?.trim()) {
        ElMessage.warning("方案名称不能为空。");
        return;
      }
      try {
        const res = await onuApi.saveConfigTemplate(form);
        ElMessage.success("方案已成功保存");
        await loadConfigTemplates();
        if (res.template?.id) {
          selectTemplate(res.template);
        }
      } catch (err) {
        ElMessage.error("保存方案失败: " + err.message);
      }
    }

    async function saveAsNewTemplate() {
      const form = state.templateEditor.form;
      const newName = `${form.name} (复制)`;
      try {
        const res = await onuApi.saveConfigTemplate({
          ...form,
          id: "",
          name: newName,
          isBuiltin: false
        });
        ElMessage.success(`已另存为新方案: ${newName}`);
        await loadConfigTemplates();
        if (res.template?.id) {
          selectTemplate(res.template);
        }
      } catch (err) {
        ElMessage.error("另存方案失败: " + err.message);
      }
    }

    async function deleteCurrentTemplate() {
      const form = state.templateEditor.form;
      if (!form.id || form.isBuiltin) return;
      try {
        await ElMessageBox.confirm(`确定要删除自定义方案「${form.name}」吗？此操作无法撤销。`, "删除确认", {
          confirmButtonText: "确定删除",
          cancelButtonText: "取消",
          type: "warning"
        });
        await onuApi.deleteConfigTemplate(form.id);
        ElMessage.success("方案已删除");
        state.templateEditor.selectedId = "";
        await loadConfigTemplates();
      } catch (err) {
        if (err !== "cancel") {
          ElMessage.error("删除失败: " + err.message);
        }
      }
    }

    async function resetCurrentBuiltinTemplate() {
      const form = state.templateEditor.form;
      if (!form.id || !form.isBuiltin) return;
      try {
        await ElMessageBox.confirm(`确定将内置方案「${form.name}」恢复为出厂默认设置吗？所有临时改动将被还原。`, "重置确认", {
          confirmButtonText: "确定恢复默认",
          cancelButtonText: "取消",
          type: "warning"
        });
        const res = await onuApi.resetConfigTemplate(form.id);
        ElMessage.success("已恢复出厂默认设置");
        await loadConfigTemplates();
        if (res.template) {
          selectTemplate(res.template);
        }
      } catch (err) {
        if (err !== "cancel") {
          ElMessage.error("恢复默认失败: " + err.message);
        }
      }
    }

    async function copyEditorPreview() {
      const text = renderedEditorPreview.value;
      if (!text) {
        ElMessage.warning("当前没有可复制的预览内容");
        return;
      }
      const copied = await copyText(text);
      if (copied) ElMessage.success("预览命令已成功复制到剪贴板");
      else ElMessage.error("复制失败，请手工选择文本复制");
    }

    function jumpToTemplateEditor(templateId) {
      state.configPlan.visible = false;
      setView("configTemplates");
      if (templateId) {
        const found = (state.templateEditor.templates || []).find((t) => t.id === templateId);
        if (found) selectTemplate(found);
      }
    }

    function syncConfigTemplateSelection() {
      if (!currentConfigTemplates.value.some((template) => template.id === state.configPlan.templateId)) {
        state.configPlan.templateId = currentConfigTemplates.value[0]?.id || "";
      }
    }

    function openConfigPlanDialog(row) {
      state.configPlan.visible = true;
      state.configPlan.row = row;
      state.configPlan.result = null;
      state.configPlan.templateId = currentConfigTemplates.value[0]?.id || "";
      state.configPlan.ethPorts = [...defaultEthPortsForTemplate.value];
      state.configPlan.customVlan = undefined;
      handleConfigTemplateChange();
    }

    function configPlanVariableLabel(key) {
      return {
        slot: "板卡",
        chassis: "槽/框",
        board: "板卡",
        pon: "PON口",
        serial: "序列号",
        onuId: "终端ID",
        innerVlan: "内层VLAN",
        outerVlan: "外层VLAN",
        ottVlan: "互动VLAN",
        liveVlan: "直播VLAN",
        defaultVlan: "默认下发VLAN",
        intranetVlan: "内网VLAN",
        lastOnuId: "最后终端ID",
        suggestedOnuId: "候选ONT ID",
        ledgerOuterVlan: "外层VLAN",
        sampleOnuId: "范例ID",
        ethPort: "物理端口",
        ethPorts: "已选端口",
        customVlan: "自定义VLAN",
        actualOntId: "自动ONT ID",
        address: "安装地址",
        boxAddress: "分纤箱地址",
        projectId: "项目ID",
        projectName: "项目名称",
        projectVlan: "项目VLAN"
      }[key] || key;
    }

    function formatEthPortLabel(port) {
      if (currentConfigTemplate.value.portRules?.labels?.[port]) {
        return currentConfigTemplate.value.portRules.labels[port];
      }
      const map = {
        "eth_0/1": "网口1 (eth_0/1)",
        "eth_0/2": "网口2 (eth_0/2)",
        "eth_0/3": "网口3 (eth_0/3)",
        "eth_0/4": "网口4 (eth_0/4)",
        "veip_1": "VEIP (veip_1)",
        "eth 1": "网口1 (eth 1)",
        "eth 2": "网口2 (eth 2)",
        "eth 3": "网口3 (eth 3)",
        "eth 4": "网口4 (eth 4)",
        "eth1": "网口1 (eth1)",
        "eth2": "网口2 (eth2)",
        "eth3": "网口3 (eth3)",
        "eth4": "网口4 (eth4)"
      };
      return map[port] || port;
    }

    function selectQuickEthPorts(type) {
      const options = currentEthPortOptions.value;
      if (!options.length) return;
      if (type === "single") {
        state.configPlan.ethPorts = [options[0]];
      } else if (type === "dual") {
        state.configPlan.ethPorts = options.slice(0, 2);
      } else if (type === "all") {
        const ethOnly = options.filter((p) => !p.startsWith("veip"));
        state.configPlan.ethPorts = ethOnly.length ? ethOnly : [...options];
      }
      generateConfigPlan();
    }

    function formatConfigPlanVariable(key, value) {
      if ((key === "ethPorts" || key === "ethPort") && Array.isArray(value)) return value.map(formatEthPortLabel).join(", ");
      if (key === "ethPort" && typeof value === "string") return formatEthPortLabel(value);
      if (Array.isArray(value)) return value.join(", ");
      return value || "-";
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

    async function copyRevision(revision) {
      if (!revision) return;
      const copied = await copyText(revision);
      if (copied) {
        ElMessage.success("Revision 已复制到剪贴板");
      } else {
        ElMessage.info(revision);
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

    function handleDashboardQuickAction(action) {
      if (action.action === "terminal") {
        openTerminalFromDashboard();
        return;
      }
      if (action.view) setView(action.view);
    }

    function openTerminalFromDashboard() {
      if (!window.oltManagerDesktop?.terminal) {
        ElMessage.warning("内置 Telnet 终端仅桌面版支持。");
        return;
      }
      state.terminal.status = "正在打开内置终端并自动登录...";
      state.terminal.visible = true;
    }

    async function openTerminalForConfigPlan() {
      const commands = state.configPlan.result?.commands || "";
      if (!commands) return;
      if (activePlanOlt.value?.id && activePlanOlt.value.id !== state.selectedOltId) {
        state.selectedOltId = activePlanOlt.value.id;
      }
      const copied = await copyText(commands);
      if (!window.oltManagerDesktop?.terminal) {
        ElMessage.warning(copied ? "命令已复制。内置 Telnet 终端仅桌面版支持。" : "内置 Telnet 终端仅桌面版支持，请手工复制命令。");
        return;
      }
      state.terminal.status = copied ? "配置命令已复制，正在打开内置终端..." : "正在打开内置终端，请稍后手工复制配置命令...";
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
        fontFamily: "Menlo, Consolas, 'Liberation Mono', monospace",
        fontSize: 13,
        theme: { background: "#0f172a", foreground: "#dbeafe", cursor: "#fbbf24" }
      });
      state.terminal.recentOutput = "";
      terminalFitAddon = new xtermRuntime.FitAddon();
      terminalInstance.loadAddon(terminalFitAddon);
      terminalInstance.open(terminalHost.value);
      terminalFitAddon.fit();
      terminalInstance.focus();
      terminalInstance.writeln("OLT Manager 内置 Telnet 终端");
      terminalInstance.writeln("系统不会自动粘贴或执行配置方案；可用鼠标点击“粘贴剪贴板”后人工确认。");

      const isHuawei = String(selectedOlt.value.vendor || "").toLowerCase() === "huawei";
      attachTerminalKeydownGuard(isHuawei);
      attachTerminalPasteGuard();
      terminalInstance.attachCustomKeyEventHandler((event) => {
        if (event.type !== "keydown") return true;
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
        if (event.message) state.terminal.status = event.message;
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
      } catch (error) {
        const message = error.message || "内置终端启动失败";
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

    async function sendPastedTerminalText(text) {
      if (!state.terminal.sessionId || state.terminal.pasting) return;
      const prepared = prepareTerminalInput(text);
      const frames = terminalPasteFrames(prepared);
      const isHuawei = String(selectedOlt.value.vendor || "").toLowerCase().includes("huawei");
      if (!frames.length) return;
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
        state.terminal.status = "配置命令已发送，请检查终端回显。";
      } finally {
        if (runId === terminalPasteRun) state.terminal.pasting = false;
      }
    }

    async function pasteClipboardToTerminal() {
      if (!state.terminal.sessionId || state.terminal.pasting) return;
      try {
        const text = await navigator.clipboard?.readText?.();
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
          const text = event.clipboardData?.getData("text/plain") || await navigator.clipboard?.readText?.() || "";
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

    async function sendPiAssistantMessage() {
      const text = String(state.terminal.assistantInput || "").trim();
      if (!text || state.terminal.assistantLoading) return;
      state.terminal.assistantInput = "";
      await dispatchPiAssistantChat(text);
    }

    async function sendPiAssistantQuick(promptText) {
      if (state.terminal.assistantLoading) return;
      await dispatchPiAssistantChat(promptText);
    }

    async function dispatchPiAssistantChat(queryText) {
      const olt = selectedOlt.value || {};
      state.terminal.assistantMessages.push({
        role: "user",
        content: queryText
      });
      state.terminal.assistantLoading = true;
      scrollPiMessagesBottom();

      try {
        const payload = {
          messages: state.terminal.assistantMessages.map((m) => ({ role: m.role, content: m.content })),
          context: {
            oltId: olt.id || state.selectedOltId,
            vendor: olt.vendor,
            model: olt.deviceProfile || olt.model,
            version: olt.version,
            deviceProfile: olt.deviceProfile,
            terminalContext: state.terminal.recentOutput,
            piSdk: true,
            readonlyScope: {
              oltIds: [String(olt.id || state.selectedOltId)].filter(Boolean)
            }
          }
        };
        const res = await localAuthClient.fetch("/api/pi-agent/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        const reply = String(data.reply || "（未收到有效解答）").replace(/<think>[\s\S]*?<\/think>\s*/gi, "").trim();

        // 提取建议命令
        const codeBlocks = [];
        const regex = /```(?:[a-zA-Z0-9_-]*\n)?([\s\S]*?)```|`([^`\n]{3,80})`/g;
        let match;
        while ((match = regex.exec(reply)) !== null) {
          const cmd = (match[1] || match[2] || "").trim();
          if (cmd && !cmd.includes("\n") && (cmd.startsWith("show ") || cmd.startsWith("display ") || cmd.startsWith("interface ") || cmd.startsWith("ont ") || cmd.startsWith("configure ") || cmd.startsWith("config"))) {
            if (!codeBlocks.includes(cmd)) codeBlocks.push(cmd);
          }
        }

        state.terminal.assistantMessages.push({
          role: "assistant",
          content: reply,
          commands: codeBlocks
        });
      } catch (err) {
        state.terminal.assistantMessages.push({
          role: "assistant",
          content: `网络异常或服务未响应：${err.message || "请求失败"}`,
          commands: []
        });
      } finally {
        state.terminal.assistantLoading = false;
        scrollPiMessagesBottom();
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

    async function openAnySearchConfigDialog() {
      await loadAnySearchConfig();
      state.anysearch.dialogVisible = true;
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

    function scrollPiMessagesBottom() {
      nextTick(() => {
        if (piMessagesContainer.value) {
          piMessagesContainer.value.scrollTop = piMessagesContainer.value.scrollHeight;
        }
      });
    }

    function escapeHtml(str) {
      return String(str || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    function formatInlineMarkdown(str) {
      return escapeHtml(str)
        .replace(/\*\*([^*]+)\*\*/g, "<strong class='pi-bold'>$1</strong>")
        .replace(/`([^`\n]+)`/g, (_m, c) => `<code class="pi-inline-code" onclick="window.copyPiInlineCode(this)" title="点击复制命令">${c}</code>`);
    }

    function renderPiMessage(rawContent) {
      if (!rawContent) return "";
      let text = String(rawContent).trim();

      // 1. 保护代码块
      const codeBlocks = [];
      text = text.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_m, lang, code) => {
        const id = `__PI_CODE_${codeBlocks.length}__`;
        codeBlocks.push({ lang: lang || "bash", code: code.trim() });
        return id;
      });

      // 2. 保护表格
      const tableBlocks = [];
      text = text.replace(/(?:^[ \t]*\|[^\n]+\|[ \t]*(?:\r?\n|$))+/gm, (tableText) => {
        const lines = tableText.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        if (lines.length < 2) return tableText;

        const parseRow = (line) => line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
        const headers = parseRow(lines[0]);
        let dataStartIndex = 1;
        if (lines[1] && /^\|?[\s:-|]+\|?$/.test(lines[1])) {
          dataStartIndex = 2;
        }

        const theadHtml = `<thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>`;
        const rowsHtml = lines.slice(dataStartIndex).map((r) => {
          const cells = parseRow(r);
          return `<tr>${cells.map((c) => `<td>${formatInlineMarkdown(c)}</td>`).join("")}</tr>`;
        }).join("");

        const id = `__PI_TABLE_${tableBlocks.length}__`;
        tableBlocks.push(`<div class="pi-table-wrap"><table class="pi-rich-table">${theadHtml}<tbody>${rowsHtml}</tbody></table></div>`);
        return id;
      });

      // 3. 结构化模块标头转换
      text = text.replace(/(?:^|\n)###?\s*([^\n]+)/g, (_m, title) => {
        let badgeClass = "pi-badge-general";
        let icon = "📌";
        if (title.includes("结论") || title.includes("诊断") || title.includes("💡")) {
          badgeClass = "pi-badge-diagnosis";
          icon = "💡";
        } else if (title.includes("命令") || title.includes("对比") || title.includes("📋")) {
          badgeClass = "pi-badge-commands";
          icon = "📋";
        } else if (title.includes("指标") || title.includes("门限") || title.includes("标准") || title.includes("📊")) {
          badgeClass = "pi-badge-metrics";
          icon = "📊";
        } else if (title.includes("避坑") || title.includes("警告") || title.includes("注意") || title.includes("⚠️")) {
          badgeClass = "pi-badge-warning";
          icon = "⚠️";
        } else if (title.includes("来源") || title.includes("检索") || title.includes("文档") || title.includes("🌐")) {
          badgeClass = "pi-badge-source";
          icon = "🌐";
        }
        const cleanTitle = title.replace(/[💡📋📊⚠️🌐📌]/g, "").trim();
        return `\n<div class="pi-section-title ${badgeClass}"><span class="pi-badge-icon">${icon}</span><span class="pi-badge-text">${escapeHtml(cleanTitle)}</span></div>\n`;
      });

      // 4. 处理段落与常规文本
      const lines = text.split("\n");
      const processedLines = lines.map((line) => {
        const trimmed = line.trim();
        if (!trimmed) return "<div class='pi-spacer'></div>";
        if (trimmed.startsWith("__PI_CODE_") || trimmed.startsWith("__PI_TABLE_") || trimmed.startsWith("<div class=\"pi-section-title")) {
          return trimmed;
        }
        if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
          return `<div class="pi-list-item"><span class="pi-bullet">•</span><span>${formatInlineMarkdown(trimmed.slice(2))}</span></div>`;
        }
        if (/^\d+\.\s/.test(trimmed)) {
          const num = trimmed.match(/^(\d+)\.\s/)[1];
          const rest = trimmed.replace(/^\d+\.\s/, "");
          return `<div class="pi-step-item"><span class="pi-step-num">${num}</span><span>${formatInlineMarkdown(rest)}</span></div>`;
        }
        if (trimmed.startsWith("&gt;") || trimmed.startsWith(">")) {
          const quote = trimmed.replace(/^(&gt;|>)\s*/, "");
          return `<blockquote class="pi-blockquote">${formatInlineMarkdown(quote)}</blockquote>`;
        }
        return `<p class="pi-paragraph">${formatInlineMarkdown(trimmed)}</p>`;
      });

      let html = processedLines.join("");

      // 5. 还原表格
      html = html.replace(/__PI_TABLE_(\d+)__/g, (_m, idx) => tableBlocks[Number(idx)] || "");

      // 6. 还原代码块
      html = html.replace(/__PI_CODE_(\d+)__/g, (_m, idx) => {
        const block = codeBlocks[Number(idx)];
        if (!block) return "";
        const escapedCode = escapeHtml(block.code);
        return `<div class="pi-code-card">
          <div class="pi-code-header">
            <span class="pi-code-lang">${escapeHtml(block.lang.toUpperCase() || 'COMMAND')}</span>
            <button class="pi-copy-btn" onclick="window.copyPiCode(this)" data-code="${escapeHtml(block.code)}">复制</button>
          </div>
          <pre class="pi-code-pre"><code>${escapedCode}</code></pre>
        </div>`;
      });

      return html;
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

    function startTerminalResize(e) {
      e.preventDefault();
      state.terminal.resizing = true;
      const startX = e.clientX;
      const startWidth = Number(state.terminal.assistantWidth) || 440;
      const containerWidth = terminalLayoutRef.value?.clientWidth || 1200;
      const minTerminalWidth = Math.min(460, Math.max(320, Math.floor(containerWidth * 0.38)));
      const minAssistantWidth = 320;
      const splitterWidth = 10;
      const maxAssistantWidth = Math.max(minAssistantWidth, Math.min(680, containerWidth - minTerminalWidth - splitterWidth));

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      function onMouseMove(moveEvent) {
        // 向左拉，助手变宽；向右拉，助手变窄
        const deltaX = startX - moveEvent.clientX;
        const targetWidth = startWidth + deltaX;
        const newWidth = Math.max(minAssistantWidth, Math.min(maxAssistantWidth, Math.round(targetWidth)));
        state.terminal.assistantWidth = newWidth;
        requestAnimationFrame(() => {
          fitTerminal();
        });
      }

      function onMouseUp() {
        state.terminal.resizing = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
        nextTick(() => {
          fitTerminal();
        });
      }

      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    }

    function resetTerminalAssistantWidth() {
      const containerWidth = terminalLayoutRef.value?.clientWidth || 1200;
      const defaultWidth = Math.min(440, Math.max(340, Math.round(containerWidth * 0.38)));
      state.terminal.assistantWidth = defaultWidth;
      nextTick(() => {
        fitTerminal();
      });
    }

    const terminalDialogWidth = computed(() => "min(96vw, 1260px)");

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

    async function ensureProjectsLoaded(open) {
      if (open === false || state.projects.length) return;
      state.projects = await fetchProjects();
    }

    async function addOnuToProject(row, projectId) {
      if (!projectId) return;
      const project = state.projects.find((item) => item.id === projectId);
      if (!project) return;
      try {
        await ElMessageBox.confirm(`确认将 ONU ${onuCoordinateLabel(row)} 加入项目「${project.name}」？`, "加入项目", { type: "warning" });
        const response = await localAuthClient.fetch(`/api/admin/projects/${encodeURIComponent(projectId)}/onus`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            oltId: row.oltId || state.selectedOltId,
            chassis: String(row.chassis ?? ""),
            board: String(row.board ?? row.slot ?? ""),
            slot: String(row.board ?? row.slot ?? ""),
            pon: String(row.pon ?? ""),
            onuId: String(row.onuId ?? ""),
            serial: String(row.serial ?? ""),
            address: String(row.address ?? ""),
            vlan: String(row.vlan ?? project.vlan ?? "")
          })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "加入项目失败");
        ElMessage.success("ONU 已加入项目");
        await loadOnus();
      } catch (error) {
        if (error === "cancel" || error === "close") return;
        ElMessage.error(error.message || "加入项目失败");
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

    function disablePastDate(date) {
      return date.getTime() < new Date().setHours(0, 0, 0, 0);
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

    async function createResourceSchedule() {
      const { operation, runAt, repeatEnabled, repeatDays } = state.resourceSchedule.form;
      if (!operation || !runAt) {
        ElMessage.warning("请选择执行日期和同步类型");
        return;
      }
      state.resourceSchedule.saving = true;
      try {
        await resourceSyncApi.createTask({ operation, runAt, repeatEnabled, repeatDays });
        state.resourceSchedule.form.runAt = "";
        state.resourceSchedule.form.repeatEnabled = false;
        await loadResourceSchedules();
        ElMessage.success("定时任务已创建");
      } catch (error) {
        ElMessage.error(error.message || "定时任务创建失败");
      } finally {
        state.resourceSchedule.saving = false;
      }
    }

    async function cancelResourceSchedule(task) {
      try {
        await ElMessageBox.confirm("确认取消这个定时任务？", "取消定时任务", { type: "warning" });
        state.resourceSchedule.cancelingId = task.id;
        await resourceSyncApi.cancelTask(task.id);
        await loadResourceSchedules();
        ElMessage.success("定时任务已取消");
      } catch (error) {
        if (error === "cancel" || error === "close") return;
        ElMessage.error(error.message || "取消定时任务失败");
      } finally {
        state.resourceSchedule.cancelingId = "";
      }
    }

    async function deleteResourceSchedule(task) {
      try {
        await ElMessageBox.confirm("确认永久删除这个定时任务？已写入的用户快照不会受影响。", "删除定时任务", { type: "warning" });
        state.resourceSchedule.deletingId = task.id;
        await resourceSyncApi.deleteTask(task.id);
        await loadResourceSchedules();
        ElMessage.success("定时任务已删除");
      } catch (error) {
        if (error === "cancel" || error === "close") return;
        ElMessage.error(error.message || "删除定时任务失败");
      } finally {
        state.resourceSchedule.deletingId = "";
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

    async function initializeNmseBossWatermark() {
      try {
        const result = await ElMessageBox.prompt("请输入已人工核对的本地一期快照结束时间，例如 2026-09-07 00:00:00。", "设置一期 BOSS 初始水位", { inputPattern: /^\d{4}-\d{2}-\d{2} 00:00:00$/, inputErrorMessage: "格式必须为 YYYY-MM-DD 00:00:00。" });
        const data = await resourceSyncApi.initializeBossWatermark(result.value);
        state.mergedOnu.bossSync = { ...state.mergedOnu.bossSync, ...data.bossSync };
        ElMessage.success("一期 BOSS 初始水位已设置");
      } catch (error) {
        if (error === "cancel" || error === "close") return;
        ElMessage.error(error.message || "一期 BOSS 水位初始化失败");
      }
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

    async function syncMergedOnuDataset() {
      return syncMergedOnuOperation("full");
    }

    async function cleanupMergedOnuDuplicates() {
      state.mergedOnu.cleaningDuplicates = true;
      try {
        const res = await localAuthClient.fetch("/api/admin/merged-onu/cleanup-duplicates", {
          method: "POST"
        });
        const data = await res.json();
        if (data.ok) {
          const count = Number(data.cleanedCount || 0);
          if (count > 0) {
            ElMessage.success(`已成功自动清理 ${count} 个重复 LOID 的废弃历史快照坐标！`);
          } else {
            ElMessage.info("当前快照库数据健康，未发现重复坐标的旧快照。");
          }
          await loadMergedOnuSyncState();
        } else {
          ElMessage.error(data.error || "清理重复快照失败");
        }
      } catch (err) {
        ElMessage.error(err.message || "请求异常");
      } finally {
        state.mergedOnu.cleaningDuplicates = false;
      }
    }

    async function openMergedConflictDialog() {
      state.mergedConflictDialog.visible = true;
      state.mergedConflictDialog.loading = true;
      state.mergedConflictDialog.selectedReason = "all";
      state.mergedConflictDialog.selectedOltIp = "";
      state.mergedConflictDialog.searchKeyword = "";
      state.mergedConflictDialog.page = 1;
      try {
        const rows = await resourceSyncApi.listMergedConflicts();
        state.mergedConflictDialog.rows = rows || [];
        if (rows && rows.length > 0) {
          state.mergedConflictDialog.activeGuideKey = rows[0].reason || "network_coordinate_duplicate";
        }
      } catch (err) {
        ElMessage.error(err.message || "加载冲突明细失败");
      } finally {
        state.mergedConflictDialog.loading = false;
      }
    }

    function selectConflictCategory(reason) {
      state.mergedConflictDialog.selectedReason = reason;
      if (reason !== "all") {
        state.mergedConflictDialog.activeGuideKey = reason;
      }
      state.mergedConflictDialog.page = 1;
    }

    const conflictSummary = computed(() => {
      return summarizeConflicts(state.mergedConflictDialog.rows);
    });

    const currentConflictGuide = computed(() => {
      const key = state.mergedConflictDialog.selectedReason !== "all"
        ? state.mergedConflictDialog.selectedReason
        : (state.mergedConflictDialog.activeGuideKey || "network_coordinate_duplicate");
      return getConflictGuide(key);
    });

    const conflictOltIpList = computed(() => {
      const ips = new Set((state.mergedConflictDialog.rows || []).map((r) => r.oltIp).filter(Boolean));
      return Array.from(ips).sort();
    });

    const filteredConflictRows = computed(() => {
      return filterConflictRows(state.mergedConflictDialog.rows, {
        reason: state.mergedConflictDialog.selectedReason,
        keyword: state.mergedConflictDialog.searchKeyword,
        oltIp: state.mergedConflictDialog.selectedOltIp
      });
    });

    const pagedConflictRows = computed(() => {
      const list = filteredConflictRows.value;
      const page = state.mergedConflictDialog.page || 1;
      const size = state.mergedConflictDialog.pageSize || 15;
      return list.slice((page - 1) * size, page * size);
    });

    async function copyConflictRowInfo(row) {
      const guide = getConflictGuide(row.reason);
      const text = `【双端冲突自主裁决审计信息】
冲突类型：${guide.label} (${guide.severity})
OLT 设备 IP：${row.oltIp || '未指定'}
物理端口/坐标：${row.onuIndexDisplay || '未解析'}
LOID：${row.loid || '无'}
裁决详情：${row.detail || '无'}
系统容错：${guide.tolerance}
处理结论：${guide.suggestion}`;
      const ok = await copyText(text);
      if (ok) {
        ElMessage.success("已复制该条自主裁决审计信息至剪贴板");
      }
    }

    async function exportConflictsExcel() {
      try {
        const XLSX = await loadXlsx();
        const rows = filteredConflictRows.value;
        if (!rows.length) {
          ElMessage.warning("当前没有可导出的冲突记录");
          return;
        }
        const exportData = rows.map((r, i) => {
          const guide = getConflictGuide(r.reason);
          return {
            "序号": i + 1,
            "冲突类型": guide.label,
            "优先级": guide.severity,
            "OLT 设备 IP": r.oltIp || "",
            "物理端口/坐标": r.onuIndexDisplay || "",
            "LOID": r.loid || "",
            "冲突成因明细": r.detail || "",
            "成因剖析": guide.cause,
            "系统容错策略": guide.tolerance,
            "权威修改建议": guide.suggestion,
            "分步修改方法": guide.actionMethods.map((m) => `${m.step}.${m.title}:${m.content}`).join(" ")
          };
        });
        const worksheet = XLSX.utils.json_to_sheet(exportData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "属性比对冲突与修改建议");
        const out = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
        const blob = new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
        const fileName = `属性比对冲突与修改建议-${new Date().toISOString().slice(0, 10)}.xlsx`;
        downloadBlob(blob, fileName);
        ElMessage.success(`已成功导出 ${rows.length} 条冲突排查与处置清单！`);
      } catch (err) {
        ElMessage.error("导出 Excel 失败：" + (err.message || String(err)));
      }
    }

    async function handleRerunMergeSync() {
      state.mergedConflictDialog.visible = false;
      await syncMergedOnuOperation("full");
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

    function openOltTerminalFromMatrix(olt) {
      if (!olt) return;
      if (olt.id) {
        state.selectedOltId = olt.id;
      }
      openTerminalFromDashboard();
    }

    function selectOltForManagement(olt) {
      if (!olt) return;
      if (olt.id) {
        state.selectedOltId = olt.id;
      }
      setView("onus");
    }

    async function copyAlertPortInfo(port) {
      if (!port) return;
      const roomName = state.dashboardWorkdesk.roomName || state.oss.config.roomName || "厚街机房";
      const text = `【重点关注 PON 业务端口整改派单】
属地机房：${roomName}
设备名称：${port.oltName} (${port.oltIp})
业务端口：${port.ponPort}
预警类型：${port.issueLabel}
当前指标：${port.metricValue}
成因剖析：${port.detail}
排障建议：${port.suggestion}`;
      const ok = await copyText(text);
      if (ok) {
        ElMessage.success(`已复制 ${port.ponPort} 端口整改派单信息至剪贴板`);
      }
    }

    const userOnlineDash = computed(() => {
      const p = state.dashboardWorkdesk.donutCharts?.userOnline?.percent || 0;
      return `${p} ${Math.max(0, 100 - p)}`;
    });

    const userOfflineDash = computed(() => {
      const p = state.dashboardWorkdesk.donutCharts?.userOnline?.percent || 0;
      return `${Math.max(0, 100 - p)} ${p}`;
    });

    const userOfflineOffset = computed(() => {
      const p = state.dashboardWorkdesk.donutCharts?.userOnline?.percent || 0;
      return -p;
    });

    const opticalExcellentDash = computed(() => {
      const p = state.dashboardWorkdesk.donutCharts?.opticalHealth?.percent || 0;
      return `${p} ${Math.max(0, 100 - p)}`;
    });

    const opticalMildDash = computed(() => {
      const mild = state.dashboardWorkdesk.donutCharts?.opticalHealth?.segments?.[1]?.percent || 0;
      return `${mild} ${Math.max(0, 100 - mild)}`;
    });

    const opticalMildOffset = computed(() => {
      const p = state.dashboardWorkdesk.donutCharts?.opticalHealth?.percent || 0;
      return -p;
    });

    const opticalSevereDash = computed(() => {
      const severe = state.dashboardWorkdesk.donutCharts?.opticalHealth?.segments?.[2]?.percent || 0;
      return `${severe} ${Math.max(0, 100 - severe)}`;
    });

    const opticalSevereOffset = computed(() => {
      const p = state.dashboardWorkdesk.donutCharts?.opticalHealth?.percent || 0;
      const mild = state.dashboardWorkdesk.donutCharts?.opticalHealth?.segments?.[1]?.percent || 0;
      return -(p + mild);
    });

    function openOltAlertsDialog(olt) {
      if (!olt) return;
      state.oltAlertsDialog.olt = olt;
      state.oltAlertsDialog.ports = olt.alertPorts || [];
      state.oltAlertsDialog.visible = true;
    }

    function openWeakUsersDialog(port) {
      if (!port) return;
      state.weakUsersDialog.ponPort = port.ponPort || "";
      state.weakUsersDialog.fullPortDisplay = port.fullPortDisplay || (port.oltIp ? `${port.oltIp}/${port.ponPort}` : "");
      state.weakUsersDialog.primaryBoxAddress = port.primaryBoxAddress || port.primaryArea || "未配置一级箱";
      state.weakUsersDialog.primaryArea = state.weakUsersDialog.primaryBoxAddress;
      state.weakUsersDialog.oltIp = port.oltIp || "";
      state.weakUsersDialog.users = port.weakUsers || [];
      state.weakUsersDialog.visible = true;
    }

    async function copyWeakUsersText() {
      const users = state.weakUsersDialog.users || [];
      if (!users.length) {
        ElMessage.warning("暂无弱光用户资料");
        return;
      }
      const portName = state.weakUsersDialog.fullPortDisplay || state.weakUsersDialog.ponPort;
      const boxAddr = state.weakUsersDialog.primaryBoxAddress || state.weakUsersDialog.primaryArea || "未配置一级箱";
      const lines = [
        `【PON 业务端口 ${portName} (${boxAddr}) 弱光用户整改清单 (共 ${users.length} 户)】`,
        `所属设备 IP: ${state.weakUsersDialog.oltIp}`,
        `一级箱物理地址: ${boxAddr}`,
        `---------------------------------------------`
      ];
      users.forEach((u, i) => {
        lines.push(`${i + 1}. [${u.onuIndex}] ${u.username} (LOID: ${u.loid}) - 光功率: ${u.rxPower} - 状态: ${u.phase} - 安装地址: ${u.address}`);
      });
      const ok = await copyText(lines.join("\n"));
      if (ok) {
        ElMessage.success("已复制全部弱光用户资料至剪贴板");
      }
    }

    function selectWorkdeskType(type) {
      state.dashboardWorkdesk.selectedType = type;
      state.dashboardWorkdesk.page = 1;
    }

    const workdeskOltList = computed(() => {
      if (Array.isArray(state.dashboardWorkdesk.olts) && state.dashboardWorkdesk.olts.length > 0) {
        return state.dashboardWorkdesk.olts;
      }
      return state.olts || [];
    });

    const filteredWorkdeskRows = computed(() => {
      let rows = state.dashboardWorkdesk.remediationRows || [];
      const type = state.dashboardWorkdesk.selectedType;
      if (type && type !== "all") {
        rows = rows.filter((r) => r.type === type);
      }
      const oltIp = state.dashboardWorkdesk.selectedOltIp;
      if (oltIp) {
        rows = rows.filter((r) => r.oltIp === oltIp);
      }
      const keyword = String(state.dashboardWorkdesk.searchKeyword || "").trim().toLowerCase();
      if (keyword) {
        rows = rows.filter((r) => {
          const matchName = String(r.username || "").toLowerCase().includes(keyword);
          const matchLoid = String(r.loid || "").toLowerCase().includes(keyword);
          const matchIp = String(r.oltIp || "").toLowerCase().includes(keyword);
          const matchPort = String(r.onuIndexDisplay || "").toLowerCase().includes(keyword);
          const matchAddr = String(r.installationAddress || "").toLowerCase().includes(keyword);
          const matchDetail = String(r.detail || "").toLowerCase().includes(keyword);
          const matchMetric = String(r.metricValue || "").toLowerCase().includes(keyword);
          const matchOltName = String(r.oltName || "").toLowerCase().includes(keyword);
          return matchName || matchLoid || matchIp || matchPort || matchAddr || matchDetail || matchMetric || matchOltName;
        });
      }
      return rows;
    });

    const pagedWorkdeskRows = computed(() => {
      const rows = filteredWorkdeskRows.value;
      const page = state.dashboardWorkdesk.page || 1;
      const size = state.dashboardWorkdesk.pageSize || 15;
      return rows.slice((page - 1) * size, page * size);
    });

    async function copyRemediationInfo(row) {
      const roomName = state.dashboardWorkdesk.roomName || state.oss.config.roomName || "厚街机房";
      const orgName = state.dashboardWorkdesk.organizationName || state.oss.config.organizationName || "东莞分公司";
      const text = `【现场排障与隐患治理工单】
隐患类型：${row.typeLabel || '排障项'} (${row.severity || '高'}优先级)
机房属地：${roomName} (${orgName})
所属 OLT：${row.oltName || 'OLT设备'} (${row.oltIp || ''})
物理端口：${row.onuIndexDisplay || '未解析'}
用户姓名：${row.username || '未知'}
认证 LOID：${row.loid || '无'}
安装地址：${row.installationAddress || '未登记或整口设备'}
核心指标：${row.metricValue || ''}
隐患成因：${row.detail || ''}
建议措施：${row.actionLabel || '现场核检处理'}`;

      const ok = await copyText(text);
      if (ok) {
        ElMessage.success("已复制排障工单信息至剪贴板，可直接发送微信或派单系统");
      }
    }

    async function exportWorkdeskExcel() {
      try {
        const XLSX = await loadXlsx();
        const rows = filteredWorkdeskRows.value;
        if (!rows.length) {
          ElMessage.warning("当前没有可导出的排障隐患记录");
          return;
        }
        const roomName = state.dashboardWorkdesk.roomName || "厚街机房";
        const exportData = rows.map((r, i) => ({
          "序号": i + 1,
          "隐患类型": r.typeLabel || "",
          "优先级": r.severity || "",
          "所属 OLT": r.oltName || "",
          "OLT 设备 IP": r.oltIp || "",
          "物理端口/坐标": r.onuIndexDisplay || "",
          "用户姓名": r.username || "",
          "认证 LOID": r.loid || "",
          "安装地址": r.installationAddress || "",
          "核心指标/表现": r.metricValue || "",
          "隐患成因剖析": r.detail || "",
          "排障行动建议": r.actionLabel || ""
        }));
        const worksheet = XLSX.utils.json_to_sheet(exportData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, `${roomName}-待处置隐患清单`);
        const out = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
        const blob = new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
        const fileName = `${roomName}-待处置隐患清单-${new Date().toISOString().slice(0, 10)}.xlsx`;
        downloadBlob(blob, fileName);
        ElMessage.success(`已成功导出 ${rows.length} 条机房排障与隐患清单！`);
      } catch (err) {
        ElMessage.error("导出 Excel 失败：" + (err.message || String(err)));
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

    async function loadOssResourceConfig() {
      const config = await ossResourceApi.config();
      applyOssResourceConfig(config);
      return config;
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

    async function logoutOssResource() {
      try {
        await ossResourceApi.logout();
        Object.assign(state.oss, ossLogoutProjection());
        ElMessage.success("已退出网管二期");
      } catch (error) {
        ElMessage.error(error.message || "退出网管二期失败");
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

    async function loginResourceManagement() {
      state.resource.loginLoading = true;
      try {
        const data = await resourceManagementApi.login({ password: state.resource.config.password });
        state.resource.loggedIn = true;
        ElMessage.success(`资源管理系统登录成功，发现 ${data.oltCount} 台 OLT`);
      } catch (error) {
        ElMessage.error(error.message || "资源管理系统登录失败");
      } finally {
        state.resource.loginLoading = false;
      }
    }

    async function logoutResourceManagement() {
      try {
        await resourceManagementApi.logout();
        state.resource.loggedIn = false;
        ElMessage.success("已退出资源管理系统");
      } catch (error) {
        ElMessage.error(error.message || "退出失败");
      }
    }

    async function syncResourceVlans() {
      state.resource.vlanSyncing = true;
      try {
        const data = await resourceManagementApi.syncVlans(selectedOlt.value.id);
        state.ponPorts = await fetchPonPorts();
        ponPortFilterState.reset(state.ponPorts);
        ElMessage.success(`已同步 ${data.count} 个 PON 的外层 VLAN 到本地台账`);
      } catch (error) {
        if (/未登录|会话已失效/.test(error.message || "")) state.resource.loggedIn = false;
        ElMessage.error(error.message || "VLAN 同步失败");
      } finally {
        state.resource.vlanSyncing = false;
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

    function queryAddressSuggestions(queryString, callback) {
      const keyword = String(queryString || "").trim().toLowerCase();
      const values = state.ponPorts
        .filter((port) => port.address && (!keyword || port.address.toLowerCase().includes(keyword)))
        .map((port) => {
          const olt = state.olts.find((item) => item.host === port.oltIp);
          return {
            value: `${port.address} · ${olt?.name || port.oltIp} · ${port.ponPort}`,
            address: port.address,
            oltIp: port.oltIp,
            oltId: olt?.id || "",
            chassis: port.chassis || defaultChassisForVendor(olt?.vendor),
            slot: port.board || port.slot,
            board: port.board || port.slot,
            pon: port.pon
          };
        })
        .sort((a, b) => a.value.localeCompare(b.value, "zh-Hans-CN"))
        .slice(0, 80);
      callback(values);
    }

    async function handleAddressSelect(item) {
      state.filters.search = item.address;
      state.filters.chassis = item.chassis || "";
      state.filters.slot = item.slot || "";
      state.filters.pon = item.pon || "";
      await switchOltForGlobalSearch(item.oltIp);
      saveFilters();
      await loadOnus();
    }

    function handleChassisChange() {
      state.filters.slot = "";
      state.filters.pon = "";
      saveFilters();
    }

    function handleSlotChange() {
      state.filters.pon = "";
      saveFilters();
    }

    function handleOnuSort({ prop, order }) {
      state.sort.field = order ? prop || "" : "";
      state.sort.direction = order || "ascending";
    }

    async function loadOnuConfig(row, target) {
      target.loading = true;
      target.data = null;
      try {
        target.data = await onuApi.config(row);
      } catch (error) {
        ElMessage.error(error.message);
      } finally {
        target.loading = false;
      }
    }

    function openTerminalForOnuConfig(row) {
      if (!row) return;
      const olt = selectedOlt.value || {};
      const commands = buildOnuConfigTerminalCommands({
        vendor: olt.vendor,
        model: olt.model,
        deviceProfile: olt.deviceProfile,
        chassis: row.chassis,
        board: row.board,
        slot: row.slot,
        pon: row.pon,
        onuId: row.onuId
      });

      if (!window.oltManagerDesktop?.terminal) {
        ElMessage.info(`内置终端仅桌面版支持。查看命令已就绪：${commands.join(" ; ")}`);
        return;
      }

      const isHuawei = String(olt.vendor || "").toLowerCase().includes("huawei");
      if (state.terminal.visible && state.terminal.sessionId) {
        commands.forEach((cmd, idx) => {
          setTimeout(() => {
            sendTerminalInput(cmd + "\r");
            if (isHuawei) {
              setTimeout(() => {
                sendTerminalInput("\r");
              }, 200);
            }
          }, idx * 600);
        });
        state.terminal.status = `已自动执行只读查看命令：${commands.join(" & ")}`;
      } else {
        state.terminal.pendingCommands = commands;
        state.terminal.pendingCommand = commands[0];
        state.terminal.status = `正在连接终端并自动执行：${commands.join(" & ")}...`;
        state.terminal.visible = true;
      }
    }

    function openOnuConfig(row) {
      openTerminalForOnuConfig(row);
    }

    async function openOnuDetail(row) {
      state.onuDetail.visible = true;
      state.oss.historyRows = [];
      state.oss.historyError = "";
      await Promise.all([
        loadOnuConfig(row, state.onuDetail),
        loadOssResourceConfig().catch(() => null)
      ]);
    }

    async function loadOssOpticalHistory() {
      const detail = state.onuDetail.data;
      const request = ossHistoricalOpticalRequestFor({ detail, dateRange: state.oss.dateRange });
      if (!request.ok) {
        ElMessage.warning(request.error);
        return;
      }
      state.oss.historyLoading = true;
      state.oss.historyError = "";
      state.oss.historyRows = [];
      try {
        const result = await ossResourceApi.historicalOptical(request.payload);
        state.oss.historyRows = ossHistoryRowsFromResponse(result);
        ElMessage.success(`读取到 ${state.oss.historyRows.length} 条历史光功率记录`);
      } catch (error) {
        state.oss.historyError = error.message || "历史光功率读取失败";
        if (/未登录|会话已失效/.test(state.oss.historyError)) state.oss.loggedIn = false;
        ElMessage.error(state.oss.historyError);
      } finally {
        state.oss.historyLoading = false;
      }
    }

    function addAdminOlt() {
      const profile = defaultProfileForVendor("zte");
      state.adminOlts.push({
        id: `olt-${Date.now()}`,
        name: "新 OLT",
        vendor: profile.vendor,
        model: profile.model,
        deviceProfile: profile.id,
        version: "V2.1",
        host: "",
        snmpPort: 161,
        readCommunity: "public",
        telnetPort: 23,
        telnetUsername: "",
        telnetPassword: "",
        enabled: true
      });
    }

    function adminProfilesForVendor(vendor) {
      return profilesForVendor(vendor);
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

    function deleteAdminOlt(index) {
      state.adminOlts.splice(Number(index), 1);
    }

    async function saveAdminOlts() {
      state.loading.admin = true;
      try {
        const data = await oltAdminApi.save(state.adminOlts.map(normalizeAdminOltRow));
        state.olts = data.olts;
        state.adminOlts = (data.adminOlts || data.olts).map(normalizeAdminOltRow);
        if (!state.olts.some((olt) => olt.id === state.selectedOltId)) state.selectedOltId = state.olts[0]?.id || "";
        ElMessage.success("设备信息已保存");
      } catch (error) {
        ElMessage.error(error.message);
      } finally {
        state.loading.admin = false;
      }
    }

    async function fetchProjects() {
      return projectApi.list(state.projectSearch);
    }

    async function loadProjects() {
      state.loading.admin = true;
      try {
        const projects = await fetchProjects();
        state.projects = projects;
        await syncSelectedProjectAfterProjectListChange();
      } catch (error) {
        ElMessage.error(error.message);
      } finally {
        state.loading.admin = false;
      }
    }

    function openProjectDialog(project) {
      state.projectDialog.form = projectFormFor(project);
      state.projectDialog.visible = true;
    }

    async function saveProject() {
      const form = state.projectDialog.form;
      state.projectDialog.loading = true;
      try {
        const savedProject = await projectApi.save(form);
        state.projectDialog.visible = false;
        const projects = await fetchProjects();
        state.projects = projects;
        const saved = savedProject?.id ? projects.find((project) => project.id === savedProject.id) : null;
        await syncSelectedProjectAfterProjectListChange(saved);
        ElMessage.success("项目已保存");
      } catch (error) {
        ElMessage.error(error.message);
      } finally {
        state.projectDialog.loading = false;
      }
    }

    async function deleteProject(project) {
      try {
        await ElMessageBox.confirm(`确认删除项目「${project.name}」？\n只会删除本地项目和项目 ONU 关联，不会删除 OLT 实机 ONU。`, "删除确认", { type: "warning" });
        await projectApi.remove(project.id);
        const projects = await fetchProjects();
        state.projects = projects;
        await syncSelectedProjectAfterProjectListChange();
        ElMessage.success("项目已删除");
      } catch (error) {
        if (error === "cancel" || error === "close") return;
        ElMessage.error(error.message || "删除项目失败");
      }
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

    function selectProjectOnu(row) {
      state.projectDetail.selectedOnu = row || null;
    }

    function projectOnuRowClassName({ row }) {
      return projectOnuRowClassNameFor(row, state.projectDetail.selectedOnu);
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

    async function saveProjectOnuNote(row) {
      const project = state.projectDetail.project;
      if (!project?.id || !row?.id) return;
      row.savingNote = true;
      try {
        const onu = await projectApi.updateOnuNote(project.id, row.id, row.noteDraft);
        row.note = onu?.note || "";
        row.noteDraft = row.note;
        ElMessage.success("设备安装地址已修改");
      } catch (error) {
        ElMessage.error(error.message || "保存设备安装地址失败");
      } finally {
        row.savingNote = false;
      }
    }

    async function removeProjectOnu(row) {
      const project = state.projectDetail.project;
      if (!project?.id || !row?.id) return;
      try {
        await ElMessageBox.confirm(`确认从项目「${project.name}」移除 ONU ${onuCoordinateLabel(row)}？\n只删除本地项目关联，不会删除 OLT 实机 ONU。`, "移除项目 ONU", { type: "warning" });
        row.removing = true;
        await projectApi.removeOnu(project.id, row.id);
        const projectOnuState = removeProjectOnuRow(state.projectDetail.onus, state.projectDetail.selectedOnu?.id, row.id);
        state.projectDetail.onus = projectOnuState.rows;
        state.projectDetail.selectedOnu = projectOnuState.selectedOnu;
        if (state.activeView === "onus") await loadOnus();
        ElMessage.success("项目 ONU 已移除");
      } catch (error) {
        if (error === "cancel" || error === "close") return;
        ElMessage.error(error.message || "移除项目 ONU 失败");
      } finally {
        row.removing = false;
      }
    }

    function addPonPort() {
      state.ponPorts.unshift({
        oltIp: selectedOlt.value.host || "",
        chassis: defaultChassisForVendor(selectedOlt.value.vendor),
        board: "",
        slot: "",
        pon: "",
        ponPort: "",
        outerVlan: "",
        address: ""
      });
      state.ponAdminSearch = "";
      nextTick(() => ElMessage.success("已新增一行"));
    }

    async function fetchPonPorts() {
      return ponAdminApi.list();
    }

    async function deletePonPort(index) {
      const port = state.ponPorts[Number(index)];
      if (!port) return;
      const label = `${port.oltIp || ""} ${port.ponPort || ""} ${port.address || ""}`.trim();
      try {
        await ElMessageBox.confirm(`确认删除这条 PON 台账？\n${label}`, "删除确认", { type: "warning" });
        state.ponPorts.splice(Number(index), 1);
      } catch {}
    }

    async function savePonPorts() {
      state.loading.admin = true;
      try {
        const rows = state.ponPorts
          .map((port) => ({
            oltIp: String(port.oltIp || "").trim(),
            chassis: String(port.chassis || "").trim(),
            board: String(port.board || port.slot || "").trim(),
            slot: String(port.board || port.slot || "").trim(),
            pon: String(port.pon || "").trim(),
            ponPort: ponCoordinateKey(port) || String(port.ponPort || "").trim(),
            outerVlan: String(port.outerVlan || "").trim(),
            address: String(port.address || "").trim()
          }))
          .filter((port) => port.oltIp && (port.ponPort || (port.board && port.pon)));
        const data = await ponAdminApi.save(rows, "保存失败");
        state.ponPorts = await fetchPonPorts();
        ponPortFilterState.reset(state.ponPorts);
        ElMessage.success(`已保存 ${data.count} 条`);
      } catch (error) {
        ElMessage.error(error.message);
      } finally {
        state.loading.admin = false;
      }
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

    async function exportEncryptedBackup() {
      const validation = validateEncryptedBackupPassword(state.encryptedBackup.password, state.encryptedBackup.confirmation);
      if (!validation.valid) {
        ElMessage.error(validation.reason === "mismatch" ? "两次输入的主密码不一致" : "主密码至少需要 8 位");
        return;
      }
      state.encryptedBackup.exporting = true;
      const password = state.encryptedBackup.password;
      try {
        downloadBlob(await backupApi.exportEncrypted(password), `olt-manager-backup-${new Date().toISOString().slice(0, 10)}.sqlite.enc`);
        ElMessage.success("加密 SQLite 备份已导出");
      } catch {
        ElMessage.error("加密备份导出失败");
      } finally {
        state.encryptedBackup = clearEncryptedBackupPasswords(state.encryptedBackup);
        state.encryptedBackup.exporting = false;
      }
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

    function triggerExcelImport() {
      document.getElementById("pon-excel-input")?.click();
    }

    async function saveImportedPonRows(rows, successLabel = "导入") {
      if (!rows.length) throw new Error("没有识别到可导入的台账行");
      const data = await ponAdminApi.save(rows, `${successLabel}失败`);
      state.ponPorts = await fetchPonPorts();
      ponPortFilterState.reset(state.ponPorts);
      ElMessage.success(`已${successLabel} ${data.count} 条`);
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

    async function confirmImportPonRows() {
      const validRows = state.ponImportPreview.validRows || [];
      if (!validRows.length) return;
      state.ponImportPreview.loading = true;
      try {
        await saveImportedPonRows(validRows, "导入 Excel");
        state.ponImportPreview.visible = false;
      } catch (error) {
        ElMessage.error(error.message || "应用台账导入失败");
      } finally {
        state.ponImportPreview.loading = false;
      }
    }

    const wizardFileInputRef = ref(null);

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

    const canWizardProceed = computed(() => {
      return canProceedToNextStep(state.wizard.currentStep, state);
    });

    const distinctOltCountInPonPorts = computed(() => {
      const hosts = new Set((state.ponPorts || []).map((p) => p.host || p.oltIp).filter(Boolean));
      return hosts.size;
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

    function addCustomWizardOlt() {
      const nextIndex = (state.oss.olts?.length || 0) + 1;
      const newOlt = {
        id: `custom-olt-${Date.now().toString(36)}`,
        name: `新 OLT 设备 ${nextIndex}`,
        host: "172.19.104.",
        vendor: "zte",
        deviceProfile: "zte-c300",
        roomName: state.oss.config.roomName || "本地机房",
        resourceIp: ""
      };
      if (!Array.isArray(state.oss.olts)) state.oss.olts = [];
      state.oss.olts.push(newOlt);
      state.wizard.selectedOssOlts.push(getOssOltRowKey(newOlt));
      ElMessage.success("已添加一行自定义 OLT，请在表格中填写本地管理 IP 和名称");
    }

    function removeWizardOssOltRow(index) {
      if (!Array.isArray(state.oss.olts)) return;
      const removed = state.oss.olts.splice(index, 1)[0];
      if (removed) {
        const key = getOssOltRowKey(removed);
        const idx = state.wizard.selectedOssOlts.indexOf(key);
        if (idx >= 0) state.wizard.selectedOssOlts.splice(idx, 1);
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

    function handleWizardRowVendorChange(row) {
      handleAdminVendorChange(row);
    }

    function wizardNextStep() {
      try {
        if (state.wizard.currentStep === 1) {
          const resourceLoggedIn = Boolean(state.resource?.loggedIn);
          const ossLoggedIn = Boolean(state.oss?.loggedIn);
          if (!resourceLoggedIn && !ossLoggedIn) {
            const hasExisting = (state.adminOlts && state.adminOlts.length > 0) || (state.olts && state.olts.length > 0);
            if (hasExisting) {
              ElMessage.info("网管尚未登录，已为您转至设备选择步骤（可使用系统已有设备或手动录入）");
            } else {
              ElMessage.info("网管尚未登录，已为您转至设备选择步骤（支持手动录入待纳管设备）");
            }
          }
        } else if (state.wizard.currentStep === 2) {
          syncWizardOltDraftsFromSelection();
          const selected = state.wizard?.selectedOssOlts || [];
          const drafts = state.wizard?.oltDrafts || [];
          const adminOlts = state.adminOlts || [];
          if (selected.length === 0 && drafts.length === 0 && adminOlts.length === 0) {
            ElMessage.warning("请至少选择或添加 1 台待纳管 OLT 设备");
            return;
          }
        } else if (state.wizard.currentStep === 5) {
          const datasetSynced = Boolean(state.mergedOnu?.dataset?.synced);
          const networkSynced = Boolean(state.mergedOnu?.sources?.network?.synced);
          const nmseSynced = Boolean(state.mergedOnu?.sources?.nmse?.synced);
          if (!datasetSynced && !networkSynced && !nmseSynced) {
            ElMessage.info("网管数据尚未同步，您可以稍后在控制台同步，已为您进入下一步");
          }
        }
        if (state.wizard.currentStep < 7) {
          state.wizard.currentStep += 1;
        }
      } catch (err) {
        console.error("[wizard] 切换至下一步异常:", err);
        ElMessage.error(err.message || "切换步骤失败");
      }
    }

    function wizardPrevStep() {
      if (state.wizard.currentStep > 1) {
        state.wizard.currentStep -= 1;
      }
    }

    function wizardSkipStep() {
      if (state.wizard.currentStep < 7) {
        state.wizard.currentStep += 1;
      }
    }

    function completeWizard() {
      state.wizard.completed = true;
      try {
        localStorage.setItem("olt_wizard_completed", "true");
      } catch (_) {}
      ElMessage.success("恭喜！系统配置向导已顺利完成。");
      setView("dashboard");
    }

    function dismissWizardBanner() {
      state.wizardDismissed = true;
      try {
        localStorage.setItem("olt_wizard_dismissed", "true");
      } catch (_) {}
    }

    function wizardGoToStep(step) {
      if (step >= 1 && step <= 7) {
        if (state.wizard.currentStep === 2 && step === 3) {
          syncWizardOltDraftsFromSelection();
        }
        state.wizard.currentStep = step;
      }
    }

    async function testWizardResourceLogin() {
      state.wizard.resourceTestStatus = "testing";
      state.wizard.resourceTestMessage = "正在保存并测试登录一期网管...";
      try {
        await saveResourceManagementConfig();
        const data = await resourceManagementApi.login({ password: state.resource.config.password });
        state.resource.loggedIn = true;
        state.wizard.resourceTestStatus = "success";
        state.wizard.resourceTestMessage = `一期网管连接成功，发现 ${data.oltCount || 0} 台 OLT`;
        ElMessage.success(state.wizard.resourceTestMessage);
      } catch (error) {
        state.resource.loggedIn = false;
        state.wizard.resourceTestStatus = "error";
        state.wizard.resourceTestMessage = error.message || "一期网管登录失败";
        ElMessage.error(state.wizard.resourceTestMessage);
      }
    }

    async function testWizardOssLogin() {
      state.wizard.ossTestStatus = "testing";
      state.wizard.ossTestMessage = "正在保存并测试登录二期网管...";
      try {
        await loginOssResource({ autoLogin: false, quiet: true });
        if (state.oss.loggedIn) {
          state.wizard.ossTestStatus = "success";
          state.wizard.ossTestMessage = `二期网管登录成功，发现 ${state.oss.olts?.length || 0} 台 OLT`;
          state.oss.olts = enrichOssOltsWithExisting(state.oss.olts);
          state.wizard.selectedOssOlts = state.oss.olts.map(getOssOltRowKey);
          ElMessage.success(state.wizard.ossTestMessage);
        } else {
          throw new Error("二期网管登录未完成");
        }
      } catch (error) {
        state.wizard.ossTestStatus = "error";
        state.wizard.ossTestMessage = error.message || "二期网管登录失败";
        ElMessage.error(state.wizard.ossTestMessage);
      }
    }

    function isWizardOssOltSelected(olt) {
      const key = getOssOltRowKey(olt);
      return state.wizard.selectedOssOlts.includes(key);
    }

    function toggleWizardOssOlt(olt) {
      const key = getOssOltRowKey(olt);
      const idx = state.wizard.selectedOssOlts.indexOf(key);
      if (idx >= 0) {
        state.wizard.selectedOssOlts.splice(idx, 1);
      } else {
        state.wizard.selectedOssOlts.push(key);
      }
    }

    function selectAllWizardOssOlts() {
      state.wizard.selectedOssOlts = (state.oss.olts || []).map(getOssOltRowKey);
    }

    function clearAllWizardOssOlts() {
      state.wizard.selectedOssOlts = [];
    }

    function syncWizardOltDraftsFromSelection() {
      const merged = buildOltsFromOssSelection({
        selectedOssOlts: state.wizard.selectedOssOlts,
        ossOlts: state.oss.olts || [],
        existingOlts: state.adminOlts.length > 0 ? state.adminOlts : state.olts,
        batchCredentials: state.wizard.batchCredentials
      });
      state.wizard.oltDrafts = merged.map(normalizeAdminOltRow);
    }

    function applyWizardBatchCredentials() {
      const { community, telnetUser, telnetPassword } = state.wizard.batchCredentials;
      for (const draft of state.wizard.oltDrafts) {
        if (community) draft.snmpCommunity = community;
        if (telnetUser) draft.telnetUser = telnetUser;
        if (telnetPassword) draft.telnetPassword = telnetPassword;
      }
      ElMessage.success(`已批量应用凭据到 ${state.wizard.oltDrafts.length} 台设备`);
    }

    function handleWizardOltVendorChange(row) {
      handleAdminVendorChange(row);
    }

    function handleWizardOltProfileChange(row) {
      handleAdminProfileChange(row);
    }

    function removeWizardOltDraft(index) {
      state.wizard.oltDrafts.splice(index, 1);
    }

    async function saveWizardOlts() {
      const validation = validateOltListCredentials(state.wizard.oltDrafts);
      if (!validation.valid) {
        ElMessage.warning(validation.errors?.[0] || validation.error || "请补全 OLT 必填信息");
        return false;
      }
      state.wizard.savingOlts = true;
      try {
        const data = await oltAdminApi.save(state.wizard.oltDrafts.map(normalizeAdminOltRow));
        state.olts = data.olts;
        state.adminOlts = (data.adminOlts || data.olts).map(normalizeAdminOltRow);
        if (!state.olts.some((olt) => olt.id === state.selectedOltId)) {
          state.selectedOltId = state.olts[0]?.id || "";
        }
        ElMessage.success(`已成功纳管 ${state.olts.length} 台 OLT 设备！`);
        return true;
      } catch (error) {
        ElMessage.error(error.message || "保存 OLT 纳管失败");
        return false;
      } finally {
        state.wizard.savingOlts = false;
      }
    }

    function triggerWizardPonImport() {
      if (wizardFileInputRef.value) {
        wizardFileInputRef.value.click();
      }
    }

    async function downloadPonTemplateExcel() {
      try {
        const XLSX = await loadXlsx();
        const sampleRows = [
          {
            "OLT IP": state.olts[0]?.host || "10.22.4.2",
            "槽": "1",
            "板卡": "1",
            "PON": "1",
            "板槽端口": "1/1/1",
            "外层 VLAN": "1001",
            "地址": "示例某小区1号楼1单元"
          }
        ];
        const worksheet = XLSX.utils.json_to_sheet(sampleRows, {
          header: ["OLT IP", "槽", "板卡", "PON", "板槽端口", "外层 VLAN", "地址"]
        });
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "PON台账导入模板");
        const data = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
        const blob = new Blob([data], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        });
        downloadBlob(blob, "onu-ledger-template.xlsx");
        ElMessage.success("已下载标准台账模板");
      } catch (error) {
        ElMessage.error(error.message || "下载模板失败");
      }
    }

    async function syncWizardMergedOnu() {
      try {
        await syncMergedOnuOperation("full");
      } catch (error) {
        ElMessage.error(error.message || "触发数据同步失败");
      }
    }

    async function syncWizardAllVlans() {
      if (state.olts.length === 0) {
        ElMessage.warning("尚未纳管任何 OLT，请先在步骤 3 中保存纳管设备");
        return;
      }
      state.wizard.vlanSyncing = true;
      state.wizard.vlanResults = [];
      const results = [];
      try {
        for (const olt of state.olts) {
          try {
            const data = await resourceManagementApi.syncVlans(olt.id);
            results.push({
              oltId: olt.id,
              oltName: olt.name,
              host: olt.host,
              success: true,
              count: data.count || 0,
              message: `已同步 ${data.count || 0} 个 PON 口外层 VLAN`
            });
          } catch (err) {
            results.push({
              oltId: olt.id,
              oltName: olt.name,
              host: olt.host,
              success: false,
              count: 0,
              message: err.message || "同步失败"
            });
          }
        }
        state.wizard.vlanResults = results;
        state.ponPorts = await fetchPonPorts();
        ponPortFilterState.reset(state.ponPorts);
        const totalCount = results.reduce((sum, r) => sum + (r.count || 0), 0);
        state.wizard.vlanSummary = `完成 ${results.length} 台 OLT 的外层 VLAN 同步，累计更新 ${totalCount} 个 PON 口`;
        ElMessage.success(state.wizard.vlanSummary);
      } catch (error) {
        ElMessage.error(error.message || "批量同步 VLAN 失败");
      } finally {
        state.wizard.vlanSyncing = false;
      }
    }

    async function syncWizardSingleOltVlan(oltId) {
      try {
        const data = await resourceManagementApi.syncVlans(oltId);
        state.ponPorts = await fetchPonPorts();
        ponPortFilterState.reset(state.ponPorts);
        const target = state.wizard.vlanResults.find((r) => r.oltId === oltId);
        if (target) {
          target.success = true;
          target.count = data.count || 0;
          target.message = `已重新同步 ${data.count || 0} 个 PON 口外层 VLAN`;
        }
        ElMessage.success(`OLT 外层 VLAN 同步成功，共 ${data.count || 0} 个 PON 口`);
      } catch (error) {
        ElMessage.error(error.message || "单台 OLT VLAN 同步失败");
      }
    }

    async function saveWizardAllAiConfig() {
      state.wizard.savingAiConfig = true;
      state.wizard.aiTestStatus = "testing";
      state.wizard.aiTestMessage = "正在保存并生效智能能力配置...";
      try {
        if (!window.oltManagerDesktop?.feishu) {
          const payload = {
            feishuAppId: state.feishu.appId,
            feishuAppSecret: state.feishu.appSecret,
            anysearchApiKey: state.anysearch.apiKey,
            piProviderName: state.feishu.piAgentLanguageProviderName,
            piEndpoint: state.feishu.piAgentLanguageEndpoint,
            piModel: state.feishu.piAgentLanguageModel,
            piApiKey: state.feishu.piAgentLanguageApiKey,
            jevProviderName: state.feishu.languageProviderName,
            jevEndpoint: state.feishu.languageEndpoint,
            jevModel: state.feishu.languageModel,
            jevApiKey: state.feishu.languageApiKey
          };
          const res = await fetch("/api/admin/bot-ai/config", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
          const data = await res.json();
          if (!data || !data.ok) throw new Error(data?.error || "保存失败");
        } else {
          if (state.feishu.appId && state.feishu.appSecret) {
            await saveFeishuCredentials();
          }
          if (state.feishu.languageApiKey || state.feishu.languageEndpoint) {
            await saveLanguageProvider();
          }
          if (state.feishu.piAgentLanguageApiKey || state.feishu.piAgentLanguageEndpoint) {
            await savePiAgentLanguage();
          }
          if (state.anysearch.apiKey) {
            await saveAnySearchConfig();
          }
        }
        state.wizard.aiTestStatus = "success";
        state.wizard.aiTestMessage = "所有智能能力配置已成功保存并立即生效！";
        ElMessage.success(state.wizard.aiTestMessage);
      } catch (error) {
        state.wizard.aiTestStatus = "error";
        state.wizard.aiTestMessage = error.message || "智能能力配置保存失败";
        ElMessage.error(state.wizard.aiTestMessage);
      } finally {
        state.wizard.savingAiConfig = false;
      }
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
      terminalHost,
      terminalLayoutRef,
      state,
      showOltSelector,
      filteredUnregisteredRows,
      activePlanOlt,
      configPlanDialogTitle,
      getOltUnregisteredCount,
      selectInstallFilterOlt,
      installEmptyText,
      dashboardMetrics,
      dashboardWorkItems,
      dashboardQuickActions,
      dashboardFreshness,
      selectedOlt,
      resourceUserPageRows,
      currentConfigTemplates,
      currentEthPortOptions,
      selectedProjectTemplate,
      showEthPortSelector,
      showCustomVlanInput,
      cleanConfigPlanVariables,
      isCurrentTemplateMultiPort,
      templateEditorInputRef,
      templateContextMenu,
      showVariablePalette,
      groupedTemplateVariables,
      handleTemplateEditorContextMenu,
      closeTemplateContextMenu,
      insertVariableFromContextMenu,
      copyAllTemplateText,
      clearTemplateText,
      filteredEditorTemplates,
      renderedEditorPreview,
      loadTemplateVariables,
      selectTemplate,
      createNewTemplate,
      handleTemplateVendorChange,
      insertTemplateVariable,
      saveTemplate,
      saveAsNewTemplate,
      deleteCurrentTemplate,
      resetCurrentBuiltinTemplate,
      copyEditorPreview,
      jumpToTemplateEditor,
      configPlanUnsupportedMessage,
      chassisOptions,
      slotOptions,
      ponOptions,
      sortedOnuRows,
      onuSummary,
      onuEmptyText,
      filteredPonPorts,
      ponStats,
      phaseInfo,
      rxPowerInfo,
      ponCoordinateKey,
      onuCoordinateLabel,
      setView,
      refreshCurrent,
      loadStatus,
      loadInstallOnus,
      loadConfigTemplates,
      loadOnus,
      loadAdminData,
      loadResourceManagement,
      loadResourceUsers,
      loadMergedOnuSyncState,
      initializeNmseBossWatermark,
      loadMergedOnuSyncProgress,
      syncMergedOnuDataset,
      syncMergedOnuOperation,
      cleanupMergedOnuDuplicates,
      openMergedConflictDialog,
      selectConflictCategory,
      conflictSummary,
      currentConflictGuide,
      conflictOltIpList,
      filteredConflictRows,
      pagedConflictRows,
      copyConflictRowInfo,
      exportConflictsExcel,
      handleRerunMergeSync,
      // 方案 4：机房排障与隐患清零工作台
      loadRemediationWorkdesk,
      selectWorkdeskType,
      workdeskOltList,
      filteredWorkdeskRows,
      pagedWorkdeskRows,
      copyRemediationInfo,
      exportWorkdeskExcel,
      openOltTerminalFromMatrix,
      selectOltForManagement,
      copyAlertPortInfo,
      openOltAlertsDialog,
      openWeakUsersDialog,
      copyWeakUsersText,
      userOnlineDash,
      userOfflineDash,
      userOfflineOffset,
      opticalExcellentDash,
      opticalMildDash,
      opticalMildOffset,
      opticalSevereDash,
      opticalSevereOffset,
      getConflictGuide,
      copyRevision,
      mergedOnuSyncPhaseText,
      mergedOnuSyncStatusText,
      mergedOnuSourceStatusText,
      mergedOnuSyncPercent,
      loadFeishuSettings,
      selectManualUpdate,
      installManualUpdate,
      saveFeishuCredentials,
      saveLanguageProvider,
      savePiAgentLanguage,
      enableFeishu,
      stopFeishu,
      saveResourceManagementConfig,
      loginResourceManagement,
      logoutResourceManagement,
      syncResourceVlans,
      loadResourceSchedules,
      createResourceSchedule,
      cancelResourceSchedule,
      deleteResourceSchedule,
      disablePastDate,
      resourceScheduleStatusText,
      resourceScheduleStatusType,
      resourceScheduleOperationText,
      resourceScheduleRepeatText,
      resourceScheduleLastResult,
      resourceSyncOperations: RESOURCE_SYNC_OPERATIONS,
      loadProjects,
      loadProjectOnus,
      handleOltChange,
      handleDashboardQuickAction,
      queryAddressSuggestions,
      handleAddressSelect,
      handleChassisChange,
      handleSlotChange,
      handleOnuSort,
      openOnuConfig,
      openTerminalForOnuConfig,
      openOnuDetail,
      saveOssResourceConfig,
      loginOssResource,
      logoutOssResource,
      loadOssOpticalHistory,
      ensureProjectsLoaded,
      addOnuToProject,
      openConfigPlanDialog,
      handleConfigTemplateChange,
      configPlanVariableLabel,
      formatEthPortLabel,
      selectQuickEthPorts,
      formatConfigPlanVariable,
      generateConfigPlan,
      copyConfigPlan,
      openTerminalForConfigPlan,
      mountTerminal,
      pasteClipboardToTerminal,
      closeTerminalSession,
      piMessagesContainer,
      togglePiAssistant,
      sendPiAssistantMessage,
      sendPiAssistantQuick,
      openAnySearchConfigDialog,
      saveAnySearchConfig,
      renderPiMessage,
      startTerminalResize,
      resetTerminalAssistantWidth,
      terminalDialogWidth,
      addAdminOlt,
      adminProfilesForVendor,
      handleAdminVendorChange,
      handleAdminProfileChange,
      deleteAdminOlt,
      saveAdminOlts,
      openProjectDialog,
      selectProjectDetail,
      selectProjectOnu,
      projectOnuRowClassName,
      saveProject,
      deleteProject,
      saveProjectOnuNote,
      removeProjectOnu,
      addPonPort,
      deletePonPort,
      savePonPorts,
      exportPonPortsExcel,
      exportProjectBackup,
      exportEncryptedBackup,
      triggerExcelImport,
      triggerProjectRestore,
      restoreProjectBackup,
      importPonPortsExcel,
      confirmImportPonRows,
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
      WIZARD_STEPS,
      isSystemConfigured,
      canWizardProceed,
      distinctOltCountInPonPorts,
      wizardFileInputRef,
      initWizard,
      wizardNextStep,
      wizardPrevStep,
      wizardSkipStep,
      completeWizard,
      dismissWizardBanner,
      wizardGoToStep,
      testWizardResourceLogin,
      testWizardOssLogin,
      isWizardOssOltSelected,
      toggleWizardOssOlt,
      selectAllWizardOssOlts,
      clearAllWizardOssOlts,
      addCustomWizardOlt,
      removeWizardOssOltRow,
      loadExistingOltsIntoWizard,
      handleWizardRowVendorChange,
      syncWizardOltDraftsFromSelection,
      applyWizardBatchCredentials,
      handleWizardOltVendorChange,
      handleWizardOltProfileChange,
      removeWizardOltDraft,
      saveWizardOlts,
      triggerWizardPonImport,
      downloadPonTemplateExcel,
      syncWizardMergedOnu,
      syncWizardAllVlans,
      syncWizardSingleOltVlan,
      saveWizardAllAiConfig,
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
