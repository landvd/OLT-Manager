<template>
  <el-dialog
    v-model="state.oltAlertsDialog.visible"
    width="780px"
    destroy-on-close
    class="olt-alerts-modal"
  >
    <template #header>
      <div style="display: flex; align-items: center; justify-content: space-between; padding-right: 24px;">
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 16px; font-weight: 700; color: #0f172a;">
            ⚠️ PON 业务端口预警与弱光排查
          </span>
          <el-tag size="small" type="danger" effect="plain">
            {{ (state.oltAlertsDialog.ports || []).length }} 个端口需排查
          </el-tag>
        </div>
        <div v-if="state.oltAlertsDialog.olt" style="font-size: 13px; color: #475569; font-family: var(--app-font-mono); font-weight: 600;">
          设备 IP: {{ state.oltAlertsDialog.olt.host }} ({{ state.oltAlertsDialog.olt.model }})
        </div>
      </div>
    </template>

    <div v-if="state.oltAlertsDialog.ports && state.oltAlertsDialog.ports.length > 0" class="alerts-dialog-body">
      <div
        v-for="port in state.oltAlertsDialog.ports"
        :key="port.id"
        :class="['alert-port-dialog-card', port.tagType === 'warning' ? 'warning' : '']"
      >
        <div class="alert-port-dialog-header">
          <div class="port-name-wrap" style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            <span class="port-coord-tag" style="font-family: var(--app-font-mono); font-size: 14px; font-weight: 700; background: #f8fafc; color: #0f172a;">
              {{ port.fullPortDisplay || (port.oltIp + '/' + port.ponPort) }}
            </span>
            <span style="font-size: 12px; font-weight: 600; color: #0284c7; background: #f0f9ff; padding: 2px 8px; border-radius: 4px; border: 1px solid #bae6fd;">
              📦 一级箱: {{ port.primaryBoxAddress || port.primaryArea }}
            </span>
            <el-tag :type="port.tagType" size="small" effect="plain">
              {{ port.issueLabel }}
            </el-tag>
          </div>
          <span class="port-metric-val" style="font-size: 13px; font-weight: 700; color: #dc2626;">
            {{ port.metricValue }}
          </span>
        </div>

        <div class="alert-port-dialog-content">
          <div class="alert-port-detail-text">
            {{ port.detail }}
          </div>
          <el-button
            type="primary"
            size="small"
            @click="openWeakUsersDialog(port)"
          >
            显示弱光详情 →
          </el-button>
        </div>
      </div>
    </div>
    <el-empty
      v-else
      description="该设备下所有 PON 端口运行指标优良，无重点预警口！"
      :image-size="70"
    />

    <template #footer>
      <div style="display: flex; justify-content: flex-end;">
        <el-button @click="state.oltAlertsDialog.visible = false">关闭</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script>
import { useAppContext } from "../app-context.js";

// OLT 告警明细。页面专属状态与操作在本组件内维护，跨页面共享部分来自 App.vue 上下文。
export default {
  name: "OltAlertsDialog",
  setup() {
    const ctx = useAppContext();
    const { state } = ctx;

    function openWeakUsersDialog(port) {
      if (!port) return;
      state.weakUsersDialog.ponPort = port.ponPort || "";
      state.weakUsersDialog.fullPortDisplay = port.fullPortDisplay || (port.oltIp ? `${port.oltIp}/${port.ponPort}` : "");
      state.weakUsersDialog.primaryBoxAddress = port.primaryBoxAddress || port.primaryArea || "未配置一级箱";
      state.weakUsersDialog.primaryArea = state.weakUsersDialog.primaryBoxAddress;
      state.weakUsersDialog.oltIp = port.oltIp || "";
      state.weakUsersDialog.users = port.weakUsers || [];
      state.weakUsersDialog.visible = true;
    }

    return { ...ctx, openWeakUsersDialog };
  }
};
</script>
