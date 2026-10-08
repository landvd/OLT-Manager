<template>
  <section>
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
</template>

<script>
import { computed } from "vue";
import { localAuthClient } from "../renderer-services.js";
import { ElMessage } from "element-plus/es/components/message/index.mjs";
import { ElMessageBox } from "element-plus/es/components/message-box/index.mjs";
import { defaultChassisForVendor, onuCoordinateLabel } from "../pon-coordinate.mjs";
import { sortOnuRows } from "../onu-list-state.mjs";
import { uniqueSorted, buildOnuConfigTerminalCommands } from "../main-view-state.mjs";
import { onuEmptyTextFor, onuSummaryFor } from "../dashboard-view-state.mjs";
import { useAppContext } from "../app-context.js";

// ONU 数据查询。页面专属状态与操作在本组件内维护，跨页面共享部分来自 App.vue 上下文。
export default {
  name: "OnuQueryView",
  setup() {
    const ctx = useAppContext();
    const { applyOssResourceConfig, currentPonPorts, fetchProjects, loadOnus, onuApi, onuGroupCounts, ossResourceApi, saveFilters, selectedOlt, sendTerminalInput, state, switchOltForGlobalSearch } = ctx;

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

    const onuSummary = computed(() => onuSummaryFor(onuGroupCounts.value));

    const sortedOnuRows = computed(() => sortOnuRows(state.onuRows, state.sort));

    const onuEmptyText = computed(() => onuEmptyTextFor(state.filters));

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

    async function loadOssResourceConfig() {
      const config = await ossResourceApi.config();
      applyOssResourceConfig(config);
      return config;
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

    return { ...ctx, chassisOptions, slotOptions, ponOptions, onuSummary, sortedOnuRows, onuEmptyText, ensureProjectsLoaded, addOnuToProject, queryAddressSuggestions, handleAddressSelect, handleChassisChange, handleSlotChange, handleOnuSort, openOnuConfig, openOnuDetail };
  }
};
</script>
