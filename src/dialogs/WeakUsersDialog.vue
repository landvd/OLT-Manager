<template>
  <el-dialog
    v-model="state.weakUsersDialog.visible"
    width="1060px"
    destroy-on-close
    class="weak-users-modal"
  >
    <template #header>
      <div style="display: flex; align-items: center; justify-content: space-between; padding-right: 24px;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 16px; font-weight: 700; color: #0f172a;">
            <el-icon class="inline-icon"><Search /></el-icon>PON 口 [{{ state.weakUsersDialog.fullPortDisplay || state.weakUsersDialog.ponPort }} · 一级箱: {{ state.weakUsersDialog.primaryBoxAddress || state.weakUsersDialog.primaryArea }}] 弱光用户资料与实时光功率
          </span>
          <el-tag size="small" type="danger" effect="plain">
            {{ (state.weakUsersDialog.users || []).length }} 户弱光
          </el-tag>
        </div>
        <div style="font-size: 12px; color: #64748b; font-family: var(--app-font-mono);">
          {{ state.weakUsersDialog.oltIp }}
        </div>
      </div>
    </template>

    <div class="weak-user-table-wrap">
      <el-table
        :data="state.weakUsersDialog.users"
        border
        stripe
        size="small"
        empty-text="该 PON 口下暂无弱光用户记录"
      >
        <el-table-column type="index" label="序号" width="55" align="center" />
        <el-table-column label="ONU 物理坐标" width="130" align="center" prop="onuIndex" />
        <el-table-column label="用户姓名" width="110" align="center" prop="username" />
        <el-table-column label="认证 LOID" width="150" align="center">
          <template #default="{ row }">
            <code style="font-size: 12px;">{{ row.loid }}</code>
          </template>
        </el-table-column>
        <el-table-column label="接收光功率" width="110" align="center">
          <template #default="{ row }">
            <span style="font-weight: 700; color: #dc2626;">{{ row.rxPower }}</span>
          </template>
        </el-table-column>
        <el-table-column label="在线状态" width="80" align="center">
          <template #default="{ row }">
            <el-tag :type="row.phase === '离线' ? 'info' : 'success'" size="small">
              {{ row.phase }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="安装门牌地址" min-width="320">
          <template #default="{ row }">
            <span style="font-weight: 500; color: #1e293b;">{{ row.address || '未登记地址' }}</span>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <template #footer>
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <el-button
          type="success"
          plain
          size="small"
          @click="copyWeakUsersText"
        >
          <el-icon class="inline-icon"><CopyDocument /></el-icon>复制全部弱光用户
        </el-button>
        <el-button @click="state.weakUsersDialog.visible = false">关闭</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script>
import { ElMessage } from "element-plus/es/components/message/index.mjs";
import { useAppContext } from "../app-context.js";

// 弱光用户明细。页面专属状态与操作在本组件内维护，跨页面共享部分来自 App.vue 上下文。
export default {
  name: "WeakUsersDialog",
  setup() {
    const ctx = useAppContext();
    const { copyText, state } = ctx;

    async function copyWeakUsersText() {
      const users = state.weakUsersDialog.users || [];
      if (!users.length) {
        ElMessage.warning("暂无弱光用户资料");
        return;
      }
      const portName = state.weakUsersDialog.fullPortDisplay || state.weakUsersDialog.ponPort;
      const boxAddr = state.weakUsersDialog.primaryBoxAddress || state.weakUsersDialog.primaryArea || "未配置一级箱";
      const lines = [
        `【PON 业务端口 ${portName} (${boxAddr}) 弱光用户整改清单 (共 ${users.length} 户)】`,
        `所属设备 IP: ${state.weakUsersDialog.oltIp}`,
        `一级箱物理地址: ${boxAddr}`,
        `---------------------------------------------`
      ];
      users.forEach((u, i) => {
        lines.push(`${i + 1}. [${u.onuIndex}] ${u.username} (LOID: ${u.loid}) - 光功率: ${u.rxPower} - 状态: ${u.phase} - 安装地址: ${u.address}`);
      });
      const ok = await copyText(lines.join("\n"));
      if (ok) {
        ElMessage.success("已复制全部弱光用户资料至剪贴板");
      }
    }

    return { ...ctx, copyWeakUsersText };
  }
};
</script>
