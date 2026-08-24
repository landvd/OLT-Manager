import { createApp, computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from "vue/dist/vue.esm-bundler.js";
import { ElAlert } from "element-plus/es/components/alert/index.mjs";
import { ElAutocomplete } from "element-plus/es/components/autocomplete/index.mjs";
import { ElButton } from "element-plus/es/components/button/index.mjs";
import { ElCard } from "element-plus/es/components/card/index.mjs";
import { ElCol } from "element-plus/es/components/col/index.mjs";
import { ElDatePicker } from "element-plus/es/components/date-picker/index.mjs";
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
import { terminalPasteCharDelayMs, terminalPasteFrames, terminalPasteLineDelayMs, terminalPasteNeedsExtraEnter } from "./terminal-paste.mjs";
import { createOnuApi } from "./onu-api.mjs";
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
  uniqueSorted
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
          <el-menu-item index="dashboard">首页</el-menu-item>
          <el-menu-item index="install">ONU 安装查询</el-menu-item>
          <el-menu-item index="onus">ONU 数据查询</el-menu-item>
          <el-menu-item index="adminOlts">OLT 设备管理</el-menu-item>
          <el-menu-item index="adminPonPorts">ONU 数据管理</el-menu-item>
          <el-menu-item index="resourceManagement">用户资源管理</el-menu-item>
          <el-menu-item index="feishuSettings">飞书机器人</el-menu-item>
          <el-menu-item index="adminProjects">专线项目管理</el-menu-item>
          <el-menu-item index="resourceSchedule">定时任务</el-menu-item>
          <el-menu-item index="backupRestore">备份还原</el-menu-item>
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
                <p>查看当前 OLT 的状态、待处理 ONU 和台账健康情况。</p>
              </div>
            </div>
            <el-row :gutter="14" class="metric-row">
              <el-col :span="6" v-for="metric in dashboardMetrics" :key="metric.label">
                <el-card shadow="never" :class="['metric-card', metric.tone || '']">
                  <span>{{ metric.label }}</span>
                  <strong>{{ metric.value }}</strong>
                  <em v-if="metric.hint">{{ metric.hint }}</em>
                </el-card>
              </el-col>
            </el-row>
            <el-row :gutter="14">
              <el-col :span="16">
                <el-card shadow="never" class="content-card workbench-card">
                  <template #header>
                    <div class="card-header-line">
                      <span>待处理事项</span>
                      <el-tag type="info" effect="light">只读统计，不自动操作设备</el-tag>
                    </div>
                  </template>
                  <div class="work-item-grid">
                    <button
                      v-for="item in dashboardWorkItems"
                      :key="item.label"
                      type="button"
                      :class="['work-item', item.tone]"
                      @click="setView(item.view)"
                    >
                      <span>{{ item.label }}</span>
                      <strong>{{ item.value }}</strong>
                      <small>{{ item.hint }}</small>
                    </button>
                  </div>
                </el-card>
              </el-col>
              <el-col :span="8">
                <el-card shadow="never" class="content-card quick-card">
                  <template #header>快捷入口</template>
                  <button v-for="action in dashboardQuickActions" :key="action.title" type="button" class="quick-action" @click="handleDashboardQuickAction(action)">
                    <span>{{ action.title }}</span>
                    <small>{{ action.description }}</small>
                  </button>
                </el-card>
              </el-col>
            </el-row>
            <el-card shadow="never" class="content-card freshness-card">
              <template #header>最近状态</template>
              <div class="freshness-list">
                <div v-for="item in dashboardFreshness" :key="item.label" class="freshness-item">
                  <span>{{ item.label }}</span>
                  <strong>{{ item.value }}</strong>
                </div>
              </div>
            </el-card>
          </section>

          <section v-else-if="state.activeView === 'feishuSettings'">
            <div class="page-head">
              <div>
                <h1>飞书机器人</h1>
                <p>可选的飞书 ONU 查询入口。数据由 OLT Manager 内部只读数据服务提供。</p>
              </div>
              <el-tag :type="state.feishu.connection.state === 'connected' ? 'success' : state.feishu.enabled ? 'warning' : 'info'" size="large" effect="dark">
                {{ state.feishu.connection.state === 'connected' ? '已连接' : state.feishu.enabled ? '已启用但未连接' : '默认关闭' }}
              </el-tag>
            </div>
            <div class="gateway-layout feishu-settings-layout">
              <el-card shadow="never" class="content-card gateway-control-card">
                <template #header><div class="card-header-line"><span>飞书机器人配置</span><el-tag type="warning" effect="plain">不回显密钥</el-tag></div></template>
                <el-form label-position="top" class="gateway-form">
                  <div class="feishu-section-title">飞书机器人凭据</div>
                  <el-form-item label="飞书APP ID"><el-input v-model="state.feishu.appId" placeholder="cli_..." /></el-form-item>
                  <el-form-item label="APP SECRET"><el-input v-model="state.feishu.appSecret" type="password" show-password autocomplete="new-password" placeholder="首次保存时填写；已保存后可留空" /></el-form-item>
                  <div class="gateway-actions feishu-credential-actions">
                    <el-button type="primary" :loading="state.feishu.credentialSaving" @click="saveFeishuCredentials">保存飞书APP ID和APP SECRET</el-button>
                  </div>

                  <div class="feishu-section-title">大模型配置</div>
                  <el-form-item label="供应商名称"><el-input v-model="state.feishu.languageProviderName" placeholder="例如 MiniMax / OpenAI Compatible" /></el-form-item>
                  <el-form-item label="API 请求地址"><el-input v-model="state.feishu.languageEndpoint" placeholder="https://api.example.com/v1" /></el-form-item>
                  <el-form-item label="默认模型"><el-input v-model="state.feishu.languageModel" placeholder="例如 MiniMax-M2.7" /></el-form-item>
                  <el-form-item label="上游格式">
                    <el-select v-model="state.feishu.languageFormat" style="width: 100%">
                      <el-option label="Chat Completions（兼容）" value="chat-completions" />
                      <el-option label="Responses（原生）" value="responses" />
                    </el-select>
                  </el-form-item>
                  <el-form-item label="API KEY"><el-input v-model="state.feishu.languageApiKey" type="password" show-password autocomplete="new-password" placeholder="首次保存时填写；已保存后可留空" /></el-form-item>
                  <div class="gateway-actions">
                    <el-button type="primary" :loading="state.feishu.languageSaving" @click="saveLanguageProvider">保存大模型配置</el-button>
                    <el-button type="success" :disabled="!state.feishu.languageProviderReady" :loading="state.feishu.saving" @click="enableFeishu">启用</el-button>
                    <el-button :disabled="!state.feishu.enabled" :loading="state.feishu.saving" @click="stopFeishu">停止</el-button>
                  </div>
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
                </el-form>
              </el-card>
            </div>
          </section>

          <section v-else-if="state.activeView === 'install'">
            <div class="page-head">
              <div>
                <h1>ONU 安装查询</h1>
                <p>只读查询当前 OLT 未注册 ONU，不显示新安装/首次上线功能。</p>
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
                <el-table-column prop="serial" label="序列号" min-width="180" />
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
                <p>按地址或槽/板卡/PON 查询 ONU 状态、光功率和距离。</p>
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
                  <template #default="{ row }"><span>{{ row.deviceNumber || "未同步" }}</span></template>
                </el-table-column>
                <el-table-column prop="serial" label="ONU 序列号" min-width="150">
                  <template #default="{ row }">
                    <el-button link type="primary" class="serial-link" @click="openOnuConfig(row)">
                      {{ row.serial || "N/A" }}
                    </el-button>
                  </template>
                </el-table-column>
                <el-table-column prop="loid" label="LOID" min-width="150" show-overflow-tooltip>
                  <template #default="{ row }">
                    <el-button v-if="row.loid" link type="primary" class="serial-link" @click="openOnuDetail(row)">
                      {{ row.loid }}
                    </el-button>
                    <span v-else>-</span>
                  </template>
                </el-table-column>
                <el-table-column prop="username" label="姓名" min-width="120" show-overflow-tooltip />
                <el-table-column prop="phase" label="Phase状态" sortable="custom" min-width="130">
                  <template #default="{ row }">
                    <el-tag :type="phaseInfo(row.phase).type">{{ phaseInfo(row.phase).text }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column prop="rxPower" label="RX 光功率" sortable="custom" min-width="130">
                  <template #default="{ row }">
                    <span :class="['rx-pill', rxPowerInfo(row.rxPower).className]">{{ rxPowerInfo(row.rxPower).text }}</span>
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
                <p>维护 OLT 基础信息和只读连接参数。已保存的敏感凭据不会回显；留空表示保持原值。</p>
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
                  <template #default="{ row }"><span>{{ row.deviceNumber || "未同步" }}</span></template>
                </el-table-column>
                <el-table-column prop="loid" label="LOID" min-width="130" />
                <el-table-column prop="username" label="用户名" min-width="120" />
                <el-table-column prop="userPhone" label="电话" min-width="130" />
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
                <div class="card-header-line">
                  <span>合并 ONU 数据同步</span>
                  <el-tag :type="state.mergedOnu.dataset.synced ? 'success' : 'warning'">
                    {{ state.mergedOnu.dataset.synced ? '已同步' : '尚未同步' }}
                  </el-tag>
                </div>
              </template>
              <el-alert
                v-if="!state.mergedOnu.dataset.synced"
                title="统一数据库尚未同步；ONU 查询和飞书 ONU 详情暂不使用旧用户快照作为合并结果。"
                type="warning"
                :closable="false"
                show-icon
              />
              <p class="muted merged-onu-sync-note">网管二期和 NMSE-PON 可分别全量同步到本机源快照，再手动合并；每次操作前自动备份本机 SQLite，不会写入或修改远端系统。</p>
              <el-descriptions :column="4" border size="small" class="merged-onu-sync-summary">
                <el-descriptions-item label="数据集状态">{{ state.mergedOnu.dataset.synced ? '已同步' : '尚未同步' }}</el-descriptions-item>
                <el-descriptions-item label="Revision">{{ state.mergedOnu.dataset.revision || '暂无' }}</el-descriptions-item>
                <el-descriptions-item label="最近完成">{{ formatDate(state.mergedOnu.dataset.lastCompletedAt || state.mergedOnu.dataset.updatedAt) || '暂无' }}</el-descriptions-item>
                <el-descriptions-item label="合并数量">{{ state.mergedOnu.dataset.snapshotCount || 0 }}</el-descriptions-item>
                <el-descriptions-item label="最近冲突">{{ state.mergedOnu.dataset.lastConflictCount || 0 }}</el-descriptions-item>
                <el-descriptions-item label="运行状态">{{ mergedOnuSyncStatusText(state.mergedOnu.progress) }}</el-descriptions-item>
                <el-descriptions-item label="网管二期源">{{ mergedOnuSourceStatusText(state.mergedOnu.sources.network) }}</el-descriptions-item>
                <el-descriptions-item label="NMSE-PON源">{{ mergedOnuSourceStatusText(state.mergedOnu.sources.nmse) }}</el-descriptions-item>
              </el-descriptions>
              <div class="toolbar merged-onu-sync-toolbar">
                <el-button
                  type="primary"
                  :loading="state.mergedOnu.syncing && state.mergedOnu.progress.operation === 'network'"
                  :disabled="state.mergedOnu.syncing || !state.oss.loggedIn"
                  @click="syncMergedOnuOperation('network')"
                >同步网管二期</el-button>
                <el-button
                  type="primary"
                  :loading="state.mergedOnu.syncing && state.mergedOnu.progress.operation === 'nmse'"
                  :disabled="state.mergedOnu.syncing || !state.resource.loggedIn"
                  @click="syncMergedOnuOperation('nmse')"
                >同步 NMSE-PON</el-button>
                <el-button
                  type="success"
                  :loading="state.mergedOnu.syncing && state.mergedOnu.progress.operation === 'merge'"
                  :disabled="state.mergedOnu.syncing || !state.mergedOnu.sources.network.synced || !state.mergedOnu.sources.nmse.synced"
                  @click="syncMergedOnuOperation('merge')"
                >手动合并</el-button>
                <el-button
                  :loading="state.mergedOnu.syncing && state.mergedOnu.progress.operation === 'full'"
                  :disabled="state.mergedOnu.syncing || !state.resource.loggedIn || !state.oss.loggedIn"
                  @click="syncMergedOnuDataset"
                >全量同步</el-button>
                <span v-if="!state.resource.loggedIn || !state.oss.loggedIn" class="muted">独立同步只需登录对应系统；全量同步需同时登录。</span>
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
                  <span v-if="state.mergedOnu.progress.phase === 'fetching-nmse' && state.mergedOnu.progress.nmsePages">NMSE {{ state.mergedOnu.progress.nmseCompletedPages || 0 }} / {{ state.mergedOnu.progress.nmsePages }} 页 · {{ state.mergedOnu.progress.nmseWorkers || 1 }} 路并发</span>
                  <span v-else>OLT {{ state.mergedOnu.progress.completedOlts || 0 }} / {{ state.mergedOnu.progress.totalOlts || 0 }}</span>
                  <span>冲突 {{ state.mergedOnu.progress.conflicts || 0 }}</span>
                </div>
                <el-alert v-if="state.mergedOnu.progress.error" :title="state.mergedOnu.progress.error" type="error" :closable="false" show-icon />
              </div>
            </el-card>
            <el-card shadow="never" class="content-card resource-card">
              <template #header>NMSE-PON服务器配置（仅保存在本机）</template>
              <div class="resource-config-grid resource-config-form-only">
                <el-form label-position="top">
                  <el-form-item label="服务器地址"><el-input v-model="state.resource.config.serverUrl" placeholder="http://server:port" /></el-form-item>
                  <el-form-item label="用户名"><el-input v-model="state.resource.config.username" /></el-form-item>
                  <el-form-item label="密码"><el-input v-model="state.resource.config.password" type="password" show-password placeholder="保存时填写；不会从服务端返回" /></el-form-item>
                  <el-form-item label="迁移主密码"><el-input v-model="state.resource.config.migrationMasterPassword" type="password" show-password autocomplete="new-password" placeholder="旧版迁移或纯 Node/Web 解锁时填写；不会保存" /></el-form-item>
                  <el-button type="primary" :loading="state.resource.configLoading" @click="saveResourceManagementConfig">保存配置</el-button>
                  <div class="toolbar resource-login-toolbar">
                    <el-tag :type="state.resource.loggedIn ? 'success' : 'info'">{{ state.resource.loggedIn ? '资源系统已登录' : '未登录' }}</el-tag>
                    <el-button v-if="state.resource.loggedIn" @click="logoutResourceManagement">退出</el-button>
                    <el-button v-else type="primary" :loading="state.resource.loginLoading" @click="loginResourceManagement">登录资源系统</el-button>
                  </div>
                </el-form>
              </div>
            </el-card>
            <el-card shadow="never" class="content-card resource-card oss-config-card">
              <template #header>
                <div class="oss-card-heading">
                  <span>网管二期历史光功率配置</span>
                  <el-tag :type="state.oss.loggedIn ? 'success' : 'info'">{{ state.oss.loggedIn ? '已登录' : '未登录' }}</el-tag>
                </div>
              </template>
              <el-alert
                title="可选的本机自动登录会使用操作系统加密存储；跨设备迁移仍使用迁移主密码加密密文。SQLite、备份和接口都不保存网管二期明文密码；接口只读取 OLT、ONU 和历史光功率。"
                type="info"
                :closable="false"
                show-icon
              />
              <el-form label-position="top" class="oss-config-form">
                <div class="oss-config-grid">
                  <el-form-item label="OSS 认证地址"><el-input v-model="state.oss.config.authBaseUrl" placeholder="http://认证服务器:端口" /></el-form-item>
                  <el-form-item label="网管二期地址"><el-input v-model="state.oss.config.ngbBaseUrl" placeholder="http://网管服务器:端口" /></el-form-item>
                  <el-form-item label="用户名"><el-input v-model="state.oss.config.username" autocomplete="off" /></el-form-item>
                  <el-form-item label="网管二期登录密码"><el-input v-model="state.oss.password" type="password" show-password autocomplete="current-password" placeholder="首次保存或更新时填写；自动登录时可留空" /></el-form-item>
                  <el-form-item label="迁移主密码"><el-input v-model="state.oss.migrationMasterPassword" type="password" show-password autocomplete="new-password" placeholder="跨设备/非桌面保存时填写；至少 8 位，不会保存" /></el-form-item>
                  <el-form-item label="组织名称"><el-input v-model="state.oss.config.organizationName" placeholder="例如：某某分公司" /></el-form-item>
                  <el-form-item label="机房名称"><el-input v-model="state.oss.config.roomName" placeholder="例如：某某机房" /></el-form-item>
                </div>
                <el-checkbox v-if="state.oss.autoLoginAvailable" v-model="state.oss.rememberPassword">本机自动登录（使用系统加密保存密码）</el-checkbox>
                <div class="toolbar">
                  <el-button :loading="state.oss.configLoading" @click="saveOssResourceConfig">保存非敏感配置</el-button>
                  <el-button v-if="state.oss.loggedIn" @click="logoutOssResource">退出网管二期</el-button>
                  <el-button v-else type="primary" :loading="state.oss.loginLoading" @click="loginOssResource">{{ state.oss.autoLoginConfigured && !state.oss.password && !state.oss.migrationMasterPassword ? '自动登录' : '保存并登录' }}</el-button>
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
            <div class="page-head"><div><h1>备份还原</h1><p>导出或还原完整本机项目数据，不会连接或修改 OLT 设备。</p></div></div>
            <el-card shadow="never" class="content-card">
              <el-alert title="组合备份包含本机 SQLite（含网管二期非敏感配置、IP 映射和登录密码加密密文）及 Feishu 加密密文，不包含网管二期登录密码明文、迁移主密码、解密后的 App Secret 或系统密钥。请只保存到可信位置；还原会覆盖当前本机项目和 Feishu 状态。" type="warning" :closable="false" show-icon />
              <div class="toolbar" style="margin-top: 18px">
                <el-button type="primary" @click="exportProjectBackup">导出组合备份</el-button>
                <el-button type="danger" @click="triggerProjectRestore">导入并还原</el-button>
                <input id="project-backup-input" type="file" accept=".json,.oltbackup,.sqlite,.sqlite.enc,application/vnd.sqlite3,application/vnd.olt-manager.encrypted-backup" hidden @change="restoreProjectBackup" />
              </div>
            </el-card>
            <el-card shadow="never" class="content-card">
              <template #header>加密 SQLite 备份</template>
              <el-alert title="加密导出只在请求期间使用主密码，不保存到浏览器、本机数据库或日志。请妥善保管主密码；忘记后无法恢复。" type="info" :closable="false" show-icon />
              <el-form label-position="top" class="backup-password-form" @submit.prevent="exportEncryptedBackup">
                <div class="backup-password-grid">
                  <el-form-item label="备份主密码" required>
                    <el-input v-model="state.encryptedBackup.password" type="password" show-password autocomplete="new-password" placeholder="至少 8 位" />
                  </el-form-item>
                  <el-form-item label="确认主密码" required>
                    <el-input v-model="state.encryptedBackup.confirmation" type="password" show-password autocomplete="new-password" placeholder="再次输入主密码" />
                  </el-form-item>
                </div>
                <div class="toolbar">
                  <el-button type="primary" native-type="submit" :loading="state.encryptedBackup.exporting">导出加密 SQLite</el-button>
                  <el-button type="danger" :loading="state.encryptedBackup.importing" @click="triggerProjectRestore">导入 .sqlite.enc</el-button>
                </div>
              </el-form>
            </el-card>
          </section>

          <section v-else-if="state.activeView === 'adminProjects'">
            <div class="page-head">
              <div>
                <h1>专线项目管理</h1>
                <p>维护本地项目、项目 VLAN 和联系人信息；项目不绑定单台 OLT，不触发设备命令。</p>
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
                <p>按指定执行日期运行只读同步任务，数据直接保存到本机源快照或统一数据集。</p>
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
              <p class="muted resource-schedule-note">四种任务均只执行只读同步，不会写入或修改 OLT 配置。开启重复后，将按“执行日期 + 间隔天数”自动安排下一次执行。</p>
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
                <el-alert
                  title="当前页面为只读查看，仅展示已配置数据，系统不会执行或下发到 OLT。"
                  type="warning"
                  :closable="false"
                  show-icon
                />
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
                <el-alert
                  title="当前页面为只读查看，仅展示 ONU 基础信息和链路数据，系统不会执行或下发到 OLT。"
                  type="warning"
                  :closable="false"
                  show-icon
                />
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
                    <el-descriptions-item label="离线原因">{{ state.onuDetail.data.onu.lastOfflineCause || "暂无" }}</el-descriptions-item>
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
                          <span>只读取已保存的历史记录，不触发光功率刷新</span>
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
                        @click="loadOssOpticalHistory"
                      >读取历史光功率</el-button>
                    </div>
                    <el-alert v-if="!state.oss.loggedIn" title="请先到“用户资源管理”保存网管二期配置并登录。" type="warning" :closable="false" show-icon />
                    <el-alert v-else-if="state.oss.historyError" :title="state.oss.historyError" type="warning" :closable="false" show-icon />
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
              <el-alert
                title="配置方案只生成命令文本供人工复制，系统不会登录配置模式、不会下发、不会保存到 OLT。"
                type="warning"
                :closable="false"
                show-icon
              />
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
            width="960px"
            class="terminal-dialog"
            destroy-on-close
            @opened="mountTerminal"
            @closed="closeTerminalSession"
          >
            <el-alert
              title="系统只负责自动登录，不会自动粘贴或执行配置命令；Huawei 会保留方案中的 config，请人工粘贴、检查并回车确认。"
              type="warning"
              :closable="false"
              show-icon
              class="terminal-safety"
            />
            <div class="terminal-status">
              <span>{{ state.terminal.status }}</span>
              <div class="terminal-actions">
                <el-button size="small" @click="copyConfigPlan" :disabled="!state.configPlan.result?.commands">复制配置命令</el-button>
                <el-button size="small" type="primary" plain @click="pasteClipboardToTerminal" :disabled="!state.terminal.sessionId || state.terminal.pasting">粘贴剪贴板</el-button>
              </div>
            </div>
            <div ref="terminalHost" class="embedded-terminal"></div>
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
        </el-main>
      </el-container>
    </el-container>
  `,
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
      state.olts = bootstrap.olts || [];
      state.ponPorts = bootstrap.ponPorts || [];
      ponPortFilterState.reset(state.ponPorts);
      state.selectedOltId = state.olts[0]?.id || "";
      restoreFilters();
      await Promise.all([loadConfigTemplates(), loadDashboard()]);
      state.projects = await fetchProjects();
      await syncSelectedProjectAfterProjectListChange();
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
        connection: settings.connection || { state: "stopped", lastError: null },
        error: settings.connection?.lastError || ""
      };
      if (syncForm) {
        Object.assign(next, {
          appId: settings.appId || "",
          languageProvider: settings.languageProvider || "production",
          languageProviderName: settings.languageProviderName || "",
          languageEndpoint: settings.languageEndpoint || "",
          languageModel: settings.languageModel || "",
          languageFormat: settings.languageFormat || "chat-completions"
        });
      }
      if (clearSecrets) {
        Object.assign(next, { appSecret: "", languageApiKey: "" });
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
      if (!window.oltManagerDesktop?.feishu) return;
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
        ElMessage.success("大模型配置已加密保存");
      } catch (error) {
        state.feishu.error = error.message || "大模型配置保存失败";
        ElMessage.error(state.feishu.error);
      } finally {
        state.feishu.languageSaving = false;
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
        if (event.type === "data") terminalInstance?.write(event.data);
        if (event.message) state.terminal.status = event.message;
        if (event.type === "notice") terminalInstance?.writeln(`\r\n${event.message}`);
        if (event.type === "error") terminalInstance?.writeln(`\r\n错误：${event.message}`);
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
      const chassis = String(variables.chassis || "1").trim();
      const board = String(variables.board || variables.slot || "").trim();
      const pon = String(variables.pon || "").trim();
      const onuId = String(variables.onuId || "").trim();
      if (!chassis || !board || !pon || !onuId) return [];
      const name = `gpon-onu_${chassis}/${board}/${pon}:${onuId}`;
      return [
        `show running-config interface ${name}`,
        `show onu running config ${name}`
      ];
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
      detachTerminalKeydownGuard();
      detachTerminalPasteGuard();
      terminalUnsubscribe?.();
      terminalUnsubscribe = undefined;
      terminalInstance?.dispose();
      terminalInstance = undefined;
      terminalFitAddon = undefined;
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
        if (operation === "merge" || operation === "full") {
          ElMessage.success(`合并 ONU 同步完成，共 ${data.mergedCount || 0} 条，冲突 ${data.conflictCount || 0} 条`);
        } else {
          ElMessage.success(`${operation === "network" ? "网管二期" : "NMSE-PON"} 源数据同步完成，共 ${data.count || 0} 条`);
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
      const { config: projectedConfig, ...meta } = projection;
      Object.assign(state.oss.config, projectedConfig);
      Object.assign(state.oss, meta);
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
        const config = await ossResourceApi.saveConfig(state.oss.config);
        applyOssResourceConfig(config);
        if (!quiet) ElMessage.success("网管二期非敏感配置已保存");
        return true;
      } catch (error) {
        if (!quiet) ElMessage.error(error.message || "网管二期配置保存失败");
        return false;
      } finally {
        state.oss.configLoading = false;
      }
    }

    async function loginOssResource({ autoLogin = false, quiet = false } = {}) {
      const usingAutoLogin = autoLogin || (state.oss.autoLoginConfigured && !state.oss.password && !state.oss.migrationMasterPassword);
      if (!state.oss.migrationMasterPassword && !usingAutoLogin && !state.oss.password) {
        ElMessage.warning("请输入迁移主密码");
        return;
      }
      if (!state.oss.password && !state.oss.credentialConfigured && !state.oss.autoLoginConfigured) {
        ElMessage.warning("首次保存请填写网管二期登录密码");
        return;
      }
      state.oss.loginLoading = true;
      try {
        if (!await saveOssResourceConfig({ quiet: true })) throw new Error("网管二期配置保存失败");
        const result = await ossResourceApi.login({
          password: state.oss.password,
          migrationMasterPassword: state.oss.migrationMasterPassword,
          rememberPassword: Boolean(state.oss.rememberPassword),
          autoLogin: usingAutoLogin
        });
        state.oss.password = "";
        state.oss.migrationMasterPassword = "";
        Object.assign(state.oss, ossLoginProjection(result, {
          rememberPassword: state.oss.rememberPassword,
          autoLoginConfigured: state.oss.autoLoginConfigured
        }));
        if (!quiet) ElMessage.success(`网管二期登录成功，发现 ${result.oltCount} 台已投影 OLT`);
      } catch (error) {
        state.oss.loggedIn = false;
        if (!quiet) ElMessage.error(error.message || "网管二期登录失败");
      } finally {
        state.oss.password = "";
        state.oss.migrationMasterPassword = "";
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

    async function saveResourceManagementConfig() {
      state.resource.configLoading = true;
      try {
        const data = await resourceManagementApi.saveConfig(state.resource.config);
        state.resource.config.serverUrl = data.serverUrl || "";
        state.resource.config.username = data.username || "";
        state.resource.config.password = "";
        state.resource.config.migrationMasterPassword = "";
        state.resource.loggedIn = false;
        ElMessage.success("资源管理配置已保存，请重新登录");
      } catch (error) {
        ElMessage.error(error.message || "保存资源管理配置失败");
      } finally {
        state.resource.configLoading = false;
      }
    }

    async function loginResourceManagement() {
      state.resource.loginLoading = true;
      try {
        const data = await resourceManagementApi.login(state.resource.config.migrationMasterPassword);
        state.resource.loggedIn = true;
        state.resource.config.migrationMasterPassword = "";
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
      await Promise.all([loadStatus(), loadInstallOnus(), loadOnus({ showProgress: false })]);
    }

    function setView(name) {
      if (name !== "feishuSettings") stopFeishuStatusPolling();
      if (name !== "resourceManagement") stopMergedOnuSyncPolling();
      state.activeView = name;
      if (name === "dashboard") loadDashboard();
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

    async function openOnuConfig(row) {
      state.onuConfig.visible = true;
      await loadOnuConfig(row, state.onuConfig);
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
        const rows = excelRowsToPonRows(XLSX.utils.sheet_to_json(sheet, { defval: "" }));
        await saveImportedPonRows(rows, "导入 Excel");
      } catch (error) {
        ElMessage.error(error.message || "导入 Excel 失败");
      } finally {
        input.value = "";
      }
    }

    onBeforeUnmount(() => {
      stopFeishuStatusPolling();
      stopMergedOnuSyncPolling();
    });

    onMounted(async () => {
      try {
        await initializeAuth();
        if (state.authenticated) await loadApplication();
      } catch (error) {
        state.authError = error.message || "本地登录服务不可用。";
      }
    });

    return {
      terminalHost,
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
      loadMergedOnuSyncProgress,
      syncMergedOnuDataset,
      syncMergedOnuOperation,
      mergedOnuSyncPhaseText,
      mergedOnuSyncStatusText,
      mergedOnuSourceStatusText,
      mergedOnuSyncPercent,
      loadFeishuSettings,
      saveFeishuCredentials,
      saveLanguageProvider,
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
      formatDate,
      opticalValue,
      rxHistoryPoints,
      servicePortCli,
      onuMgmtCli,
      saveFilters,
      submitAuth,
      toggleAuthRequirement
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
  "el-tag": ElTag
})) app.component(name, component);
app.directive("loading", ElLoading.directive);
app.mount("#app");
