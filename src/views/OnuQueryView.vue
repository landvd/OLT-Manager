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
import { useAppContext } from "../app-context.js";

// ONU 数据查询。状态与操作仍由 App.vue 统一提供，后续逐步迁入本组件。
export default {
  name: "OnuQueryView",
  setup() {
    return useAppContext();
  }
};
</script>
