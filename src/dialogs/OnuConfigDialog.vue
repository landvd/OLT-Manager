<template>
  <el-dialog
    v-model="state.onuConfig.visible"
    title="ONU 已配置数据"
    width="760px"
    destroy-on-close
  >
    <div v-loading="state.onuConfig.loading">
      <el-empty v-if="!state.onuConfig.data" description="请选择 ONU 序列号查看配置" />
      <div v-else class="onu-detail">
        <el-descriptions title="基础信息" :column="2" border class="detail-block">
          <el-descriptions-item label="OLT">{{ state.onuConfig.data.olt.name }}</el-descriptions-item>
          <el-descriptions-item label="厂商型号">{{ state.onuConfig.data.olt.vendor }} {{ state.onuConfig.data.olt.model }}</el-descriptions-item>
          <el-descriptions-item label="槽/板卡/PON/ID">
            {{ onuCoordinateLabel(state.onuConfig.data.onu) }}
          </el-descriptions-item>
          <el-descriptions-item label="ONU 序列号">{{ state.onuConfig.data.onu.serial }}</el-descriptions-item>
          <el-descriptions-item label="一级地址">{{ state.onuConfig.data.onu.address || "未登记" }}</el-descriptions-item>
          <el-descriptions-item label="外层 VLAN">{{ state.onuConfig.data.onu.outerVlan || "待补充" }}</el-descriptions-item>
        </el-descriptions>

        <el-card v-if="state.onuConfig.data.servicePorts?.length || state.onuConfig.data.cliConfig?.runningConfig" shadow="never" class="detail-block">
          <template #header>已验证业务 VLAN</template>
          <pre class="command-template terminal-block">{{ servicePortCli(state.onuConfig.data) }}</pre>
        </el-card>

        <el-card v-if="state.onuConfig.data.cliConfig?.onuRunningConfig" shadow="never" class="detail-block">
          <template #header>ONU 已配置数据</template>
          <el-alert
            :title="'数据来源：' + (state.onuConfig.data.cliConfig?.source || '只读采集') + '。'"
            type="info"
            :closable="false"
            show-icon
            class="detail-note"
          />
          <pre class="command-template terminal-block">{{ onuMgmtCli(state.onuConfig.data) }}</pre>
        </el-card>

        <el-alert
          v-else-if="state.onuConfig.data.cliConfig?.error"
          :title="'ONU 已配置数据读取失败：' + state.onuConfig.data.cliConfig.error"
          type="warning"
          :closable="false"
          show-icon
          class="detail-block"
        />
      </div>
    </div>
  </el-dialog>
</template>

<script>
import { useAppContext } from "../app-context.js";

// ONU 已配置数据。状态与操作仍由 App.vue 统一提供，后续逐步迁入本组件。
export default {
  name: "OnuConfigDialog",
  setup() {
    return useAppContext();
  }
};
</script>
