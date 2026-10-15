<template>
  <el-dialog
    v-model="state.configPlan.visible"
    :title="configPlanDialogTitle"
    width="900px"
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
            <el-select v-model="state.configPlan.templateId" placeholder="请选择模板" filterable style="flex: 1;" @change="handleConfigTemplateChange">
              <el-option-group v-for="group in templateGroups" :key="group.label" :label="group.label">
                <el-option v-for="template in group.options" :key="template.id" :label="template.name" :value="template.id" />
              </el-option-group>
            </el-select>
            <el-button size="small" type="info" plain :disabled="!currentConfigTemplate.id" @click="openTemplateDrawer"><el-icon class="inline-icon"><Edit /></el-icon>编辑方案</el-button>
          </div>
        </el-form-item>

        <el-form-item v-if="selectedProjectTemplate" label="项目模板">
          <div class="project-template-summary">
            <el-tag type="success">{{ selectedProjectTemplate.projectName }}</el-tag>
            <el-tag>VLAN {{ selectedProjectTemplate.vlan }}</el-tag>
          </div>
        </el-form-item>
        <el-form-item v-if="showEthPortSelector" label="物理端口">
          <el-checkbox-group v-model="state.configPlan.ethPorts">
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
        <el-form-item
          v-for="param in currentConfigTemplate.inputParams || []"
          :key="param.name"
          :label="param.label || param.name"
          :required="param.required"
        >
          <el-select v-if="param.type === 'select'" v-model="state.configPlan.templateInputs[param.name]" :clearable="!param.required" style="width: 220px;">
            <el-option v-for="option in param.options" :key="option" :label="option" :value="option" />
          </el-select>
          <el-input
            v-else
            v-model="state.configPlan.templateInputs[param.name]"
            :placeholder="param.type === 'vlan' ? '1–4094' : ''"
            style="width: 220px;"
          />
        </el-form-item>
      </el-form>

      <!-- 所有提示集中在一处：不支持的型号、没填的必填参数、生成结果的提醒或拦截原因、生成出错 -->
      <el-alert v-if="planHints.items.length" :type="planHints.type" :closable="false" show-icon class="detail-note plan-hints">
        <template #title>
          <div v-for="item in planHints.items" :key="item">{{ item }}</div>
        </template>
      </el-alert>

      <div class="plan-summary-bar">
        <span class="plan-summary-text">
          <template v-if="state.configPlan.loading">正在生成…</template>
          <template v-else-if="variableSummary">{{ variableSummary }}</template>
          <template v-else>选择模板后自动生成命令预览。</template>
        </span>
        <el-button v-if="variableCount" link type="primary" @click="showAllVariables = !showAllVariables">{{ showAllVariables ? "收起变量来源" : `全部变量来源（${variableCount}）` }}</el-button>
        <span class="plan-summary-actions">
          <el-button size="small" :loading="state.configPlan.loading" :disabled="!currentConfigTemplates.length" @click="generateConfigPlan()">重新生成</el-button>
          <el-button size="small" type="primary" :disabled="!planCommands" @click="copyConfigPlan">复制命令</el-button>
          <el-button size="small" :disabled="!planCommands" @click="openTerminalForConfigPlan">打开内置终端</el-button>
        </span>
      </div>
      <el-descriptions v-if="showAllVariables && variableCount" :column="3" border class="detail-block">
        <el-descriptions-item v-for="(value, key) in cleanConfigPlanVariables" :key="key">
          <template #label>{{ configPlanVariableLabel(key) }}</template>
          {{ formatConfigPlanVariable(key, value) }}
        </el-descriptions-item>
      </el-descriptions>
      <pre class="command-template terminal-block">{{ planCommands || (state.configPlan.loading ? "正在生成…" : "没有可显示的命令，见上方提示。") }}</pre>
    </div>

    <!-- 侧边编辑模板：不离开弹窗，保存后自动重新生成 -->
    <el-drawer v-model="drawer.visible" :title="drawer.form ? `编辑方案：${drawer.form.name}` : '编辑方案'" size="min(760px, 92vw)" append-to-body destroy-on-close>
      <template v-if="drawer.form">
        <el-alert v-if="drawer.form.isBuiltin" type="info" :closable="false" show-icon class="detail-note" title="内置方案不能直接修改。复制成“我的方案”后再改，原来的内置方案保持不变。">
          <el-button size="small" type="primary" :loading="drawer.saving" style="margin-top: 6px;" @click="copyBuiltinForEdit">复制为我的方案并编辑</el-button>
        </el-alert>
        <el-form label-width="72px">
          <el-form-item label="名称">
            <el-input v-model="drawer.form.name" :disabled="drawer.form.isBuiltin" maxlength="60" />
          </el-form-item>
        </el-form>
        <TemplateCodeEditor
          v-model="drawer.form.commandTemplate"
          :readonly="drawer.form.isBuiltin"
          :variables="state.templateEditor.variables || []"
          :param-names="drawerParamNames"
          :param-labels="drawerParamLabels"
          :error-lines="drawerErrorLines"
          height="420px"
        />
        <div v-if="drawerCheck.errors.length || drawerCheck.warnings.length" class="drawer-check">
          <div v-for="item in drawerCheck.errors" :key="`e-${item.message}`" class="debug-error">✕ {{ item.message }}</div>
          <div v-for="item in drawerCheck.warnings" :key="`w-${item.message}`" class="muted">! {{ item.message }}</div>
        </div>
        <p class="muted">“生成时填写的参数”、适用型号等其它设置请到“配置方案管理”页修改。</p>
      </template>
      <template #footer>
        <el-button @click="jumpToTemplateEditor(drawer.form?.id)">到配置方案管理页</el-button>
        <el-button @click="drawer.visible = false">取消</el-button>
        <el-button type="primary" :loading="drawer.saving" :disabled="!drawer.form || drawer.form.isBuiltin || !drawerCheck.ok" @click="saveDrawerTemplate">保存并重新生成</el-button>
      </template>
    </el-drawer>
  </el-dialog>
