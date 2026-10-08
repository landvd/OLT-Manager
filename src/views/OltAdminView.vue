<template>
  <section>
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
</template>

<script>
import { useAppContext } from "../app-context.js";

// OLT 设备管理。状态与操作仍由 App.vue 统一提供，后续逐步迁入本组件。
export default {
  name: "OltAdminView",
  setup() {
    return useAppContext();
  }
};
</script>
