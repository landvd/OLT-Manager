<template>
  <section>
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
        <el-input v-model="state.ponPlaceFilter" clearable class="pon-place-filter" placeholder="按村 / 小组 / 小区筛选" />
        <span class="muted">{{ ponStats }}</span>
      </div>
      <div class="pon-batch-bar">
        <el-button size="small" type="primary" :disabled="!selectedPortCount" @click="openBatchPortPlace">批量设置归属（已选 {{ selectedPortCount }} 行）</el-button>
        <el-button size="small" :disabled="!filteredPonPorts.length" @click="selectFilteredPorts">全选当前筛选结果</el-button>
        <el-button size="small" :disabled="!selectedPortCount" @click="clearPortSelection">清除选择</el-button>
        <span class="muted">在“操作”列逐行勾选；先勾一行，再按住 Shift 勾另一行，可连续选中中间所有行。勾选后点“批量设置归属”或任意一行的“编辑”，都会一起设置。同一个口分几路（几个一级地址）给不同村 / 小区时，分别设置各行即可。</span>
      </div>
      <el-table :data="filteredPonPorts" border stripe size="small" max-height="520">
        <el-table-column label="OLT IP" min-width="160"><template #default="{ row }"><el-input v-model="row.port.oltIp" /></template></el-table-column>
        <el-table-column label="槽" width="100"><template #default="{ row }"><el-input v-model="row.port.chassis" /></template></el-table-column>
        <el-table-column label="板卡" width="100"><template #default="{ row }"><el-input v-model="row.port.board" /></template></el-table-column>
        <el-table-column label="PON" width="100"><template #default="{ row }"><el-input v-model="row.port.pon" /></template></el-table-column>
        <el-table-column label="外层 VLAN" width="140"><template #default="{ row }"><el-input v-model="row.port.outerVlan" /></template></el-table-column>
        <el-table-column label="一级地址" min-width="260"><template #default="{ row }"><el-input v-model="row.port.address" /></template></el-table-column>
        <el-table-column label="村 / 小组 / 小区" min-width="260">
          <template #default="{ row }">
            <div class="pon-place-cell">
              <template v-if="portAssignment(row.port)">
                <span>{{ portAssignment(row.port).label }}</span>
                <el-tag size="small" type="warning">手动</el-tag>
                <el-tag v-if="portSplit(row.port)" size="small" type="info" title="这个口的各行设成了不同归属（分路），口上用户按各自地址自动判断">分路</el-tag>
              </template>
              <span v-else class="muted">{{ placeText(row.port) || "—" }}</span>
              <el-button link type="primary" :disabled="!row.port.oltIp || !(row.port.board || row.port.slot) || !row.port.pon" @click="openPortPlace(row.port)">编辑</el-button>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="110" fixed="right">
          <template #default="{ row, $index }">
            <div class="pon-op-cell">
              <span class="pon-select" :title="portComplete(row.port) ? '勾选这一行（按住 Shift 连续选择）' : '先填好 OLT IP、板卡和 PON'" @mousedown="(event) => event.shiftKey && event.preventDefault()" @click.stop.prevent="togglePortSelection(row, $index, $event)">
                <el-checkbox :model-value="isPortSelected(row.port)" :disabled="!portComplete(row.port)" />
              </span>
              <el-button type="danger" link @click="deletePonPort(row.__index)">删除</el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="portPlace.visible" :title="portPlace.batch ? `批量设置 ${portPlace.rowCount} 行的归属` : '指定这一行的归属'" width="min(500px, 94vw)">
      <template v-if="portPlace.batch">
        <p class="muted">{{ batchPortText }}</p>
        <p class="muted">立即生效，不需要点“保存台账”。一个口的各行都设成同一归属时，口上所有用户（单户修正过的除外）都归到这里；各行设成不同归属（分路）时，口上用户按各自地址自动判断。</p>
      </template>
      <template v-else>
        <p class="muted">{{ portPlace.oltIp }} · {{ portPlace.board }}/{{ portPlace.pon }} · {{ portPlace.address || "（无一级地址）" }}</p>
        <p class="muted">立即生效，不需要点“保存台账”。这个口的各行都是同一归属时，口上所有用户（单户修正过的除外）都归到这里；各行不同（分路）时，口上用户按各自地址自动判断。</p>
        <p class="muted">系统自动汇总：{{ portPlace.autoText || "—" }}</p>
      </template>
      <el-form label-width="64px">
        <el-form-item label="村">
          <el-autocomplete v-model="portPlace.village" class="place-input" clearable :fetch-suggestions="suggestVillages" placeholder="例如：厚街村（可直接输入新名称）" @select="portPlace.villageGroup = ''" />
        </el-form-item>
        <el-form-item label="小组">
          <el-autocomplete v-model="portPlace.villageGroup" class="place-input" clearable :fetch-suggestions="suggestGroups" placeholder="例如：下栅（不用写“小组”，可直接输入）" />
        </el-form-item>
        <el-form-item label="小区">
          <el-autocomplete v-model="portPlace.community" class="place-input" clearable :fetch-suggestions="suggestCommunities" placeholder="例如：万科城市广场（不用写“小区”，可直接输入）" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button v-if="portPlace.assigned || portPlace.batch" :loading="portPlace.saving" @click="savePortPlace(true)">恢复自动</el-button>
        <el-button @click="portPlace.visible = false">取消</el-button>
        <el-button type="primary" :loading="portPlace.saving" @click="savePortPlace(false)">保存</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script>
