import { createApp, computed, nextTick, onMounted, reactive } from "vue/dist/vue.esm-bundler.js";
import ElementPlus, { ElMessage, ElMessageBox } from "element-plus";
import "element-plus/dist/index.css";
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

function parsePonImport(text) {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    return JSON.parse(trimmed).map((row) => ({
      oltIp: row.oltIp || row.olt_ip || "",
      ponPort: row.ponPort || row.pon_port || "",
      outerVlan: row.outerVlan || row.outer_vlan || "",
      address: row.address || ""
    })).filter((row) => row.oltIp && row.ponPort);
  }
  return trimmed.split(/\r?\n/)
    .filter((line) => line.startsWith("|") && !line.includes("---") && !line.includes("OLT IP"))
    .map((line) => line.split("|").slice(1, -1).map((part) => part.trim()))
    .filter((cols) => cols.length >= 3 && cols[0] && cols[1])
    .map((cols) => {
      const [oltIp, ponPort] = cols;
      const maybeVlan = cols.find((col, index) => index >= 2 && /^\d{2,4}$/.test(col));
      const address = cols.find((col, index) => index >= 2 && col !== maybeVlan) || "";
      return { oltIp, ponPort, outerVlan: maybeVlan || "", address };
    });
}

const App = {
  template: `
    <el-container class="app-shell">
      <el-aside width="232px" class="app-aside">
        <div class="brand">
          <div class="brand-mark">OLT</div>
          <div>
            <strong>OLT 管理系统</strong>
            <span>v{{ state.version || "0.1.0" }}</span>
          </div>
        </div>
        <el-menu :default-active="state.activeView" class="side-menu" @select="setView">
          <el-menu-item index="dashboard">首页</el-menu-item>
          <el-menu-item index="install">ONU 安装查询</el-menu-item>
          <el-menu-item index="onus">ONU 列表</el-menu-item>
          <el-sub-menu index="admin">
            <template #title>后台管理</template>
            <el-menu-item index="adminOlts">设备管理</el-menu-item>
            <el-menu-item index="adminPonPorts">PON 台账</el-menu-item>
            <el-menu-item index="adminHistory">采集记录</el-menu-item>
          </el-sub-menu>
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
                <h1>设备信息</h1>
                <p>查看当前 OLT 基础状态、SNMP 运行信息和告警。</p>
              </div>
              <el-button type="primary" @click="loadStatus">刷新状态</el-button>
            </div>
            <el-row :gutter="14" class="metric-row">
              <el-col :span="6" v-for="metric in dashboardMetrics" :key="metric.label">
                <el-card shadow="never" class="metric-card">
                  <span>{{ metric.label }}</span>
                  <strong>{{ metric.value }}</strong>
                </el-card>
              </el-col>
            </el-row>
            <el-card shadow="never" class="content-card">
              <template #header>运行状态</template>
              <pre class="sysdescr">{{ state.status.sysDescr || "读取中..." }}</pre>
              <p class="muted">{{ state.status.uptime }}</p>
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
                <el-table-column prop="slot" label="槽位" width="100" />
                <el-table-column prop="pon" label="PON" width="100" />
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
                <h1>ONU 列表</h1>
                <p>按地址或槽位/PON 查询 ONU 状态、光功率和距离。</p>
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
                <el-select v-model="state.filters.slot" clearable filterable placeholder="槽位" class="mini-select" @change="handleSlotChange">
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
                <el-table-column label="槽/PON/ID" min-width="120">
                  <template #default="{ row }">{{ row.slot }}/{{ row.pon }}/{{ row.onuId }}</template>
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
                <h1>设备管理</h1>
                <p>维护 OLT 基础信息和只读 SNMP community。</p>
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
                <el-table-column label="厂商" width="120"><template #default="{ row }"><el-input v-model="row.vendor" /></template></el-table-column>
                <el-table-column label="型号" width="130"><template #default="{ row }"><el-input v-model="row.model" /></template></el-table-column>
                <el-table-column label="版本" width="130"><template #default="{ row }"><el-input v-model="row.version" /></template></el-table-column>
                <el-table-column label="IP" min-width="150"><template #default="{ row }"><el-input v-model="row.host" /></template></el-table-column>
                <el-table-column label="端口" width="110"><template #default="{ row }"><el-input-number v-model="row.snmpPort" :min="1" :max="65535" controls-position="right" /></template></el-table-column>
                <el-table-column label="Community" min-width="150"><template #default="{ row }"><el-input v-model="row.readCommunity" show-password /></template></el-table-column>
                <el-table-column label="操作" width="90"><template #default="{ $index }"><el-button type="danger" link @click="deleteAdminOlt($index)">删除</el-button></template></el-table-column>
              </el-table>
            </el-card>
          </section>

          <section v-else-if="state.activeView === 'adminPonPorts'">
            <div class="page-head">
              <div>
                <h1>PON 台账</h1>
                <p>维护 OLT、PON 口和地址台账，供地址搜索和查询定位使用。</p>
              </div>
              <div class="toolbar">
                <el-button @click="addPonPort">新增一行</el-button>
                <el-button type="success" :loading="state.loading.vlan" @click="refreshPonVlans">更新外层 VLAN</el-button>
                <el-button @click="exportPonPorts">导出 JSON</el-button>
                <el-button type="primary" :loading="state.loading.admin" @click="savePonPorts">保存台账</el-button>
              </div>
            </div>
            <el-card shadow="never" class="content-card">
              <div class="pon-tools">
                <el-input v-model="state.ponAdminSearch" clearable placeholder="搜索 OLT/IP/PON/外层VLAN/地址" />
                <span class="muted">{{ ponStats }}</span>
              </div>
              <el-input v-model="state.ponImportText" type="textarea" :rows="4" placeholder="粘贴 Markdown 表格或 JSON 数组后点击导入台账" />
              <div class="import-actions"><el-button type="primary" plain @click="importPonPorts">导入台账</el-button></div>
              <el-table :data="filteredPonPorts" border stripe size="small" max-height="520">
                <el-table-column label="OLT IP" min-width="160"><template #default="{ row }"><el-input v-model="row.port.oltIp" /></template></el-table-column>
                <el-table-column label="PON" width="140"><template #default="{ row }"><el-input v-model="row.port.ponPort" /></template></el-table-column>
                <el-table-column label="外层 VLAN" width="140"><template #default="{ row }"><el-input v-model="row.port.outerVlan" /></template></el-table-column>
                <el-table-column label="地址" min-width="260"><template #default="{ row }"><el-input v-model="row.port.address" /></template></el-table-column>
                <el-table-column label="操作" width="90"><template #default="{ row }"><el-button type="danger" link @click="deletePonPort(row.__index)">删除</el-button></template></el-table-column>
              </el-table>
            </el-card>
          </section>

          <section v-else-if="state.activeView === 'adminHistory'">
            <div class="page-head">
              <div>
                <h1>采集记录</h1>
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
                  title="当前页面为只读查看，命令模板仅供人工核对，系统不会执行或下发到 OLT。"
                  type="warning"
                  :closable="false"
                  show-icon
                />
                <el-descriptions title="基础信息" :column="2" border class="detail-block">
                  <el-descriptions-item label="OLT">{{ state.onuDetail.data.olt.name }}</el-descriptions-item>
                  <el-descriptions-item label="厂商型号">{{ state.onuDetail.data.olt.vendor }} {{ state.onuDetail.data.olt.model }}</el-descriptions-item>
                  <el-descriptions-item label="槽/PON/ID">
                    {{ state.onuDetail.data.onu.slot }}/{{ state.onuDetail.data.onu.pon }}/{{ state.onuDetail.data.onu.onuId }}
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
                  <template #header>ONU 管理配置</template>
                  <el-alert
                    title="数据来源：TELNET 固定白名单只读 show 查询。"
                    type="info"
                    :closable="false"
                    show-icon
                    class="detail-note"
                  />
                  <pre class="command-template terminal-block">{{ onuMgmtCli(state.onuDetail.data) }}</pre>
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
                <el-descriptions-item label="槽/PON">{{ state.configPlan.row.slot }}/{{ state.configPlan.row.pon }}</el-descriptions-item>
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
                    <el-checkbox-button label="eth_0/1" />
                    <el-checkbox-button label="eth_0/2" />
                    <el-checkbox-button label="eth_0/3" />
                    <el-checkbox-button label="eth_0/4" />
                  </el-checkbox-group>
                </el-form-item>
                <el-form-item>
                  <el-button type="primary" :loading="state.configPlan.loading" @click="generateConfigPlan">生成命令预览</el-button>
                  <el-button :disabled="!state.configPlan.result?.commands" @click="copyConfigPlan">复制命令</el-button>
                  <el-button :disabled="!state.configPlan.result?.commands" @click="openTerminalForConfigPlan">打开终端</el-button>
                </el-form-item>
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
        </el-main>
      </el-container>
    </el-container>
  `,
  setup() {
    const state = reactive({
      version: "0.1.0",
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
      configPlan: { visible: false, loading: false, row: null, templateId: "zte-self-operated-internet", ethPorts: ["eth_0/1"], result: null },
      filters: { search: "", slot: "", pon: "" },
      sort: { field: "", direction: "asc" },
      adminOlts: [],
      snmpHistory: [],
      adminEvents: [],
      ponAdminSearch: "",
      ponImportText: "",
      loading: { status: false, install: false, onus: false, admin: false, vlan: false }
    });

    const selectedOlt = computed(() => state.olts.find((olt) => olt.id === state.selectedOltId) || state.olts[0] || {});
    const currentPonPorts = computed(() => state.ponPorts.filter((port) => !selectedOlt.value.host || port.oltIp === selectedOlt.value.host));
    const currentConfigTemplates = computed(() => state.configTemplates.filter((template) => template.vendor === selectedOlt.value.vendor));
    const showEthPortSelector = computed(() => selectedOlt.value.vendor !== "huawei" && state.configPlan.templateId !== "zte-mdu-ott");
    const slotOptions = computed(() => uniqueSorted(currentPonPorts.value.map((port) => port.ponPort.split("/")[0]), true));
    const ponOptions = computed(() => uniqueSorted(
      currentPonPorts.value
        .filter((port) => !state.filters.slot || port.ponPort.split("/")[0] === state.filters.slot)
        .map((port) => port.ponPort.split("/")[1]),
      true
    ));
    const dashboardMetrics = computed(() => [
      { label: "设备", value: selectedOlt.value.name || "-" },
      { label: "型号/版本", value: `${selectedOlt.value.model || "-"} / ${selectedOlt.value.version || "-"}` },
      { label: "管理地址", value: selectedOlt.value.host || "未配置" },
      { label: "PON 台账", value: currentPonPorts.value.length }
    ]);
    const alertRows = computed(() => state.status.alarms?.length ? state.status.alarms : [{ level: "info", text: "暂无告警。" }]);
    const onuSummary = computed(() => {
      const counts = { total: state.onuRows.length, online: 0, offline: 0, los: 0, power: 0, auth: 0, logging: 0, sync: 0 };
      for (const row of state.onuRows) {
        const group = phaseInfo(row.phase).group;
        if (Object.hasOwn(counts, group)) counts[group] += 1;
      }
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
      const hasInput = state.filters.search || state.filters.slot || state.filters.pon;
      return hasInput ? "没有匹配到 ONU，请确认地址、槽位和 PON 口。" : "请输入地址，或选择槽位和 PON 口后点击搜索。";
    });
    const filteredPonPorts = computed(() => {
      const keyword = state.ponAdminSearch.trim().toLowerCase();
      return state.ponPorts
        .map((port, index) => ({
          port,
          __index: index,
          searchText: `${port.oltIp || ""} ${port.ponPort || ""} ${port.outerVlan || ""} ${port.address || ""}`.toLowerCase()
        }))
        .filter((row) => !keyword || row.searchText.includes(keyword))
        .slice(0, 500);
    });
    const ponStats = computed(() => {
      const duplicateAddresses = new Map();
      for (const port of state.ponPorts) {
        if (!port.address) continue;
        duplicateAddresses.set(port.address, (duplicateAddresses.get(port.address) || 0) + 1);
      }
      const duplicateCount = [...duplicateAddresses.values()].filter((count) => count > 1).length;
      const emptyCount = state.ponPorts.filter((port) => !port.address).length;
      return `${state.ponPorts.length} 条 · 重复地址 ${duplicateCount} 个 · 空地址 ${emptyCount} 条`;
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
      if (!keyword || state.filters.slot || state.filters.pon) return;
      const match = state.ponPorts
        .filter((port) => port.address && port.address.toLowerCase().includes(keyword))
        .sort((a, b) => a.address.length - b.address.length)[0];
      if (!match) return;
      const [slot, pon] = match.ponPort.split("/");
      state.filters.slot = slot || "";
      state.filters.pon = pon || "";
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
        if (!currentConfigTemplates.value.some((template) => template.id === state.configPlan.templateId)) {
          state.configPlan.templateId = currentConfigTemplates.value[0]?.id || "zte-self-operated-internet";
        }
      } catch (error) {
        state.configTemplates = [];
        ElMessage.error(error.message);
      }
    }

    function handleConfigTemplateChange() {
      state.configPlan.result = null;
      if (state.configPlan.templateId === "zte-mdu-ott") {
        state.configPlan.ethPorts = ["eth_0/1", "eth_0/2", "eth_0/3", "eth_0/4"];
      } else if (!state.configPlan.ethPorts.length) {
        state.configPlan.ethPorts = ["eth_0/1"];
      }
    }

    function openConfigPlanDialog(row) {
      state.configPlan.visible = true;
      state.configPlan.row = row;
      state.configPlan.result = null;
      state.configPlan.templateId = currentConfigTemplates.value[0]?.id || "zte-self-operated-internet";
      state.configPlan.ethPorts = ["eth_0/1"];
    }

    function configPlanVariableLabel(key) {
      return {
        slot: "槽位",
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
        ethPorts: "物理端口"
      }[key] || key;
    }

    function formatConfigPlanVariable(value) {
      if (Array.isArray(value)) return value.join(", ");
      return value || "-";
    }

    async function generateConfigPlan() {
      const row = state.configPlan.row;
      if (!row) return;
      state.configPlan.loading = true;
      try {
        const data = await api(`/api/unregistered-onus/${encodeURIComponent(`${row.slot}-${row.pon}-${row.serial}`)}/config-plan`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            slot: row.slot,
            pon: row.pon,
            serial: row.serial,
            templateId: state.configPlan.templateId,
            ethPorts: state.configPlan.ethPorts
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

    async function openTerminalForConfigPlan() {
      const commands = state.configPlan.result?.commands || "";
      if (!commands) return;
      const copied = await copyText(commands);
      try {
        await api("/api/open-terminal", { method: "POST" });
        ElMessage.success(copied ? "已打开终端，配置命令已复制，请人工粘贴确认。" : "已打开终端，请手工复制命令。");
      } catch (error) {
        ElMessage.error(error.message || "打开终端失败");
      }
    }

    async function loadOnus() {
      state.loading.onus = true;
      try {
        const matchedPort = applyAddressSearchToPon();
        if (matchedPort) await switchOltForGlobalSearch(matchedPort.oltIp);
        saveFilters();
        const params = new URLSearchParams();
        if (state.filters.search.trim()) params.set("search", state.filters.search.trim());
        if (state.filters.slot.trim()) params.set("slot", state.filters.slot.trim());
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
        state.adminOlts = olts.map((olt) => ({ ...olt }));
        state.ponPorts = ponPorts;
        state.snmpHistory = history;
        state.adminEvents = events;
      } catch (error) {
        ElMessage.error(error.message);
      } finally {
        state.loading.admin = false;
      }
    }

    function setView(name) {
      state.activeView = name;
      if (name.startsWith("admin")) loadAdminData();
    }

    async function refreshCurrent() {
      if (state.activeView === "dashboard") return loadStatus();
      if (state.activeView === "install") return loadInstallOnus();
      if (state.activeView === "onus") return loadOnus();
      return loadAdminData();
    }

    async function handleOltChange() {
      restoreFilters();
      await Promise.all([loadStatus(), loadInstallOnus(), loadOnus()]);
    }

    function queryAddressSuggestions(queryString, callback) {
      const keyword = String(queryString || "").trim().toLowerCase();
      const values = state.ponPorts
        .filter((port) => port.address && (!keyword || port.address.toLowerCase().includes(keyword)))
        .map((port) => {
          const [slot, pon] = port.ponPort.split("/");
          const olt = state.olts.find((item) => item.host === port.oltIp);
          return {
            value: `${port.address} · ${olt?.name || port.oltIp} · ${port.ponPort}`,
            address: port.address,
            oltIp: port.oltIp,
            oltId: olt?.id || "",
            slot,
            pon
          };
        })
        .sort((a, b) => a.value.localeCompare(b.value, "zh-Hans-CN"))
        .slice(0, 80);
      callback(values);
    }

    async function handleAddressSelect(item) {
      state.filters.search = item.address;
      state.filters.slot = item.slot || "";
      state.filters.pon = item.pon || "";
      await switchOltForGlobalSearch(item.oltIp);
      saveFilters();
      await loadOnus();
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
          slot: String(row.slot || ""),
          pon: String(row.pon || ""),
          onuId: String(row.onuId || ""),
          serial: String(row.serial || "")
        });
        state.onuDetail.data = await api(`/api/onu-config?${params}`);
      } catch (error) {
        ElMessage.error(error.message);
      } finally {
        state.onuDetail.loading = false;
      }
    }

    function addAdminOlt() {
      state.adminOlts.push({
        id: `olt-${Date.now()}`,
        name: "新 OLT",
        vendor: "zte",
        model: "C300",
        version: "V2.1",
        host: "",
        snmpPort: 161,
        readCommunity: "public",
        enabled: true
      });
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
          body: JSON.stringify({ olts: state.adminOlts })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "保存失败");
        state.olts = data.olts;
        state.adminOlts = data.olts.map((olt) => ({ ...olt }));
        if (!state.olts.some((olt) => olt.id === state.selectedOltId)) state.selectedOltId = state.olts[0]?.id || "";
        ElMessage.success("设备信息已保存");
      } catch (error) {
        ElMessage.error(error.message);
      } finally {
        state.loading.admin = false;
      }
    }

    function addPonPort() {
      state.ponPorts.unshift({ oltIp: selectedOlt.value.host || "", ponPort: "", outerVlan: "", address: "" });
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
            ponPort: String(port.ponPort || "").trim(),
            outerVlan: String(port.outerVlan || "").trim(),
            address: String(port.address || "").trim()
          }))
          .filter((port) => port.oltIp && port.ponPort);
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

    function exportPonPorts() {
      const blob = new Blob([JSON.stringify(state.ponPorts, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "pon-ports.json";
      link.click();
      URL.revokeObjectURL(url);
    }

    async function importPonPorts() {
      try {
        const rows = parsePonImport(state.ponImportText);
        if (!rows.length) throw new Error("没有识别到可导入的台账行");
        const response = await fetch("/api/admin/import-pon-ports", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ rows })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "导入失败");
        state.ponPorts = await fetchPonPorts();
        state.ponImportText = "";
        ElMessage.success(`已导入 ${data.count} 条`);
      } catch (error) {
        ElMessage.error(error.message);
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
      const lines = [`interface gpon-onu_1/${onu.slot}/${onu.pon}:${onu.onuId}`];
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
      await Promise.all([loadConfigTemplates(), loadStatus(), loadInstallOnus(), loadOnus()]);
    });

    return {
      state,
      dashboardMetrics,
      alertRows,
      currentConfigTemplates,
      showEthPortSelector,
      slotOptions,
      ponOptions,
      sortedOnuRows,
      onuSummary,
      onuEmptyText,
      filteredPonPorts,
      ponStats,
      phaseInfo,
      rxPowerInfo,
      setView,
      refreshCurrent,
      loadStatus,
      loadInstallOnus,
      loadConfigTemplates,
      loadOnus,
      loadAdminData,
      handleOltChange,
      queryAddressSuggestions,
      handleAddressSelect,
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
      addAdminOlt,
      deleteAdminOlt,
      saveAdminOlts,
      addPonPort,
      deletePonPort,
      savePonPorts,
      exportPonPorts,
      importPonPorts,
      refreshPonVlans,
      formatDate,
      servicePortCli,
      onuMgmtCli,
      saveFilters
    };
  }
};

createApp(App).use(ElementPlus).mount("#app");
