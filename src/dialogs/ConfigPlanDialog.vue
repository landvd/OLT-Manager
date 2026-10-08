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
          <span style="font-family: var(--app-font-mono); font-weight: 700;">{{ activePlanOlt?.host || state.configPlan.row.oltHost || '-' }}</span>
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
            <el-button size="small" type="info" plain @click="jumpToTemplateEditor(state.configPlan.templateId)"><el-icon class="inline-icon"><Edit /></el-icon>编辑方案</el-button>
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
import { computed } from "vue";
import { ElMessage } from "element-plus/es/components/message/index.mjs";
import { useAppContext } from "../app-context.js";

// 配置方案预览。页面专属状态与操作在本组件内维护，跨页面共享部分来自 App.vue 上下文。
export default {
  name: "ConfigPlanDialog",
  setup() {
    const ctx = useAppContext();
    const { activePlanOlt, copyText, currentConfigTemplate, currentEthPortOptions, selectTemplate, setView, state } = ctx;

    const configPlanDialogTitle = computed(() => {
      const olt = activePlanOlt.value;
      const vendorName = olt?.vendor === "huawei" ? "华为" : "中兴";
      const host = olt?.host ? ` ${olt.host}` : "";
      const model = olt?.model ? ` (${olt.model})` : "";
      return `未注册 ONU 配置方案 - ${vendorName}${host}${model}`;
    });

    const selectedProjectTemplate = computed(() => currentConfigTemplate.value.projectId ? currentConfigTemplate.value : null);

    const showEthPortSelector = computed(() => {
      if (state.configPlan.templateId === "zte-mdu-ott") return false;
      const cmd = currentConfigTemplate.value.commandTemplate || "";
      return cmd.includes("{{ethPort}}") || currentEthPortOptions.value.length > 0;
    });

    const showCustomVlanInput = computed(() => currentConfigTemplate.value.businessType === "custom-vlan");

    const cleanConfigPlanVariables = computed(() => {
      const vars = state.configPlan.result?.variables || {};
      const ignoredKeys = new Set(["sampleOnuId", "snAuthSerial", "slot"]);
      const result = {};
      for (const [key, value] of Object.entries(vars)) {
        if (ignoredKeys.has(key)) continue;
        if (key.startsWith("port1_") || key.startsWith("port2_") || key.startsWith("port3_") || key.startsWith("port4_")) continue;
        if (value === "" || value === null || value === undefined) continue;
        if (Array.isArray(value) && value.length === 0) continue;
        result[key] = value;
      }
      return result;
    });

    function jumpToTemplateEditor(templateId) {
      state.configPlan.visible = false;
      setView("configTemplates");
      if (templateId) {
        const found = (state.templateEditor.templates || []).find((t) => t.id === templateId);
        if (found) selectTemplate(found);
      }
    }

    function configPlanVariableLabel(key) {
      return {
        slot: "板卡",
        chassis: "槽/框",
        board: "板卡",
        pon: "PON口",
        serial: "序列号",
        onuId: "终端ID",
        innerVlan: "内层VLAN",
        outerVlan: "外层VLAN",
        ottVlan: "互动VLAN",
        liveVlan: "直播VLAN",
        defaultVlan: "默认下发VLAN",
        intranetVlan: "内网VLAN",
        lastOnuId: "最后终端ID",
        suggestedOnuId: "候选ONT ID",
        ledgerOuterVlan: "外层VLAN",
        sampleOnuId: "范例ID",
        ethPort: "物理端口",
        ethPorts: "已选端口",
        customVlan: "自定义VLAN",
        actualOntId: "自动ONT ID",
        address: "安装地址",
        boxAddress: "分纤箱地址",
        projectId: "项目ID",
        projectName: "项目名称",
        projectVlan: "项目VLAN"
      }[key] || key;
    }

    function formatEthPortLabel(port) {
      if (currentConfigTemplate.value.portRules?.labels?.[port]) {
        return currentConfigTemplate.value.portRules.labels[port];
      }
      const map = {
        "eth_0/1": "网口1 (eth_0/1)",
        "eth_0/2": "网口2 (eth_0/2)",
        "eth_0/3": "网口3 (eth_0/3)",
        "eth_0/4": "网口4 (eth_0/4)",
        "veip_1": "VEIP (veip_1)",
        "eth 1": "网口1 (eth 1)",
        "eth 2": "网口2 (eth 2)",
        "eth 3": "网口3 (eth 3)",
        "eth 4": "网口4 (eth 4)",
        "eth1": "网口1 (eth1)",
        "eth2": "网口2 (eth2)",
        "eth3": "网口3 (eth3)",
        "eth4": "网口4 (eth4)"
      };
      return map[port] || port;
    }

    function formatConfigPlanVariable(key, value) {
      if ((key === "ethPorts" || key === "ethPort") && Array.isArray(value)) return value.map(formatEthPortLabel).join(", ");
      if (key === "ethPort" && typeof value === "string") return formatEthPortLabel(value);
      if (Array.isArray(value)) return value.join(", ");
      return value || "-";
    }

    async function openTerminalForConfigPlan() {
      const commands = state.configPlan.result?.commands || "";
      if (!commands) return;
      if (activePlanOlt.value?.id && activePlanOlt.value.id !== state.selectedOltId) {
        state.selectedOltId = activePlanOlt.value.id;
      }
      const copied = await copyText(commands);
      if (!window.oltManagerDesktop?.terminal) {
        ElMessage.warning(copied ? "命令已复制。内置 Telnet 终端仅桌面版支持。" : "内置 Telnet 终端仅桌面版支持，请手工复制命令。");
        return;
      }
      state.terminal.status = copied ? "配置命令已复制，正在打开内置终端..." : "正在打开内置终端，请稍后手工复制配置命令...";
      state.terminal.visible = true;
    }

    return { ...ctx, configPlanDialogTitle, selectedProjectTemplate, showEthPortSelector, showCustomVlanInput, cleanConfigPlanVariables, jumpToTemplateEditor, configPlanVariableLabel, formatEthPortLabel, formatConfigPlanVariable, openTerminalForConfigPlan };
  }
};
</script>
