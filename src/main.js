import { createApp, computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from "vue/dist/vue.esm-bundler.js";
import ElementPlus, { ElMessage, ElMessageBox } from "element-plus";
import * as XLSX from "xlsx";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { defaultProfileForModel, defaultProfileForVendor, profileById, profilesForVendor } from "./device-profiles.mjs";
import { createPonPortFilterState } from "./pon-admin-filter.mjs";
import { compareOnuCoordinates, defaultChassisForVendor, normalizePonCoordinate, onuCoordinateLabel, ponCoordinateKey } from "./pon-coordinate.mjs";
import { formatUptime } from "./formatters.mjs";
import "element-plus/dist/index.css";
import "@xterm/xterm/css/xterm.css";
import "./styles.css";

const phaseMap = {
  working: { text: "在线", group: "online", type: "success" },
  online: { text: "在线", group: "online", type: "success" },
  offline: { text: "离线", group: "offline", type: "info" },
  los: { text: "LOS", group: "los", type: "danger" },
  dyinggasp: { text: "断电", group: "power", type: "warning" },
  authfailed: { text: "认证失败", group: "auth", type: "danger" },
  logging: { text: "登录中", group: "logging", type: "warning" },
  syncmib: { text: "同步中", group: "sync", type: "warning" }
};

function phaseInfo(phase) {
  return phaseMap[String(phase || "").trim().toLowerCase()] || { text: phase || "未知", group: "unknown", type: "info" };
}

function phaseSortValue(phase) {
  return {
    working: 1,
    online: 1,
    logging: 2,
    syncmib: 3,
    offline: 4,
    los: 5,
    dyinggasp: 6,
    authfailed: 7
  }[String(phase || "").trim().toLowerCase()] || 99;
}

function rxPowerInfo(rxPower) {
  const raw = String(rxPower || "").trim();
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return { text: raw || "N/A", className: "unknown" };
  if (value <= -12 && value >= -25) return { text: raw, className: "good" };
  if (value < -25 && value >= -27) return { text: raw, className: "warn" };
  return { text: raw, className: "bad" };
}

function rxPowerSortValue(rxPower) {
  const value = Number.parseFloat(String(rxPower || ""));
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

function filterStorageKey(oltId) {
  return `olt-manager-filters:${oltId || "default"}`;
}

function uniqueSorted(values, numeric = false) {
  const items = [...new Set(values.filter((value) => value !== "" && value != null).map(String))];
  return items.sort((a, b) => numeric ? Number(a) - Number(b) : a.localeCompare(b, "zh-Hans-CN"));
}

function countDuplicateAddresses(rows) {
  const duplicateAddresses = new Map();
  for (const port of rows) {
    if (!port.address) continue;
    duplicateAddresses.set(port.address, (duplicateAddresses.get(port.address) || 0) + 1);
  }
  return [...duplicateAddresses.values()].filter((count) => count > 1).length;
}

function countOnuGroups(rows) {
  const counts = { total: rows.length, online: 0, offline: 0, los: 0, power: 0, auth: 0, logging: 0, sync: 0 };
  for (const row of rows) {
    const group = phaseInfo(row.phase).group;
    if (Object.hasOwn(counts, group)) counts[group] += 1;
  }
  return counts;
}

function normalizePonPortRow(row) {
  const coordinate = normalizePonCoordinate(row);
  return {
    oltIp: String(row.oltIp ?? row["OLT IP"] ?? row["OLT"] ?? row["OLT地址"] ?? row["OLT IP地址"] ?? row.olt_ip ?? "").trim(),
    chassis: coordinate.chassis,
    board: coordinate.board,
    slot: coordinate.board,
    pon: coordinate.pon,
    ponPort: coordinate.ponPort,
    outerVlan: String(row.outerVlan ?? row["外层 VLAN"] ?? row["外层VLAN"] ?? row["Outer VLAN"] ?? row.outer_vlan ?? "").trim(),
    address: String(row.address ?? row["地址"] ?? row["安装地址"] ?? row["ONU地址"] ?? "").trim()
  };
}

function normalizePonRows(rows) {
  return rows.map(normalizePonPortRow).filter((row) => row.oltIp && row.ponPort);
}

function excelRowsToPonRows(rows) {
  return normalizePonRows(rows);
}

function ponRowsForExport(rows) {
  return rows.map((row) => ({
    "OLT IP": row.oltIp || "",
    "槽": row.chassis || "",
    "板卡": row.board || row.slot || "",
    "PON": row.pon || "",
    "板槽端口": row.ponPort || ponCoordinateKey(row),
    "外层 VLAN": row.outerVlan || "",
    "地址": row.address || ""
  }));
}

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
    <el-container class="app-shell">
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
                <p>维护 OLT 基础信息、只读 SNMP community 和本地 Telnet 登录凭据。</p>
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
                <el-table-column label="Community" min-width="150"><template #default="{ row }"><el-input v-model="row.readCommunity" show-password /></template></el-table-column>
                <el-table-column label="Telnet端口" width="130"><template #default="{ row }"><el-input-number v-model="row.telnetPort" :min="1" :max="65535" controls-position="right" /></template></el-table-column>
                <el-table-column label="Telnet用户" min-width="140"><template #default="{ row }"><el-input v-model="row.telnetUsername" /></template></el-table-column>
                <el-table-column label="Telnet密码" min-width="150"><template #default="{ row }"><el-input v-model="row.telnetPassword" show-password /></template></el-table-column>
                <el-table-column label="操作" width="90"><template #default="{ $index }"><el-button type="danger" link @click="deleteAdminOlt($index)">删除</el-button></template></el-table-column>
              </el-table>
            </el-card>
          </section>

          <section v-else-if="state.activeView === 'resourceManagement'">
            <div class="page-head">
              <div>
                <h1>用户资源管理</h1>
                <p>读取资源管理系统中的当前 OLT 用户快照与宽带 VLAN 配置；NMSE 配置数据与 OLT 实时 SNMP 数据独立。</p>
              </div>
              <div class="toolbar">
                <el-tag :type="state.resource.loggedIn ? 'success' : 'info'">{{ state.resource.loggedIn ? '资源系统已登录' : '未登录' }}</el-tag>
                <el-button v-if="state.resource.loggedIn" @click="logoutResourceManagement">退出</el-button>
                <el-button v-else type="primary" :loading="state.resource.loginLoading" @click="loginResourceManagement">登录资源系统</el-button>
              </div>
            </div>
            <el-card shadow="never" class="content-card resource-card">
              <template #header>当前 OLT 同步</template>
              <div class="toolbar resource-sync-actions">
                <el-button type="primary" :disabled="!state.resource.loggedIn" :loading="state.resource.userSyncing" @click="syncResourceUsers">同步用户信息</el-button>
                <el-autocomplete
                  v-model="state.resource.search"
                  :fetch-suggestions="queryResourceUserSuggestions"
                  clearable
                  placeholder="搜索全部 ONU、LOID、用户、电话、地址"
                  class="resource-search"
                  @select="handleResourceUserSelect"
                  @keyup.enter="loadResourceUsers"
                  @change="loadResourceUsers"
                  @clear="loadResourceUsers"
                >
                  <template #default="{ item }">
                    <div class="resource-user-suggestion">
                      <strong>{{ item.onuIndex }} · {{ item.username || '未登记用户' }}</strong>
                      <span>{{ item.loid || '-' }}{{ item.userPhone ? ' · ' + item.userPhone : '' }}</span>
                    </div>
                  </template>
                </el-autocomplete>
              </div>
              <div v-if="state.resource.userSyncing || state.resource.userProgress.total" class="resource-user-progress">
                <div class="resource-progress-heading">
                  <div>
                    <span class="resource-progress-label">NMSE-PON 用户快照同步</span>
                    <strong v-if="state.resource.userProgress.total">{{ state.resource.userProgress.received.toLocaleString() }}<small> / {{ state.resource.userProgress.total.toLocaleString() }} 条</small></strong>
                    <strong v-else>正在获取总量…</strong>
                  </div>
                  <el-tag v-if="state.resource.userProgress.total" effect="light" type="success">{{ state.resource.userProgress.workers || 1 }} 路并发</el-tag>
                  <el-tag v-else effect="light" type="warning">第 {{ state.resource.userProgress.attempt || 1 }}/{{ state.resource.userProgress.maxAttempts || 3 }} 次</el-tag>
                </div>
                <el-progress :percentage="state.resource.userProgress.percent" :indeterminate="!state.resource.userProgress.total" :stroke-width="14" :show-text="Boolean(state.resource.userProgress.total)" />
                <div class="resource-progress-meta">
                  <span>{{ state.resource.userProgress.total ? '已完成第 ' + state.resource.userProgress.completedPages + '/' + state.resource.userProgress.pages + ' 页' : '正在读取第 1 页并确认总量' }}</span>
                  <span v-if="state.resource.userProgress.total">完成 {{ state.resource.userProgress.percent }}%</span>
                </div>
              </div>
            </el-card>
            <el-card shadow="never" class="content-card resource-card">
              <template #header>用户信息快照</template>
              <el-table :data="resourceUserPageRows" border stripe size="small" class="resource-table">
                <el-table-column prop="oltIp" label="OLT IP地址" min-width="140" />
                <el-table-column prop="onuIndex" label="ONU 索引" min-width="130" />
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
            <el-card shadow="never" class="content-card resource-card">
              <template #header>NMSE-PON服务器配置（仅保存在本机）</template>
              <div class="resource-config-grid resource-config-form-only">
                <el-form label-position="top">
                  <el-form-item label="服务器地址"><el-input v-model="state.resource.config.serverUrl" placeholder="http://server:port" /></el-form-item>
                  <el-form-item label="用户名"><el-input v-model="state.resource.config.username" /></el-form-item>
                  <el-form-item label="密码"><el-input v-model="state.resource.config.password" type="password" show-password placeholder="保存时填写；不会从服务端返回" /></el-form-item>
                  <el-button type="primary" :loading="state.resource.configLoading" @click="saveResourceManagementConfig">保存配置</el-button>
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
                title="密码仅用于本次登录并保存在服务进程内存，不写入 SQLite、日志或备份。接口只读取 OLT、ONU 和历史光功率。"
                type="info"
                :closable="false"
                show-icon
              />
              <el-form label-position="top" class="oss-config-form">
                <div class="oss-config-grid">
                  <el-form-item label="OSS 认证地址"><el-input v-model="state.oss.config.authBaseUrl" placeholder="http://认证服务器:端口" /></el-form-item>
                  <el-form-item label="网管二期地址"><el-input v-model="state.oss.config.ngbBaseUrl" placeholder="http://网管服务器:端口" /></el-form-item>
                  <el-form-item label="用户名"><el-input v-model="state.oss.config.username" autocomplete="off" /></el-form-item>
                  <el-form-item label="本次登录密码"><el-input v-model="state.oss.password" type="password" show-password autocomplete="new-password" placeholder="不保存；每次服务重启后重新输入" /></el-form-item>
                  <el-form-item label="组织名称"><el-input v-model="state.oss.config.organizationName" placeholder="例如：某某分公司" /></el-form-item>
                  <el-form-item label="机房名称"><el-input v-model="state.oss.config.roomName" placeholder="例如：某某机房" /></el-form-item>
                </div>
                <div class="toolbar">
                  <el-button :loading="state.oss.configLoading" @click="saveOssResourceConfig">保存非敏感配置</el-button>
                  <el-button v-if="state.oss.loggedIn" @click="logoutOssResource">退出网管二期</el-button>
                  <el-button v-else type="primary" :loading="state.oss.loginLoading" @click="loginOssResource">保存并登录</el-button>
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
              <el-alert title="组合备份包含本机 SQLite 和 Feishu 加密密文，不包含解密后的 App Secret 或系统密钥。请只保存到可信位置；还原会覆盖当前本机项目和 Feishu 状态。" type="warning" :closable="false" show-icon />
              <div class="toolbar" style="margin-top: 18px">
                <el-button type="primary" @click="exportProjectBackup">导出组合备份</el-button>
                <el-button type="danger" @click="triggerProjectRestore">导入并还原</el-button>
                <input id="project-backup-input" type="file" accept=".json,.oltbackup,.sqlite,application/vnd.sqlite3" hidden @change="restoreProjectBackup" />
              </div>
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
                <p>按指定日期和时间连接 NMSE-PON，读取选定 OLT 的用户信息并保存到本机快照。</p>
              </div>
              <el-button :loading="state.resourceSchedule.loading" @click="loadResourceSchedules">刷新任务</el-button>
            </div>
            <el-card shadow="never" class="content-card resource-schedule-card">
              <template #header>新增用户信息同步任务</template>
              <el-form label-position="top" class="resource-schedule-form">
                <el-form-item label="执行时间" required>
                  <el-date-picker
                    v-model="state.resourceSchedule.form.runAt"
                    type="datetime"
                    placeholder="选择执行日期和时间"
                    format="YYYY-MM-DD HH:mm"
                    value-format="YYYY-MM-DD HH:mm:ss"
                    :disabled-date="disablePastDate"
                  />
                </el-form-item>
                <el-form-item label="目标 OLT" required>
                  <el-select v-model="state.resourceSchedule.form.oltId" placeholder="请选择 OLT" filterable>
                    <el-option v-for="olt in state.olts" :key="olt.id" :label="olt.name + ' · ' + olt.host" :value="olt.id" />
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
              <p class="muted resource-schedule-note">任务只读取 NMSE-PON 用户信息并更新本地快照，不会写入或修改 OLT 配置。开启重复后，将按“执行时间 + 间隔天数”自动安排下一次执行，例如每 5 天凌晨 5 点。</p>
            </el-card>
            <el-card shadow="never" class="content-card resource-schedule-card">
              <template #header>
                <div class="card-header-line"><span>任务列表</span><span class="muted">{{ state.resourceSchedule.tasks.length }} 个任务</span></div>
              </template>
              <el-table :data="state.resourceSchedule.tasks" border stripe size="small" empty-text="暂无定时任务">
                <el-table-column label="执行时间" min-width="180"><template #default="{ row }">{{ formatDate(row.runAt) }}</template></el-table-column>
                <el-table-column label="目标 OLT" min-width="190"><template #default="{ row }">{{ state.olts.find((olt) => olt.id === row.oltId)?.name || row.oltId }}</template></el-table-column>
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
              title="系统只负责自动登录并进入配置模式，不会自动粘贴或执行配置命令；请人工粘贴、检查并回车确认。"
              type="warning"
              :closable="false"
              show-icon
              class="terminal-safety"
            />
            <div class="terminal-status">
              <span>{{ state.terminal.status }}</span>
              <div class="terminal-actions">
                <el-button size="small" @click="copyConfigPlan" :disabled="!state.configPlan.result?.commands">复制配置命令</el-button>
                <el-button size="small" type="primary" plain @click="pasteClipboardToTerminal" :disabled="!state.terminal.sessionId">粘贴剪贴板</el-button>
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
    let projectLoadingTimer;
    let onuLoadingTimer;
    let feishuStatusTimer;
    let feishuStatusRefreshing = false;
    const localDateValue = (value) => {
      const date = new Date(value);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    };
    const state = reactive({
      version: "0.0.0",
      activeView: "dashboard",
      olts: [],
      ponPorts: [],
      selectedOltId: "",
      status: { alarms: [] },
      unregisteredRows: [],
      configTemplates: [],
      installMessage: "",
      onuRows: [],
      onuConfig: { visible: false, loading: false, data: null },
      onuDetail: { visible: false, loading: false, data: null },
      configPlan: { visible: false, loading: false, row: null, templateId: "zte-self-operated-internet", ethPorts: ["eth_0/1"], customVlan: undefined, result: null },
      terminal: { visible: false, sessionId: "", status: "未连接" },
      filters: { search: "", chassis: "", slot: "", pon: "" },
      sort: { field: "", direction: "asc" },
      adminOlts: [],
      resource: {
        config: { serverUrl: "", username: "", password: "" },
        loggedIn: false,
        configLoading: false,
        loginLoading: false,
        userSyncing: false,
        userProgress: { phase: "", total: 0, pages: 0, completedPages: 0, received: 0, workers: 0, attempt: 0, maxAttempts: 3, percent: 0 },
        vlanSyncing: false,
        search: "",
        pageSize: 20,
        userPage: 1,
        users: []
      },
      oss: {
        config: { authBaseUrl: "", ngbBaseUrl: "", username: "", organizationName: "", roomName: "" },
        password: "",
        loggedIn: false,
        configLoading: false,
        loginLoading: false,
        olts: [],
        historyLoading: false,
        historyRows: [],
        historyError: "",
        dateRange: [
          localDateValue(Date.now() - 30 * 24 * 60 * 60 * 1000),
          localDateValue(Date.now())
        ]
      },
      resourceSchedule: {
        tasks: [],
        loading: false,
        saving: false,
        cancelingId: "",
        deletingId: "",
        form: { runAt: "", oltId: "", repeatEnabled: false, repeatDays: 5 }
      },
      feishu: {
        appId: "",
        appSecret: "",
        enabled: false,
        configured: false,
        credentialConfigured: false,
        languageProvider: "production",
        languageProviderName: "",
        languageEndpoint: "",
        languageModel: "",
        languageFormat: "chat-completions",
        languageApiKey: "",
        languageApiKeyConfigured: false,
        languageProviderReady: false,
        connection: { state: "stopped", lastError: null },
        error: "",
        saving: false,
        credentialSaving: false,
        languageSaving: false
      },
      projects: [],
      projectSearch: "",
      projectDialog: {
        visible: false,
        loading: false,
        form: { id: "", name: "", vlan: 100, address: "", contactName: "", contactPhone: "", contactNote: "" }
      },
      projectDetail: {
        loading: false,
        project: null,
        onus: [],
        selectedOnu: null,
        loadedProjectId: ""
      },
      projectLoading: {
        visible: false,
        title: "正在刷新 ONU 台账",
        message: "正在连接本地台账与当前 OLT 状态...",
        step: "准备读取",
        percent: 0
      },
      onuLoading: {
        visible: false,
        title: "正在查询 ONU 数据",
        message: "正在准备查询条件...",
        step: "准备查询",
        percent: 0
      },
      ponAdminSearch: "",
      loading: { status: false, install: false, onus: false, admin: false, vlan: false }
    });

    const selectedOlt = computed(() => state.olts.find((olt) => olt.id === state.selectedOltId) || state.olts[0] || {});
    const resourceUserPageRows = computed(() => {
      const start = (state.resource.userPage - 1) * state.resource.pageSize;
      return state.resource.users.slice(start, start + state.resource.pageSize);
    });
    let resourceUserProgressTimer = null;
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
    const dashboardMetrics = computed(() => [
      { label: "当前 OLT", value: selectedOlt.value.name || "-", hint: selectedOlt.value.host || "未配置管理地址", tone: "primary" },
      { label: "SNMP 状态", value: state.status.snmpState || "检测中", hint: state.status.reachable ? "设备可读" : "需要检查连通性", tone: state.status.reachable ? "ok" : "warn" },
      { label: "未注册 ONU", value: state.unregisteredRows.length, hint: "等待安装确认", tone: state.unregisteredRows.length ? "warn" : "ok" },
      { label: "PON 台账", value: currentPonPorts.value.length, hint: `空地址 ${emptyLedgerCount.value} 条`, tone: emptyLedgerCount.value ? "warn" : "ok" }
    ]);
    const dashboardWorkItems = computed(() => [
      { label: "未注册 ONU", value: state.unregisteredRows.length, hint: "进入安装查询生成方案", view: "install", tone: state.unregisteredRows.length ? "warn" : "ok" },
      { label: "LOS", value: onuGroupCounts.value.los, hint: "光路中断需排查", view: "onus", tone: onuGroupCounts.value.los ? "danger" : "ok" },
      { label: "断电", value: onuGroupCounts.value.power, hint: "疑似终端断电", view: "onus", tone: onuGroupCounts.value.power ? "danger" : "ok" },
      { label: "离线", value: onuGroupCounts.value.offline, hint: "查看 ONU 数据查询", view: "onus", tone: onuGroupCounts.value.offline ? "warn" : "ok" },
      { label: "空地址台账", value: emptyLedgerCount.value, hint: "补齐地址方便定位", view: "adminPonPorts", tone: emptyLedgerCount.value ? "warn" : "ok" },
      { label: "重复地址", value: duplicateLedgerCount.value, hint: "检查台账是否重复", view: "adminPonPorts", tone: duplicateLedgerCount.value ? "warn" : "ok" }
    ]);
    const dashboardQuickActions = [
      { title: "打开终端", description: "自动登录当前 OLT 并进入配置模式", action: "terminal" },
      { title: "查看未注册 ONU", description: "发现新接入设备并生成配置预览", view: "install" },
      { title: "查询 ONU 数据", description: "按地址、槽、板卡、PON 查询光功率和状态", view: "onus" },
      { title: "维护 ONU 台账", description: "编辑地址、PON 和外层 VLAN", view: "adminPonPorts" }
    ];
    const dashboardFreshness = computed(() => [
      { label: "型号/版本", value: `${selectedOlt.value.model || "-"} / ${selectedOlt.value.version || "-"}` },
      { label: "管理地址", value: selectedOlt.value.host || "未配置" },
      { label: "运行时间", value: formatUptime(state.status.uptime) },
      { label: "ONU 数据", value: `${state.onuRows.length} 条，在线 ${onuGroupCounts.value.online} 条` },
      { label: "未注册数据", value: state.installMessage || `${state.unregisteredRows.length} 条` },
      { label: "台账健康", value: `重复地址 ${duplicateLedgerCount.value} 个，空地址 ${emptyLedgerCount.value} 条` }
    ]);
    const onuSummary = computed(() => {
      const counts = onuGroupCounts.value;
      return [
        { label: "总计", value: counts.total, key: "total" },
        { label: "在线", value: counts.online, key: "online" },
        { label: "离线", value: counts.offline, key: "offline" },
        { label: "LOS", value: counts.los, key: "los" },
        { label: "断电", value: counts.power, key: "power" },
        { label: "认证失败", value: counts.auth, key: "auth" },
        { label: "登录中", value: counts.logging, key: "logging" },
        { label: "同步中", value: counts.sync, key: "sync" }
      ];
    });
    const sortedOnuRows = computed(() => {
      if (!state.sort.field) return state.onuRows;
      const direction = state.sort.direction === "descending" ? -1 : 1;
      return [...state.onuRows].sort((a, b) => {
        if (state.sort.field === "coordinate") return compareOnuCoordinates(a, b) * direction;
        const left = state.sort.field === "phase" ? phaseSortValue(a.phase) : rxPowerSortValue(a.rxPower);
        const right = state.sort.field === "phase" ? phaseSortValue(b.phase) : rxPowerSortValue(b.rxPower);
        if (left === right) return String(a.onuId).localeCompare(String(b.onuId), "zh-Hans-CN");
        return (left - right) * direction;
      });
    });
    const onuEmptyText = computed(() => {
      const hasInput = state.filters.search || state.filters.chassis || state.filters.slot || state.filters.pon;
      return hasInput ? "没有匹配到 ONU，请确认地址、槽、板卡和 PON 口。" : "请输入地址，或选择槽、板卡和 PON 口后点击搜索。";
    });
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
      const response = await fetch(url, options);
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || data.error || "请求失败");
      return data;
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
      const match = state.ponPorts
        .filter((port) => port.address && port.address.toLowerCase().includes(keyword))
        .sort((a, b) => a.address.length - b.address.length)[0];
      if (!match) return;
      state.filters.chassis = match.chassis || "";
      state.filters.slot = match.board || match.slot || "";
      state.filters.pon = match.pon || "";
      return match;
    }

    async function loadStatus() {
      state.loading.status = true;
      try {
        state.status = await api("/api/status");
      } catch (error) {
        ElMessage.error(error.message);
      } finally {
        state.loading.status = false;
      }
    }

    async function loadInstallOnus() {
      state.loading.install = true;
      try {
        const data = await api("/api/unregistered-onus");
        state.unregisteredRows = data.rows || [];
        state.installMessage = data.message || "";
      } catch (error) {
        state.unregisteredRows = [];
        state.installMessage = error.message;
        ElMessage.error(error.message);
      } finally {
        state.loading.install = false;
      }
    }

    async function loadConfigTemplates() {
      try {
        const data = await api("/api/config-templates");
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
        suggestedOnuId: "终端ID",
        ledgerOuterVlan: "外层VLAN",
        sampleOnuId: "范例ID",
        ethPorts: "物理端口",
        customVlan: "自定义VLAN",
        actualOntId: "建议ONT ID",
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
        const data = await api(`/api/unregistered-onus/${encodeURIComponent(`${ponCoordinateKey(row)}-${row.serial}`)}/config-plan`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chassis: row.chassis,
            board: row.board || row.slot,
            slot: row.board || row.slot,
            pon: row.pon,
            serial: row.serial,
            templateId: state.configPlan.templateId,
            ethPorts: state.configPlan.ethPorts,
            customVlan: state.configPlan.customVlan
          })
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
      terminalInstance = new Terminal({
        cursorBlink: true,
        convertEol: true,
        fontFamily: "Menlo, Consolas, 'Liberation Mono', monospace",
        fontSize: 13,
        theme: { background: "#0f172a", foreground: "#dbeafe", cursor: "#fbbf24" }
      });
      terminalFitAddon = new FitAddon();
      terminalInstance.loadAddon(terminalFitAddon);
      terminalInstance.open(terminalHost.value);
      terminalFitAddon.fit();
      terminalInstance.focus();
      terminalInstance.writeln("OLT Manager 内置 Telnet 终端");
      terminalInstance.writeln("系统不会自动粘贴或执行配置方案；可用鼠标点击“粘贴剪贴板”后人工确认。");

      const isHuawei = String(selectedOlt.value.vendor || "").toLowerCase() === "huawei";
      attachTerminalKeydownGuard(isHuawei);
      terminalInstance.attachCustomKeyEventHandler((event) => {
        if (event.type !== "keydown") return true;
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
      terminalInstance.onData((input) => sendTerminalInput(prepareTerminalInput(input)));
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

    async function pasteClipboardToTerminal() {
      if (!state.terminal.sessionId) return;
      try {
        const text = await navigator.clipboard?.readText?.();
        if (!text) {
          ElMessage.warning("剪贴板为空，或当前环境不允许读取剪贴板。");
          return;
        }
        sendTerminalInput(prepareTerminalInput(text));
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

    function closeTerminalSession() {
      if (state.terminal.sessionId && window.oltManagerDesktop?.terminal) {
        window.oltManagerDesktop.terminal.close({ sessionId: state.terminal.sessionId });
      }
      state.terminal.sessionId = "";
      detachTerminalKeydownGuard();
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
        state.onuRows = await api(`/api/onus?${params}`);
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
        const response = await fetch(`/api/admin/projects/${encodeURIComponent(projectId)}/onus`, {
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
          fetch("/api/admin/olts").then((response) => response.json()),
          fetchPonPorts(),
          fetchProjects()
        ]);
        state.adminOlts = olts.map(normalizeAdminOltRow);
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

    function resourceScheduleStatusText(status) {
      return { pending: "待执行", running: "执行中", success: "已完成", failed: "失败", canceled: "已取消" }[status] || status || "未知";
    }

    function resourceScheduleStatusType(status) {
      return { pending: "warning", running: "", success: "success", failed: "danger", canceled: "info" }[status] || "info";
    }

    function resourceScheduleRepeatText(task) {
      return Number(task?.repeatDays || 0) > 0 ? `每 ${task.repeatDays} 天` : "仅一次";
    }

    function resourceScheduleLastResult(task) {
      const status = task.lastStatus || (task.status === "success" ? "success" : task.status === "failed" ? "failed" : "");
      const label = { success: "已完成", failed: "失败", running: "执行中" }[status] || (task.status === "canceled" ? "已取消" : "尚未执行");
      return task.error ? `${label}：${task.error}` : label;
    }

    async function loadResourceSchedules() {
      state.resourceSchedule.loading = true;
      try {
        const data = await api("/api/admin/resource-sync-tasks");
        state.resourceSchedule.tasks = data.rows || [];
        if (!state.resourceSchedule.form.oltId) state.resourceSchedule.form.oltId = selectedOlt.value.id || state.olts[0]?.id || "";
      } catch (error) {
        ElMessage.error(error.message || "定时任务加载失败");
      } finally {
        state.resourceSchedule.loading = false;
      }
    }

    async function createResourceSchedule() {
      const { runAt, oltId, repeatEnabled, repeatDays } = state.resourceSchedule.form;
      if (!runAt || !oltId) {
        ElMessage.warning("请选择执行时间和目标 OLT");
        return;
      }
      state.resourceSchedule.saving = true;
      try {
        await api("/api/admin/resource-sync-tasks", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ runAt, oltId, repeatDays: repeatEnabled ? repeatDays : 0 })
        });
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
        await api(`/api/admin/resource-sync-tasks/${encodeURIComponent(task.id)}`, { method: "DELETE" });
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
        await api(`/api/admin/resource-sync-tasks/${encodeURIComponent(task.id)}/delete`, { method: "DELETE" });
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
      const params = new URLSearchParams();
      if (keyword) params.set("q", keyword);
      else params.set("oltId", selectedOlt.value.id);
      const data = await api(`/api/admin/resource-management/users?${params}`);
      state.resource.users = data.rows || [];
      state.resource.userPage = 1;
    }

    async function queryResourceUserSuggestions(queryString, callback) {
      const keyword = String(queryString || "").trim();
      if (!keyword) return callback([]);
      try {
        const params = new URLSearchParams({ q: keyword });
        const data = await api(`/api/admin/resource-management/users?${params}`);
        callback((data.rows || []).slice(0, 20).map((row) => ({
          value: `${row.onuIndex} · ${row.username || row.loid || "用户"}`,
          searchKey: row.username || row.loid || row.onuIndex,
          onuIndex: row.onuIndex,
          loid: row.loid,
          username: row.username,
          userPhone: row.userPhone
        })));
      } catch {
        callback([]);
      }
    }

    async function handleResourceUserSelect(item) {
      state.resource.search = item.searchKey || item.onuIndex || "";
      await loadResourceUsers();
    }

    async function loadResourceManagement() {
      const oltId = selectedOlt.value.id;
      const [configResult, usersResult, ossResult] = await Promise.allSettled([
        api("/api/admin/resource-management/config"),
        oltId ? api(`/api/admin/resource-management/users?oltId=${encodeURIComponent(oltId)}`) : Promise.resolve({ rows: [] }),
        api("/api/admin/oss-resource/config")
      ]);
      if (configResult.status === "fulfilled") {
        const config = configResult.value;
        state.resource.config.serverUrl = config.serverUrl || "";
        state.resource.config.username = config.username || "";
        state.resource.config.password = "";
        state.resource.loggedIn = Boolean(config.loggedIn);
      }
      if (usersResult.status === "fulfilled") {
        state.resource.users = usersResult.value.rows || [];
        state.resource.userPage = 1;
      }
      if (ossResult.status === "fulfilled") applyOssResourceConfig(ossResult.value);
      const failures = [configResult, usersResult, ossResult].filter((item) => item.status === "rejected");
      if (failures.length) ElMessage.warning(`资源管理部分数据加载失败（${failures.length} 项），已保留其余本地快照`);
    }

    function applyOssResourceConfig(config = {}) {
      state.oss.config.authBaseUrl = config.authBaseUrl || "";
      state.oss.config.ngbBaseUrl = config.ngbBaseUrl || "";
      state.oss.config.username = config.username || "";
      state.oss.config.organizationName = config.organizationName || "";
      state.oss.config.roomName = config.roomName || "";
      state.oss.loggedIn = Boolean(config.loggedIn);
      if (!state.oss.loggedIn) state.oss.olts = [];
    }

    async function loadOssResourceConfig() {
      const config = await api("/api/admin/oss-resource/config");
      applyOssResourceConfig(config);
      return config;
    }

    async function saveOssResourceConfig({ quiet = false } = {}) {
      state.oss.configLoading = true;
      try {
        const config = await api("/api/admin/oss-resource/config", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(state.oss.config)
        });
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

    async function loginOssResource() {
      if (!state.oss.password) {
        ElMessage.warning("请输入本次登录密码");
        return;
      }
      state.oss.loginLoading = true;
      try {
        if (!await saveOssResourceConfig({ quiet: true })) throw new Error("网管二期配置保存失败");
        const result = await api("/api/admin/oss-resource/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ password: state.oss.password })
        });
        state.oss.password = "";
        state.oss.loggedIn = true;
        state.oss.olts = Array.isArray(result.olts) ? result.olts : [];
        ElMessage.success(`网管二期登录成功，发现 ${result.oltCount} 台已投影 OLT`);
      } catch (error) {
        state.oss.loggedIn = false;
        ElMessage.error(error.message || "网管二期登录失败");
      } finally {
        state.oss.password = "";
        state.oss.loginLoading = false;
      }
    }

    async function logoutOssResource() {
      try {
        await api("/api/admin/oss-resource/logout", { method: "POST" });
        state.oss.loggedIn = false;
        state.oss.olts = [];
        state.oss.historyRows = [];
        ElMessage.success("已退出网管二期");
      } catch (error) {
        ElMessage.error(error.message || "退出网管二期失败");
      }
    }

    async function saveResourceManagementConfig() {
      state.resource.configLoading = true;
      try {
        const data = await api("/api/admin/resource-management/config", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(state.resource.config)
        });
        state.resource.config.serverUrl = data.serverUrl || "";
        state.resource.config.username = data.username || "";
        state.resource.config.password = "";
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
        const data = await api("/api/admin/resource-management/login", { method: "POST" });
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
        await api("/api/admin/resource-management/logout", { method: "POST" });
        state.resource.loggedIn = false;
        ElMessage.success("已退出资源管理系统");
      } catch (error) {
        ElMessage.error(error.message || "退出失败");
      }
    }

    async function syncResourceUsers() {
      state.resource.userSyncing = true;
      state.resource.userProgress = { phase: "fetching-total", total: 0, pages: 0, completedPages: 0, received: 0, workers: 0, attempt: 1, maxAttempts: 3, percent: 0 };
      const refreshProgress = async () => {
        try {
          const progress = await api(`/api/admin/resource-management/sync-users/progress?oltId=${encodeURIComponent(selectedOlt.value.id)}`);
          state.resource.userProgress = { ...progress, percent: progress.pages ? Math.round((progress.completedPages / progress.pages) * 100) : 0 };
        } catch {
          // The foreground sync request reports failures; polling must stay quiet.
        }
      };
      await refreshProgress();
      resourceUserProgressTimer = window.setInterval(refreshProgress, 500);
      try {
        const data = await api("/api/admin/resource-management/sync-users", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ oltId: selectedOlt.value.id })
        });
        await loadResourceUsers();
        ElMessage.success(`已同步 ${data.count} 条用户信息`);
      } catch (error) {
        if (/未登录|会话已失效/.test(error.message || "")) state.resource.loggedIn = false;
        ElMessage.error(error.message || "用户信息同步失败");
      } finally {
        if (resourceUserProgressTimer) window.clearInterval(resourceUserProgressTimer);
        resourceUserProgressTimer = null;
        await refreshProgress();
        state.resource.userSyncing = false;
      }
    }

    async function syncResourceVlans() {
      state.resource.vlanSyncing = true;
      try {
        const data = await api("/api/admin/resource-management/sync-vlans", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ oltId: selectedOlt.value.id })
        });
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

    function onuConfigParams(row) {
      return new URLSearchParams({
        oltId: String(row.oltId || state.selectedOltId || ""),
        chassis: String(row.chassis ?? ""),
        board: String(row.board ?? row.slot ?? ""),
        slot: String(row.board ?? row.slot ?? ""),
        pon: String(row.pon ?? ""),
        onuId: String(row.onuId ?? ""),
        serial: String(row.serial ?? "")
      });
    }

    async function loadOnuConfig(row, target) {
      target.loading = true;
      target.data = null;
      try {
        target.data = await api(`/api/onu-config?${onuConfigParams(row)}`);
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
      const [startDate, endDate] = state.oss.dateRange || [];
      if (!detail?.olt?.id || !detail?.onu || !startDate || !endDate) {
        ElMessage.warning("ONU 详情或日期范围不完整");
        return;
      }
      state.oss.historyLoading = true;
      state.oss.historyError = "";
      state.oss.historyRows = [];
      try {
        const result = await api("/api/onus/historical-optical", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            oltId: detail.olt.id,
            chassis: detail.onu.chassis,
            board: detail.onu.board ?? detail.onu.slot,
            pon: detail.onu.pon,
            onuId: detail.onu.onuId,
            startDate,
            endDate
          })
        });
        state.oss.historyRows = result.rows || [];
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
        const response = await fetch("/api/admin/olts", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ olts: state.adminOlts.map(normalizeAdminOltRow) })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "保存失败");
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
      const params = new URLSearchParams();
      if (state.projectSearch.trim()) params.set("q", state.projectSearch.trim());
      const suffix = params.toString() ? `?${params}` : "";
      const data = await fetch(`/api/admin/projects${suffix}`).then((response) => response.json());
      return data.rows || [];
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

    function blankProjectForm() {
      return { id: "", name: "", vlan: 100, address: "", contactName: "", contactPhone: "", contactNote: "" };
    }

    function openProjectDialog(project) {
      state.projectDialog.form = project
        ? {
            id: project.id,
            name: project.name || "",
            vlan: Number(project.vlan || 100),
            address: project.address || "",
            contactName: project.contactName || "",
            contactPhone: project.contactPhone || "",
            contactNote: project.contactNote || ""
          }
        : blankProjectForm();
      state.projectDialog.visible = true;
    }

    async function saveProject() {
      const form = state.projectDialog.form;
      const payload = {
        name: String(form.name || "").trim(),
        vlan: form.vlan,
        address: String(form.address || "").trim(),
        contactName: String(form.contactName || "").trim(),
        contactPhone: String(form.contactPhone || "").trim(),
        contactNote: String(form.contactNote || "").trim()
      };
      const url = form.id ? `/api/admin/projects/${encodeURIComponent(form.id)}` : "/api/admin/projects";
      state.projectDialog.loading = true;
      try {
        const response = await fetch(url, {
          method: form.id ? "PUT" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "保存项目失败");
        state.projectDialog.visible = false;
        const projects = await fetchProjects();
        state.projects = projects;
        const savedProject = data.project?.id ? projects.find((project) => project.id === data.project.id) : null;
        await syncSelectedProjectAfterProjectListChange(savedProject);
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
        const response = await fetch(`/api/admin/projects/${encodeURIComponent(project.id)}`, { method: "DELETE" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "删除项目失败");
        const projects = await fetchProjects();
        state.projects = projects;
        await syncSelectedProjectAfterProjectListChange();
        ElMessage.success("项目已删除");
      } catch (error) {
        if (error === "cancel" || error === "close") return;
        ElMessage.error(error.message || "删除项目失败");
      }
    }

    function normalizeProjectOnuRow(row) {
      return {
        ...row,
        noteDraft: row.note || "",
        savingNote: false,
        removing: false
      };
    }

    async function syncSelectedProjectAfterProjectListChange(preferredProject, options = {}) {
      const preferred = preferredProject?.id ? state.projects.find((project) => project.id === preferredProject.id) : null;
      const current = state.projectDetail.project?.id ? state.projects.find((project) => project.id === state.projectDetail.project.id) : null;
      const nextProject = preferred || current || null;
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
      return row?.id && row.id === state.projectDetail.selectedOnu?.id ? "selected-row" : "";
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
        const response = await fetch(`/api/admin/projects/${encodeURIComponent(project.id)}/onus`);
        setProjectLoadingProgress(76, "正在整理 ONU 状态和安装地址...", "整理数据");
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "读取项目 ONU 失败");
        state.projectDetail.onus = (data.rows || []).map(normalizeProjectOnuRow);
        const current = state.projectDetail.selectedOnu?.id ? state.projectDetail.onus.find((row) => row.id === state.projectDetail.selectedOnu.id) : null;
        state.projectDetail.selectedOnu = current || state.projectDetail.onus[0] || null;
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
        const response = await fetch(`/api/admin/projects/${encodeURIComponent(project.id)}/onus/${encodeURIComponent(row.id)}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ note: row.noteDraft || "" })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "保存设备安装地址失败");
        row.note = data.onu?.note || "";
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
        const response = await fetch(`/api/admin/projects/${encodeURIComponent(project.id)}/onus/${encodeURIComponent(row.id)}`, { method: "DELETE" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "移除项目 ONU 失败");
        state.projectDetail.onus = state.projectDetail.onus.filter((item) => item.id !== row.id);
        if (state.projectDetail.selectedOnu?.id === row.id) state.projectDetail.selectedOnu = state.projectDetail.onus[0] || null;
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
      const data = await fetch("/api/admin/pon-ports").then((item) => item.json());
      return Array.isArray(data) ? data : data.ponPorts || [];
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
        const response = await fetch("/api/admin/import-pon-ports", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ rows })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "保存失败");
        state.ponPorts = await fetchPonPorts();
        ponPortFilterState.reset(state.ponPorts);
        ElMessage.success(`已保存 ${data.count} 条`);
      } catch (error) {
        ElMessage.error(error.message);
      } finally {
        state.loading.admin = false;
      }
    }

    function exportPonPortsExcel() {
      try {
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
        const response = await fetch("/api/admin/backup");
        if (!response.ok) throw new Error("导出备份失败");
        downloadBlob(await response.blob(), `olt-manager-backup-${new Date().toISOString().slice(0, 10)}.sqlite`);
        ElMessage.success("完整项目备份已导出");
      } catch (error) { ElMessage.error(error.message); }
    }

    function triggerProjectRestore() { document.getElementById("project-backup-input")?.click(); }

    async function restoreProjectBackup(event) {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      try {
        await ElMessageBox.confirm("还原会覆盖当前本机 SQLite、Feishu 加密状态和授权配置，且无法撤销。确认继续？", "确认还原组合备份", { type: "warning", confirmButtonText: "确认还原" });
        if (window.oltManagerDesktop?.feishuBackup) {
          const result = await window.oltManagerDesktop.feishuBackup.restore({ bytes: new Uint8Array(await file.arrayBuffer()), confirmed: true });
          ElMessage.success(result.warnings?.join("；") || "组合备份还原成功，正在刷新页面");
          window.setTimeout(() => window.location.reload(), 500);
          return;
        }
        const response = await fetch("/api/admin/restore", { method: "POST", headers: { "content-type": "application/vnd.sqlite3" }, body: file });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "备份还原失败");
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
      const response = await fetch("/api/admin/import-pon-ports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rows })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `${successLabel}失败`);
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

    function formatDate(value) {
      return value ? new Date(value).toLocaleString() : "";
    }

    function opticalValue(value) {
      if (value === null || value === undefined || value === "") return "-";
      return Number.isFinite(Number(value)) ? `${Number(value).toFixed(2)} dBm` : "-";
    }

    function rxHistoryPoints(detail) {
      const samples = detail?.history?.rxPower || [];
      if (samples.length < 2) return "";
      const values = samples.map((sample) => Number(sample.rxPower)).filter(Number.isFinite);
      if (values.length < 2) return "";
      const min = Math.min(...values);
      const max = Math.max(...values);
      const span = max - min || 1;
      return samples.map((sample, index) => {
        const x = 20 + (index * 560) / Math.max(1, samples.length - 1);
        const y = 160 - ((Number(sample.rxPower) - min) / span) * 140;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(" ");
    }

    function servicePortCli(detail) {
      if (detail?.cliConfig?.runningConfig) return detail.cliConfig.runningConfig;
      const onu = detail?.onu || {};
      const lines = [`interface gpon-onu_${onu.chassis || "1"}/${onu.board || onu.slot}/${onu.pon}:${onu.onuId}`];
      for (const item of detail?.servicePorts || []) {
        const parts = [
          `  service-port ${item.servicePort}`,
          `vport ${item.vport}`,
          `user-vlan ${item.userVlan}`,
          `vlan ${item.cVlan || item.userVlan}`
        ];
        if (item.sVlan) parts.push(`svlan ${item.sVlan}`);
        lines.push(parts.join(" "));
      }
      lines.push("!");
      return lines.join("\n");
    }

    function onuMgmtCli(detail) {
      return detail?.cliConfig?.onuRunningConfig || "";
    }

    onBeforeUnmount(() => {
      stopFeishuStatusPolling();
    });

    onMounted(async () => {
      const bootstrap = await fetch("/api/bootstrap").then((response) => response.json());
      state.version = bootstrap.version;
      state.olts = bootstrap.olts || [];
      state.ponPorts = bootstrap.ponPorts || [];
      ponPortFilterState.reset(state.ponPorts);
      state.selectedOltId = state.olts[0]?.id || "";
      restoreFilters();
      await Promise.all([loadConfigTemplates(), loadDashboard()]);
      state.projects = await fetchProjects();
      await syncSelectedProjectAfterProjectListChange();
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
      loadFeishuSettings,
      saveFeishuCredentials,
      saveLanguageProvider,
      enableFeishu,
      stopFeishu,
      saveResourceManagementConfig,
      loginResourceManagement,
      logoutResourceManagement,
      syncResourceUsers,
      syncResourceVlans,
      loadResourceSchedules,
      createResourceSchedule,
      cancelResourceSchedule,
      deleteResourceSchedule,
      disablePastDate,
      resourceScheduleStatusText,
      resourceScheduleStatusType,
      resourceScheduleRepeatText,
      resourceScheduleLastResult,
      queryResourceUserSuggestions,
      handleResourceUserSelect,
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
      triggerExcelImport,
      triggerProjectRestore,
      restoreProjectBackup,
      importPonPortsExcel,
      formatDate,
      opticalValue,
      rxHistoryPoints,
      servicePortCli,
      onuMgmtCli,
      saveFilters
    };
  }
};

createApp(App).use(ElementPlus).mount("#app");
