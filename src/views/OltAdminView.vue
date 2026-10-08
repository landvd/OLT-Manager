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
import { ElMessage } from "element-plus/es/components/message/index.mjs";
import { defaultProfileForVendor, profilesForVendor } from "../device-profiles.mjs";
import { useAppContext } from "../app-context.js";

// OLT 设备管理。页面专属状态与操作在本组件内维护，跨页面共享部分来自 App.vue 上下文。
export default {
  name: "OltAdminView",
  setup() {
    const ctx = useAppContext();
    const { normalizeAdminOltRow, oltAdminApi, state } = ctx;

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

    return { ...ctx, addAdminOlt, adminProfilesForVendor, deleteAdminOlt, saveAdminOlts };
  }
};
</script>
