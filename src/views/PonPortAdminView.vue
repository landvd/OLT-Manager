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
</template>

<script>
import { useAppContext } from "../app-context.js";

// ONU 数据管理（PON 台账）。状态与操作仍由 App.vue 统一提供，后续逐步迁入本组件。
export default {
  name: "PonPortAdminView",
  setup() {
    return useAppContext();
  }
};
</script>
