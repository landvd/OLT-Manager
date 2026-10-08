<template>
  <el-dialog
    v-model="state.configPlan.visible"
    :title="configPlanDialogTitle"
    width="880px"
    destroy-on-close
  >
    <div v-if="state.configPlan.row" class="plan-dialog">
      <el-descriptions :column="4" border class="detail-block">
        <el-descriptions-item label="所属设备">
          <span style="font-family: monospace; font-weight: 700;">{{ activePlanOlt?.host || state.configPlan.row.oltHost || '-' }}</span>
          <span style="color: #64748b; margin-left: 4px;">({{ activePlanOlt?.model || state.configPlan.row.oltModel || '-' }})</span>
        </el-descriptions-item>
        <el-descriptions-item label="槽/板卡/PON">{{ ponCoordinateKey(state.configPlan.row) }}</el-descriptions-item>
        <el-descriptions-item label="序列号">{{ state.configPlan.row.serial }}</el-descriptions-item>
        <el-descriptions-item label="状态">{{ state.configPlan.row.state }}</el-descriptions-item>
      </el-descriptions>
      <el-form label-width="96px" class="plan-form">
        <el-form-item label="配置模板">
          <div style="display: flex; gap: 8px; width: 100%;">
            <el-select v-model="state.configPlan.templateId" placeholder="请选择模板" style="flex: 1;" @change="handleConfigTemplateChange">
              <el-option
                v-for="template in currentConfigTemplates"
                :key="template.id"
                :label="template.name"
                :value="template.id"
              />
            </el-select>
            <el-button size="small" type="info" plain @click="jumpToTemplateEditor(state.configPlan.templateId)">🛠 编辑方案</el-button>
          </div>
        </el-form-item>

        <el-form-item v-if="selectedProjectTemplate" label="项目模板">
          <div class="project-template-summary">
            <el-tag type="success">{{ selectedProjectTemplate.projectName }}</el-tag>
            <el-tag>VLAN {{ selectedProjectTemplate.vlan }}</el-tag>
          </div>
        </el-form-item>
        <el-form-item v-if="showEthPortSelector" label="物理端口">
          <el-checkbox-group v-model="state.configPlan.ethPorts" @change="generateConfigPlan">
            <el-checkbox-button
              v-for="port in currentEthPortOptions"
              :key="port"
              :label="port"
            >
              {{ formatEthPortLabel(port) }}
            </el-checkbox-button>
          </el-checkbox-group>
        </el-form-item>
        <el-form-item v-if="showCustomVlanInput" label="业务 VLAN">
          <el-input-number
            v-model="state.configPlan.customVlan"
            :min="1"
            :max="4094"
            controls-position="right"
            placeholder="请输入 VLAN"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="state.configPlan.loading" :disabled="!currentConfigTemplates.length" @click="generateConfigPlan">生成命令预览</el-button>
          <el-button :disabled="!state.configPlan.result?.commands" @click="copyConfigPlan">复制命令</el-button>
          <el-button :disabled="!state.configPlan.result?.commands" @click="openTerminalForConfigPlan">打开内置终端</el-button>
        </el-form-item>
        <el-alert
          v-if="configPlanUnsupportedMessage"
          :title="configPlanUnsupportedMessage"
          type="warning"
          :closable="false"
          show-icon
        />
      </el-form>
      <el-alert
        v-for="warning in state.configPlan.result?.warnings || []"
        :key="warning"
        :title="warning"
        :type="state.configPlan.result?.blocked ? 'error' : 'info'"
        :closable="false"
        show-icon
        class="detail-note"
      />
      <el-descriptions v-if="cleanConfigPlanVariables && Object.keys(cleanConfigPlanVariables).length" title="变量来源" :column="3" border class="detail-block">
        <el-descriptions-item v-for="(value, key) in cleanConfigPlanVariables" :key="key" :label="key">
          <template #label>{{ configPlanVariableLabel(key) }}</template>
          {{ formatConfigPlanVariable(key, value) }}
        </el-descriptions-item>
      </el-descriptions>
      <pre class="command-template terminal-block">{{ state.configPlan.result?.commands || "请选择模板并点击生成。" }}</pre>
    </div>
  </el-dialog>
</template>

<script>
import { useAppContext } from "../app-context.js";

// 配置方案预览。状态与操作仍由 App.vue 统一提供，后续逐步迁入本组件。
export default {
  name: "ConfigPlanDialog",
  setup() {
    return useAppContext();
  }
};
</script>
