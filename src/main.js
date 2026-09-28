import { createApp, computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from "vue/dist/vue.esm-bundler.js";
import { ElAlert } from "element-plus/es/components/alert/index.mjs";
import { ElAutocomplete } from "element-plus/es/components/autocomplete/index.mjs";
import { ElButton } from "element-plus/es/components/button/index.mjs";
import { ElCard } from "element-plus/es/components/card/index.mjs";
import { ElCol } from "element-plus/es/components/col/index.mjs";
import { ElConfigProvider } from "element-plus/es/components/config-provider/index.mjs";
import { ElDatePicker } from "element-plus/es/components/date-picker/index.mjs";
import zhCn from "element-plus/es/locale/lang/zh-cn.mjs";
import { ElDialog } from "element-plus/es/components/dialog/index.mjs";
import { ElEmpty } from "element-plus/es/components/empty/index.mjs";
import { ElInput } from "element-plus/es/components/input/index.mjs";
import { ElInputNumber } from "element-plus/es/components/input-number/index.mjs";
import { ElLoading } from "element-plus/es/components/loading/index.mjs";
import { ElPagination } from "element-plus/es/components/pagination/index.mjs";
import { ElProgress } from "element-plus/es/components/progress/index.mjs";
import { ElRow } from "element-plus/es/components/row/index.mjs";
import { ElSwitch } from "element-plus/es/components/switch/index.mjs";
import { ElTag } from "element-plus/es/components/tag/index.mjs";
import { ElMessage } from "element-plus/es/components/message/index.mjs";
import { ElMessageBox } from "element-plus/es/components/message-box/index.mjs";
import { ElAside, ElContainer, ElHeader, ElMain } from "element-plus/es/components/container/index.mjs";
import { ElCheckbox, ElCheckboxButton, ElCheckboxGroup } from "element-plus/es/components/checkbox/index.mjs";
import { ElDescriptions, ElDescriptionsItem } from "element-plus/es/components/descriptions/index.mjs";
import { ElForm, ElFormItem } from "element-plus/es/components/form/index.mjs";
import { ElMenu, ElMenuItem } from "element-plus/es/components/menu/index.mjs";
import { ElOption, ElSelect } from "element-plus/es/components/select/index.mjs";
import { ElTable, ElTableColumn } from "element-plus/es/components/table/index.mjs";
import { ElStep, ElSteps } from "element-plus/es/components/steps/index.mjs";
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
import "element-plus/dist/index.css";
import "@xterm/xterm/css/xterm.css";
import "./styles.css";

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

const App = {
  template: `
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
          <div class="header-left">
            <span class="header-label">当前 OLT</span>
            <el-select v-model="state.selectedOltId" filterable class="olt-select" @change="handleOltChange">
              <el-option v-for="olt in state.olts" :key="olt.id" :label="olt.name" :value="olt.id" />
            </el-select>
          </div>
          <div class="header-actions">
            <el-button size="small" type="primary" plain @click="setView('wizard')" title="进入系统配置向导">
              系统配置向导
            </el-button>
            <el-tag :type="state.status.reachable ? 'success' : 'warning'" size="large" effect="light">
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
          <section v-if="state.activeView === 'dashboard'">
            <div class="page-head">
              <div>
                <h1>运维概览</h1>
              </div>
              <div class="page-head-actions">
                <el-button type="primary" plain @click="setView('wizard')">
                  系统配置向导
                </el-button>
              </div>
            </div>
            <el-alert
              v-if="!isSystemConfigured && !state.wizardDismissed"
              title="系统尚未完成初始化分发配置"
              type="warning"
              description="检测到系统尚未纳管 OLT 设备或一二期网管尚未配置/同步。推荐使用【系统配置向导】进行全流程初始化引导。"
              show-icon
              closable
              @close="dismissWizardBanner"
              style="margin-bottom: 16px;"
            >
              <template #default>
                <div style="margin-top: 8px;">
                  <el-button type="primary" size="small" @click="setView('wizard')">进入系统配置向导</el-button>
                </div>
              </template>
            </el-alert>
            <!-- 1. 属地机房概况横幅（根据二期网管选定机房动态联动） -->
            <div class="room-summary-banner">
              <div class="room-banner-left">
                <div class="room-badge-box">
                  <span class="room-badge-icon">📍</span>
                  <div>
                    <span class="room-title-heading">属地机房：{{ state.dashboardWorkdesk.roomName || state.oss.config.roomName || '厚街机房' }}</span>
                    <span class="room-org-label">({{ state.dashboardWorkdesk.organizationName || state.oss.config.organizationName || '东莞分公司' }})</span>
                  </div>
                </div>
                <div class="room-assets-chips">
                  <span class="room-chip room-chip-success">
                    <span>纳管 OLT:</span>
                    <strong>{{ state.dashboardWorkdesk.summary.totalOlts || state.olts.length || 0 }} 台在线</strong>
                  </span>
                  <span class="room-chip">
                    <span>纳管用户总数:</span>
                    <strong>{{ state.dashboardWorkdesk.summary.totalOnus || 0 }} 户</strong>
                  </span>
                  <span class="room-chip">
                    <span>大网在线率:</span>
                    <strong style="color: #16a34a;">{{ state.dashboardWorkdesk.summary.onlineRate || '100%' }}</strong>
                  </span>
                  <span class="room-chip">
                    <span>已配 PON 口:</span>
                    <strong>{{ state.dashboardWorkdesk.summary.totalPonPorts || 0 }} 个</strong>
                  </span>
                </div>
              </div>
              <div class="room-banner-right">
                <el-button size="small" :loading="state.dashboardWorkdesk.loading" @click="loadRemediationWorkdesk()">
                  🔄 刷新设备状态
                </el-button>
                <el-button size="small" type="primary" plain @click="setView('wizard')">
                  ⚙️ 切换机房/向导
                </el-button>
              </div>
            </div>

            <!-- 2. 三大直观圆饼状态图（Donut Charts：设备在线、大网在线率、光衰质量） -->
            <div class="donut-charts-grid" v-if="state.dashboardWorkdesk.donutCharts">
              <!-- 饼图 1：OLT 设备通信态势 -->
              <div class="donut-card">
                <div class="donut-card-title">
                  <span>🖥️ OLT 设备连通态势</span>
                  <el-tag size="small" type="success" effect="plain">全部可达</el-tag>
                </div>
                <div class="donut-card-body">
                  <div class="donut-chart-view">
                    <svg viewBox="0 0 36 36" style="width: 100%; height: 100%;">
                      <circle cx="18" cy="18" r="15.915" fill="transparent" stroke="#f1f5f9" stroke-width="3.5" />
                      <circle
                        cx="18" cy="18" r="15.915"
                        fill="transparent"
                        stroke="#16a34a"
                        stroke-width="3.5"
                        stroke-dasharray="100 0"
                        stroke-dashoffset="0"
                        transform="rotate(-90 18 18)"
                      />
                    </svg>
                    <div class="donut-center-overlay">
                      <div class="donut-center-val" style="color: #16a34a;">{{ state.dashboardWorkdesk.donutCharts.deviceStatus.centerText }}</div>
                      <div class="donut-center-sub">{{ state.dashboardWorkdesk.donutCharts.deviceStatus.subText }}</div>
                    </div>
                  </div>
                  <div class="donut-legend-list">
                    <div class="donut-legend-item">
                      <span class="donut-legend-label">
                        <span class="donut-legend-dot" style="background: #16a34a;"></span>
                        <span>正常在线</span>
                      </span>
                      <span class="donut-legend-val">{{ state.dashboardWorkdesk.donutCharts.deviceStatus.onlineCount }} 台 (100%)</span>
                    </div>
                    <div class="donut-legend-item">
                      <span class="donut-legend-label">
                        <span class="donut-legend-dot" style="background: #ef4444;"></span>
                        <span>通信异常</span>
                      </span>
                      <span class="donut-legend-val">0 台 (0%)</span>
                    </div>
                    <div class="donut-legend-item" style="border-top: 1px dashed #e2e8f0; padding-top: 4px; margin-top: 2px;">
                      <span class="donut-legend-label" style="font-size: 11px; color: #64748b;">
                        <span>中兴 {{ state.dashboardWorkdesk.donutCharts.deviceStatus.vendorDistribution[0]?.count || 6 }} 台 · 华为 {{ state.dashboardWorkdesk.donutCharts.deviceStatus.vendorDistribution[1]?.count || 2 }} 台</span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 饼图 2：机房大网实时在线率 -->
              <div class="donut-card">
                <div class="donut-card-title">
                  <span>👥 机房大网实时在线率</span>
                  <el-tag size="small" type="primary" effect="plain">{{ state.dashboardWorkdesk.donutCharts.userOnline.total }} 户纳管</el-tag>
                </div>
                <div class="donut-card-body">
                  <div class="donut-chart-view">
                    <svg viewBox="0 0 36 36" style="width: 100%; height: 100%;">
                      <circle cx="18" cy="18" r="15.915" fill="transparent" stroke="#f1f5f9" stroke-width="3.5" />
                      <!-- 在线弧段 (绿) -->
                      <circle
                        cx="18" cy="18" r="15.915"
                        fill="transparent"
                        stroke="#16a34a"
                        stroke-width="3.5"
                        :stroke-dasharray="userOnlineDash"
                        stroke-dashoffset="0"
                        transform="rotate(-90 18 18)"
                      />
                      <!-- 离线弧段 (灰) -->
                      <circle
                        cx="18" cy="18" r="15.915"
                        fill="transparent"
                        stroke="#94a3b8"
                        stroke-width="3.5"
                        :stroke-dasharray="userOfflineDash"
                        :stroke-dashoffset="userOfflineOffset"
                        transform="rotate(-90 18 18)"
                      />
                    </svg>
                    <div class="donut-center-overlay">
                      <div class="donut-center-val" style="color: #0f172a;">{{ state.dashboardWorkdesk.donutCharts.userOnline.centerText }}</div>
                      <div class="donut-center-sub">{{ state.dashboardWorkdesk.donutCharts.userOnline.subText }}</div>
                    </div>
                  </div>
                  <div class="donut-legend-list">
                    <div class="donut-legend-item">
                      <span class="donut-legend-label">
                        <span class="donut-legend-dot" style="background: #16a34a;"></span>
                        <span>正常在线</span>
                      </span>
                      <span class="donut-legend-val">{{ state.dashboardWorkdesk.donutCharts.userOnline.onlineCount }} 户 ({{ state.dashboardWorkdesk.donutCharts.userOnline.percent }}%)</span>
                    </div>
                    <div class="donut-legend-item">
                      <span class="donut-legend-label">
                        <span class="donut-legend-dot" style="background: #94a3b8;"></span>
                        <span>离线停机</span>
                      </span>
                      <span class="donut-legend-val">{{ state.dashboardWorkdesk.donutCharts.userOnline.offlineCount }} 户 ({{ (100 - state.dashboardWorkdesk.donutCharts.userOnline.percent).toFixed(1) }}%)</span>
                    </div>
                    <div class="donut-legend-item" style="border-top: 1px dashed #e2e8f0; padding-top: 4px; margin-top: 2px;">
                      <span class="donut-legend-label" style="font-size: 11px; color: #64748b;">
                        <span>活跃业务口: {{ state.dashboardWorkdesk.summary.activePonPorts }} 个</span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 饼图 3：全网光衰质量梯度 -->
              <div class="donut-card">
                <div class="donut-card-title">
                  <span>💡 全网光衰质量健康梯度</span>
                  <el-tag size="small" :type="state.dashboardWorkdesk.donutCharts.opticalHealth.percent > 80 ? 'success' : 'warning'" effect="plain">
                    达标率 {{ state.dashboardWorkdesk.donutCharts.opticalHealth.percent }}%
                  </el-tag>
                </div>
                <div class="donut-card-body">
                  <div class="donut-chart-view">
                    <svg viewBox="0 0 36 36" style="width: 100%; height: 100%;">
                      <circle cx="18" cy="18" r="15.915" fill="transparent" stroke="#f1f5f9" stroke-width="3.5" />
                      <!-- 优良段 (绿) -->
                      <circle
                        cx="18" cy="18" r="15.915"
                        fill="transparent"
                        stroke="#16a34a"
                        stroke-width="3.5"
                        :stroke-dasharray="opticalExcellentDash"
                        stroke-dashoffset="0"
                        transform="rotate(-90 18 18)"
                      />
                      <!-- 轻度弱光段 (黄) -->
                      <circle
                        cx="18" cy="18" r="15.915"
                        fill="transparent"
                        stroke="#f59e0b"
                        stroke-width="3.5"
                        :stroke-dasharray="opticalMildDash"
                        :stroke-dashoffset="opticalMildOffset"
                        transform="rotate(-90 18 18)"
                      />
                      <!-- 严重弱光段 (红) -->
                      <circle
                        cx="18" cy="18" r="15.915"
                        fill="transparent"
                        stroke="#dc2626"
                        stroke-width="3.5"
                        :stroke-dasharray="opticalSevereDash"
                        :stroke-dashoffset="opticalSevereOffset"
                        transform="rotate(-90 18 18)"
                      />
                    </svg>
                    <div class="donut-center-overlay">
                      <div class="donut-center-val" style="color: #16a34a;">{{ state.dashboardWorkdesk.donutCharts.opticalHealth.centerText }}</div>
                      <div class="donut-center-sub">{{ state.dashboardWorkdesk.donutCharts.opticalHealth.subText }}</div>
                    </div>
                  </div>
                  <div class="donut-legend-list">
                    <div class="donut-legend-item">
                      <span class="donut-legend-label">
                        <span class="donut-legend-dot" style="background: #16a34a;"></span>
                        <span>优良达标</span>
                      </span>
                      <span class="donut-legend-val">{{ state.dashboardWorkdesk.donutCharts.opticalHealth.excellentCount }} 户</span>
                    </div>
                    <div class="donut-legend-item">
                      <span class="donut-legend-label">
                        <span class="donut-legend-dot" style="background: #f59e0b;"></span>
                        <span>轻度关注</span>
                      </span>
                      <span class="donut-legend-val">{{ state.dashboardWorkdesk.donutCharts.opticalHealth.mildWeakCount }} 户</span>
                    </div>
                    <div class="donut-legend-item">
                      <span class="donut-legend-label">
                        <span class="donut-legend-dot" style="background: #dc2626;"></span>
                        <span>严重弱光</span>
                      </span>
                      <span class="donut-legend-val" style="color: #dc2626;">{{ state.dashboardWorkdesk.donutCharts.opticalHealth.severeWeakCount }} 户</span>
                    </div>
                    <div class="donut-card-footnote">
                      * 优良 ≥ -24 dBm · 轻度 -27~-24 dBm · 严重 &lt; -27 dBm
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- 3. 【核心主角】机房 OLT 设备运行矩阵与健康卡片 -->
            <div class="olt-matrix-section">
              <div class="section-subhead">
                <div class="section-subhead-title">
                  <span>🖥️ 机房 OLT 设备运行矩阵与健康卡片</span>
                  <el-tag size="small" type="info" effect="plain">{{ state.dashboardWorkdesk.oltMatrix.length || state.olts.length }} 台设备已纳管</el-tag>
                </div>
                <div style="font-size: 12px; color: #64748b;">
                  点击各设备卡片可一键打开内置 Telnet 终端进入配置，或选定切换该设备
                </div>
              </div>

              <div class="olt-cards-grid">
                <div
                  v-for="olt in state.dashboardWorkdesk.oltMatrix"
                  :key="olt.id"
                  class="olt-device-card"
                >
                  <div>
                    <div class="olt-card-header">
                      <div class="olt-card-brand-col">
                        <div v-if="olt.vendor === 'zte'" class="brand-logo-badge zte" title="中兴通讯 ZTE">
                          <svg viewBox="0 0 54 20" width="54" height="20" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <text x="2" y="16" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif" font-weight="900" font-style="italic" font-size="18" fill="#005bac" letter-spacing="1">ZTE</text>
                          </svg>
                        </div>
                        <div v-else class="brand-logo-badge huawei" title="华为技术 HUAWEI">
                          <svg viewBox="0 0 94 20" width="94" height="20" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <g transform="translate(1, 1)" fill="#cf0a2c">
                              <path d="M9 1 C8.6 3.8 8 6 6.8 8 C7.8 7.5 8.8 6.5 9 1Z"/>
                              <path d="M10.5 1 C10.9 3.8 11.5 6 12.7 8 C11.7 7.5 10.7 6.5 10.5 1Z"/>
                              <path d="M5.5 2.5 C5.5 5 5 7 3.5 9 C4.8 8.2 6 7 5.5 2.5Z"/>
                              <path d="M14 2.5 C14 5 14.5 7 16 9 C14.7 8.2 13.5 7 14 2.5Z"/>
                              <path d="M2.5 5 C3 7.5 3 9.2 1.8 11.2 C2.8 10.2 3.8 8.8 2.5 5Z"/>
                              <path d="M17 5 C16.5 7.5 16.5 9.2 17.7 11.2 C16.7 10.2 15.7 8.8 17 5Z"/>
                              <path d="M0.8 8.5 C2 10.5 2.5 12 1.8 14 C2.5 12.8 3.2 11 0.8 8.5Z"/>
                              <path d="M18.7 8.5 C17.5 10.5 17 12 17.7 14 C17 12.8 16.3 11 18.7 8.5Z"/>
                            </g>
                            <text x="24" y="15" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif" font-weight="800" font-size="12" fill="#cf0a2c" letter-spacing="0.5">HUAWEI</text>
                          </svg>
                        </div>
                        <span class="olt-card-status-badge">
                          <span class="pulse-dot"></span>
                          <span>在线 {{ olt.responseTime }}ms</span>
                        </span>
                      </div>

                      <div class="olt-card-info-col">
                        <div class="olt-card-name">{{ olt.host }}</div>
                        <div class="olt-card-ip">{{ olt.model }}</div>
                      </div>
                    </div>

                    <div class="olt-card-metrics-grid">
                      <div class="olt-metric-item">
                        <span class="olt-metric-label">纳管总用户</span>
                        <span class="olt-metric-val">{{ olt.totalOnus }} 户</span>
                      </div>
                      <div class="olt-metric-item">
                        <span class="olt-metric-label">实时在线率</span>
                        <span class="olt-metric-val rate">{{ olt.onlineRate }}</span>
                      </div>
                      <div class="olt-metric-item">
                        <span class="olt-metric-label">已配 PON 口</span>
                        <span class="olt-metric-val">{{ olt.ponPortCount }} 个</span>
                      </div>
                      <div class="olt-metric-item">
                        <span class="olt-metric-label">弱光用户占比</span>
                        <span class="olt-metric-val weak">{{ olt.weakRate }} ({{ olt.weakOnuCount }}户)</span>
                      </div>
                    </div>

                    <!-- 进度 1：在线进度条 -->
                    <div class="olt-card-progress">
                      <div class="olt-progress-meta">
                        <span>在线进度 (在线 {{ olt.onlineOnus }} / 离线 {{ olt.offlineOnus }})</span>
                        <span>{{ olt.onlineRate }}</span>
                      </div>
                      <div class="olt-progress-bar-bg">
                        <div class="olt-progress-bar-fill" :style="{ width: olt.onlinePercent + '%' }"></div>
                      </div>
                    </div>

                    <!-- 进度 2：弱光占比进度条 -->
                    <div class="olt-card-progress" style="margin-top: 8px;">
                      <div class="olt-progress-meta">
                        <span>弱光进度 (超标 {{ olt.weakOnuCount }} 户 / 达标 {{ Math.max(0, olt.totalOnus - olt.weakOnuCount) }} 户)</span>
                        <span style="color: #ea580c; font-weight: 700;">{{ olt.weakRate }}</span>
                      </div>
                      <div class="olt-progress-bar-bg">
                        <div
                          class="olt-progress-bar-fill"
                          :style="{
                            width: olt.weakPercent + '%',
                            background: olt.weakPercent > 10 ? '#ef4444' : (olt.weakPercent > 5 ? '#f59e0b' : '#10b981')
                          }"
                        ></div>
                      </div>
                    </div>

                    <!-- PON 业务端口预警状态条 (点击弹出详细排障建议窗口) -->
                    <div
                      v-if="olt.alertPorts && olt.alertPorts.length > 0"
                      class="olt-ports-status-bar alert"
                      @click="openOltAlertsDialog(olt)"
                      title="点击弹出预警端口详情与排障建议"
                    >
                      <div class="status-alert-left">
                        <span class="status-indicator-dot alert"></span>
                        <span style="font-weight: 600;">
                          {{ olt.alertPorts.length }} 个 PON 端口需关注
                        </span>
                      </div>
                      <span class="status-toggle-btn">
                        查看详情 🔍
                      </span>
                    </div>
                    <div v-else class="olt-ports-status-bar normal">
                      <div class="status-alert-left">
                        <span class="status-indicator-dot normal"></span>
                        <span>PON 端口指标全优</span>
                      </div>
                      <el-tag size="small" type="success" effect="plain" style="height: 20px; font-size: 11px;">正常</el-tag>
                    </div>
                  </div>

                  <div class="olt-card-actions">
                    <el-button
                      size="small"
                      type="primary"
                      plain
                      style="width: 100%;"
                      @click="openOltTerminalFromMatrix(olt)"
                    >
                      🤖 AI 终端
                    </el-button>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section v-else-if="state.activeView === 'wizard'" class="wizard-container">
            <div class="page-head wizard-header">
              <div>
                <h1>系统配置向导</h1>
                <p class="section-lead">分发部署一站式引导：配置一二期网管认证、勾选 OLT 资产纳管、导入台账、全量数据同步与智能配置。</p>
              </div>
              <div class="wizard-header-actions">
                <el-tag v-if="isSystemConfigured" type="success" effect="plain">系统已初始化就绪</el-tag>
                <el-tag v-else type="warning" effect="plain">待完成初始化</el-tag>
                <el-button size="small" @click="setView('dashboard')">返回首页</el-button>
              </div>
            </div>

            <!-- 顶部步骤指示条 -->
            <el-card shadow="never" class="wizard-steps-card">
              <el-steps :active="state.wizard.currentStep - 1" finish-status="success" align-center class="wizard-interactive-steps">
                <el-step title="网管登录" description="一二期网管认证" @click="wizardGoToStep(1)" style="cursor: pointer;" />
                <el-step title="选择 OLT" description="勾选二期网管资产" @click="wizardGoToStep(2)" style="cursor: pointer;" />
                <el-step title="凭据与网络" description="管理IP与访问凭据" @click="wizardGoToStep(3)" style="cursor: pointer;" />
                <el-step title="ONU 台账" description="台账导入与导出" @click="wizardGoToStep(4)" style="cursor: pointer;" />
                <el-step title="数据同步" description="一二期全量融合同步" @click="wizardGoToStep(5)" style="cursor: pointer;" />
                <el-step title="同步 VLAN" description="外层 SVLAN 台账" @click="wizardGoToStep(6)" style="cursor: pointer;" />
                <el-step title="智能能力" description="飞书/AI/搜索配置" @click="wizardGoToStep(7)" style="cursor: pointer;" />
              </el-steps>
            </el-card>

            <!-- 步骤内容区域 -->
            <div class="wizard-step-body">
              <!-- ================= 步骤 1: 网管登录 ================= -->
              <div v-if="state.wizard.currentStep === 1" class="wizard-step-pane">
                <div class="wizard-step-intro">
                  <h3>第 1 步：配置一期和二期网管登录数据</h3>
                  <p>网管服务器生产地址已预设锁定不可变；请填写一线访问凭据并测试联通性。二期网管测试成功后，即可在下一步自动读取当前局点的 OLT 资产。</p>
                </div>
                <el-row :gutter="20">
                  <el-col :span="12">
                    <el-card shadow="never" class="wizard-card">
                      <template #header>
                        <div class="wizard-card-title">
                          <span>一期 NMSE BOSS 网管</span>
                          <el-tag :type="state.resource.loggedIn ? 'success' : 'info'" size="small">
                            {{ state.resource.loggedIn ? '已登录一期' : '未登录' }}
                          </el-tag>
                        </div>
                      </template>
                      <el-form label-position="top">
                        <el-form-item label="服务器地址（生产环境固定）">
                          <el-input :model-value="state.resource.config.serverUrl || 'http://172.18.254.7:9000'" disabled placeholder="http://172.18.254.7:9000" />
                          <small class="field-hint">预设固定网管地址，已锁定不可变</small>
                        </el-form-item>
                        <el-form-item label="网管用户名">
                          <el-input v-model="state.resource.config.username" placeholder="请输入一期网管用户名" />
                        </el-form-item>
                        <el-form-item label="网管密码">
                          <el-input v-model="state.resource.config.password" type="password" show-password placeholder="请输入一期网管密码" />
                        </el-form-item>
                        <div class="wizard-card-action">
                          <el-button type="primary" :loading="state.wizard.resourceTestStatus === 'testing'" @click="testWizardResourceLogin">
                            保存并测试一期网管
                          </el-button>
                          <span v-if="state.wizard.resourceTestMessage" :class="state.wizard.resourceTestStatus === 'success' ? 'text-success' : 'text-danger'" class="action-feedback">
                            {{ state.wizard.resourceTestMessage }}
                          </span>
                        </div>
                      </el-form>
                    </el-card>
                  </el-col>
                  <el-col :span="12">
                    <el-card shadow="never" class="wizard-card">
                      <template #header>
                        <div class="wizard-card-title">
                          <span>二期 OSS 资源网管</span>
                          <el-tag :type="state.oss.loggedIn ? 'success' : 'info'" size="small">
                            {{ state.oss.loggedIn ? '已登录二期' : '未登录' }}
                          </el-tag>
                        </div>
                      </template>
                      <el-form label-position="top">
                        <el-form-item label="认证服务地址（生产环境固定）">
                          <el-input :model-value="state.oss.config.authBaseUrl || 'http://10.205.136.199:18140'" disabled />
                        </el-form-item>
                        <el-form-item label="支撑系统地址（生产环境固定）">
                          <el-input :model-value="state.oss.config.ngbBaseUrl || 'http://10.205.137.22:8080'" disabled />
                          <small class="field-hint">预设固定网管地址，已锁定不可变</small>
                        </el-form-item>
                        <el-row :gutter="12">
                          <el-col :span="12">
                            <el-form-item label="登录账号">
                              <el-input v-model="state.oss.config.username" placeholder="OSS 用户名" />
                            </el-form-item>
                          </el-col>
                          <el-col :span="12">
                            <el-form-item label="登录密码">
                              <el-input v-model="state.oss.password" type="password" show-password placeholder="OSS 密码" />
                            </el-form-item>
                          </el-col>
                        </el-row>
                        <div class="oss-fetch-rooms-toolbar" style="margin: 2px 0 14px; display: flex; align-items: center; justify-content: space-between; background: var(--el-fill-color-light); padding: 8px 12px; border-radius: 6px;">
                          <span style="font-size: 13px; color: var(--el-text-color-regular);">输入账号密码后，可点击自动读取片区与机房：</span>
                          <el-button
                            type="success"
                            plain
                            size="small"
                            :loading="state.oss.roomsLoading"
                            @click="fetchOssRoomInfo"
                          >
                            读取机房信息
                          </el-button>
                        </div>
                        <el-row :gutter="12">
                          <el-col :span="12">
                            <el-form-item label="所属机构">
                              <el-select
                                v-model="state.oss.config.organizationName"
                                filterable
                                allow-create
                                default-first-option
                                placeholder="例如：某市分公司（可下拉选择）"
                                style="width: 100%"
                                @change="handleWizardOrgChange"
                              >
                                <el-option
                                  v-for="org in state.oss.discoveredOrgs"
                                  :key="org.name"
                                  :label="org.name"
                                  :value="org.name"
                                >
                                  <div style="display: flex; justify-content: space-between; align-items: center;">
                                    <span>{{ org.name }}</span>
                                    <span style="color: var(--el-text-color-secondary); font-size: 12px;">{{ (org.rooms || []).length }} 个机房</span>
                                  </div>
                                </el-option>
                              </el-select>
                            </el-form-item>
                          </el-col>
                          <el-col :span="12">
                            <el-form-item label="所属机房">
                              <el-select
                                v-model="state.oss.config.roomName"
                                filterable
                                allow-create
                                default-first-option
                                placeholder="例如：核心机房（可下拉选择）"
                                style="width: 100%"
                              >
                                <el-option
                                  v-for="room in currentOrgRoomOptions"
                                  :key="room"
                                  :label="room"
                                  :value="room"
                                />
                              </el-select>
                            </el-form-item>
                          </el-col>
                        </el-row>
                        <div class="wizard-card-action">
                          <el-button type="primary" :loading="state.wizard.ossTestStatus === 'testing'" @click="testWizardOssLogin">
                            保存并测试二期网管
                          </el-button>
                          <span v-if="state.wizard.ossTestMessage" :class="state.wizard.ossTestStatus === 'success' ? 'text-success' : 'text-danger'" class="action-feedback">
                            {{ state.wizard.ossTestMessage }}
                          </span>
                        </div>
                      </el-form>
                    </el-card>
                  </el-col>
                </el-row>
              </div>

              <!-- ================= 步骤 2: 勾选与配置纳管 OLT ================= -->
              <div v-else-if="state.wizard.currentStep === 2" class="wizard-step-pane">
                <div class="wizard-step-intro">
                  <h3>第 2 步：选择与配置纳管 OLT 设备（本地 IP 与名称自由填写）</h3>
                  <p>二期网管读取的支撑网 IP 仅作为资产与机房参考；请在此直接填写本地局域网可连通的实际管理 IP 与设备名称。您也可点击【从系统已有 OLT 载入】或【+ 添加自定义 OLT】自由调整。</p>
                </div>
                <el-card shadow="never" class="wizard-card">
                  <div class="wizard-table-toolbar">
                    <div class="toolbar-stats">
                      已选中 <el-tag size="small" type="primary">{{ state.wizard.selectedOssOlts.length }}</el-tag> 台 OLT / 共 {{ (state.oss.olts || []).length }} 台
                    </div>
                    <div class="toolbar-actions">
                      <el-button size="small" type="primary" plain @click="addCustomWizardOlt">+ 手动添加 OLT 设备</el-button>
                      <el-button size="small" @click="loadExistingOltsIntoWizard">从系统已有 OLT 载入</el-button>
                      <el-button size="small" @click="selectAllWizardOssOlts">全选</el-button>
                      <el-button size="small" @click="clearAllWizardOssOlts">取消全选</el-button>
                      <el-button size="small" :loading="state.oss.loginLoading" @click="testWizardOssLogin">重新读取二期</el-button>
                    </div>
                  </div>
                  <el-table
                    v-if="(state.oss.olts || []).length > 0"
                    :data="state.oss.olts"
                    border
                    stripe
                    style="width: 100%"
                    max-height="460"
                  >
                    <el-table-column width="55" align="center">
                      <template #header>选择</template>
                      <template #default="{ row }">
                        <el-checkbox
                          :model-value="isWizardOssOltSelected(row)"
                          @change="toggleWizardOssOlt(row)"
                        />
                      </template>
                    </el-table-column>
                    <el-table-column label="OLT 设备名称（可自定）" min-width="190">
                      <template #default="{ row }">
                        <el-input v-model="row.name" size="small" placeholder="如 ZTE C300 172.19.104.98" />
                      </template>
                    </el-table-column>
                    <el-table-column label="本地属地 IP（网管二期直接读取）" min-width="170">
                      <template #default="{ row }">
                        <el-input v-model="row.host" size="small" placeholder="本地真实IP，如 172.19.104.98" />
                      </template>
                    </el-table-column>
                    <el-table-column label="厂商" width="120">
                      <template #default="{ row }">
                        <el-select v-model="row.vendor" size="small" @change="handleWizardRowVendorChange(row)">
                          <el-option label="中兴 ZTE" value="zte" />
                          <el-option label="华为 Huawei" value="huawei" />
                        </el-select>
                      </template>
                    </el-table-column>
                    <el-table-column label="型号/方案" min-width="150">
                      <template #default="{ row }">
                        <el-select v-model="row.deviceProfile" size="small">
                          <el-option
                            v-for="profile in profilesForVendor(row.vendor)"
                            :key="profile.id"
                            :label="profile.label"
                            :value="profile.id"
                          />
                        </el-select>
                      </template>
                    </el-table-column>
                    <el-table-column label="所属机房" width="120">
                      <template #default="{ row }">
                        <el-input v-model="row.roomName" size="small" placeholder="机房名称" />
                      </template>
                    </el-table-column>
                    <el-table-column label="二期支撑网 IP (参考)" width="140">
                      <template #default="{ row }">
                        <code>{{ row.resourceIp || row.ip || '-' }}</code>
                      </template>
                    </el-table-column>
                    <el-table-column label="操作" width="70" align="center">
                      <template #default="{ $index }">
                        <el-button type="danger" link size="small" @click="removeWizardOssOltRow($index)">删除</el-button>
                      </template>
                    </el-table-column>
                  </el-table>
                  <el-empty v-else description="暂无 OLT 资产，您可点击上方【从系统已有 OLT 载入】或【+ 手动添加 OLT 设备】直接填报。" />
                </el-card>
              </div>

              <!-- ================= 步骤 3: 凭据与网络配置 ================= -->
              <div v-else-if="state.wizard.currentStep === 3" class="wizard-step-pane">
                <div class="wizard-step-intro">
                  <h3>第 3 步：配置纳管 OLT 管理 IP 与访问凭据</h3>
                  <p>系统已依据二期网管支撑网 IP 自动映射为管理 IP（如 22.0.6.x → 10.22.6.x）。您可以在上方快速填写统一的 SNMP Community 与 Telnet 凭据并一键应用，也可在下方针对特定设备单独微调。</p>
                </div>
                <!-- 批量填充栏 -->
                <el-card shadow="never" class="wizard-batch-card">
                  <div class="batch-title">批量快速填充（快速应用至所有待纳管设备）：</div>
                  <el-row :gutter="14" align="middle">
                    <el-col :span="6">
                      <el-input v-model="state.wizard.batchCredentials.community" placeholder="SNMP Community（如 public）">
                        <template #prepend>Community</template>
                      </el-input>
                    </el-col>
                    <el-col :span="6">
                      <el-input v-model="state.wizard.batchCredentials.telnetUser" placeholder="Telnet 用户名（如 admin）">
                        <template #prepend>用户名</template>
                      </el-input>
                    </el-col>
                    <el-col :span="6">
                      <el-input v-model="state.wizard.batchCredentials.telnetPassword" type="password" show-password placeholder="Telnet 密码">
                        <template #prepend>密码</template>
                      </el-input>
                    </el-col>
                    <el-col :span="6">
                      <el-button type="primary" plain @click="applyWizardBatchCredentials">一键批量应用凭据</el-button>
                    </el-col>
                  </el-row>
                </el-card>

                <!-- 待纳管设备列表 -->
                <el-card shadow="never" class="wizard-card" style="margin-top: 14px;">
                  <div class="wizard-table-toolbar">
                    <div class="toolbar-stats">
                      待纳管 OLT 清单（共 <strong>{{ state.wizard.oltDrafts.length }}</strong> 台）
                    </div>
                    <div class="toolbar-actions">
                      <el-button type="success" :loading="state.wizard.savingOlts" @click="saveWizardOlts">
                        保存纳管配置到系统
                      </el-button>
                    </div>
                  </div>
                  <el-table :data="state.wizard.oltDrafts" border stripe style="width: 100%" max-height="420">
                    <el-table-column type="index" label="序号" width="55" align="center" />
                    <el-table-column label="设备名称" min-width="140">
                      <template #default="{ row }">
                        <el-input v-model="row.name" size="small" placeholder="OLT 名称" />
                      </template>
                    </el-table-column>
                    <el-table-column label="管理 IP" width="140">
                      <template #default="{ row }">
                        <el-input v-model="row.host" size="small" placeholder="如 10.22.6.2" />
                      </template>
                    </el-table-column>
                    <el-table-column label="厂商" width="110">
                      <template #default="{ row }">
                        <el-select v-model="row.vendor" size="small" @change="handleWizardOltVendorChange(row)">
                          <el-option label="中兴 ZTE" value="zte" />
                          <el-option label="华为 Huawei" value="huawei" />
                        </el-select>
                      </template>
                    </el-table-column>
                    <el-table-column label="设备型号/方案" min-width="150">
                      <template #default="{ row }">
                        <el-select v-model="row.deviceProfile" size="small" @change="handleWizardOltProfileChange(row)">
                          <el-option
                            v-for="profile in profilesForVendor(row.vendor)"
                            :key="profile.id"
                            :label="profile.label"
                            :value="profile.id"
                          />
                        </el-select>
                      </template>
                    </el-table-column>
                    <el-table-column label="Community" width="120">
                      <template #default="{ row }">
                        <el-input v-model="row.snmpCommunity" size="small" placeholder="public" />
                      </template>
                    </el-table-column>
                    <el-table-column label="Telnet 账号" width="110">
                      <template #default="{ row }">
                        <el-input v-model="row.telnetUser" size="small" placeholder="admin" />
                      </template>
                    </el-table-column>
                    <el-table-column label="Telnet 密码" width="120">
                      <template #default="{ row }">
                        <el-input v-model="row.telnetPassword" size="small" type="password" show-password placeholder="密码" />
                      </template>
                    </el-table-column>
                    <el-table-column label="操作" width="70" align="center">
                      <template #default="{ $index }">
                        <el-button type="danger" link size="small" @click="removeWizardOltDraft($index)">删除</el-button>
                      </template>
                    </el-table-column>
                  </el-table>
                </el-card>
              </div>

              <!-- ================= 步骤 4: ONU 数据管理 ================= -->
              <div v-else-if="state.wizard.currentStep === 4" class="wizard-step-pane">
                <div class="wizard-step-intro">
                  <h3>第 4 步：ONU 台账管理（用户数据导入导出）</h3>
                  <p>系统支持通过标准 Excel 模板快速录入现场 PON 口与用户安装地址台账。若现场已有历史台账，可在此一键上传；若暂无 Excel，可点击【跳过此步】，后续通过网管数据同步自动填充。</p>
                </div>
                <!-- 隐藏的文件选择器 -->
                <input ref="wizardFileInputRef" type="file" accept=".xlsx,.xls" style="display:none;" @change="importPonPortsExcel" />

                <el-row :gutter="20">
                  <el-col :span="10">
                    <el-card shadow="never" class="wizard-card">
                      <template #header>
                        <div class="wizard-card-title">本地 ONU 台账概况</div>
                      </template>
                      <div class="wizard-summary-metrics">
                        <div class="summary-metric-item">
                          <span>已录入 PON 口台账</span>
                          <strong>{{ (state.ponPorts || []).length }}</strong>
                          <small>条</small>
                        </div>
                        <div class="summary-metric-item">
                          <span>涵盖 OLT 节点</span>
                          <strong>{{ distinctOltCountInPonPorts }}</strong>
                          <small>台</small>
                        </div>
                      </div>
                      <div style="margin-top: 16px; font-size: 13px; color: var(--muted); line-height: 1.6;">
                        <p>标准字段说明：<strong>OLT IP</strong>、<strong>槽</strong>、<strong>板卡</strong>、<strong>PON</strong>、<strong>板槽端口</strong>、<strong>外层 VLAN</strong>、<strong>地址</strong>。</p>
                        <p>导入时系统将对板槽端口格式进行智能预检，并支持覆盖更新已有记录。</p>
                      </div>
                    </el-card>
                  </el-col>
                  <el-col :span="14">
                    <el-card shadow="never" class="wizard-card">
                      <template #header>
                        <div class="wizard-card-title">台账操作与数据交换</div>
                      </template>
                      <div class="wizard-action-grid">
                        <div class="action-box">
                          <h4>1. 下载标准 Excel 模板</h4>
                          <p>获取包含规范表头与示例数据的空模板，按格式整理后导入。</p>
                          <el-button @click="downloadPonTemplateExcel">下载标准模板 (.xlsx)</el-button>
                        </div>
                        <div class="action-box">
                          <h4>2. 导入已有台账 Excel</h4>
                          <p>选择包含 PON 与用户地址的 Excel 文件，进行校验并合并入库。</p>
                          <el-button type="primary" @click="triggerWizardPonImport">选择文件并导入</el-button>
                        </div>
                        <div class="action-box">
                          <h4>3. 导出当前本地台账</h4>
                          <p>将当前系统中的全部 PON 口台账导出为 Excel 文件备份。</p>
                          <el-button @click="exportPonPortsExcel">导出当前台账 (.xlsx)</el-button>
                        </div>
                      </div>
                    </el-card>
                  </el-col>
                </el-row>
              </div>

              <!-- ================= 步骤 5: 一二期网管数据同步 ================= -->
              <div v-else-if="state.wizard.currentStep === 5" class="wizard-step-pane">
                <div class="wizard-step-intro">
                  <h3>第 5 步：一期和二期网管全量数据同步</h3>
                  <p>系统将自动联动一期 BOSS 与二期 OSS：抓取历史光功率、设备投影、用户账号与历史姓名，并完成多维融合匹配。此步骤奠定全网 ONU 智能排障与数字孪生底座。</p>
                </div>
                <el-card shadow="never" class="wizard-card">
                  <div class="sync-action-hero">
                    <div class="hero-left">
                      <h4>全量融合数据同步</h4>
                      <p>同步涵盖：二期 OSS 历史光衰快照 + 一期 BOSS 存量用户资料 + 跨系统账号/LOID/SN 融合</p>
                      <div v-if="state.mergedOnu.dataset.synced" class="hero-status-pill text-success">
                        上次完成时间：{{ formatDate(state.mergedOnu.dataset.lastCompletedAt) || '暂无记录' }} · 共融合 {{ state.mergedOnu.dataset.snapshotCount || 0 }} 条
                      </div>
                    </div>
                    <div class="hero-right">
                      <el-button
                        type="primary"
                        size="large"
                        :loading="state.mergedOnu.syncing || state.mergedOnu.progress.running"
                        @click="syncWizardMergedOnu"
                      >
                        {{ state.mergedOnu.syncing || state.mergedOnu.progress.running ? '正在同步融合中...' : '开始全量融合同步' }}
                      </el-button>
                    </div>
                  </div>

                  <!-- 实时同步进度展示 -->
                  <div v-if="state.mergedOnu.progress.running || state.mergedOnu.syncing" class="sync-progress-area" style="margin-top: 20px;">
                    <div class="progress-header">
                      <span>当前阶段：<strong>{{ mergedOnuSyncPhaseText(state.mergedOnu.progress.phase) }}</strong></span>
                      <span>{{ mergedOnuSyncPercent(state.mergedOnu.progress) }}%</span>
                    </div>
                    <el-progress
                      :percentage="mergedOnuSyncPercent(state.mergedOnu.progress)"
                      :status="state.mergedOnu.progress.status === 'error' ? 'exception' : 'success'"
                      :stroke-width="14"
                    />
                    <el-row :gutter="14" style="margin-top: 14px;">
                      <el-col :span="6">
                        <div class="progress-sub-stat">
                          <small>二期 OSS 条数</small>
                          <strong>{{ state.mergedOnu.progress.networkRows || 0 }}</strong>
                        </div>
                      </el-col>
                      <el-col :span="6">
                        <div class="progress-sub-stat">
                          <small>一期 BOSS 分页</small>
                          <strong>{{ state.mergedOnu.progress.nmseCompletedPages || 0 }} / {{ state.mergedOnu.progress.nmsePages || 0 }}</strong>
                        </div>
                      </el-col>
                      <el-col :span="6">
                        <div class="progress-sub-stat">
                          <small>已融合条数</small>
                          <strong>{{ state.mergedOnu.progress.mergedRows || 0 }}</strong>
                        </div>
                      </el-col>
                      <el-col :span="6">
                        <div class="progress-sub-stat">
                          <small>冲突条数</small>
                          <strong>{{ state.mergedOnu.progress.conflicts || 0 }}</strong>
                        </div>
                      </el-col>
                    </el-row>
                  </div>
                  <div v-else-if="state.mergedOnu.dataset.synced" style="margin-top: 16px;">
                    <el-alert type="success" :closable="false" show-icon title="网管数据已就绪，可直接进入下一步同步外层 VLAN。">
                      <template #default>
                        融合数据共收录 {{ state.mergedOnu.dataset.snapshotCount || 0 }} 条记录，版本修订号：{{ state.mergedOnu.dataset.revision }}。
                      </template>
                    </el-alert>
                  </div>
                </el-card>
              </div>

              <!-- ================= 步骤 6: 同步外层 VLAN ================= -->
              <div v-else-if="state.wizard.currentStep === 6" class="wizard-step-pane">
                <div class="wizard-step-intro">
                  <h3>第 6 步：同步外层 VLAN (SVLAN)</h3>
                  <p>一二期网管数据就绪后，系统可自动向各台纳管 OLT 拉取下属所有 PON 口的外层业务 SVLAN，并更新写入本地台账数据库。</p>
                </div>
                <el-card shadow="never" class="wizard-card">
                  <div class="wizard-table-toolbar">
                    <div class="toolbar-stats">
                      <span>已纳管 <strong>{{ state.olts.length }}</strong> 台 OLT 设备</span>
                      <span v-if="state.wizard.vlanSummary" class="text-success" style="margin-left: 12px;">{{ state.wizard.vlanSummary }}</span>
                    </div>
                    <div class="toolbar-actions">
                      <el-button type="primary" :loading="state.wizard.vlanSyncing" @click="syncWizardAllVlans">
                        一键同步所有 OLT 外层 VLAN
                      </el-button>
                    </div>
                  </div>

                  <el-table
                    v-if="state.wizard.vlanResults.length > 0"
                    :data="state.wizard.vlanResults"
                    border
                    stripe
                    style="width: 100%"
                  >
                    <el-table-column prop="oltName" label="OLT 名称" min-width="160" />
                    <el-table-column prop="host" label="管理 IP" width="140" />
                    <el-table-column label="同步结果" width="110" align="center">
                      <template #default="{ row }">
                        <el-tag :type="row.success ? 'success' : 'danger'" size="small">
                          {{ row.success ? '同步成功' : '失败' }}
                        </el-tag>
                      </template>
                    </el-table-column>
                    <el-table-column prop="count" label="PON 口数" width="100" align="center" />
                    <el-table-column prop="message" label="明细状态" min-width="200" />
                    <el-table-column label="操作" width="100" align="center">
                      <template #default="{ row }">
                        <el-button size="small" type="primary" link @click="syncWizardSingleOltVlan(row.oltId)">重新同步</el-button>
                      </template>
                    </el-table-column>
                  </el-table>
                  <div v-else class="vlan-empty-guide" style="padding: 28px 0; text-align: center; color: var(--muted);">
                    <p>点击上方【一键同步所有 OLT 外层 VLAN】按钮，系统将自动依次遍历各台 OLT 并完成落库。</p>
                  </div>
                </el-card>
              </div>

              <!-- ================= 步骤 7: 智能能力集中配置 ================= -->
              <div v-else-if="state.wizard.currentStep === 7" class="wizard-step-pane">
                <div class="wizard-step-intro">
                  <h3>第 7 步：智能能力集中配置（飞书/AI/AnySearch）</h3>
                  <p>配置飞书运维机器人、Pi Agent 大模型、JEV 意图路由引擎以及 AnySearch 智能外网搜索。配置完成后，一线工程师可通过群聊和桌面端直接使用智能问答与自主排障。</p>
                </div>
                <el-row :gutter="14">
                  <!-- 飞书机器人 -->
                  <el-col :span="12">
                    <el-card shadow="never" class="wizard-card">
                      <template #header>
                        <div class="wizard-card-title">
                          <span>1. 飞书智能运维机器人</span>
                          <el-tag :type="state.feishu.connection.state === 'connected' ? 'success' : 'info'" size="small">
                            {{ state.feishu.connection.state === 'connected' ? '长连接已通' : '未连接' }}
                          </el-tag>
                        </div>
                      </template>
                      <el-form label-position="top">
                        <el-form-item label="飞书 App ID">
                          <el-input v-model="state.feishu.appId" placeholder="cli_..." />
                        </el-form-item>
                        <el-form-item label="飞书 App Secret">
                          <el-input v-model="state.feishu.appSecret" type="password" show-password placeholder="请输入 App Secret" />
                        </el-form-item>
                      </el-form>
                    </el-card>
                  </el-col>

                  <!-- AnySearch 智能外网搜索 -->
                  <el-col :span="12">
                    <el-card shadow="never" class="wizard-card">
                      <template #header>
                        <div class="wizard-card-title">
                          <span>2. AnySearch 智能外网搜索</span>
                          <el-tag :type="state.anysearch.apiKey ? 'success' : 'info'" size="small">
                            {{ state.anysearch.apiKey ? 'Key 已填' : '未配置' }}
                          </el-tag>
                        </div>
                      </template>
                      <el-form label-position="top">
                        <el-form-item label="AnySearch API Key">
                          <el-input v-model="state.anysearch.apiKey" show-password placeholder="as_sk_..." />
                          <small class="field-hint">用于全网故障知识、外网协议与技术文档智能检索增强</small>
                        </el-form-item>
                      </el-form>
                    </el-card>
                  </el-col>
                </el-row>

                <el-row :gutter="14" style="margin-top: 14px;">
                  <!-- Pi Agent 大模型 -->
                  <el-col :span="12">
                    <el-card shadow="never" class="wizard-card">
                      <template #header>
                        <div class="wizard-card-title">
                          <span>3. Pi Agent 自主决策模型</span>
                        </div>
                      </template>
                      <el-form label-position="top">
                        <el-form-item label="模型服务商 / Provider">
                          <el-input v-model="state.feishu.piAgentLanguageProviderName" placeholder="如 OpenAI / DeepSeek / 本地 Ollama" />
                        </el-form-item>
                        <el-form-item label="API Endpoint">
                          <el-input v-model="state.feishu.piAgentLanguageEndpoint" placeholder="https://api.openai.com/v1" />
                        </el-form-item>
                        <el-row :gutter="12">
                          <el-col :span="12">
                            <el-form-item label="模型名称 (Model)">
                              <el-input v-model="state.feishu.piAgentLanguageModel" placeholder="gpt-4o / deepseek-chat" />
                            </el-form-item>
                          </el-col>
                          <el-col :span="12">
                            <el-form-item label="API Key">
                              <el-input v-model="state.feishu.piAgentLanguageApiKey" type="password" show-password placeholder="sk-..." />
                            </el-form-item>
                          </el-col>
                        </el-row>
                      </el-form>
                    </el-card>
                  </el-col>

                  <!-- JEV 意图路由引擎 -->
                  <el-col :span="12">
                    <el-card shadow="never" class="wizard-card">
                      <template #header>
                        <div class="wizard-card-title">
                          <span>4. JEV 意图识别与路由模型</span>
                        </div>
                      </template>
                      <el-form label-position="top">
                        <el-form-item label="模型服务商 / Provider">
                          <el-input v-model="state.feishu.languageProviderName" placeholder="如 OpenAI / SiliconFlow" />
                        </el-form-item>
                        <el-form-item label="API Endpoint">
                          <el-input v-model="state.feishu.languageEndpoint" placeholder="https://api.openai.com/v1" />
                        </el-form-item>
                        <el-row :gutter="12">
                          <el-col :span="12">
                            <el-form-item label="模型名称 (Model)">
                              <el-input v-model="state.feishu.languageModel" placeholder="gpt-4o-mini / deepseek-v3" />
                            </el-form-item>
                          </el-col>
                          <el-col :span="12">
                            <el-form-item label="API Key">
                              <el-input v-model="state.feishu.languageApiKey" type="password" show-password placeholder="sk-..." />
                            </el-form-item>
                          </el-col>
                        </el-row>
                      </el-form>
                    </el-card>
                  </el-col>
                </el-row>

                <div class="ai-save-panel" style="margin-top: 16px; text-align: center;">
                  <el-button type="primary" size="large" :loading="state.wizard.savingAiConfig" @click="saveWizardAllAiConfig">
                    一键保存并生效所有智能能力配置
                  </el-button>
                  <p v-if="state.wizard.aiTestMessage" :class="state.wizard.aiTestStatus === 'success' ? 'text-success' : 'text-danger'" style="margin-top: 8px;">
                    {{ state.wizard.aiTestMessage }}
                  </p>
                </div>

                <!-- 完成总览卡片 -->
                <el-card v-if="isSystemConfigured" shadow="never" class="wizard-success-card" style="margin-top: 20px;">
                  <div class="success-card-content">
                    <div class="success-icon">🎉</div>
                    <div class="success-text">
                      <h3>系统全流程初始化配置已完成！</h3>
                      <p>OLT Manager 现已具备纳管 OLT 只读监控、双网管数据融合、光功率排障、飞书机器人与 AI 智能决策全部能力。</p>
                      <el-button type="success" size="large" @click="setView('dashboard')">
                        完成配置并进入系统运维概览
                      </el-button>
                    </div>
                  </div>
                </el-card>
              </div>
            </div>

            <!-- 向导底部常驻操作栏 -->
            <div class="wizard-footer-bar">
              <div class="footer-left">
                <el-button v-if="state.wizard.currentStep > 1" @click="wizardPrevStep">
                  上一步
                </el-button>
              </div>
              <div class="footer-right">
                <el-button
                  v-if="state.wizard.currentStep < 7"
                  plain
                  @click="wizardSkipStep"
                >
                  跳过此步
                </el-button>
                <el-button
                  v-if="state.wizard.currentStep < 7"
                  type="primary"
                  @click="wizardNextStep"
                >
                  下一步
                </el-button>
                <el-button
                  v-else
                  type="success"
                  @click="completeWizard"
                >
                  完成向导
                </el-button>
              </div>
            </div>
          </section>

          <section v-else-if="state.activeView === 'feishuSettings'">
            <div class="feishu-settings-layout">
              <!-- 顶部 Hero 机器人控制中心 -->
              <div class="feishu-hero-panel">
                <div class="feishu-hero-header">
                  <div class="feishu-hero-info">
                    <div class="feishu-hero-icon">
                      <svg viewBox="0 0 24 24" width="28" height="28"><path fill="currentColor" d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.38-1 1.72V7h2a7 7 0 0 1 7 7v1h1a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-1v1a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3v-1H1a2 2 0 0 1-2-2v-2a2 2 0 0 1 2-2h1v-1a7 7 0 0 1 7-7h2V5.72A2.001 2.001 0 0 1 10 4a2 2 0 0 1 2-2m-4 9a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3m8 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3M7 17v1h10v-1z"/></svg>
                    </div>
                    <div>
                      <div class="feishu-hero-title-row">
                        <h1 class="feishu-hero-title">飞书智能运维机器人</h1>
                        <el-tag :type="state.feishu.connection.state === 'connected' ? 'success' : state.feishu.enabled ? 'warning' : 'info'" size="large" effect="dark" class="feishu-status-pill">
                          <span class="status-indicator-dot" :class="state.feishu.connection.state === 'connected' ? 'online' : state.feishu.enabled ? 'warning' : 'offline'"></span>
                          {{ state.feishu.connection.state === 'connected' ? '已连接' : state.feishu.enabled ? '已启用但未连接' : '默认关闭' }}
                        </el-tag>
                      </div>
                      <p class="feishu-hero-desc">
                        基于飞书开放平台 WebSocket 长连接模式，无需公网 IP 和端口映射，为一线运维人员提供单聊极速查单、实时光衰诊断、整口健康大盘及 Pi 专家排障能力。
                      </p>
                    </div>
                  </div>
                  <div class="feishu-hero-actions">
                    <el-button
                      type="success"
                      size="large"
                      :disabled="!state.feishu.languageProviderReady"
                      :loading="state.feishu.saving"
                      @click="enableFeishu"
                    >
                      ▶ 启用飞书机器人
                    </el-button>
                    <el-button
                      type="danger"
                      plain
                      size="large"
                      :disabled="!state.feishu.enabled"
                      :loading="state.feishu.saving"
                      @click="stopFeishu"
                    >
                      ⏹ 停止服务
                    </el-button>
                    <el-button size="large" @click="loadFeishuSettings" title="重新获取连接状态与凭据状态">
                      🔄 刷新状态
                    </el-button>
                  </div>
                </div>

                <!-- 运行状态横向指标条 -->
                <div class="feishu-metrics-bar">
                  <div class="feishu-metric-item">
                    <span class="feishu-metric-label">长连接通信</span>
                    <span class="feishu-metric-value" :class="state.feishu.connection.state === 'connected' ? 'text-success' : 'text-muted'">
                      {{ state.feishu.connection.state === 'connected' ? '🟢 链路正常 (WebSocket)' : state.feishu.enabled ? '🟠 连接建立中' : '⚪ 未建立' }}
                    </span>
                  </div>
                  <div class="feishu-metric-divider"></div>
                  <div class="feishu-metric-item">
                    <span class="feishu-metric-label">飞书应用凭据</span>
                    <span class="feishu-metric-value" :class="state.feishu.credentialConfigured ? 'text-success' : 'text-warning'">
                      {{ state.feishu.credentialConfigured ? '🟢 已配置安全凭据' : '⚠️ 待配置 APP 凭据' }}
                    </span>
                  </div>
                  <div class="feishu-metric-divider"></div>
                  <div class="feishu-metric-item">
                    <span class="feishu-metric-label">自然语言解析 (Jev)</span>
                    <span class="feishu-metric-value" :class="state.feishu.languageProviderReady ? 'text-success' : 'text-warning'">
                      {{ state.feishu.languageProviderReady ? '🟢 模型就绪 (' + (state.feishu.languageModel || 'jev-latest') + ')' : '⚠️ 待配置 API KEY' }}
                    </span>
                  </div>
                  <div class="feishu-metric-divider"></div>
                  <div class="feishu-metric-item">
                    <span class="feishu-metric-label">Pi Agent 专家</span>
                    <span class="feishu-metric-value" :class="state.feishu.piAgentLanguageApiKeyConfigured ? 'text-success' : 'text-muted'">
                      {{ state.feishu.piAgentLanguageApiKeyConfigured ? '🟢 已就绪' : '⚪ 可选' }}
                    </span>
                  </div>
                </div>
              </div>

              <!-- 状态警告栏 -->
              <el-alert v-if="state.feishu.error" :title="state.feishu.error" type="warning" :closable="false" show-icon class="feishu-status-alert" />
              <el-alert
                v-else-if="state.feishu.enabled && state.feishu.connection.state !== 'connected'"
                :title="state.feishu.connection.state === 'connecting' || state.feishu.connection.state === 'reconnecting'
                  ? '飞书长连接仍在重试；请确认飞书开放平台已启用机器人，并将事件订阅方式设为“使用长连接接收事件/回调”。'
                  : '飞书机器人已启用但尚未连接；可点击“启用”重试。'"
                type="warning"
                :closable="false"
                show-icon
                class="feishu-status-alert"
              />

              <!-- 折叠式飞书开放平台 3 步配置指南 -->
              <el-collapse class="feishu-guide-collapse">
                <el-collapse-item name="guide">
                  <template #title>
                    <div class="feishu-guide-title">
                      <span>💡 飞书开放平台 3 步极速接入指南 (无需公网 IP，长连接安全模式)</span>
                    </div>
                  </template>
                  <div class="feishu-guide-content">
                    <div class="feishu-guide-step">
                      <div class="step-num">1</div>
                      <div class="step-body">
                        <strong>创建企业自建应用</strong>
                        <p>登录 <a href="https://open.feishu.cn" target="_blank">飞书开放平台 (open.feishu.cn)</a>，创建“企业自建应用”，进入“凭证与基础信息”获取 <code>App ID</code> 和 <code>App Secret</code> 填入下方卡片。</p>
                      </div>
                    </div>
                    <div class="feishu-guide-step">
                      <div class="step-num">2</div>
                      <div class="step-body">
                        <strong>添加机器人能力并发布</strong>
                        <p>在左侧导航进入“添加应用能力”，添加“机器人”；并在“版本管理与发布”中创建并发布版本（可设置为仅企业内部运维人员可见）。</p>
                      </div>
                    </div>
                    <div class="feishu-guide-step">
                      <div class="step-num">3</div>
                      <div class="step-body">
                        <strong>开启长连接事件订阅</strong>
                        <p>进入“事件与回调”，将事件订阅方式配置为<strong>“使用长连接接收事件”</strong>（无需公网 IP 和域名），并添加接收消息 <code>im.message.receive_v1</code> 与卡片回调事件权限。</p>
                      </div>
                    </div>
                  </div>
                </el-collapse-item>
              </el-collapse>

              <!-- 四大配置卡片网格 -->
              <div class="feishu-cards-grid">
                <!-- 卡片 1：官方凭据 -->
                <el-card shadow="never" class="content-card feishu-card">
                  <template #header>
                    <div class="card-header-line">
                      <span>飞书机器人凭据</span>
                      <el-tag :type="state.feishu.credentialConfigured ? 'success' : 'info'" size="small">
                        {{ state.feishu.credentialConfigured ? '已配置' : '未配置' }}
                      </el-tag>
                    </div>
                  </template>
                  <el-form label-position="top">
                    <el-form-item label="飞书APP ID"><el-input v-model="state.feishu.appId" placeholder="cli_..." /></el-form-item>
                    <el-form-item label="APP SECRET"><el-input v-model="state.feishu.appSecret" type="password" show-password autocomplete="new-password" placeholder="请输入 APP SECRET" /></el-form-item>
                    <div class="feishu-card-footer">
                      <el-button type="primary" :loading="state.feishu.credentialSaving" @click="saveFeishuCredentials">保存飞书APP ID和APP SECRET</el-button>
                    </div>
                  </el-form>
                </el-card>

                <!-- 卡片 2：Jev 大模型 -->
                <el-card shadow="never" class="content-card feishu-card">
                  <template #header>
                    <div class="card-header-line">
                      <span>飞书查询 Jev 路由大模型</span>
                      <el-tag :type="state.feishu.languageProviderReady ? 'success' : 'info'" size="small">
                        {{ state.feishu.languageProviderReady ? '就绪' : '未就绪' }}
                      </el-tag>
                    </div>
                  </template>
                  <el-form label-position="top">
                    <el-form-item label="路由名称"><el-input v-model="state.feishu.languageProviderName" placeholder="Jev 或 TypeSafe Jev" /></el-form-item>
                    <el-form-item label="API 请求地址（可留空）"><el-input v-model="state.feishu.languageEndpoint" placeholder="Jev 配置无需填写" /></el-form-item>
                    <el-form-item label="默认模型"><el-input v-model="state.feishu.languageModel" placeholder="jev-latest" /></el-form-item>
                    <el-form-item label="上游格式">
                      <el-select v-model="state.feishu.languageFormat" style="width: 100%">
                        <el-option label="Chat Completions（兼容）" value="chat-completions" />
                        <el-option label="Responses（原生）" value="responses" />
                      </el-select>
                    </el-form-item>
                    <el-form-item label="Jev API KEY"><el-input v-model="state.feishu.languageApiKey" type="password" show-password autocomplete="new-password" placeholder="请输入 Jev API KEY" /></el-form-item>
                    <div class="feishu-card-footer">
                      <el-button type="primary" :loading="state.feishu.languageSaving" @click="saveLanguageProvider">保存大模型配置</el-button>
                      <el-button type="success" :disabled="!state.feishu.languageProviderReady" :loading="state.feishu.saving" @click="enableFeishu">启用</el-button>
                      <el-button :disabled="!state.feishu.enabled" :loading="state.feishu.saving" @click="stopFeishu">停止</el-button>
                    </div>
                  </el-form>
                </el-card>

                <!-- 卡片 3：Pi Agent 排障大模型 -->
                <el-card shadow="never" class="content-card feishu-card">
                  <template #header>
                    <div class="card-header-line">
                      <span>Pi Agent 原大模型配置</span>
                      <el-tag :type="state.feishu.piAgentLanguageApiKeyConfigured ? 'success' : 'info'" size="small">
                        {{ state.feishu.piAgentLanguageApiKeyConfigured ? '已配置' : '未配置' }}
                      </el-tag>
                    </div>
                  </template>
                  <el-form label-position="top">
                    <el-form-item label="供应商名称"><el-input v-model="state.feishu.piAgentLanguageProviderName" placeholder="例如 MiniMax / OpenAI Compatible" /></el-form-item>
                    <el-form-item label="API 请求地址"><el-input v-model="state.feishu.piAgentLanguageEndpoint" placeholder="https://api.example.com/v1" /></el-form-item>
                    <el-form-item label="默认模型"><el-input v-model="state.feishu.piAgentLanguageModel" placeholder="例如 MiniMax-M2.7" /></el-form-item>
                    <el-form-item label="上游格式">
                      <el-select v-model="state.feishu.piAgentLanguageFormat" style="width: 100%">
                        <el-option label="Chat Completions（兼容）" value="chat-completions" />
                        <el-option label="Responses（原生）" value="responses" />
                      </el-select>
                    </el-form-item>
                    <el-form-item label="Pi Agent API KEY"><el-input v-model="state.feishu.piAgentLanguageApiKey" type="password" show-password autocomplete="new-password" placeholder="请输入 Pi Agent API KEY" /></el-form-item>
                    <div class="feishu-card-footer">
                      <el-button type="primary" :loading="state.feishu.piAgentLanguageSaving" @click="savePiAgentLanguage">保存配置</el-button>
                    </div>
                  </el-form>
                </el-card>

                <!-- 卡片 4：AnySearch 联网搜索 -->
                <el-card shadow="never" class="content-card feishu-card">
                  <template #header>
                    <div class="card-header-line">
                      <span>AnySearch 智能联网搜索</span>
                      <el-tag :type="state.anysearch.apiKey ? 'success' : 'info'" size="small">
                        {{ state.anysearch.apiKey ? '已配置' : '默认未配置' }}
                      </el-tag>
                    </div>
                  </template>
                  <el-form label-position="top">
                    <el-form-item label="AnySearch Key">
                      <el-input v-model="state.anysearch.apiKey" show-password placeholder="as_sk_..." />
                    </el-form-item>
                    <div class="feishu-card-footer">
                      <el-button type="primary" :loading="state.anysearch.saving" @click="saveAnySearchConfig">保存 AnySearch Key</el-button>
                    </div>
                  </el-form>
                </el-card>
              </div>
            </div>
          </section>


          <section v-else-if="state.activeView === 'install'">
            <div class="page-head">
              <div>
                <h1>ONU 安装查询</h1>
              </div>
              <el-button type="primary" :loading="state.loading.install" @click="loadInstallOnus">刷新 ONU 安装信息</el-button>
            </div>
            <el-card shadow="never" class="content-card">
              <template #header>未注册 ONU</template>
              <el-table
                :data="state.unregisteredRows"
                border
                stripe
                size="small"
                :empty-text="state.installMessage || '当前 OLT 暂无未注册 ONU 数据'"
              >
                <el-table-column label="槽/板卡/PON/ID" min-width="150">
                  <template #default="{ row }">{{ onuCoordinateLabel(row) }}</template>
                </el-table-column>
                <el-table-column label="地址" min-width="160" show-overflow-tooltip>
                  <template #default="{ row }">{{ row.address || "-" }}</template>
                </el-table-column>
                <el-table-column prop="serial" label="序列号" min-width="180">
                  <template #default="{ row }">
                    <div class="cell-copy-row">
                      <span>{{ row.serial || "N/A" }}</span>
                      <button v-if="row.serial" type="button" class="quick-copy-btn" title="复制序列号" @click.stop="quickCopy(row.serial, '序列号')">
                        <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M16 1H4C2.9 1 2 1.9 2 3v14h2V3h12V1zm3 4H8C6.9 5 6 5.9 6 7v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
                      </button>
                    </div>
                  </template>
                </el-table-column>
                <el-table-column label="发现时间" min-width="180">
                  <template #default="{ row }">{{ formatDate(row.detectedAt) }}</template>
                </el-table-column>
                <el-table-column prop="state" label="状态" width="140" />
                <el-table-column label="配置方案" min-width="180">
                  <template #default="{ row }">
                    <el-button link type="primary" @click="openConfigPlanDialog(row)">生成方案</el-button>
                  </template>
                </el-table-column>
              </el-table>
            </el-card>
          </section>

          <section v-else-if="state.activeView === 'onus'">
            <div class="page-head compact">
              <div>
                <h1>ONU 数据查询</h1>
              </div>
              <div class="search-bar">
                <span class="search-label">全局搜索</span>
                <el-autocomplete
                  v-model="state.filters.search"
                  :fetch-suggestions="queryAddressSuggestions"
                  clearable
                  placeholder="搜索序列号、地址、Phase状态、RX光功率"
                  @select="handleAddressSelect"
                  @change="saveFilters"
                />
                <el-select v-model="state.filters.chassis" clearable filterable placeholder="槽" class="mini-select" @change="handleChassisChange">
                  <el-option v-for="chassis in chassisOptions" :key="chassis" :label="chassis" :value="chassis" />
                </el-select>
                <el-select v-model="state.filters.slot" clearable filterable placeholder="板卡" class="mini-select" @change="handleSlotChange">
                  <el-option v-for="slot in slotOptions" :key="slot" :label="slot" :value="slot" />
                </el-select>
                <el-select v-model="state.filters.pon" clearable filterable placeholder="PON" class="mini-select" @change="saveFilters">
                  <el-option v-for="pon in ponOptions" :key="pon" :label="pon" :value="pon" />
                </el-select>
                <el-button type="primary" :loading="state.loading.onus" @click="loadOnus">搜索</el-button>
              </div>
            </div>
            <div class="summary-strip">
              <span v-for="item in onuSummary" :key="item.key" :class="['summary-item', item.key]">
                {{ item.label }}: <strong>{{ item.value }}</strong>
              </span>
            </div>
            <el-card shadow="never" class="content-card table-card">
              <el-table
                :data="sortedOnuRows"
                border
                stripe
                size="small"
                :empty-text="onuEmptyText"
                @sort-change="handleOnuSort"
              >
                <el-table-column prop="coordinate" label="槽/板卡/PON/ID" sortable="custom" min-width="150">
                  <template #default="{ row }">{{ onuCoordinateLabel(row) }}</template>
                </el-table-column>
                <el-table-column prop="deviceNumber" label="网管二期设备号" min-width="190" show-overflow-tooltip>
                  <template #default="{ row }">
                    <div class="cell-copy-row">
                      <span>{{ row.deviceNumber || "未同步" }}</span>
                      <button v-if="row.deviceNumber" type="button" class="quick-copy-btn" title="复制设备号" @click.stop="quickCopy(row.deviceNumber, '设备号')">
                        <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M16 1H4C2.9 1 2 1.9 2 3v14h2V3h12V1zm3 4H8C6.9 5 6 5.9 6 7v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
                      </button>
                    </div>
                  </template>
                </el-table-column>
                <el-table-column prop="serial" label="ONU 序列号" min-width="160">
                  <template #default="{ row }">
                    <div class="cell-copy-row">
                      <el-button link type="primary" class="serial-link" title="点击打开内置终端自动执行命令查看原生配置" @click="openOnuConfig(row)">
                        {{ row.serial || "N/A" }}
                      </el-button>
                      <button v-if="row.serial" type="button" class="quick-copy-btn" title="复制序列号" @click.stop="quickCopy(row.serial, '序列号')">
                        <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M16 1H4C2.9 1 2 1.9 2 3v14h2V3h12V1zm3 4H8C6.9 5 6 5.9 6 7v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
                      </button>
                    </div>
                  </template>
                </el-table-column>
                <el-table-column prop="loid" label="LOID" min-width="160" show-overflow-tooltip>
                  <template #default="{ row }">
                    <div class="cell-copy-row">
                      <el-button v-if="row.loid" link type="primary" class="serial-link" @click="openOnuDetail(row)">
                        {{ row.loid }}
                      </el-button>
                      <span v-else>-</span>
                      <button v-if="row.loid" type="button" class="quick-copy-btn" title="复制 LOID" @click.stop="quickCopy(row.loid, 'LOID')">
                        <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M16 1H4C2.9 1 2 1.9 2 3v14h2V3h12V1zm3 4H8C6.9 5 6 5.9 6 7v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
                      </button>
                    </div>
                  </template>
                </el-table-column>
                <el-table-column prop="username" label="姓名" min-width="120" show-overflow-tooltip />
                <el-table-column prop="phase" label="Phase状态" sortable="custom" min-width="130">
                  <template #default="{ row }">
                    <el-tag :type="phaseInfo(row.phase).type">{{ phaseInfo(row.phase).text }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column prop="rxPower" label="RX 光功率" sortable="custom" min-width="140">
                  <template #default="{ row }">
                    <span :class="['rx-pill', rxPowerInfo(row.rxPower).className]" :title="rxPowerHint(row.rxPower)">
                      <span class="rx-dot"></span>
                      {{ rxPowerInfo(row.rxPower).text }}
                    </span>
                  </template>
                </el-table-column>
                <el-table-column prop="distance" label="ONU 距离" min-width="120" />
                <el-table-column prop="address" label="一级地址" min-width="240" show-overflow-tooltip />
                <el-table-column label="所属项目" min-width="180" show-overflow-tooltip>
                  <template #default="{ row }">
                    <el-tag v-if="row.project" type="success">{{ row.project.name }} · VLAN {{ row.project.vlan }}</el-tag>
                    <el-select
                      v-else
                      :model-value="''"
                      size="small"
                      filterable
                      placeholder="加入项目"
                      class="project-assign-select"
                      @visible-change="ensureProjectsLoaded"
                      @change="(projectId) => addOnuToProject(row, projectId)"
                    >
                      <el-option
                        v-for="project in state.projects"
                        :key="project.id"
                        :label="project.name + ' · VLAN ' + project.vlan"
                        :value="project.id"
                      />
                    </el-select>
                  </template>
                </el-table-column>
              </el-table>
            </el-card>
          </section>

          <section v-else-if="state.activeView === 'adminOlts'">
            <div class="page-head">
              <div>
                <h1>OLT 设备管理</h1>
              </div>
              <div>
                <el-button @click="addAdminOlt">新增 OLT</el-button>
                <el-button type="primary" :loading="state.loading.admin" @click="saveAdminOlts">保存设备</el-button>
              </div>
            </div>
            <el-card shadow="never" class="content-card">
              <el-table :data="state.adminOlts" border stripe size="small">
                <el-table-column label="启用" width="80">
                  <template #default="{ row }"><el-switch v-model="row.enabled" /></template>
                </el-table-column>
                <el-table-column label="名称" min-width="180"><template #default="{ row }"><el-input v-model="row.name" /></template></el-table-column>
                <el-table-column label="厂商" width="120">
                  <template #default="{ row }">
                    <el-select v-model="row.vendor" placeholder="请选择" @change="handleAdminVendorChange(row)">
                      <el-option label="中兴" value="zte" />
                      <el-option label="华为" value="huawei" />
                    </el-select>
                  </template>
                </el-table-column>
                <el-table-column label="型号" width="190">
                  <template #default="{ row }">
                    <el-select v-model="row.deviceProfile" placeholder="请选择" @change="handleAdminProfileChange(row)">
                      <el-option
                        v-for="profile in adminProfilesForVendor(row.vendor)"
                        :key="profile.id"
                        :label="profile.label"
                        :value="profile.id"
                      />
                    </el-select>
                  </template>
                </el-table-column>
                <el-table-column label="版本" width="130"><template #default="{ row }"><el-input v-model="row.version" /></template></el-table-column>
                <el-table-column label="IP" min-width="150"><template #default="{ row }"><el-input v-model="row.host" /></template></el-table-column>
                <el-table-column label="端口" width="110"><template #default="{ row }"><el-input-number v-model="row.snmpPort" :min="1" :max="65535" controls-position="right" /></template></el-table-column>
                <el-table-column label="Community" min-width="150"><template #default="{ row }"><el-input v-model="row.readCommunity" placeholder="留空保持原值" show-password /></template></el-table-column>
                <el-table-column label="Telnet端口" width="130"><template #default="{ row }"><el-input-number v-model="row.telnetPort" :min="1" :max="65535" controls-position="right" /></template></el-table-column>
                <el-table-column label="Telnet用户" min-width="140"><template #default="{ row }"><el-input v-model="row.telnetUsername" placeholder="留空保持原值" /></template></el-table-column>
                <el-table-column label="Telnet密码" min-width="150"><template #default="{ row }"><el-input v-model="row.telnetPassword" placeholder="留空保持原值" show-password /></template></el-table-column>
                <el-table-column label="操作" width="90"><template #default="{ $index }"><el-button type="danger" link @click="deleteAdminOlt($index)">删除</el-button></template></el-table-column>
              </el-table>
            </el-card>
          </section>

          <section v-else-if="state.activeView === 'resourceManagement'">
            <div class="page-head">
              <div>
                <h1>用户资源管理</h1>
              </div>
            </div>
            <el-card shadow="never" class="content-card resource-card merged-onu-snapshot-card">
              <template #header>
                <div class="card-header-line merged-onu-snapshot-header">
                  <span>合并 ONU 数据快照</span>
                  <div class="merged-onu-search">
                    <el-input
                      v-model="state.resource.search"
                      clearable
                      placeholder="搜索 OLT、ONU、设备号、LOID、用户、电话、地址"
                      @keyup.enter="loadResourceUsers"
                      @clear="loadResourceUsers"
                    >
                      <template #append><el-button @click="loadResourceUsers">搜索</el-button></template>
                    </el-input>
                  </div>
                </div>
              </template>
              <el-table :data="resourceUserPageRows" border stripe size="small" class="resource-table">
                <el-table-column prop="oltIp" label="OLT IP地址" min-width="140" />
                <el-table-column prop="onuIndex" label="ONU 索引" min-width="130" />
                <el-table-column prop="deviceNumber" label="网管二期设备号" min-width="190" show-overflow-tooltip>
                  <template #default="{ row }">
                    <div class="cell-copy-row">
                      <span>{{ row.deviceNumber || "未同步" }}</span>
                      <button v-if="row.deviceNumber" type="button" class="quick-copy-btn" title="复制设备号" @click.stop="quickCopy(row.deviceNumber, '设备号')">
                        <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M16 1H4C2.9 1 2 1.9 2 3v14h2V3h12V1zm3 4H8C6.9 5 6 5.9 6 7v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
                      </button>
                    </div>
                  </template>
                </el-table-column>
                <el-table-column prop="loid" label="LOID" min-width="140">
                  <template #default="{ row }">
                    <div class="cell-copy-row">
                      <span>{{ row.loid || "-" }}</span>
                      <button v-if="row.loid" type="button" class="quick-copy-btn" title="复制 LOID" @click.stop="quickCopy(row.loid, 'LOID')">
                        <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M16 1H4C2.9 1 2 1.9 2 3v14h2V3h12V1zm3 4H8C6.9 5 6 5.9 6 7v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
                      </button>
                    </div>
                  </template>
                </el-table-column>
                <el-table-column prop="username" label="用户名" min-width="120" />
                <el-table-column prop="userPhone" label="电话" min-width="140">
                  <template #default="{ row }">
                    <div class="cell-copy-row">
                      <span>{{ row.userPhone || "-" }}</span>
                      <button v-if="row.userPhone" type="button" class="quick-copy-btn" title="复制电话" @click.stop="quickCopy(row.userPhone, '电话')">
                        <svg viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M16 1H4C2.9 1 2 1.9 2 3v14h2V3h12V1zm3 4H8C6.9 5 6 5.9 6 7v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
                      </button>
                    </div>
                  </template>
                </el-table-column>
                <el-table-column prop="installationAddress" label="装机地址" min-width="220" show-overflow-tooltip />
                <el-table-column prop="syncedAt" label="同步时间" min-width="180" />
              </el-table>
              <el-pagination
                v-if="state.resource.users.length"
                v-model:current-page="state.resource.userPage"
                :page-size="state.resource.pageSize"
                :total="state.resource.users.length"
                layout="total, prev, pager, next"
                small
                background
                class="resource-pagination"
              />
            </el-card>
            <el-card shadow="never" class="content-card resource-card merged-onu-sync-card">
              <template #header>
                <div class="merged-header-wrapper">
                  <div class="merged-title-group">
                    <span class="merged-header-title">合并 ONU 数据同步</span>
                    <span class="merged-header-desc">聚合网管二期源与一期 BOSS 资源，提供全网统一的 ONU 资产与用户视图</span>
                  </div>
                  <div class="merged-header-right">
                    <el-tag :type="state.mergedOnu.dataset.synced ? 'success' : 'warning'" effect="light" round>
                      {{ state.mergedOnu.dataset.synced ? '● 数据集已就绪' : '○ 尚未同步' }}
                    </el-tag>
                    <el-button size="small" :loading="state.mergedOnu.syncing" @click="loadMergedOnuSyncState">
                      刷新状态
                    </el-button>
                  </div>
                </div>
              </template>

              <!-- 核心 KPI 看板网格 -->
              <div class="merged-kpi-grid">
                <!-- 指标 1：已合并总量 -->
                <div class="merged-kpi-card kpi-card-highlight">
                  <div class="kpi-card-head">
                    <span class="kpi-title">已合并 ONU 总量</span>
                    <span class="kpi-badge kpi-badge-teal">统一快照</span>
                  </div>
                  <div class="kpi-number-row">
                    <span class="kpi-number">{{ Number(state.mergedOnu.dataset.snapshotCount || 0).toLocaleString() }}</span>
                    <span class="kpi-unit">条</span>
                  </div>
                  <div class="kpi-footnote">
                    <span>最近完成：{{ formatDate(state.mergedOnu.dataset.lastCompletedAt || state.mergedOnu.dataset.updatedAt) || '暂无记录' }}</span>
                  </div>
                </div>

                <!-- 指标 2：二期设备源 -->
                <div class="merged-kpi-card">
                  <div class="kpi-card-head">
                    <span class="kpi-title">网管二期设备源</span>
                    <span class="kpi-badge" :class="state.mergedOnu.sources.network.synced ? 'kpi-badge-blue' : 'kpi-badge-gray'">
                      {{ state.mergedOnu.sources.network.synced ? '二期已就绪' : '未同步' }}
                    </span>
                  </div>
                  <div class="kpi-number-row">
                    <span class="kpi-number">{{ Number(state.mergedOnu.sources.network.count || 0).toLocaleString() }}</span>
                    <span class="kpi-unit">条</span>
                  </div>
                  <div class="kpi-footnote">
                    <span>快照时间：{{ formatDate(state.mergedOnu.sources.network.snapshotAt) || '暂无快照' }}</span>
                  </div>
                </div>

                <!-- 指标 3：最近冲突数 -->
                <div
                  class="merged-kpi-card merged-kpi-card-clickable"
                  :class="{ 'kpi-card-warning': state.mergedOnu.dataset.lastConflictCount > 0 }"
                  @click="openMergedConflictDialog"
                  title="点击查看属性比对冲突诊断、修改建议与修改方法"
                >
                  <div class="kpi-card-head">
                    <span class="kpi-title">属性比对冲突</span>
                    <span class="kpi-badge" :class="state.mergedOnu.dataset.lastConflictCount > 0 ? 'kpi-badge-amber' : 'kpi-badge-green'">
                      {{ state.mergedOnu.dataset.lastConflictCount > 0 ? '需关注差异' : '数据一致' }}
                    </span>
                  </div>
                  <div class="kpi-number-row">
                    <span class="kpi-number" :class="{ 'text-amber': state.mergedOnu.dataset.lastConflictCount > 0 }">
                      {{ Number(state.mergedOnu.dataset.lastConflictCount || 0).toLocaleString() }}
                    </span>
                    <span class="kpi-unit">项</span>
                  </div>
                  <div class="kpi-footnote">
                    <span>{{ state.mergedOnu.dataset.lastConflictCount > 0 ? '双端字段存在冲突，已按策略容错' : '未检测到字段冲突，双端吻合' }}</span>
                    <span v-if="state.mergedOnu.dataset.lastConflictCount > 0" class="kpi-click-hint">点击查看修改建议与方法 →</span>
                  </div>
                </div>

                <!-- 指标 4：一期 BOSS 历史 -->
                <div class="merged-kpi-card">
                  <div class="kpi-card-head">
                    <span class="kpi-title">一期 BOSS 历史姓名</span>
                    <span class="kpi-badge" :class="state.mergedOnu.bossSync.nameHistoryCompletedAt ? 'kpi-badge-teal' : 'kpi-badge-amber'">
                      {{ state.mergedOnu.bossSync.nameHistoryCompletedAt ? '已初始化' : '待初始化' }}
                    </span>
                  </div>
                  <div class="kpi-number-row">
                    <span v-if="state.mergedOnu.bossSync.nameHistoryCompletedAt" class="kpi-number">
                      {{ Number(state.mergedOnu.bossSync.nameHistoryCount || 0).toLocaleString() }}
                    </span>
                    <span v-else class="kpi-text-pending">待初始化</span>
                    <span v-if="state.mergedOnu.bossSync.nameHistoryCompletedAt" class="kpi-unit">个 LOID</span>
                  </div>
                  <div class="kpi-footnote">
                    <span>{{ state.mergedOnu.bossSync.nameHistoryCompletedAt ? '历史姓名已持久化至台账' : '覆盖至：' + (state.mergedOnu.sources.nmse.coverageThrough || '未确认') }}</span>
                  </div>
                </div>
              </div>

              <!-- 精简技术元数据信息行 -->
              <div class="merged-meta-banner">
                <div class="merged-meta-col">
                  <span class="meta-field-label">统一合并时间:</span>
                  <span class="meta-field-value">{{ formatDate(state.mergedOnu.dataset.mergedAt) || '暂无合并记录' }}</span>
                </div>
                <div class="merged-meta-col">
                  <span class="meta-field-label">后台运行状态:</span>
                  <span class="meta-field-value">
                    <span class="meta-status-pill" :class="'pill-' + (state.mergedOnu.progress.status || 'idle')">
                      {{ mergedOnuSyncStatusText(state.mergedOnu.progress) }}
                    </span>
                  </span>
                </div>
                <div class="merged-meta-col meta-revision-col" v-if="state.mergedOnu.dataset.revision">
                  <span class="meta-field-label">Revision:</span>
                  <div class="meta-revision-box">
                    <code class="meta-revision-code" :title="state.mergedOnu.dataset.revision">
                      {{ state.mergedOnu.dataset.revision.length > 28 ? state.mergedOnu.dataset.revision.slice(0, 26) + '...' : state.mergedOnu.dataset.revision }}
                    </code>
                    <el-button link type="primary" size="small" class="copy-rev-btn" @click="copyRevision(state.mergedOnu.dataset.revision)">
                      复制
                    </el-button>
                  </div>
                </div>
              </div>

              <!-- 规整操作工具栏 -->
              <div class="merged-action-container">
                <div class="merged-action-group">
                  <span class="action-group-title">阶段操作：</span>
                  <el-button
                    :loading="state.mergedOnu.syncing && state.mergedOnu.progress.operation === 'network'"
                    :disabled="state.mergedOnu.syncing || !state.oss.loggedIn"
                    @click="syncMergedOnuOperation('network')"
                  >
                    二期全量同步
                  </el-button>
                  <el-button
                    :loading="state.mergedOnu.syncing && state.mergedOnu.progress.operation === 'nmse'"
                    :disabled="state.mergedOnu.syncing || !state.resource.loggedIn"
                    @click="syncMergedOnuOperation('nmse')"
                  >
                    {{ state.mergedOnu.bossSync.nameHistoryCompletedAt ? '一期 BOSS 增量同步' : '一期 BOSS 历史全量初始化' }}
                  </el-button>
                  <el-button
                    :loading="state.mergedOnu.syncing && state.mergedOnu.progress.operation === 'merge'"
                    :disabled="state.mergedOnu.syncing || !state.mergedOnu.sources.network.synced || !state.mergedOnu.sources.nmse.synced"
                    @click="syncMergedOnuOperation('merge')"
                  >
                    手动合并
                  </el-button>
                </div>
                <div class="merged-action-primary">
                  <el-button
                    type="primary"
                    class="full-sync-btn"
                    :loading="state.mergedOnu.syncing && state.mergedOnu.progress.operation === 'full'"
                    :disabled="state.mergedOnu.syncing || !state.resource.loggedIn || !state.oss.loggedIn"
                    @click="syncMergedOnuDataset"
                  >
                    {{ state.mergedOnu.bossSync.nameHistoryCompletedAt ? '一键全量合并 (二期全量 + 一期增量)' : '一键全流程同步并初始化' }}
                  </el-button>
                </div>
              </div>

              <div class="merged-action-tips" title="每次操作前自动备份本机 SQLite">
                <span class="tip-icon">ℹ️</span>
                <span>操作安全保障：每次操作前自动备份本机 SQLite，可放心执行全量同步与合并。</span>
              </div>
              <div v-if="state.mergedOnu.syncing || state.mergedOnu.progress.status === 'running' || state.mergedOnu.progress.error" class="resource-user-progress merged-onu-sync-progress">
                <div class="resource-progress-heading">
                  <div>
                    <span class="resource-progress-label">{{ mergedOnuSyncPhaseText(state.mergedOnu.progress.phase) }}</span>
                    <strong>{{ state.mergedOnu.progress.networkRows || 0 }} 网络 ONU · {{ state.mergedOnu.progress.nmseRows || 0 }} NMSE 用户 · {{ state.mergedOnu.progress.mergedRows || 0 }} 已合并</strong>
                  </div>
                  <el-tag :type="state.mergedOnu.progress.status === 'failed' ? 'danger' : state.mergedOnu.progress.status === 'success' ? 'success' : 'warning'">{{ mergedOnuSyncStatusText(state.mergedOnu.progress) }}</el-tag>
                </div>
                <el-progress :percentage="mergedOnuSyncPercent(state.mergedOnu.progress)" :indeterminate="state.mergedOnu.progress.status === 'running' && !state.mergedOnu.progress.totalOlts" :stroke-width="14" />
                <div class="resource-progress-meta">
                  <span v-if="state.mergedOnu.progress.phase === 'fetching-nmse-history'">历史批次 {{ state.mergedOnu.progress.nmseCompletedChunks || 0 }} / {{ state.mergedOnu.progress.nmseChunkCount || 0 }} · 当前批次 {{ state.mergedOnu.progress.nmseCompletedPages || 0 }} / {{ state.mergedOnu.progress.nmsePages || 0 }} 页</span>
                  <span v-else-if="state.mergedOnu.progress.phase === 'fetching-nmse' && state.mergedOnu.progress.nmsePages">NMSE {{ state.mergedOnu.progress.nmseCompletedPages || 0 }} / {{ state.mergedOnu.progress.nmsePages }} 页 · {{ state.mergedOnu.progress.nmseWorkers || 1 }} 路并发</span>
                  <span v-else>OLT {{ state.mergedOnu.progress.completedOlts || 0 }} / {{ state.mergedOnu.progress.totalOlts || 0 }}</span>
                  <span>冲突 {{ state.mergedOnu.progress.conflicts || 0 }}</span>
                </div>
                <el-alert v-if="state.mergedOnu.progress.error" :title="state.mergedOnu.progress.error" type="error" :closable="false" show-icon />
              </div>
            </el-card>
            <el-card shadow="never" class="content-card resource-card">
              <template #header>
                <div class="oss-card-heading">
                  <span>NMSE-PON 服务器配置</span>
                  <el-tag :type="state.resource.loggedIn ? 'success' : 'info'">{{ state.resource.loggedIn ? '资源系统已登录' : '未登录' }}</el-tag>
                </div>
              </template>
              <el-form label-position="top">
                <div class="oss-config-grid">
                  <el-form-item label="服务器地址"><el-input v-model="state.resource.config.serverUrl" placeholder="http://172.18.254.7:9000" /></el-form-item>
                  <el-form-item label="用户名"><el-input v-model="state.resource.config.username" /></el-form-item>
                  <el-form-item label="登录密码"><el-input v-model="state.resource.config.password" type="password" show-password placeholder="保存后持久化至数据库，无需每次输入" /></el-form-item>
                </div>
                <div class="toolbar" style="margin-top: 14px">
                  <el-button type="primary" :loading="state.resource.configLoading" @click="saveResourceManagementConfig">保存配置</el-button>
                  <el-button v-if="state.resource.loggedIn" @click="logoutResourceManagement">退出登录</el-button>
                  <el-button v-else type="primary" :loading="state.resource.loginLoading" @click="loginResourceManagement">登录资源系统</el-button>
                </div>
              </el-form>
            </el-card>
            <el-card shadow="never" class="content-card resource-card oss-config-card">
              <template #header>
                <div class="oss-card-heading">
                  <span>网管二期历史光功率配置</span>
                  <el-tag :type="state.oss.loggedIn ? 'success' : 'info'">{{ state.oss.loggedIn ? '已登录' : '未登录' }}</el-tag>
                </div>
              </template>
              <el-form label-position="top" class="oss-config-form">
                <div class="oss-config-grid">
                  <el-form-item label="OSS 认证地址"><el-input v-model="state.oss.config.authBaseUrl" placeholder="http://10.205.136.199:18140" /></el-form-item>
                  <el-form-item label="网管二期地址"><el-input v-model="state.oss.config.ngbBaseUrl" placeholder="http://10.205.137.22:8080" /></el-form-item>
                  <el-form-item label="用户名"><el-input v-model="state.oss.config.username" autocomplete="off" /></el-form-item>
                  <el-form-item label="组织名称">
                    <el-select
                      v-model="state.oss.config.organizationName"
                      filterable
                      allow-create
                      default-first-option
                      placeholder="例如：南区分公司（可下拉选择）"
                      style="width: 100%"
                      @change="handleWizardOrgChange"
                    >
                      <el-option
                        v-for="org in state.oss.discoveredOrgs"
                        :key="org.name"
                        :label="org.name"
                        :value="org.name"
                      >
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                          <span>{{ org.name }}</span>
                          <span style="color: var(--el-text-color-secondary); font-size: 12px;">{{ (org.rooms || []).length }} 个机房</span>
                        </div>
                      </el-option>
                    </el-select>
                  </el-form-item>
                  <el-form-item label="机房名称">
                    <el-select
                      v-model="state.oss.config.roomName"
                      filterable
                      allow-create
                      default-first-option
                      placeholder="例如：核心机房（可下拉选择）"
                      style="width: 100%"
                    >
                      <el-option
                        v-for="room in currentOrgRoomOptions"
                        :key="room"
                        :label="room"
                        :value="room"
                      />
                    </el-select>
                  </el-form-item>
                </div>
                <el-checkbox v-if="state.oss.autoLoginAvailable" v-model="state.oss.rememberPassword">本机自动登录可使用操作系统加密存储</el-checkbox>
                <div class="toolbar">
                  <el-button type="success" plain :loading="state.oss.roomsLoading" @click="fetchOssRoomInfo">读取机房信息</el-button>
                  <el-button :loading="state.oss.configLoading" @click="saveOssResourceConfig">保存配置</el-button>
                  <el-button v-if="state.oss.loggedIn" @click="logoutOssResource">退出网管二期</el-button>
                  <el-button v-else type="primary" :loading="state.oss.loginLoading" @click="loginOssResource">{{ (state.oss.credentialConfigured || state.oss.autoLoginConfigured) && !state.oss.password ? '登录网管二期' : '保存并登录' }}</el-button>
                </div>
              </el-form>
              <el-alert v-if="state.oss.loggedIn" :title="'已发现 ' + state.oss.olts.length + ' 台目标机房 OLT'" type="success" :closable="false" show-icon />
              <el-table v-if="state.oss.olts.length" :data="state.oss.olts" border stripe size="small" class="oss-discovered-table">
                <el-table-column prop="resourceIp" label="支撑网 IP" min-width="160" />
                <el-table-column prop="roomName" label="机房" min-width="140" />
              </el-table>
            </el-card>
          </section>

          <section v-else-if="state.activeView === 'backupRestore'">
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

          <section v-else-if="state.activeView === 'systemUpdate'">
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

          <section v-else-if="state.activeView === 'adminProjects'">
            <div class="page-head">
              <div>
                <h1>专线项目管理</h1>
              </div>
              <div class="toolbar">
                <el-input
                  v-model="state.projectSearch"
                  clearable
                  placeholder="搜索名称/地址/联系人/VLAN"
                  class="project-search"
                  @change="loadProjects"
                  @clear="loadProjects"
                />
                <el-button @click="loadProjects">搜索</el-button>
                <el-button type="primary" @click="openProjectDialog()">新增项目</el-button>
              </div>
            </div>
            <div class="project-workspace">
              <div class="project-workspace-top">
                <div class="project-pane-title">
                  <strong>项目列表</strong>
                  <span>{{ state.projects.length }} 个项目</span>
                </div>
                <el-empty v-if="!state.loading.admin && !state.projects.length" :description="state.projectSearch ? '没有匹配项目' : '暂无项目'" />
                <div class="project-rail">
                  <div
                    v-for="project in state.projects"
                    :key="project.id"
                    role="button"
                    tabindex="0"
                    :class="['project-list-item', { active: state.projectDetail.project?.id === project.id }]"
                    @click="selectProjectDetail(project, { reload: true })"
                    @keydown.enter.prevent="selectProjectDetail(project, { reload: true })"
                    @keydown.space.prevent="selectProjectDetail(project, { reload: true })"
                  >
                    <div class="project-list-main">
                      <strong>{{ project.name }}</strong>
                      <el-tag size="small" type="success">VLAN {{ project.vlan }}</el-tag>
                    </div>
                    <div class="project-list-meta">
                      <span>{{ project.address || "未填写地址" }}</span>
                      <span>{{ project.contactName || "未填写联系人" }}</span>
                    </div>
                    <div class="project-list-actions">
                      <el-button type="primary" link @click.stop="openProjectDialog(project)">编辑</el-button>
                      <el-button type="danger" link @click.stop="deleteProject(project)">删除</el-button>
                    </div>
                  </div>
                </div>
              </div>

              <template v-if="state.projectDetail.project">
                <div class="project-workspace-body">
                  <section class="project-table-pane">
                    <div class="project-section-title">
                      <strong>ONU 设备台账</strong>
                      <div class="project-section-actions">
                        <span>点击行查看地址和操作</span>
                        <el-button size="small" :loading="state.projectDetail.loading" @click="loadProjectOnus">刷新 ONU</el-button>
                      </div>
                    </div>
                    <el-table
                      :data="state.projectDetail.onus"
                      border
                      stripe
                      size="small"
                      max-height="560"
                      class="project-device-table"
                      v-loading="state.projectDetail.loading"
                      empty-text="暂无项目 ONU"
                      :row-class-name="projectOnuRowClassName"
                      @row-click="selectProjectOnu"
                    >
                      <el-table-column prop="oltName" label="OLT" min-width="160" show-overflow-tooltip />
                      <el-table-column label="位置" width="92">
                        <template #default="{ row }">
                          <span class="project-device-coordinate">{{ onuCoordinateLabel(row) }}</span>
                        </template>
                      </el-table-column>
                      <el-table-column prop="serial" label="SN" min-width="140" show-overflow-tooltip />
                      <el-table-column label="状态" width="82">
                        <template #default="{ row }">
                          <span class="project-device-status">
                            <i :class="['project-device-status-dot', phaseInfo(row.phase).type || 'info']"></i>
                            {{ row.phase ? phaseInfo(row.phase).text : "-" }}
                          </span>
                        </template>
                      </el-table-column>
                      <el-table-column label="光功率" width="105">
                        <template #default="{ row }">
                          <span v-if="row.rxPower" :class="['project-device-rx', rxPowerInfo(row.rxPower).className]">{{ rxPowerInfo(row.rxPower).text }}</span>
                          <span v-else>-</span>
                        </template>
                      </el-table-column>
                      <el-table-column prop="distance" label="距离" width="82" />
                      <el-table-column label="设备安装地址" min-width="280" show-overflow-tooltip>
                        <template #default="{ row }">
                          <span>{{ row.noteDraft || row.note || "-" }}</span>
                        </template>
                      </el-table-column>
                    </el-table>
                    <div class="project-onu-inline" v-if="state.projectDetail.selectedOnu">
                      <el-input class="project-inline-note" v-model="state.projectDetail.selectedOnu.noteDraft" size="small" maxlength="240" show-word-limit placeholder="填写设备安装地址" />
                      <div class="project-inline-actions">
                        <el-button type="primary" size="small" :loading="state.projectDetail.selectedOnu.savingNote" @click="saveProjectOnuNote(state.projectDetail.selectedOnu)">修改安装地址</el-button>
                        <el-button type="danger" size="small" plain :loading="state.projectDetail.selectedOnu.removing" @click="removeProjectOnu(state.projectDetail.selectedOnu)">移除 ONU</el-button>
                      </div>
                    </div>
                    <el-alert v-if="state.projectDetail.selectedOnu?.refreshError" type="warning" :closable="false" :title="state.projectDetail.selectedOnu.refreshError" />
                    <el-empty v-if="!state.projectDetail.selectedOnu && !state.projectDetail.loading" description="选择一台 ONU 编辑备注或移除" />
                  </section>
                </div>
              </template>
              <el-empty v-else description="请选择项目查看 ONU 台账" />
            </div>
          </section>

          <section v-else-if="state.activeView === 'adminPonPorts'">
            <div class="page-head">
              <div>
                <h1>ONU 数据管理</h1>
              </div>
              <div class="toolbar">
                <el-button @click="addPonPort">新增一行</el-button>
                <el-button type="success" :disabled="!state.resource.loggedIn" :loading="state.resource.vlanSyncing" @click="syncResourceVlans">更新外层 VLAN</el-button>
                <el-button @click="triggerExcelImport">导入 Excel</el-button>
                <el-button @click="exportPonPortsExcel">导出 Excel</el-button>
                <el-button type="primary" :loading="state.loading.admin" @click="savePonPorts">保存台账</el-button>
                <input id="pon-excel-input" class="visually-hidden-file" type="file" accept=".xlsx,.xls" @change="importPonPortsExcel" />
              </div>
            </div>
            <el-card shadow="never" class="content-card">
              <div class="pon-tools">
                <el-input v-model="state.ponAdminSearch" clearable placeholder="搜索 OLT/IP/PON/外层VLAN/地址" />
                <span class="muted">{{ ponStats }}</span>
              </div>
              <el-table :data="filteredPonPorts" border stripe size="small" max-height="520">
                <el-table-column label="OLT IP" min-width="160"><template #default="{ row }"><el-input v-model="row.port.oltIp" /></template></el-table-column>
                <el-table-column label="槽" width="100"><template #default="{ row }"><el-input v-model="row.port.chassis" /></template></el-table-column>
                <el-table-column label="板卡" width="100"><template #default="{ row }"><el-input v-model="row.port.board" /></template></el-table-column>
                <el-table-column label="PON" width="100"><template #default="{ row }"><el-input v-model="row.port.pon" /></template></el-table-column>
                <el-table-column label="外层 VLAN" width="140"><template #default="{ row }"><el-input v-model="row.port.outerVlan" /></template></el-table-column>
                <el-table-column label="一级地址" min-width="260"><template #default="{ row }"><el-input v-model="row.port.address" /></template></el-table-column>
                <el-table-column label="操作" width="90"><template #default="{ row }"><el-button type="danger" link @click="deletePonPort(row.__index)">删除</el-button></template></el-table-column>
              </el-table>
            </el-card>
          </section>

          <section v-else-if="state.activeView === 'resourceSchedule'">
            <div class="page-head">
              <div>
                <h1>定时任务</h1>
              </div>
              <el-button :loading="state.resourceSchedule.loading" @click="loadResourceSchedules">刷新任务</el-button>
            </div>
            <el-card shadow="never" class="content-card resource-schedule-card">
              <template #header>新增同步任务</template>
              <el-form label-position="top" class="resource-schedule-form">
                <el-form-item label="执行日期" required>
                  <el-date-picker
                    v-model="state.resourceSchedule.form.runAt"
                    type="datetime"
                    placeholder="选择执行日期和时间"
                    format="YYYY年MM月DD日 HH:mm"
                    value-format="YYYY-MM-DD HH:mm:ss"
                    :editable="false"
                    :disabled-date="disablePastDate"
                  />
                </el-form-item>
                <el-form-item label="同步类型" required>
                  <el-select v-model="state.resourceSchedule.form.operation" placeholder="请选择同步类型">
                    <el-option v-for="operation in resourceSyncOperations" :key="operation.value" :label="operation.label" :value="operation.value" />
                  </el-select>
                </el-form-item>
                <el-form-item label="重复执行">
                  <div class="resource-schedule-repeat-control">
                    <el-switch v-model="state.resourceSchedule.form.repeatEnabled" active-text="重复" inactive-text="仅一次" />
                    <el-input-number v-if="state.resourceSchedule.form.repeatEnabled" v-model="state.resourceSchedule.form.repeatDays" :min="1" :max="365" controls-position="right" />
                    <span v-if="state.resourceSchedule.form.repeatEnabled" class="muted">天一次</span>
                  </div>
                </el-form-item>
                <el-form-item>
                  <el-button type="primary" :loading="state.resourceSchedule.saving" @click="createResourceSchedule">新增定时任务</el-button>
                </el-form-item>
              </el-form>
            </el-card>
            <el-card shadow="never" class="content-card resource-schedule-card">
              <template #header>
                <div class="card-header-line"><span>任务列表</span><span class="muted">{{ state.resourceSchedule.tasks.length }} 个任务</span></div>
              </template>
              <el-table :data="state.resourceSchedule.tasks" border stripe size="small" empty-text="暂无定时任务">
                <el-table-column label="执行日期" min-width="180"><template #default="{ row }">{{ formatDate(row.runAt) }}</template></el-table-column>
                <el-table-column label="同步类型" min-width="150"><template #default="{ row }">{{ resourceScheduleOperationText(row.operation) }}</template></el-table-column>
                <el-table-column label="重复" width="100"><template #default="{ row }">{{ resourceScheduleRepeatText(row) }}</template></el-table-column>
                <el-table-column label="状态" width="110"><template #default="{ row }"><el-tag :type="resourceScheduleStatusType(row.status)">{{ resourceScheduleStatusText(row.status) }}</el-tag></template></el-table-column>
                <el-table-column label="同步条数" width="110"><template #default="{ row }">{{ row.resultCount || 0 }}</template></el-table-column>
                <el-table-column label="上次执行" min-width="180"><template #default="{ row }">{{ formatDate(row.lastRunAt) || '-' }}</template></el-table-column>
                <el-table-column label="结果" min-width="220" show-overflow-tooltip><template #default="{ row }">{{ resourceScheduleLastResult(row) }}</template></el-table-column>
                <el-table-column label="操作" width="140"><template #default="{ row }"><div class="resource-schedule-actions"><el-button v-if="row.status === 'pending'" type="warning" link :loading="state.resourceSchedule.cancelingId === row.id" @click="cancelResourceSchedule(row)">取消</el-button><el-button v-if="row.status !== 'running'" type="danger" link :loading="state.resourceSchedule.deletingId === row.id" @click="deleteResourceSchedule(row)">删除</el-button><span v-if="row.status === 'running'" class="muted">执行中</span></div></template></el-table-column>
              </el-table>
            </el-card>
          </section>
          <el-dialog
            v-model="state.onuConfig.visible"
            title="ONU 已配置数据"
            width="760px"
            destroy-on-close
          >
            <div v-loading="state.onuConfig.loading">
              <el-empty v-if="!state.onuConfig.data" description="请选择 ONU 序列号查看配置" />
              <div v-else class="onu-detail">
                <el-descriptions title="基础信息" :column="2" border class="detail-block">
                  <el-descriptions-item label="OLT">{{ state.onuConfig.data.olt.name }}</el-descriptions-item>
                  <el-descriptions-item label="厂商型号">{{ state.onuConfig.data.olt.vendor }} {{ state.onuConfig.data.olt.model }}</el-descriptions-item>
                  <el-descriptions-item label="槽/板卡/PON/ID">
                    {{ onuCoordinateLabel(state.onuConfig.data.onu) }}
                  </el-descriptions-item>
                  <el-descriptions-item label="ONU 序列号">{{ state.onuConfig.data.onu.serial }}</el-descriptions-item>
                  <el-descriptions-item label="一级地址">{{ state.onuConfig.data.onu.address || "未登记" }}</el-descriptions-item>
                  <el-descriptions-item label="外层 VLAN">{{ state.onuConfig.data.onu.outerVlan || "待补充" }}</el-descriptions-item>
                </el-descriptions>

                <el-card v-if="state.onuConfig.data.servicePorts?.length || state.onuConfig.data.cliConfig?.runningConfig" shadow="never" class="detail-block">
                  <template #header>已验证业务 VLAN</template>
                  <pre class="command-template terminal-block">{{ servicePortCli(state.onuConfig.data) }}</pre>
                </el-card>

                <el-card v-if="state.onuConfig.data.cliConfig?.onuRunningConfig" shadow="never" class="detail-block">
                  <template #header>ONU 已配置数据</template>
                  <el-alert
                    :title="'数据来源：' + (state.onuConfig.data.cliConfig?.source || '只读采集') + '。'"
                    type="info"
                    :closable="false"
                    show-icon
                    class="detail-note"
                  />
                  <pre class="command-template terminal-block">{{ onuMgmtCli(state.onuConfig.data) }}</pre>
                </el-card>

                <el-alert
                  v-else-if="state.onuConfig.data.cliConfig?.error"
                  :title="'ONU 已配置数据读取失败：' + state.onuConfig.data.cliConfig.error"
                  type="warning"
                  :closable="false"
                  show-icon
                  class="detail-block"
                />
              </div>
            </div>
          </el-dialog>
          <el-dialog
            v-model="state.onuDetail.visible"
            title="ONU 详情"
            width="760px"
            destroy-on-close
          >
            <div v-loading="state.onuDetail.loading">
              <el-empty v-if="!state.onuDetail.data" description="请选择 LOID 查看详情" />
              <div v-else class="onu-detail">
                  <el-descriptions title="基础信息" :column="2" border class="detail-block">
                    <el-descriptions-item label="OLT">{{ state.onuDetail.data.olt.name }}</el-descriptions-item>
                    <el-descriptions-item label="厂商型号">{{ state.onuDetail.data.olt.vendor }} {{ state.onuDetail.data.olt.model }}</el-descriptions-item>
                  <el-descriptions-item label="槽/板卡/PON/ID">
                    {{ onuCoordinateLabel(state.onuDetail.data.onu) }}
                  </el-descriptions-item>
                    <el-descriptions-item label="ONU 序列号">{{ state.onuDetail.data.onu.serial }}</el-descriptions-item>
                    <el-descriptions-item label="LOID">{{ state.onuDetail.data.onu.loid || "未登记" }}</el-descriptions-item>
                    <el-descriptions-item label="ONU 名称/备注">{{ state.onuDetail.data.onu.name || "未登记" }}</el-descriptions-item>
                    <el-descriptions-item label="状态">{{ phaseInfo(state.onuDetail.data.onu.phase).text }}</el-descriptions-item>
                    <el-descriptions-item label="电话">{{ state.onuDetail.data.onu.userPhone || "未登记" }}</el-descriptions-item>
                    <el-descriptions-item label="装机地址">{{ state.onuDetail.data.onu.installationAddress || "未登记" }}</el-descriptions-item>
                    <el-descriptions-item label="ONU MAC 地址">{{ state.onuDetail.data.onu.mac || "未登记" }}</el-descriptions-item>
                    <el-descriptions-item label="姓名">{{ state.onuDetail.data.onu.username || "未登记" }}</el-descriptions-item>
                    <el-descriptions-item label="RX 光功率">{{ state.onuDetail.data.onu.rxPower || "N/A" }}</el-descriptions-item>
                    <el-descriptions-item label="ONU 距离">{{ state.onuDetail.data.onu.distance || "N/A" }}</el-descriptions-item>
                    <el-descriptions-item label="最近上线时间">{{ state.onuDetail.data.onu.lastOnlineTime || "暂无" }}</el-descriptions-item>
                    <el-descriptions-item label="最后离线时间">{{ state.onuDetail.data.onu.lastOfflineTime || "暂无" }}</el-descriptions-item>
                    <el-descriptions-item label="离线研判" :span="2">
                      <div class="cell-copy-row" style="gap: 8px; align-items: center;">
                        <el-tag :type="diagnoseOfflineCause(state.onuDetail.data.onu.lastOfflineCause).type" effect="dark">
                          {{ diagnoseOfflineCause(state.onuDetail.data.onu.lastOfflineCause).badge }}
                        </el-tag>
                        <span v-if="diagnoseOfflineCause(state.onuDetail.data.onu.lastOfflineCause).advice" class="muted" style="font-size: 13px;">
                          👉 {{ diagnoseOfflineCause(state.onuDetail.data.onu.lastOfflineCause).advice }}
                        </span>
                      </div>
                    </el-descriptions-item>
                    <el-descriptions-item label="一级地址">{{ state.onuDetail.data.onu.address || "未登记" }}</el-descriptions-item>
                    <el-descriptions-item label="外层 VLAN">{{ state.onuDetail.data.onu.outerVlan || "待补充" }}</el-descriptions-item>
                    <el-descriptions-item label="用户资源同步时间">{{ formatDate(state.onuDetail.data.onu.userSyncedAt) || "暂无" }}</el-descriptions-item>
                    <el-descriptions-item label="所属项目">{{ state.onuDetail.data.onu.project?.name || "未归属" }}</el-descriptions-item>
                    <el-descriptions-item label="项目 VLAN">{{ state.onuDetail.data.onu.project?.vlan || "未设置" }}</el-descriptions-item>
                  </el-descriptions>

                  <el-card shadow="never" class="detail-block history-card">
                    <template #header>历史状态</template>
                    <el-descriptions :column="2" border>
                      <el-descriptions-item label="历史采样数">{{ state.onuDetail.data.history?.sampleCount || 0 }}</el-descriptions-item>
                      <el-descriptions-item label="离线次数">{{ state.onuDetail.data.history?.offlineCount || 0 }}</el-descriptions-item>
                    </el-descriptions>
                    <div v-if="state.onuDetail.data.history?.rxPower?.length >= 2" class="rx-trend-block">
                      <div class="detail-subtitle">光功率历史趋势</div>
                      <svg viewBox="0 0 600 180" class="rx-trend-chart" role="img" aria-label="光功率历史趋势">
                        <polyline :points="rxHistoryPoints(state.onuDetail.data)" fill="none" stroke="#0f766e" stroke-width="3" />
                      </svg>
                    </div>
                    <el-empty v-else description="暂无足够的光功率历史采样" />
                    <div class="detail-subtitle">最近几次离线原因</div>
                    <el-table
                      v-if="state.onuDetail.data.history?.recentOfflineReasons?.length"
                      :data="state.onuDetail.data.history.recentOfflineReasons"
                      border
                      stripe
                      size="small"
                    >
                      <el-table-column prop="time" label="时间" min-width="180" />
                      <el-table-column prop="reason" label="离线原因" min-width="140" />
                      <el-table-column prop="code" label="原因码" width="90" />
                    </el-table>
                    <el-empty v-else description="暂无离线事件采样" />
                  </el-card>

                  <el-card shadow="never" class="detail-block oss-history-card">
                    <template #header>
                      <div class="oss-card-heading">
                        <div>
                          <strong>网管二期历史光功率</strong>
                        </div>
                        <el-tag :type="state.oss.loggedIn ? 'success' : 'info'">{{ state.oss.loggedIn ? '会话可用' : '未登录' }}</el-tag>
                      </div>
                    </template>
                    <div class="oss-history-toolbar">
                      <el-date-picker
                        v-model="state.oss.dateRange"
                        type="daterange"
                        value-format="YYYY-MM-DD"
                        range-separator="至"
                        start-placeholder="开始日期"
                        end-placeholder="结束日期"
                        :clearable="false"
                      />
                      <el-button
                        type="primary"
                        :disabled="!state.oss.loggedIn"
                        :loading="state.oss.historyLoading"
                        title="只读取已保存的历史记录，不触发光功率刷新"
                        @click="loadOssOpticalHistory"
                      >读取历史光功率</el-button>
                    </div>
                    <el-alert v-if="!state.oss.loggedIn" title="请先到“用户资源管理”保存网管二期配置并登录。" type="warning" :closable="false" show-icon />
                    <el-alert v-else-if="state.oss.historyError" :title="state.oss.historyError" type="warning" :closable="false" show-icon />
                    <div v-if="state.oss.historyRows.length && analyzeHistoricalOpticalSeries(state.oss.historyRows).hasData" class="oss-history-analysis-banner" style="margin-bottom: 12px; padding: 10px 14px; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0;">
                      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                        <span style="font-weight: 600; font-size: 13px;">📊 7 天光衰波动分析 (采样 {{ analyzeHistoricalOpticalSeries(state.oss.historyRows).sampleCount }} 次)</span>
                        <el-tag :type="analyzeHistoricalOpticalSeries(state.oss.historyRows).degraded ? 'danger' : 'success'" effect="plain">
                          {{ analyzeHistoricalOpticalSeries(state.oss.historyRows).verdict }}
                        </el-tag>
                      </div>
                      <div style="display: flex; gap: 20px; font-size: 12px; color: #475569;">
                        <span>最高光衰: <strong>{{ analyzeHistoricalOpticalSeries(state.oss.historyRows).maxRx }}</strong></span>
                        <span>最低光衰: <strong>{{ analyzeHistoricalOpticalSeries(state.oss.historyRows).minRx }}</strong></span>
                        <span>波动极差: <strong :style="{ color: analyzeHistoricalOpticalSeries(state.oss.historyRows).degraded ? '#dc2626' : '#16a34a' }">{{ analyzeHistoricalOpticalSeries(state.oss.historyRows).delta }}</strong></span>
                        <span>平均光衰: <strong>{{ analyzeHistoricalOpticalSeries(state.oss.historyRows).avgRx }}</strong></span>
                      </div>
                    </div>
                    <el-table v-if="state.oss.historyRows.length" :data="state.oss.historyRows" border stripe size="small" max-height="320" class="oss-history-table">
                      <el-table-column prop="reportTime" label="采集时间" min-width="180"><template #default="{ row }">{{ formatDate(row.reportTime) }}</template></el-table-column>
                      <el-table-column prop="rxOptical" label="ONU RX" width="110"><template #default="{ row }">{{ opticalValue(row.rxOptical) }}</template></el-table-column>
                      <el-table-column prop="txOptical" label="ONU TX" width="110"><template #default="{ row }">{{ opticalValue(row.txOptical) }}</template></el-table-column>
                      <el-table-column prop="oltRxOptical" label="OLT RX" width="110"><template #default="{ row }">{{ opticalValue(row.oltRxOptical) }}</template></el-table-column>
                      <el-table-column prop="lightDecay" label="光衰" width="110"><template #default="{ row }">{{ opticalValue(row.lightDecay) }}</template></el-table-column>
                    </el-table>
                    <el-empty v-else-if="state.oss.loggedIn && !state.oss.historyLoading && !state.oss.historyError" description="选择日期后读取网管二期历史光功率" />
                  </el-card>

              </div>
            </div>
          </el-dialog>
          <el-dialog
            v-model="state.configPlan.visible"
            title="未注册 ONU 配置方案"
            width="880px"
            destroy-on-close
          >
            <div v-if="state.configPlan.row" class="plan-dialog">
              <el-descriptions :column="3" border class="detail-block">
                <el-descriptions-item label="槽/板卡/PON">{{ ponCoordinateKey(state.configPlan.row) }}</el-descriptions-item>
                <el-descriptions-item label="序列号">{{ state.configPlan.row.serial }}</el-descriptions-item>
                <el-descriptions-item label="状态">{{ state.configPlan.row.state }}</el-descriptions-item>
              </el-descriptions>
              <el-form label-width="96px" class="plan-form">
                <el-form-item label="配置模板">
                  <el-select v-model="state.configPlan.templateId" placeholder="请选择模板" @change="handleConfigTemplateChange">
                    <el-option
                      v-for="template in currentConfigTemplates"
                      :key="template.id"
                      :label="template.name"
                      :value="template.id"
                    />
                  </el-select>
                </el-form-item>
                <el-form-item v-if="selectedProjectTemplate" label="项目模板">
                  <div class="project-template-summary">
                    <el-tag type="success">{{ selectedProjectTemplate.projectName }}</el-tag>
                    <el-tag>VLAN {{ selectedProjectTemplate.vlan }}</el-tag>
                  </div>
                </el-form-item>
                <el-form-item v-if="showEthPortSelector" label="物理端口">
                  <el-checkbox-group v-model="state.configPlan.ethPorts">
                    <el-checkbox-button
                      v-for="port in currentEthPortOptions"
                      :key="port"
                      :label="port"
                    >
                      {{ formatEthPortLabel(port) }}
                    </el-checkbox-button>
                  </el-checkbox-group>
                </el-form-item>
                <el-form-item v-if="showCustomVlanInput" label="业务 VLAN">
                  <el-input-number
                    v-model="state.configPlan.customVlan"
                    :min="1"
                    :max="4094"
                    controls-position="right"
                    placeholder="请输入 VLAN"
                  />
                </el-form-item>
                <el-form-item>
                  <el-button type="primary" :loading="state.configPlan.loading" :disabled="!currentConfigTemplates.length" @click="generateConfigPlan">生成命令预览</el-button>
                  <el-button :disabled="!state.configPlan.result?.commands" @click="copyConfigPlan">复制命令</el-button>
                  <el-button :disabled="!state.configPlan.result?.commands" @click="openTerminalForConfigPlan">打开内置终端</el-button>
                </el-form-item>
                <el-alert
                  v-if="configPlanUnsupportedMessage"
                  :title="configPlanUnsupportedMessage"
                  type="warning"
                  :closable="false"
                  show-icon
                />
              </el-form>
              <el-alert
                v-for="warning in state.configPlan.result?.warnings || []"
                :key="warning"
                :title="warning"
                :type="state.configPlan.result?.blocked ? 'error' : 'info'"
                :closable="false"
                show-icon
                class="detail-note"
              />
              <el-descriptions v-if="state.configPlan.result?.variables" title="变量来源" :column="3" border class="detail-block">
                <el-descriptions-item v-for="(value, key) in state.configPlan.result.variables" :key="key" :label="key">
                  <template #label>{{ configPlanVariableLabel(key) }}</template>
                  {{ formatConfigPlanVariable(key, value) }}
                </el-descriptions-item>
              </el-descriptions>
              <pre class="command-template terminal-block">{{ state.configPlan.result?.commands || "请选择模板并点击生成。" }}</pre>
            </div>
          </el-dialog>
          <el-dialog
            v-model="state.terminal.visible"
            title="内置 Telnet 终端"
            :width="state.terminal.showAssistant ? terminalDialogWidth : '960px'"
            class="terminal-dialog"
            destroy-on-close
            @opened="mountTerminal"
            @closed="closeTerminalSession"
          >
            <div class="terminal-status">
              <span>{{ state.terminal.status }}</span>
              <div class="terminal-actions">
                <el-button size="small" @click="copyConfigPlan" :disabled="!state.configPlan.result?.commands">复制配置命令</el-button>
                <el-button size="small" type="primary" plain @click="pasteClipboardToTerminal" :disabled="!state.terminal.sessionId || state.terminal.pasting">粘贴剪贴板</el-button>
                <el-button size="small" :type="state.terminal.showAssistant ? 'success' : 'default'" plain @click="togglePiAssistant">
                  {{ state.terminal.showAssistant ? '收起 Pi 助手' : '打开 Pi 助手' }}
                </el-button>
              </div>
            </div>
            <div ref="terminalLayoutRef" class="terminal-layout" :class="{ 'is-resizing': state.terminal.resizing, 'has-assistant': state.terminal.showAssistant }">
              <div class="terminal-pane">
                <div ref="terminalHost" class="embedded-terminal"></div>
              </div>
              <div
                v-if="state.terminal.showAssistant"
                class="terminal-splitter"
                title="按住左右拖动调整宽度，双击恢复默认比例"
                @mousedown="startTerminalResize"
                @dblclick="resetTerminalAssistantWidth"
              >
                <div class="splitter-line"></div>
                <div class="splitter-handle"></div>
              </div>
              <div
                v-if="state.terminal.showAssistant"
                class="pi-assistant-pane"
                :style="{ width: (state.terminal.assistantWidth || 440) + 'px' }"
              >
                <div class="pi-assistant-header">
                  <div class="pi-assistant-context">
                    <el-tag size="small" type="info">{{ currentOlt?.vendor?.toUpperCase() || 'OLT' }}</el-tag>
                    <span>{{ currentOlt?.model || currentOlt?.name || 'Pi 智能助手' }}</span>
                  </div>
                  <div style="display: flex; align-items: center; gap: 6px;">
                    <el-button size="small" link type="primary" @click="openAnySearchConfigDialog">⚙️ 搜索配置</el-button>
                    <el-tag size="small" type="success" effect="plain">只读问答</el-tag>
                  </div>
                </div>
                <div ref="piMessagesContainer" class="pi-assistant-messages">
                  <div
                    v-for="(msg, index) in state.terminal.assistantMessages"
                    :key="index"
                    :class="['pi-message', msg.role === 'user' ? 'pi-message-user' : 'pi-message-assistant']"
                  >
                    <div v-if="msg.role === 'user'" class="pi-message-text">{{ msg.content }}</div>
                    <div v-else class="pi-message-rich" v-html="renderPiMessage(msg.content)"></div>
                    <div v-if="msg.commands && msg.commands.length" class="pi-message-commands">
                      <div v-for="(cmd, cIdx) in msg.commands" :key="cIdx" class="pi-message-code-block">
                        <code>{{ cmd }}</code>
                        <el-button size="small" link type="success" @click="copyText(cmd)">复制</el-button>
                      </div>
                    </div>
                  </div>
                  <div v-if="state.terminal.assistantLoading" class="pi-message pi-message-assistant muted">
                    Pi Agent 思考中...
                  </div>
                </div>
                <div class="pi-assistant-quick-prompts">
                  <el-button size="small" round @click="sendPiAssistantQuick('光功率查询与门限标准')">光功率标准</el-button>
                  <el-button size="small" round @click="sendPiAssistantQuick('C600与C300命令避坑差异')">C600避坑</el-button>
                  <el-button size="small" round @click="sendPiAssistantQuick('查看未注册ONU')">未注册查询</el-button>
                  <el-button size="small" round @click="sendPiAssistantQuick('ONU掉线离线原因排查')">离线原因分析</el-button>
                  <el-button size="small" round @click="sendPiAssistantQuick('流氓ONU长发光排查')">流氓ONU排查</el-button>
                  <el-button size="small" round @click="sendPiAssistantQuick('PON端口流量与丢包统计')">端口流量丢包</el-button>
                  <el-button size="small" round @click="sendPiAssistantQuick('查看机框板卡与温度')">板卡与环境</el-button>
                  <el-button size="small" round @click="sendPiAssistantQuick('查看设备当前活动告警')">活动告警</el-button>
                </div>
                <div class="pi-assistant-input-box">
                  <el-input
                    v-model="state.terminal.assistantInput"
                    size="small"
                    placeholder="向 Pi 助手提问命令或诊断..."
                    :disabled="state.terminal.assistantLoading"
                    @keyup.enter="sendPiAssistantMessage"
                  />
                  <el-button
                    size="small"
                    type="primary"
                    :loading="state.terminal.assistantLoading"
                    @click="sendPiAssistantMessage"
                  >发送</el-button>
                </div>
              </div>
            </div>
          </el-dialog>
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
          <el-dialog
            v-model="state.projectLoading.visible"
            width="420px"
            class="project-loading-dialog"
            :close-on-click-modal="false"
            :close-on-press-escape="false"
            :show-close="false"
          >
            <div class="project-loading-box">
              <div class="project-loading-icon">
                <span></span>
              </div>
              <div class="project-loading-copy">
                <strong>{{ state.projectLoading.title }}</strong>
                <p>{{ state.projectLoading.message }}</p>
              </div>
              <el-progress
                :percentage="state.projectLoading.percent"
                :stroke-width="10"
                :show-text="false"
                status="success"
              />
              <div class="project-loading-foot">
                <span>{{ state.projectLoading.percent }}%</span>
                <span>{{ state.projectLoading.step }}</span>
              </div>
            </div>
          </el-dialog>
          <el-dialog
            v-model="state.onuLoading.visible"
            width="420px"
            class="project-loading-dialog"
            :close-on-click-modal="false"
            :close-on-press-escape="false"
            :show-close="false"
          >
            <div class="project-loading-box">
              <div class="project-loading-icon">
                <span></span>
              </div>
              <div class="project-loading-copy">
                <strong>{{ state.onuLoading.title }}</strong>
                <p>{{ state.onuLoading.message }}</p>
              </div>
              <el-progress
                :percentage="state.onuLoading.percent"
                :stroke-width="10"
                :show-text="false"
                status="success"
              />
              <div class="project-loading-foot">
                <span>{{ state.onuLoading.percent }}%</span>
                <span>{{ state.onuLoading.step }}</span>
              </div>
            </div>
          </el-dialog>
          <el-dialog
            v-model="state.ponImportPreview.visible"
            title="PON 台账 Excel 导入预检"
            width="780px"
            destroy-on-close
          >
            <div class="pon-import-preview-box">
              <div class="feishu-metrics-bar" style="margin-bottom: 16px;">
                <div class="feishu-metric-item">
                  <span class="feishu-metric-label">读取行数</span>
                  <span class="feishu-metric-value">{{ state.ponImportPreview.totalRaw }} 行</span>
                </div>
                <div class="feishu-metric-divider"></div>
                <div class="feishu-metric-item">
                  <span class="feishu-metric-label">有效数据</span>
                  <span class="feishu-metric-value text-success">🟢 {{ state.ponImportPreview.validCount }} 条</span>
                </div>
                <div class="feishu-metric-divider"></div>
                <div class="feishu-metric-item">
                  <span class="feishu-metric-label">覆盖已有</span>
                  <span class="feishu-metric-value text-warning">{{ state.ponImportPreview.overrideCount }} 条</span>
                </div>
                <div class="feishu-metric-divider"></div>
                <div class="feishu-metric-item">
                  <span class="feishu-metric-label">新增端口</span>
                  <span class="feishu-metric-value text-success">+{{ state.ponImportPreview.newCount }} 条</span>
                </div>
                <div class="feishu-metric-divider"></div>
                <div class="feishu-metric-item">
                  <span class="feishu-metric-label">跳过空行</span>
                  <span class="feishu-metric-value text-muted">{{ state.ponImportPreview.emptyCount }} 行</span>
                </div>
                <div class="feishu-metric-divider"></div>
                <div class="feishu-metric-item">
                  <span class="feishu-metric-label">格式异常</span>
                  <span class="feishu-metric-value" :class="state.ponImportPreview.invalidRows.length ? 'text-danger' : 'text-muted'">
                    {{ state.ponImportPreview.invalidRows.length ? '⚠️ ' + state.ponImportPreview.invalidRows.length + ' 行' : '0' }}
                  </span>
                </div>
              </div>

              <el-alert
                v-if="state.ponImportPreview.invalidRows.length"
                :title="'检测到 ' + state.ponImportPreview.invalidRows.length + ' 处格式异常，这些行在导入时将被自动跳过：'"
                type="warning"
                :closable="false"
                show-icon
                style="margin-bottom: 12px;"
              />

              <el-table
                v-if="state.ponImportPreview.invalidRows.length"
                :data="state.ponImportPreview.invalidRows.slice(0, 10)"
                border
                stripe
                size="small"
                max-height="200"
                style="margin-bottom: 16px;"
              >
                <el-table-column prop="line" label="Excel行号" width="100" />
                <el-table-column prop="reason" label="异常原因" min-width="200" />
                <el-table-column label="原始数据摘要" min-width="280" show-overflow-tooltip>
                  <template #default="{ row }">
                    {{ JSON.stringify(row.raw) }}
                  </template>
                </el-table-column>
              </el-table>

              <div class="gateway-actions" style="margin-top: 20px; justify-content: flex-end; display: flex; gap: 12px;">
                <el-button @click="state.ponImportPreview.visible = false">取消</el-button>
                <el-button
                  type="primary"
                  :disabled="!state.ponImportPreview.validCount"
                  :loading="state.ponImportPreview.loading"
                  @click="confirmImportPonRows"
                >
                  确认导入并覆盖应用 (共 {{ state.ponImportPreview.validCount }} 条)
                </el-button>
              </div>
            </div>
          </el-dialog>

          <!-- 属性比对冲突诊断与修改指引对话框 -->
          <el-dialog
            v-model="state.mergedConflictDialog.visible"
            title="属性比对冲突诊断与修改指引"
            width="920px"
            top="5vh"
            destroy-on-close
            class="conflict-guide-dialog"
          >
            <div v-loading="state.mergedConflictDialog.loading" class="conflict-dialog-container">
              <!-- 顶部：分类统计胶囊导航 -->
              <div class="conflict-categories-bar">
                <button
                  type="button"
                  class="conflict-category-pill"
                  :class="{ active: state.mergedConflictDialog.selectedReason === 'all' }"
                  @click="selectConflictCategory('all')"
                >
                  <span>全部冲突</span>
                  <span class="pill-count">{{ state.mergedConflictDialog.rows.length }}</span>
                </button>
                <button
                  v-for="cat in conflictSummary.categories"
                  :key="cat.key"
                  type="button"
                  class="conflict-category-pill"
                  :class="[
                    cat.guide.tagType ? 'pill-' + cat.guide.tagType : '',
                    { active: state.mergedConflictDialog.selectedReason === cat.key }
                  ]"
                  @click="selectConflictCategory(cat.key)"
                >
                  <span>{{ cat.guide.label }}</span>
                  <span class="pill-count">{{ cat.count }}</span>
                </button>
              </div>

              <!-- 核心：修改建议与修改方法指南卡片 -->
              <div v-if="currentConflictGuide" class="conflict-guide-card">
                <div class="guide-card-header">
                  <div class="guide-header-left">
                    <el-tag :type="currentConflictGuide.tagType" size="default" effect="dark">
                      {{ currentConflictGuide.label }}
                    </el-tag>
                    <span class="guide-severity">优先级：{{ currentConflictGuide.severity }}</span>
                    <span class="guide-summary-text">{{ currentConflictGuide.summary }}</span>
                  </div>
                </div>

                <div class="guide-sections-grid">
                  <!-- 模块 1：成因剖析 -->
                  <div class="guide-section-box section-cause">
                    <div class="section-title">
                      <span class="section-icon">🔍</span>
                      <strong>成因剖析</strong>
                    </div>
                    <p class="section-desc">{{ currentConflictGuide.cause }}</p>
                  </div>

                  <!-- 模块 2：系统当前容错策略 -->
                  <div class="guide-section-box section-tolerance">
                    <div class="section-title">
                      <span class="section-icon">🛡️</span>
                      <strong>系统容错与保护</strong>
                    </div>
                    <p class="section-desc">{{ currentConflictGuide.tolerance }}</p>
                  </div>
                </div>

                <!-- 模块 3：修改建议 -->
                <div class="guide-section-box section-suggestion" style="margin-top: 10px;">
                  <div class="section-title">
                    <span class="section-icon">💡</span>
                    <strong>权威修改建议</strong>
                  </div>
                  <p class="section-desc">{{ currentConflictGuide.suggestion }}</p>
                </div>

                <!-- 模块 4：具体修改方法（分步操作指南） -->
                <div class="guide-section-box section-actions" style="margin-top: 10px;">
                  <div class="section-title">
                    <span class="section-icon">🛠️</span>
                    <strong>分步修改方法（操作指南）</strong>
                  </div>
                  <div class="guide-steps-list">
                    <div v-for="step in currentConflictGuide.actionMethods" :key="step.step" class="guide-step-item">
                      <div class="step-badge">{{ step.step }}</div>
                      <div class="step-content">
                        <strong class="step-title">{{ step.title }}：</strong>
                        <span class="step-detail">{{ step.content }}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 下方：明细筛选与冲突数据列表 -->
              <div class="conflict-table-panel" style="margin-top: 18px;">
                <div class="conflict-filter-bar">
                  <div class="filter-left">
                    <span class="filter-heading">冲突明细清单</span>
                    <span class="filter-total">（共 {{ filteredConflictRows.length }} 条记录）</span>
                  </div>
                  <div class="filter-right">
                    <el-select
                      v-model="state.mergedConflictDialog.selectedOltIp"
                      placeholder="筛选 OLT IP"
                      clearable
                      size="small"
                      style="width: 160px;"
                    >
                      <el-option label="全部 OLT" value="" />
                      <el-option v-for="ip in conflictOltIpList" :key="ip" :label="ip" :value="ip" />
                    </el-select>
                    <el-input
                      v-model="state.mergedConflictDialog.searchKeyword"
                      placeholder="搜索 LOID / 端口 / 详情..."
                      clearable
                      size="small"
                      style="width: 220px;"
                    />
                  </div>
                </div>

                <el-table
                  :data="pagedConflictRows"
                  border
                  stripe
                  size="small"
                  max-height="320"
                  class="conflict-data-table"
                >
                  <el-table-column label="冲突类型" width="160">
                    <template #default="{ row }">
                      <el-tag :type="getConflictGuide(row.reason).tagType" size="small">
                        {{ getConflictGuide(row.reason).label }}
                      </el-tag>
                    </template>
                  </el-table-column>
                  <el-table-column prop="oltIp" label="OLT 设备 IP" width="140" />
                  <el-table-column prop="onuIndexDisplay" label="物理端口/坐标" width="130">
                    <template #default="{ row }">
                      <code>{{ row.onuIndexDisplay || '未解析' }}</code>
                    </template>
                  </el-table-column>
                  <el-table-column prop="loid" label="LOID" min-width="150">
                    <template #default="{ row }">
                      <div class="cell-copy-row">
                        <span>{{ row.loid || '无' }}</span>
                        <el-button v-if="row.loid" type="primary" link size="small" @click="copyText(row.loid)">
                          复制
                        </el-button>
                      </div>
                    </template>
                  </el-table-column>
                  <el-table-column prop="detail" label="冲突成因与明细" min-width="260" show-overflow-tooltip />
                  <el-table-column label="快捷操作" width="90" align="center">
                    <template #default="{ row }">
                      <el-button
                        type="primary"
                        link
                        size="small"
                        @click="copyConflictRowInfo(row)"
                        title="复制该条设备诊断信息"
                      >
                        复制信息
                      </el-button>
                    </template>
                  </el-table-column>
                </el-table>

                <!-- 分页栏 -->
                <div class="conflict-pagination-bar">
                  <el-pagination
                    v-model:current-page="state.mergedConflictDialog.page"
                    v-model:page-size="state.mergedConflictDialog.pageSize"
                    :page-sizes="[10, 15, 30, 50]"
                    :total="filteredConflictRows.length"
                    layout="total, sizes, prev, pager, next"
                    size="small"
                  />
                </div>
              </div>
            </div>

            <template #footer>
              <div class="conflict-dialog-footer">
                <div class="footer-left">
                  <el-button type="success" plain size="small" @click="exportConflictsExcel">
                    📥 导出冲突清单 (Excel)
                  </el-button>
                </div>
                <div class="footer-right">
                  <el-button @click="state.mergedConflictDialog.visible = false">关闭</el-button>
                  <el-button type="primary" @click="handleRerunMergeSync">
                    🔄 重新执行全量融合
                  </el-button>
                </div>
              </div>
            </template>
          </el-dialog>

          <!-- 核心交互：OLT 重点关注 PON 业务端口预警与弱光排查弹窗 -->
          <el-dialog
            v-model="state.oltAlertsDialog.visible"
            width="780px"
            destroy-on-close
            class="olt-alerts-modal"
          >
            <template #header>
              <div style="display: flex; align-items: center; justify-content: space-between; padding-right: 24px;">
                <div style="display: flex; align-items: center; gap: 10px;">
                  <span style="font-size: 16px; font-weight: 700; color: #0f172a;">
                    ⚠️ PON 业务端口预警与弱光排查
                  </span>
                  <el-tag size="small" type="danger" effect="plain">
                    {{ (state.oltAlertsDialog.ports || []).length }} 个端口需排查
                  </el-tag>
                </div>
                <div v-if="state.oltAlertsDialog.olt" style="font-size: 13px; color: #475569; font-family: monospace; font-weight: 600;">
                  设备 IP: {{ state.oltAlertsDialog.olt.host }} ({{ state.oltAlertsDialog.olt.model }})
                </div>
              </div>
            </template>

            <div v-if="state.oltAlertsDialog.ports && state.oltAlertsDialog.ports.length > 0" class="alerts-dialog-body">
              <div
                v-for="port in state.oltAlertsDialog.ports"
                :key="port.id"
                :class="['alert-port-dialog-card', port.tagType === 'warning' ? 'warning' : '']"
              >
                <div class="alert-port-dialog-header">
                  <div class="port-name-wrap" style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                    <span class="port-coord-tag" style="font-family: monospace; font-size: 14px; font-weight: 700; background: #f8fafc; color: #0f172a;">
                      {{ port.fullPortDisplay || (port.oltIp + '/' + port.ponPort) }}
                    </span>
                    <span style="font-size: 12px; font-weight: 600; color: #0284c7; background: #f0f9ff; padding: 2px 8px; border-radius: 4px; border: 1px solid #bae6fd;">
                      📦 一级箱: {{ port.primaryBoxAddress || port.primaryArea }}
                    </span>
                    <el-tag :type="port.tagType" size="small" effect="plain">
                      {{ port.issueLabel }}
                    </el-tag>
                  </div>
                  <span class="port-metric-val" style="font-size: 13px; font-weight: 700; color: #dc2626;">
                    {{ port.metricValue }}
                  </span>
                </div>

                <div class="alert-port-dialog-content">
                  <div class="alert-port-detail-text">
                    {{ port.detail }}
                  </div>
                  <el-button
                    type="primary"
                    size="small"
                    @click="openWeakUsersDialog(port)"
                  >
                    显示弱光详情 →
                  </el-button>
                </div>
              </div>
            </div>
            <el-empty
              v-else
              description="该设备下所有 PON 端口运行指标优良，无重点预警口！"
              :image-size="70"
            />

            <template #footer>
              <div style="display: flex; justify-content: flex-end;">
                <el-button @click="state.oltAlertsDialog.visible = false">关闭</el-button>
              </div>
            </template>
          </el-dialog>

          <!-- 弱光用户详细资料与光功率弹窗 (大屏完整展示门牌地址) -->
          <el-dialog
            v-model="state.weakUsersDialog.visible"
            width="1060px"
            destroy-on-close
            class="weak-users-modal"
          >
            <template #header>
              <div style="display: flex; align-items: center; justify-content: space-between; padding-right: 24px;">
                <div style="display: flex; align-items: center; gap: 10px;">
                  <span style="font-size: 16px; font-weight: 700; color: #0f172a;">
                    🔍 PON 口 [{{ state.weakUsersDialog.fullPortDisplay || state.weakUsersDialog.ponPort }} · 一级箱: {{ state.weakUsersDialog.primaryBoxAddress || state.weakUsersDialog.primaryArea }}] 弱光用户资料与实时光功率
                  </span>
                  <el-tag size="small" type="danger" effect="plain">
                    {{ (state.weakUsersDialog.users || []).length }} 户弱光
                  </el-tag>
                </div>
                <div style="font-size: 12px; color: #64748b; font-family: monospace;">
                  {{ state.weakUsersDialog.oltIp }}
                </div>
              </div>
            </template>

            <div class="weak-user-table-wrap">
              <el-table
                :data="state.weakUsersDialog.users"
                border
                stripe
                size="small"
                empty-text="该 PON 口下暂无弱光用户记录"
              >
                <el-table-column type="index" label="序号" width="55" align="center" />
                <el-table-column label="ONU 物理坐标" width="130" align="center" prop="onuIndex" />
                <el-table-column label="用户姓名" width="110" align="center" prop="username" />
                <el-table-column label="认证 LOID" width="150" align="center">
                  <template #default="{ row }">
                    <code style="font-size: 11px;">{{ row.loid }}</code>
                  </template>
                </el-table-column>
                <el-table-column label="接收光功率" width="110" align="center">
                  <template #default="{ row }">
                    <span style="font-weight: 700; color: #dc2626;">{{ row.rxPower }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="在线状态" width="80" align="center">
                  <template #default="{ row }">
                    <el-tag :type="row.phase === '离线' ? 'info' : 'success'" size="small">
                      {{ row.phase }}
                    </el-tag>
                  </template>
                </el-table-column>
                <el-table-column label="安装门牌地址" min-width="320">
                  <template #default="{ row }">
                    <span style="font-weight: 500; color: #1e293b;">{{ row.address || '未登记地址' }}</span>
                  </template>
                </el-table-column>
              </el-table>
            </div>

            <template #footer>
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <el-button
                  type="success"
                  plain
                  size="small"
                  @click="copyWeakUsersText"
                >
                  📋 复制全部弱光用户
                </el-button>
                <el-button @click="state.weakUsersDialog.visible = false">关闭</el-button>
              </div>
            </template>
          </el-dialog>
        </el-main>
      </el-container>
    </el-container>
    </el-config-provider>
  `,
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
    const currentPonPorts = computed(() => state.ponPorts.filter((port) => !selectedOlt.value.host || port.oltIp === selectedOlt.value.host));
    const ponPortFilterState = createPonPortFilterState();
    const currentConfigTemplates = computed(() => state.configTemplates.filter((template) => {
      if (Array.isArray(template.deviceProfiles)) return template.deviceProfiles.includes(selectedOlt.value.deviceProfile);
      return template.vendor === selectedOlt.value.vendor;
    }));
    const currentConfigTemplate = computed(() => currentConfigTemplates.value.find((template) => template.id === state.configPlan.templateId) || currentConfigTemplates.value[0] || {});
    const currentEthPortOptions = computed(() => currentConfigTemplate.value.portRules?.allowed || []);
    const defaultEthPortsForTemplate = computed(() => currentConfigTemplate.value.portRules?.defaults || []);
    const selectedProjectTemplate = computed(() => currentConfigTemplate.value.projectId ? currentConfigTemplate.value : null);
    const showEthPortSelector = computed(() => currentEthPortOptions.value.length > 0 && state.configPlan.templateId !== "zte-mdu-ott");
    const showCustomVlanInput = computed(() => currentConfigTemplate.value.businessType === "custom-vlan");
    const configPlanUnsupportedMessage = computed(() => {
      if (!selectedOlt.value.id || currentConfigTemplates.value.length) return "";
      const profile = profileById(selectedOlt.value.deviceProfile);
      const label = profile ? `${profile.vendorLabel} ${profile.model}` : `${selectedOlt.value.vendor || ""} ${selectedOlt.value.model || ""}`.trim();
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
      const url = path.startsWith("/api/bootstrap") || path.startsWith("/api/admin/")
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
      await Promise.all([loadConfigTemplates(), loadDashboard()]);
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
        if (result.available) ElMessage.success(`增量包已校验，请确认安装 v${result.version}。`);
        else ElMessage.info("该增量包不适用于当前版本，或已经是最新版本。" );
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
      const requestOltId = state.selectedOltId;
      state.loading.install = true;
      try {
        const data = await onuApi.unregistered();
        if (requestOltId !== state.selectedOltId || data.oltId !== state.selectedOltId) return;
        state.unregisteredRows = data.rows || [];
        state.installMessage = data.message || "";
      } catch (error) {
        if (requestOltId !== state.selectedOltId) return;
        state.unregisteredRows = [];
        state.installMessage = error.message;
        ElMessage.error(error.message);
      } finally {
        if (requestOltId === state.selectedOltId) state.loading.install = false;
      }
    }

    async function loadConfigTemplates() {
      try {
        const data = await onuApi.configTemplates();
        state.configTemplates = data.rows || [];
        syncConfigTemplateSelection();
      } catch (error) {
        state.configTemplates = [];
        ElMessage.error(error.message);
      }
    }

    function handleConfigTemplateChange() {
      state.configPlan.result = null;
      state.configPlan.ethPorts = [...defaultEthPortsForTemplate.value];
      if (currentConfigTemplate.value.businessType !== "custom-vlan") state.configPlan.customVlan = undefined;
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
    }

    function configPlanVariableLabel(key) {
      return {
        slot: "板卡",
        chassis: "槽",
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
        ethPorts: "物理端口",
        customVlan: "自定义VLAN",
        actualOntId: "自动ONT ID",
        projectId: "项目ID",
        projectName: "项目名称",
        projectVlan: "项目VLAN"
      }[key] || key;
    }

    function formatEthPortLabel(port) {
      return currentConfigTemplate.value.portRules?.labels?.[port] || port;
    }

    function formatConfigPlanVariable(key, value) {
      if (key === "ethPorts" && Array.isArray(value)) return value.map(formatEthPortLabel).join(", ");
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
        const data = await onuApi.configPlan(row, {
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
        lastConflictCount: Number(data.lastConflictCount || 0)
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
      const text = `【属性比对冲突排查信息】
冲突类型：${guide.label} (${guide.severity}优先级)
OLT 设备 IP：${row.oltIp || '未指定'}
物理端口/坐标：${row.onuIndexDisplay || '未解析'}
LOID：${row.loid || '无'}
冲突明细：${row.detail || '无'}
系统容错：${guide.tolerance}
修改建议：${guide.suggestion}`;
      const ok = await copyText(text);
      if (ok) {
        ElMessage.success("已复制该条冲突诊断信息至剪贴板");
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
          rememberPassword: Boolean(state.oss.rememberPassword)
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
        const result = await ossResourceApi.login({
          password: loginPassword,
          rememberPassword: Boolean(state.oss.rememberPassword),
          autoLogin: usingAutoLogin
        });
        if (loginPassword) state.oss.password = loginPassword;
        Object.assign(state.oss, ossLoginProjection(result, {
          rememberPassword: state.oss.rememberPassword,
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

    onBeforeUnmount(() => {
      stopFeishuStatusPolling();
      stopMergedOnuSyncPolling();
    });

    onMounted(async () => {
      try {
        await initializeAuth();
        if (state.authenticated) {
          await loadApplication();
        }
      } catch (error) {
        state.authError = error.message || "本地登录服务不可用。";
      }
    });

    return {
      terminalHost,
      terminalLayoutRef,
      state,
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
  }
};

const app = createApp(App);
for (const [name, component] of Object.entries({
  "el-alert": ElAlert,
  "el-aside": ElAside,
  "el-autocomplete": ElAutocomplete,
  "el-button": ElButton,
  "el-card": ElCard,
  "el-checkbox": ElCheckbox,
  "el-checkbox-button": ElCheckboxButton,
  "el-checkbox-group": ElCheckboxGroup,
  "el-col": ElCol,
  "el-config-provider": ElConfigProvider,
  "el-container": ElContainer,
  "el-date-picker": ElDatePicker,
  "el-descriptions": ElDescriptions,
  "el-descriptions-item": ElDescriptionsItem,
  "el-dialog": ElDialog,
  "el-empty": ElEmpty,
  "el-form": ElForm,
  "el-form-item": ElFormItem,
  "el-header": ElHeader,
  "el-input": ElInput,
  "el-input-number": ElInputNumber,
  "el-main": ElMain,
  "el-menu": ElMenu,
  "el-menu-item": ElMenuItem,
  "el-option": ElOption,
  "el-pagination": ElPagination,
  "el-progress": ElProgress,
  "el-row": ElRow,
  "el-select": ElSelect,
  "el-switch": ElSwitch,
  "el-table": ElTable,
  "el-table-column": ElTableColumn,
  "el-tag": ElTag,
  "el-steps": ElSteps,
  "el-step": ElStep
})) app.component(name, component);
app.directive("loading", ElLoading.directive);
app.mount("#app");
