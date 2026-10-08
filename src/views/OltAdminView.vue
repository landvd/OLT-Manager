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
      <el-table :data="state.adminOlts" border stripe size="small" empty-text="暂无 OLT，点击“新增 OLT”添加">
        <el-table-column label="启用" width="70" align="center">
          <template #default="{ row }"><el-switch v-model="row.enabled" size="small" /></template>
        </el-table-column>
        <el-table-column prop="name" label="名称" min-width="200" show-overflow-tooltip />
        <el-table-column label="厂商 / 型号" width="150">
          <template #default="{ row }">{{ row.vendor === "huawei" ? "华为" : "中兴" }} · {{ adminProfileLabel(row) }}</template>
        </el-table-column>
        <el-table-column prop="version" label="版本" width="150" show-overflow-tooltip />
        <el-table-column prop="host" label="IP" width="140" />
        <el-table-column label="SNMP / Telnet 端口" width="160">
          <template #default="{ row }">{{ row.snmpPort }} / {{ row.telnetPort }}</template>
        </el-table-column>
        <el-table-column label="Telnet 用户" width="120" show-overflow-tooltip>
          <template #default="{ row }">{{ row.telnetUsername || "保持原值" }}</template>
        </el-table-column>
        <el-table-column label="操作" width="110" fixed="right">
          <template #default="{ row, $index }">
            <el-button type="primary" link @click="openOltEditor(row)">编辑</el-button>
            <el-button type="danger" link @click="deleteAdminOlt($index)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <p class="muted olt-admin-hint">编辑或新增后请点击右上角“保存设备”写入本机数据库；Community、Telnet 密码留空表示保持原值。</p>
    </el-card>

    <el-dialog v-model="oltEditor.visible" :title="oltEditor.isNew ? '新增 OLT' : '编辑 OLT'" width="620px" destroy-on-close>
      <el-form v-if="oltEditor.draft" label-width="110px" class="olt-editor-form">
        <el-form-item label="启用"><el-switch v-model="oltEditor.draft.enabled" /></el-form-item>
        <el-form-item label="名称"><el-input v-model="oltEditor.draft.name" /></el-form-item>
        <el-form-item label="厂商">
          <el-select v-model="oltEditor.draft.vendor" @change="handleAdminVendorChange(oltEditor.draft)">
            <el-option label="中兴" value="zte" />
            <el-option label="华为" value="huawei" />
          </el-select>
        </el-form-item>
        <el-form-item label="型号">
          <el-select v-model="oltEditor.draft.deviceProfile" @change="handleAdminProfileChange(oltEditor.draft)">
            <el-option v-for="profile in adminProfilesForVendor(oltEditor.draft.vendor)" :key="profile.id" :label="profile.label" :value="profile.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="版本"><el-input v-model="oltEditor.draft.version" /></el-form-item>
        <el-form-item label="IP"><el-input v-model="oltEditor.draft.host" placeholder="例如 172.19.104.98" /></el-form-item>
        <el-form-item label="SNMP 端口"><el-input-number v-model="oltEditor.draft.snmpPort" :min="1" :max="65535" controls-position="right" /></el-form-item>
        <el-form-item label="Community"><el-input v-model="oltEditor.draft.readCommunity" placeholder="留空保持原值" show-password /></el-form-item>
        <el-form-item label="Telnet 端口"><el-input-number v-model="oltEditor.draft.telnetPort" :min="1" :max="65535" controls-position="right" /></el-form-item>
        <el-form-item label="Telnet 用户"><el-input v-model="oltEditor.draft.telnetUsername" placeholder="留空保持原值" /></el-form-item>
        <el-form-item label="Telnet 密码"><el-input v-model="oltEditor.draft.telnetPassword" placeholder="留空保持原值" show-password /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="cancelOltEditor">取消</el-button>
        <el-button type="primary" @click="confirmOltEditor">确定</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script>
import { reactive } from "vue";
import { ElMessage } from "element-plus/es/components/message/index.mjs";
import { defaultProfileForVendor, profilesForVendor } from "../device-profiles.mjs";
import { useAppContext } from "../app-context.js";

// OLT 设备管理。页面专属状态与操作在本组件内维护，跨页面共享部分来自 App.vue 上下文。
export default {
  name: "OltAdminView",
  setup() {
    const ctx = useAppContext();
    const { normalizeAdminOltRow, oltAdminApi, state } = ctx;

    // 编辑对话框改的是副本，点“确定”才写回列表；“保存设备”仍统一写入数据库。
    const oltEditor = reactive({ visible: false, isNew: false, target: null, draft: null });

    function openOltEditor(row, { isNew = false } = {}) {
      oltEditor.target = row;
      oltEditor.isNew = isNew;
      oltEditor.draft = { ...row };
      oltEditor.visible = true;
    }

    function confirmOltEditor() {
      if (!String(oltEditor.draft?.host || "").trim()) {
        ElMessage.warning("请填写 OLT 的 IP 地址");
        return;
      }
      Object.assign(oltEditor.target, oltEditor.draft);
      oltEditor.visible = false;
    }

    function cancelOltEditor() {
      // 新增后直接取消，则移除这条空白记录
      if (oltEditor.isNew) {
        const index = state.adminOlts.indexOf(oltEditor.target);
        if (index >= 0) state.adminOlts.splice(index, 1);
      }
      oltEditor.visible = false;
    }

    function adminProfileLabel(row) {
      return profilesForVendor(row.vendor).find((profile) => profile.id === row.deviceProfile)?.model || row.model || "";
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
      openOltEditor(state.adminOlts[state.adminOlts.length - 1], { isNew: true });
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

    return { ...ctx, oltEditor, openOltEditor, confirmOltEditor, cancelOltEditor, adminProfileLabel, addAdminOlt, adminProfilesForVendor, deleteAdminOlt, saveAdminOlts };
  }
};
</script>
