import { createApp, computed, nextTick, onMounted, reactive, ref } from "vue/dist/vue.esm-bundler.js";
import ElementPlus, { ElMessage, ElMessageBox } from "element-plus";
import * as XLSX from "xlsx";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { defaultProfileForModel, defaultProfileForVendor, profileById, profilesForVendor } from "./device-profiles.mjs";
import { defaultChassisForVendor, normalizePonCoordinate, onuCoordinateLabel, ponCoordinateKey } from "./pon-coordinate.mjs";
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
          <el-menu-item index="adminHistory">数据采集记录</el-menu-item>
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
            <el-card shadow="never" class="content-card">
              <template #header>警告通知</template>
              <el-alert
                v-for="(alarm, index) in alertRows"
                :key="index"
                :title="alarm.text"
                :type="alarm.level === 'info' ? 'info' : 'warning'"
                :closable="false"
                class="alarm-row"
              />
            </el-card>
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
                <el-table-column label="槽/板卡/PON/ID" min-width="150">
                  <template #default="{ row }">{{ onuCoordinateLabel(row) }}</template>
                </el-table-column>
                <el-table-column prop="serial" label="ONU 序列号" min-width="150">
                  <template #default="{ row }">
                    <el-button link type="primary" class="serial-link" @click="openOnuDetail(row)">
                      {{ row.serial || "N/A" }}
                    </el-button>
                  </template>
                </el-table-column>
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
                <el-table-column prop="address" label="地址" min-width="240" show-overflow-tooltip />
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

          <section v-else-if="state.activeView === 'adminPonPorts'">
            <div class="page-head">
              <div>
                <h1>ONU 数据管理</h1>
              </div>
              <div class="toolbar">
                <el-button @click="addPonPort">新增一行</el-button>
                <el-button type="success" :loading="state.loading.vlan" @click="refreshPonVlans">更新外层 VLAN</el-button>
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
                <el-table-column label="地址" min-width="260"><template #default="{ row }"><el-input v-model="row.port.address" /></template></el-table-column>
                <el-table-column label="操作" width="90"><template #default="{ row }"><el-button type="danger" link @click="deletePonPort(row.__index)">删除</el-button></template></el-table-column>
              </el-table>
            </el-card>
          </section>

          <section v-else-if="state.activeView === 'adminHistory'">
            <div class="page-head">
              <div>
                <h1>数据采集记录</h1>
                <p>查看 SNMP 诊断和后台操作历史。</p>
              </div>
              <el-button type="primary" :loading="state.loading.admin" @click="loadAdminData">刷新记录</el-button>
            </div>
            <el-row :gutter="14">
              <el-col :span="14">
                <el-card shadow="never" class="content-card">
                  <template #header>SNMP 采集记录</template>
                  <el-table :data="state.snmpHistory" border stripe size="small" max-height="620">
                    <el-table-column prop="created_at" label="时间" min-width="160" />
                    <el-table-column prop="olt_id" label="OLT" min-width="120" />
                    <el-table-column prop="operation" label="操作" width="90" />
                    <el-table-column prop="oid" label="OID" min-width="220" show-overflow-tooltip />
                    <el-table-column label="结果" min-width="180"><template #default="{ row }">{{ row.ok ? "成功" : "失败" }} {{ row.summary }}</template></el-table-column>
                    <el-table-column label="耗时" width="110"><template #default="{ row }">{{ row.duration_ms }} ms</template></el-table-column>
                  </el-table>
                </el-card>
              </el-col>
              <el-col :span="10">
                <el-card shadow="never" class="content-card">
                  <template #header>后台操作日志</template>
                  <el-table :data="state.adminEvents" border stripe size="small" max-height="620">
                    <el-table-column prop="created_at" label="时间" min-width="160" />
                    <el-table-column prop="action" label="动作" min-width="120" />
                    <el-table-column prop="source" label="来源" min-width="110" />
                    <el-table-column prop="detail" label="详情" min-width="160" show-overflow-tooltip />
                  </el-table>
                </el-card>
              </el-col>
            </el-row>
          </section>
          <el-dialog
            v-model="state.onuDetail.visible"
            title="ONU 已配置数据"
            width="760px"
            destroy-on-close
          >
            <div v-loading="state.onuDetail.loading">
              <el-empty v-if="!state.onuDetail.data" description="请选择 ONU 序列号查看详情" />
              <div v-else class="onu-detail">
                <el-alert
                  title="当前页面为只读查看，仅展示已配置数据，系统不会执行或下发到 OLT。"
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
                  <el-descriptions-item label="地址">{{ state.onuDetail.data.onu.address || "未登记" }}</el-descriptions-item>
                  <el-descriptions-item label="外层 VLAN">{{ state.onuDetail.data.onu.outerVlan || "待补充" }}</el-descriptions-item>
                </el-descriptions>

                <el-card v-if="state.onuDetail.data.servicePorts?.length || state.onuDetail.data.cliConfig?.runningConfig" shadow="never" class="detail-block">
                  <template #header>已验证业务 VLAN</template>
                  <pre class="command-template terminal-block">{{ servicePortCli(state.onuDetail.data) }}</pre>
                </el-card>

                <el-card v-if="state.onuDetail.data.cliConfig?.onuRunningConfig" shadow="never" class="detail-block">
                  <template #header>ONU 已配置数据</template>
                  <el-alert
                    :title="'数据来源：' + (state.onuDetail.data.cliConfig?.source || '只读采集') + '。'"
                    type="info"
                    :closable="false"
                    show-icon
                    class="detail-note"
                  />
                  <pre class="command-template terminal-block">{{ onuMgmtCli(state.onuDetail.data) }}</pre>
                </el-card>

                <el-alert
                  v-else-if="state.onuDetail.data.cliConfig?.error"
                  :title="'ONU 已配置数据读取失败：' + state.onuDetail.data.cliConfig.error"
                  type="warning"
                  :closable="false"
                  show-icon
                  class="detail-block"
                />

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
                <el-form-item v-if="showEthPortSelector" label="物理端口">
                  <el-checkbox-group v-model="state.configPlan.ethPorts">
                    <el-checkbox-button
                      v-for="port in currentEthPortOptions"
                      :key="port"
                      :label="port"
                    />
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
                  {{ formatConfigPlanVariable(value) }}
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
      onuDetail: { visible: false, loading: false, data: null },
      configPlan: { visible: false, loading: false, row: null, templateId: "zte-self-operated-internet", ethPorts: ["eth_0/1"], customVlan: undefined, result: null },
      terminal: { visible: false, sessionId: "", status: "未连接" },
      filters: { search: "", chassis: "", slot: "", pon: "" },
      sort: { field: "", direction: "asc" },
      adminOlts: [],
      snmpHistory: [],
      adminEvents: [],
      ponAdminSearch: "",
      loading: { status: false, install: false, onus: false, admin: false, vlan: false }
    });

    const selectedOlt = computed(() => state.olts.find((olt) => olt.id === state.selectedOltId) || state.olts[0] || {});
    const currentPonPorts = computed(() => state.ponPorts.filter((port) => !selectedOlt.value.host || port.oltIp === selectedOlt.value.host));
    const currentConfigTemplates = computed(() => state.configTemplates.filter((template) => {
      if (Array.isArray(template.deviceProfiles)) return template.deviceProfiles.includes(selectedOlt.value.deviceProfile);
      return template.vendor === selectedOlt.value.vendor;
    }));
    const currentConfigTemplate = computed(() => currentConfigTemplates.value.find((template) => template.id === state.configPlan.templateId) || currentConfigTemplates.value[0] || {});
    const currentEthPortOptions = computed(() => currentConfigTemplate.value.portRules?.allowed || []);
    const defaultEthPortsForTemplate = computed(() => currentConfigTemplate.value.portRules?.defaults || []);
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
      { label: "运行时间", value: state.status.uptime || "-" },
      { label: "ONU 数据", value: `${state.onuRows.length} 条，在线 ${onuGroupCounts.value.online} 条` },
      { label: "未注册数据", value: state.installMessage || `${state.unregisteredRows.length} 条` },
      { label: "台账健康", value: `重复地址 ${duplicateLedgerCount.value} 个，空地址 ${emptyLedgerCount.value} 条` }
    ]);
    const alertRows = computed(() => state.status.alarms?.length ? state.status.alarms : [{ level: "info", text: "暂无告警。" }]);
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
      const keyword = state.ponAdminSearch.trim().toLowerCase();
      const selectedHost = selectedOlt.value.host || "";
      return state.ponPorts
        .map((port, index) => ({
          port,
          __index: index,
          searchText: `${port.oltIp || ""} ${port.ponPort || ""} ${port.chassis || ""} ${port.board || ""} ${port.pon || ""} ${port.outerVlan || ""} ${port.address || ""}`.toLowerCase()
        }))
        .filter((row) => !keyword || row.searchText.includes(keyword))
        .sort((left, right) => {
          const leftSelected = selectedHost && left.port.oltIp === selectedHost ? 0 : 1;
          const rightSelected = selectedHost && right.port.oltIp === selectedHost ? 0 : 1;
          if (leftSelected !== rightSelected) return leftSelected - rightSelected;
          const oltCompare = String(left.port.oltIp || "").localeCompare(String(right.port.oltIp || ""), "zh-Hans-CN", { numeric: true });
          if (oltCompare) return oltCompare;
          const ponCompare = String(left.port.ponPort || "").localeCompare(String(right.port.ponPort || ""), "zh-Hans-CN", { numeric: true });
          if (ponCompare) return ponCompare;
          return left.__index - right.__index;
        });
    });
    const ponStats = computed(() => {
      const duplicateCount = countDuplicateAddresses(state.ponPorts);
      const emptyCount = state.ponPorts.filter((port) => !port.address).length;
      return `显示 ${filteredPonPorts.value.length} 条 / 共 ${state.ponPorts.length} 条 · 重复地址 ${duplicateCount} 个 · 空地址 ${emptyCount} 条`;
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
        actualOntId: "建议ONT ID"
      }[key] || key;
    }

    function formatConfigPlanVariable(value) {
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

    async function loadOnus() {
      state.loading.onus = true;
      try {
        const matchedPort = applyAddressSearchToPon();
        if (matchedPort) await switchOltForGlobalSearch(matchedPort.oltIp);
        saveFilters();
        const params = new URLSearchParams();
        if (state.filters.search.trim()) params.set("search", state.filters.search.trim());
        if (state.filters.chassis.trim()) params.set("chassis", state.filters.chassis.trim());
        if (state.filters.slot.trim()) params.set("board", state.filters.slot.trim());
        if (state.filters.pon.trim()) params.set("pon", state.filters.pon.trim());
        state.onuRows = await api(`/api/onus?${params}`);
      } catch (error) {
        state.onuRows = [];
        ElMessage.error(error.message);
      } finally {
        state.loading.onus = false;
      }
    }

    async function loadAdminData() {
      state.loading.admin = true;
      try {
        const [olts, ponPorts, history, events] = await Promise.all([
          fetch("/api/admin/olts").then((response) => response.json()),
          fetchPonPorts(),
          fetch("/api/admin/snmp-history").then((response) => response.json()),
          fetch("/api/admin/events").then((response) => response.json())
        ]);
        state.adminOlts = olts.map(normalizeAdminOltRow);
        state.ponPorts = ponPorts;
        state.snmpHistory = history;
        state.adminEvents = events;
      } catch (error) {
        ElMessage.error(error.message);
      } finally {
        state.loading.admin = false;
      }
    }

    async function loadDashboard() {
      await Promise.all([loadStatus(), loadInstallOnus(), loadOnus()]);
    }

    function setView(name) {
      state.activeView = name;
      if (name === "dashboard") loadDashboard();
      if (name.startsWith("admin")) loadAdminData();
    }

    async function refreshCurrent() {
      if (state.activeView === "dashboard") return loadDashboard();
      if (state.activeView === "install") return loadInstallOnus();
      if (state.activeView === "onus") return loadOnus();
      return loadAdminData();
    }

    async function handleOltChange() {
      restoreFilters();
      syncConfigTemplateSelection();
      await Promise.all([loadStatus(), loadInstallOnus(), loadOnus()]);
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
      state.sort.field = prop || "";
      state.sort.direction = order || "ascending";
    }

    async function openOnuDetail(row) {
      state.onuDetail.visible = true;
      state.onuDetail.loading = true;
      state.onuDetail.data = null;
      try {
        const params = new URLSearchParams({
          oltId: String(row.oltId || state.selectedOltId || ""),
          chassis: String(row.chassis ?? ""),
          board: String(row.board ?? row.slot ?? ""),
          slot: String(row.board ?? row.slot ?? ""),
          pon: String(row.pon ?? ""),
          onuId: String(row.onuId ?? ""),
          serial: String(row.serial ?? "")
        });
        state.onuDetail.data = await api(`/api/onu-config?${params}`);
      } catch (error) {
        ElMessage.error(error.message);
      } finally {
        state.onuDetail.loading = false;
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

    async function refreshPonVlans() {
      state.loading.vlan = true;
      try {
        const response = await fetch("/api/admin/refresh-pon-vlans", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({})
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "更新失败");
        state.ponPorts = data.ponPorts || await fetchPonPorts();
        ElMessage.success(`已更新 ${data.count} 条外层 VLAN`);
      } catch (error) {
        ElMessage.error(error.message);
      } finally {
        state.loading.vlan = false;
      }
    }

    function formatDate(value) {
      return value ? new Date(value).toLocaleString() : "";
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

    onMounted(async () => {
      const bootstrap = await fetch("/api/bootstrap").then((response) => response.json());
      state.version = bootstrap.version;
      state.olts = bootstrap.olts || [];
      state.ponPorts = bootstrap.ponPorts || [];
      state.selectedOltId = state.olts[0]?.id || "";
      restoreFilters();
      await Promise.all([loadConfigTemplates(), loadDashboard()]);
    });

    return {
      terminalHost,
      state,
      dashboardMetrics,
      dashboardWorkItems,
      dashboardQuickActions,
      dashboardFreshness,
      alertRows,
      currentConfigTemplates,
      currentEthPortOptions,
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
      handleOltChange,
      handleDashboardQuickAction,
      queryAddressSuggestions,
      handleAddressSelect,
      handleChassisChange,
      handleSlotChange,
      handleOnuSort,
      openOnuDetail,
      openConfigPlanDialog,
      handleConfigTemplateChange,
      configPlanVariableLabel,
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
      addPonPort,
      deletePonPort,
      savePonPorts,
      exportPonPortsExcel,
      triggerExcelImport,
      importPonPortsExcel,
      refreshPonVlans,
      formatDate,
      servicePortCli,
      onuMgmtCli,
      saveFilters
    };
  }
};

createApp(App).use(ElementPlus).mount("#app");