</template>

<script>
import { computed, reactive, ref, watch } from "vue";
import { ElMessage } from "element-plus/es/components/message/index.mjs";
import { useAppContext } from "../app-context.js";
import { checkConfigTemplate } from "../config-plan-engine.mjs";
import { configPlanSummary, groupConfigTemplates } from "../config-plan-memory.mjs";
import TemplateCodeEditor from "../components/TemplateCodeEditor.vue";

const TEMPLATE_FIELDS = ["id", "name", "vendor", "deviceProfiles", "businessType", "portMode", "defaultParams", "commandTemplate", "inputParams", "remark", "isBuiltin"];

// 配置方案预览（ADR-084 第二批）：打开即生成、改参数自动刷新、分组模板下拉并记住上次、
// 变量来源收成摘要、提示集中显示、侧边编辑模板。只生成命令预览，不连接设备。
export default {
  name: "ConfigPlanDialog",
  components: { TemplateCodeEditor },
  setup() {
    const ctx = useAppContext();
    const { activePlanOlt, copyText, currentConfigTemplate, currentConfigTemplates, configPlanUnsupportedMessage, currentEthPortOptions, generateConfigPlan, loadConfigTemplates, onuApi, selectTemplate, setView, state } = ctx;
    const showAllVariables = ref(false);
    const drawer = reactive({ visible: false, saving: false, form: null });

    const configPlanDialogTitle = computed(() => {
      const olt = activePlanOlt.value;
      const vendorName = olt?.vendor === "huawei" ? "华为" : "中兴";
      const host = olt?.host ? ` ${olt.host}` : "";
      const model = olt?.model ? ` (${olt.model})` : "";
      return `未注册 ONU 配置方案 - ${vendorName}${host}${model}`;
    });

    const templateGroups = computed(() => groupConfigTemplates(currentConfigTemplates.value));
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
    const variableCount = computed(() => Object.keys(cleanConfigPlanVariables.value).length);
    const variableSummary = computed(() => configPlanSummary(cleanConfigPlanVariables.value, formatConfigPlanVariable));
    const planCommands = computed(() => (state.configPlan.result?.blocked ? "" : state.configPlan.result?.commands || ""));

    // 提示合并：型号不支持、必填参数没填、生成结果的提醒 / 拦截、生成出错，去重后一起显示。
    const planHints = computed(() => {
      const items = [];
      let level = "info";
      if (configPlanUnsupportedMessage.value) {
        items.push(configPlanUnsupportedMessage.value);
        level = "error";
      }
      const missing = (currentConfigTemplate.value.inputParams || [])
        .filter((param) => param.required && !String(state.configPlan.templateInputs?.[param.name] ?? "").trim())
        .map((param) => param.label || param.name);
      if (missing.length) {
        items.push(`请先填写：${missing.join("、")}`);
        if (level !== "error") level = "warning";
      }
      for (const warning of state.configPlan.result?.warnings || []) items.push(warning);
      if (state.configPlan.result?.blocked) level = "error";
      else if ((state.configPlan.result?.warnings || []).length && level === "info") level = "warning";
      if (state.configPlan.error) {
        items.push(`生成失败：${state.configPlan.error}`);
        level = "error";
      }
      return { items: [...new Set(items)], type: level };
    });

    // 打开弹窗、换模板、改网口 / VLAN / 参数后自动重新生成（短暂停顿后执行，连续修改只生成一次）。
    let timer = null;
    watch(
      () => [state.configPlan.visible, state.configPlan.row, state.configPlan.templateId, JSON.stringify(state.configPlan.ethPorts), state.configPlan.customVlan, JSON.stringify(state.configPlan.templateInputs)],
      () => {
        if (!state.configPlan.visible || !state.configPlan.row) return;
        clearTimeout(timer);
        timer = setTimeout(() => generateConfigPlan({ silent: true }), 350);
      },
      { immediate: true }
    );

    function jumpToTemplateEditor(templateId) {
      drawer.visible = false;
      state.configPlan.visible = false;
      setView("configTemplates");
      if (templateId) {
        const found = (state.templateEditor.templates || []).find((t) => t.id === templateId);
        if (found) selectTemplate(found);
      }
    }

    function templateForm(template) {
      const form = Object.fromEntries(TEMPLATE_FIELDS.map((field) => [field, template?.[field]]));
      return {
        ...form,
        name: form.name || "",
        commandTemplate: form.commandTemplate || "",
        deviceProfiles: Array.isArray(form.deviceProfiles) ? [...form.deviceProfiles] : [],
        defaultParams: form.defaultParams ? { ...form.defaultParams } : {},
        inputParams: (form.inputParams || []).map((item) => ({ ...item, options: [...(item.options || [])] })),
        isBuiltin: Boolean(form.isBuiltin)
      };
    }

    function openTemplateDrawer() {
      drawer.form = templateForm(currentConfigTemplate.value);
      drawer.visible = true;
    }

    const drawerParamNames = computed(() => (drawer.form?.inputParams || []).map((item) => String(item.name || "").trim()).filter(Boolean));
    const drawerParamLabels = computed(() => Object.fromEntries((drawer.form?.inputParams || []).map((item) => [String(item.name || "").trim(), item.label || ""])));
    const drawerCheck = computed(() => (drawer.form ? checkConfigTemplate(drawer.form) : { ok: false, errors: [], warnings: [] }));
    const drawerErrorLines = computed(() => drawerCheck.value.errors.map((item) => item.line).filter(Boolean));

    async function persistDrawer(data, successText) {
      drawer.saving = true;
      try {
        const res = await onuApi.saveConfigTemplate(data);
        await loadConfigTemplates();
        const saved = (state.configTemplates || []).find((template) => template.id === res.template?.id) || res.template;
        if (saved?.id) {
          drawer.form = templateForm(saved);
          if (state.configPlan.templateId === saved.id) await generateConfigPlan({ silent: true });
          else state.configPlan.templateId = saved.id;
        }
        ElMessage.success(successText);
        return saved;
      } catch (error) {
        ElMessage.error(error.message || "保存失败");
        return null;
      } finally {
        drawer.saving = false;
      }
    }

    async function copyBuiltinForEdit() {
      await persistDrawer({ ...drawer.form, id: "", name: `${drawer.form.name}（我的）`, isBuiltin: false, businessType: "custom" }, "已复制为我的方案，可以修改了");
    }

    async function saveDrawerTemplate() {
      if (!drawer.form?.name?.trim()) return ElMessage.warning("请填写方案名称。");
      if (!drawerCheck.value.ok) return ElMessage.warning(drawerCheck.value.errors[0]?.message || "模板有错误");
      const saved = await persistDrawer({ ...drawer.form }, "已保存，预览已更新");
      if (saved) drawer.visible = false;
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
      const commands = planCommands.value;
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

    return { ...ctx, configPlanDialogTitle, templateGroups, selectedProjectTemplate, showEthPortSelector, showCustomVlanInput, cleanConfigPlanVariables, variableCount, variableSummary, planCommands, planHints, showAllVariables, drawer, drawerParamNames, drawerParamLabels, drawerCheck, drawerErrorLines, openTemplateDrawer, copyBuiltinForEdit, saveDrawerTemplate, jumpToTemplateEditor, configPlanVariableLabel, formatEthPortLabel, formatConfigPlanVariable, openTerminalForConfigPlan };
  }
};
</script>