import { computed, nextTick, onMounted, reactive } from "vue";
import { ElMessage } from "element-plus/es/components/message/index.mjs";
import { ElMessageBox } from "element-plus/es/components/message-box/index.mjs";
import { defaultChassisForVendor, ponCoordinateKey } from "../pon-coordinate.mjs";
import { countDuplicateAddresses } from "../main-view-state.mjs";
import { useAppContext } from "../app-context.js";
import { ponPlaceKey, ponRowPlaceKey } from "../onu-places.mjs";

// ONU 数据管理（PON 台账）。页面专属状态与操作在本组件内维护，跨页面共享部分来自 App.vue 上下文。
export default {
  name: "PonPortAdminView",
  setup() {
    const ctx = useAppContext();
    const { currentPonPorts, fetchPonPorts, fieldRepairApi, ponAdminApi, ponPortFilterState, resourceManagementApi, selectedOlt, state } = ctx;

    // 每一行（口 + 一级地址）的归属（ADR-087）：手动指定的行显示指定值，其余显示该口由合并台账自动汇总的名称。
    const addressKey = (port) => String(port?.address || "").replace(/\s+/g, "");
    function portAssignment(port) {
      return state.ponPlaces?.[ponPlaceKey(port)]?.rows?.[addressKey(port)] || null;
    }

    function portSplit(port) {
      return Boolean(state.ponPlaces?.[ponPlaceKey(port)]?.split);
    }

    function placeText(port) {
      return portAssignment(port)?.label || state.ponPlaces?.[ponPlaceKey(port)]?.text || "";
    }

    async function loadPonPlaces() {
      try {
        state.ponPlaces = (await fieldRepairApi.placePonSummary()).ports || {};
      } catch {
        // 归属汇总读取失败不影响台账编辑。
      }
    }

    // 多选：逐行记录（口 + 一级地址）。Shift 点击按当前筛选后的顺序连续选择。
    const portSelection = reactive({ keys: {}, lastIndex: -1 });
    const portOf = (port) => ({ oltIp: String(port.oltIp || "").trim(), board: String(port.board || port.slot || "").trim(), pon: String(port.pon || "").trim(), address: String(port.address || "").trim() });
    const portComplete = (port) => Boolean(port.oltIp && (port.board || port.slot) && port.pon);
    const isPortSelected = (port) => Boolean(portSelection.keys[ponRowPlaceKey(port)]);
    // 按实际勾上的台账行计数：一级地址完全相同的重复行算同一处，但都会被勾上。
    const selectedPortCount = computed(() => (state.ponPorts || []).filter((port) => isPortSelected(port)).length);

    function setPortSelected(port, selected) {
      if (!portComplete(port)) return;
      const key = ponRowPlaceKey(port);
      if (selected) portSelection.keys[key] = portOf(port);
      else delete portSelection.keys[key];
    }

    function togglePortSelection(row, index, event) {
      if (!portComplete(row.port)) return;
      const rows = filteredPonPorts.value;
      const target = !isPortSelected(row.port);
      if (event?.shiftKey && portSelection.lastIndex >= 0 && portSelection.lastIndex < rows.length) {
        const [from, to] = [portSelection.lastIndex, index].sort((left, right) => left - right);
        for (let current = from; current <= to; current += 1) setPortSelected(rows[current].port, true);
      } else {
        setPortSelected(row.port, target);
      }
      portSelection.lastIndex = index;
    }

    function selectFilteredPorts() {
      for (const row of filteredPonPorts.value) setPortSelected(row.port, true);
    }

    function clearPortSelection() {
      portSelection.keys = {};
      portSelection.lastIndex = -1;
    }

    const portPlace = reactive({
      batch: false, ports: [], rowCount: 0,
      visible: false, saving: false, assigned: false, oltIp: "", board: "", pon: "", address: "", autoText: "",
      village: "", villageGroup: "", community: "", options: { villages: [], communities: [] }
    });
    const portGroupOptions = computed(() => portPlace.options.villages.find((item) => item.village === portPlace.village)?.groups || []);
    // 输入框可直接填新名称（不需要回车确认），下拉只是已有名称的提示。
    const suggestFrom = (names) => (query, callback) => {
      const keyword = String(query || "").trim();
      callback(names().filter((name) => !keyword || name.includes(keyword)).slice(0, 50).map((value) => ({ value })));
    };
    const suggestVillages = suggestFrom(() => portPlace.options.villages.map((item) => item.village));
    const suggestGroups = suggestFrom(() => portGroupOptions.value.map((item) => item.name));
    const suggestCommunities = suggestFrom(() => portPlace.options.communities.map((item) => item.name));

    const batchPortText = computed(() => {
      const names = portPlace.ports.map((port) => `${port.board}/${port.pon} ${port.address || "（无一级地址）"}`);
      const ports = new Set(portPlace.ports.map((port) => `${port.oltIp}|${port.board}|${port.pon}`)).size;
      return `${ports} 个口：${names.length > 6 ? `${names.slice(0, 6).join("、")} 等 ${names.length} 行` : names.join("、")}`;
    });

    async function loadPlaceOptions() {
      try {
        const data = await fieldRepairApi.placeSummary();
        portPlace.options = { villages: data.villages || [], communities: data.communities || [] };
      } catch {
        // 下拉选项读取失败时仍可直接输入。
      }
    }

    async function openBatchPortPlace() {
      Object.assign(portPlace, {
        batch: true,
        ports: Object.values(portSelection.keys),
        rowCount: selectedPortCount.value,
        visible: true,
        assigned: false,
        village: "",
        villageGroup: "",
        community: ""
      });
      await loadPlaceOptions();
    }

    async function openPortPlace(port) {
      // 已经勾选了行时，点任意一行的“编辑”都按批量处理（已勾选的行 + 这一行），避免只改了点的那一行。
      if (selectedPortCount.value > 0) {
        setPortSelected(port, true);
        await openBatchPortPlace();
        return;
      }
      const summary = state.ponPlaces?.[ponPlaceKey(port)] || {};
      const assigned = portAssignment(port);
      Object.assign(portPlace, {
        batch: false,
        ports: [],
        visible: true,
        assigned: Boolean(assigned),
        oltIp: String(port.oltIp || "").trim(),
        board: String(port.board || port.slot || "").trim(),
        pon: String(port.pon || "").trim(),
        address: String(port.address || "").trim(),
        autoText: summary.text || "",
        village: assigned?.village || "",
        villageGroup: assigned?.villageGroup || "",
        community: assigned?.community || ""
      });
      await loadPlaceOptions();
    }

    async function savePortPlace(clear) {
      portPlace.saving = true;
      try {
        const values = clear ? { village: "", villageGroup: "", community: "" } : { village: portPlace.village, villageGroup: portPlace.villageGroup, community: portPlace.community };
        if (portPlace.batch) {
          if (clear) await ElMessageBox.confirm(`把这 ${portPlace.rowCount} 行全部恢复自动？`, "恢复自动", { type: "warning" });
          const data = await fieldRepairApi.savePortPlaces({ ports: portPlace.ports, ...values });
          portPlace.visible = false;
          clearPortSelection();
          await loadPonPlaces();
          ElMessage.success(data.cleared
            ? `${portPlace.rowCount} 行已恢复自动，重新计算了 ${data.changed || 0} 户`
            : `${portPlace.rowCount} 行已设为 ${data.label}，重新计算了 ${data.changed || 0} 户`);
          return;
        }
        const data = await fieldRepairApi.savePortPlace({ oltIp: portPlace.oltIp, board: portPlace.board, pon: portPlace.pon, address: portPlace.address, ...values });
        portPlace.visible = false;
        clearPortSelection();
        await loadPonPlaces();
        ElMessage.success(data.assignment ? `已指定为 ${data.assignment.label}，重新计算了 ${data.changed || 0} 户` : `已恢复自动，重新计算了 ${data.changed || 0} 户`);
      } catch (error) {
        if (error !== "cancel" && error !== "close") ElMessage.error(error.message || "保存失败");
      } finally {
        portPlace.saving = false;
      }
    }

    const filteredPonPorts = computed(() => {
      const rows = ponPortFilterState.rows({
        ponPorts: state.ponPorts,
        keyword: state.ponAdminSearch,
        selectedHost: selectedOlt.value.host || ""
      });
      const place = String(state.ponPlaceFilter || "").replace(/\s+/g, "");
      return place ? rows.filter((row) => placeText(row.port).replace(/\s+/g, "").includes(place)) : rows;
    });

    onMounted(loadPonPlaces);

    const ponStats = computed(() => {
      const duplicateCount = countDuplicateAddresses(currentPonPorts.value);
      const emptyCount = currentPonPorts.value.filter((port) => !port.address).length;
      return `显示 ${filteredPonPorts.value.length} 条 / 当前 OLT 共 ${currentPonPorts.value.length} 条 · 全部 ${state.ponPorts.length} 条 · 重复地址 ${duplicateCount} 个 · 空地址 ${emptyCount} 条`;
    });

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

    async function deletePonPort(index) {
      const port = state.ponPorts[Number(index)];
      if (!port) return;
      const label = `${port.oltIp || ""} ${port.ponPort || ""} ${port.address || ""}`.trim();
      try {
        await ElMessageBox.confirm(`确认删除这条 PON 台账？\n${label}`, "删除确认", { type: "warning" });
        state.ponPorts.splice(Number(index), 1);
      } catch {}
    }

    async function savePonPorts({ force = false } = {}) {
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
        const data = await ponAdminApi.save(rows, "保存失败", { baseRevision: force ? "" : state.ponPortsRevision || "" });
        state.ponPorts = await fetchPonPorts();
        ponPortFilterState.reset(state.ponPorts);
        ElMessage.success(`已保存 ${data.count} 条`);
      } catch (error) {
        if (error.code === "PON_LEDGER_CHANGED") {
          state.loading.admin = false;
          await resolveLedgerConflict(error.message);
          return;
        }
        ElMessage.error(error.message);
      } finally {
        state.loading.admin = false;
      }
    }

    // 台账被别处改过：默认放弃本页修改并刷新；确实要以本页为准时才整表覆盖。
    async function resolveLedgerConflict(message) {
      try {
        await ElMessageBox.confirm(`${message}\n\n建议先刷新，看到最新内容后再改。确实要以本页内容为准，可以选“仍然覆盖保存”。`, "台账已被修改", {
          type: "warning",
          confirmButtonText: "刷新台账（放弃本页修改）",
          cancelButtonText: "仍然覆盖保存",
          distinguishCancelAndClose: true
        });
        state.ponPorts = await fetchPonPorts();
        ponPortFilterState.reset(state.ponPorts);
        await loadPonPlaces();
        ElMessage.success("已刷新为最新台账");
      } catch (action) {
        if (action === "cancel") await savePonPorts({ force: true });
      }
    }

    function triggerExcelImport() {
      document.getElementById("pon-excel-input")?.click();
    }

    return { ...ctx, placeText, portAssignment, portSplit, portPlace, portGroupOptions, suggestVillages, suggestGroups, suggestCommunities, openPortPlace, savePortPlace, filteredPonPorts,
      portComplete, isPortSelected, selectedPortCount, togglePortSelection, selectFilteredPorts, clearPortSelection, openBatchPortPlace, batchPortText, ponStats, syncResourceVlans, addPonPort, deletePonPort, savePonPorts, triggerExcelImport };
  }
};
</script>
