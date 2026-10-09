<template>
  <section>
    <div class="page-head">
      <div>
        <h1>配置方案管理</h1>
        <div class="page-subtitle">编写自己的配置方案模板；系统按规则自动填好坐标、ONU ID、VLAN 等变量，只生成命令预览，不会下发到 OLT。</div>
      </div>
      <div class="toolbar">
        <el-button @click="loadConfigTemplates({ reload: true })">刷新</el-button>
        <el-button type="primary" @click="createNewTemplate">新建方案</el-button>
      </div>
    </div>

    <div class="tpl-workspace">
      <!-- 方案列表：我的方案在前，内置方案可收起 -->
      <aside class="tpl-list">
        <div class="tpl-list-filter">
          <el-input v-model="state.templateEditor.searchKeyword" clearable placeholder="搜索方案" size="small" />
          <el-radio-group v-model="state.templateEditor.filterVendor" size="small">
            <el-radio-button label="">全部</el-radio-button>
            <el-radio-button label="zte">中兴</el-radio-button>
            <el-radio-button label="huawei">华为</el-radio-button>
          </el-radio-group>
        </div>
        <div class="tpl-list-scroll">
          <div class="tpl-group-title">我的方案 · {{ customTemplates.length }}</div>
          <div
            v-for="tpl in customTemplates"
            :key="tpl.id"
            role="button"
            tabindex="0"
            :class="['tpl-item', { active: state.templateEditor.selectedId === tpl.id }]"
            @click="trySelect(tpl)"
            @keydown.enter="trySelect(tpl)"
          >
            <div class="tpl-item-name">{{ tpl.name }}</div>
            <div class="tpl-item-meta">
              <span v-for="label in profileLabels(tpl)" :key="label" class="tpl-profile">{{ label }}</span>
              <span v-if="tpl.inputParams?.length" class="tpl-profile is-param">{{ tpl.inputParams.length }} 个填写参数</span>
            </div>
            <div v-if="state.templateEditor.selectedId === tpl.id && tpl.remark" class="tpl-item-desc">{{ tpl.remark }}</div>
          </div>
          <div v-if="!customTemplates.length" class="tpl-empty">
            还没有自己的方案。点“新建方案”，或选一个内置方案后“复制为我的方案”。
          </div>

          <button type="button" class="tpl-group-title tpl-group-toggle" @click="builtinCollapsed = !builtinCollapsed">
            <el-icon class="inline-icon"><component :is="builtinCollapsed ? 'ArrowRight' : 'ArrowDown'" /></el-icon>
            内置方案 · {{ builtinTemplates.length }}（只读）
          </button>
          <template v-if="!builtinCollapsed">
            <div
              v-for="tpl in builtinTemplates"
              :key="tpl.id"
              role="button"
              tabindex="0"
              :class="['tpl-item', 'is-builtin', { active: state.templateEditor.selectedId === tpl.id }]"
              @click="trySelect(tpl)"
              @keydown.enter="trySelect(tpl)"
            >
              <div class="tpl-item-name">{{ tpl.name }}</div>
              <div v-if="state.templateEditor.selectedId === tpl.id && tpl.remark" class="tpl-item-desc">{{ tpl.remark }}</div>
            </div>
          </template>
        </div>
      </aside>

      <!-- 编辑区 -->
      <el-card shadow="never" class="tpl-editor">
        <template #header>
          <div class="tpl-card-head">
            <div class="tpl-card-title">
              <strong>{{ form.name || "未命名方案" }}</strong>
              <el-tag v-if="form.isBuiltin" size="small" type="info">内置 · 只读</el-tag>
              <el-tag v-else-if="!form.id" size="small" type="warning">新方案，未保存</el-tag>
              <el-tag v-else-if="dirty" size="small" type="warning">有未保存的修改</el-tag>
              <el-tag v-else size="small" type="success">已保存</el-tag>
            </div>
            <div class="tpl-card-actions">
              <template v-if="form.isBuiltin">
                <el-button type="primary" size="small" @click="copyAsMine">复制为我的方案</el-button>
              </template>
              <template v-else>
                <el-button v-if="form.id" type="danger" plain size="small" @click="deleteCurrentTemplate">删除</el-button>
                <el-button v-if="form.id" size="small" @click="saveAsNewTemplate">另存为</el-button>
                <el-button type="primary" size="small" :loading="saving" @click="saveTemplate">保存</el-button>
              </template>
            </div>
          </div>
        </template>

        <el-alert
          v-if="form.isBuiltin"
          type="info"
          :closable="false"
          show-icon
          class="tpl-readonly-tip"
          title="内置方案是经过现场验证的标准命令，只能查看。需要调整时点“复制为我的方案”，在副本上修改。"
        />

        <el-form label-width="84px" size="small" class="tpl-props" :disabled="form.isBuiltin">
          <div class="tpl-props-grid">
            <el-form-item label="方案名称">
              <el-input v-model="form.name" placeholder="厚街 HGU 双网口" />
            </el-form-item>
            <el-form-item label="厂商">
              <el-select v-model="form.vendor" @change="handleVendorChange">
                <el-option label="中兴 (ZTE)" value="zte" />
                <el-option label="华为 (Huawei)" value="huawei" />
              </el-select>
            </el-form-item>
            <el-form-item label="适用型号">
              <el-checkbox-group v-model="form.deviceProfiles" @change="resetSamplePorts">
                <el-checkbox v-for="option in profileOptions" :key="option.value" :label="option.value">{{ option.label }}</el-checkbox>
              </el-checkbox-group>
            </el-form-item>
            <el-form-item label="默认网口">
              <el-select v-model="form.defaultParams.defaultPort" placeholder="生成时默认勾选">
                <el-option v-for="port in portOptions" :key="port" :label="port" :value="port" />
              </el-select>
            </el-form-item>
            <el-form-item label="内层 VLAN">
              <el-input v-model="form.defaultParams.innerVlan" placeholder="3301" />
            </el-form-item>
            <el-form-item label="说明">
              <el-input v-model="form.remark" placeholder="业务场景、适用小区等" />
            </el-form-item>
          </div>
        </el-form>

        <div class="tpl-section-head">
          <span>命令模板</span>
          <span class="tpl-section-tip">右键插入变量，或输入 <code>&#123;&#123;</code> 自动弹出</span>
          <el-dropdown v-if="!form.isBuiltin" trigger="click" @command="insertVariable">
            <el-button size="small" link type="primary">插入变量<el-icon class="inline-icon is-trailing"><ArrowDown /></el-icon></el-button>
            <template #dropdown>
              <el-dropdown-menu class="tpl-var-menu">
                <template v-for="group in variableGroups" :key="group.title">
                  <div class="tpl-var-menu-title">{{ group.title }}</div>
                  <el-dropdown-item v-for="item in group.items" :key="item.name" :command="item.name">
                    <code>{{ item.name }}</code><span class="tpl-var-menu-label">{{ item.label }}</span>
                  </el-dropdown-item>
                </template>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
        <TemplateCodeEditor
          ref="codeEditorRef"
          v-model="form.commandTemplate"
          :readonly="form.isBuiltin"
          :variables="state.templateEditor.variables"
          :param-names="paramNames"
          :param-labels="paramLabels"
          :error-lines="errorLines"
          placeholder="interface gpon-olt_{{chassis}}/{{board}}/{{pon}}"
        />

        <div class="tpl-section-head">
          <span>生成时填写的参数</span>
          <span class="tpl-section-tip">在模板里用 <code>&#123;&#123;参数名&#125;&#125;</code> 引用，生成方案时弹窗会出现对应输入框</span>
        </div>
        <div v-if="form.inputParams.length" class="tpl-params">
          <div class="tpl-param-row tpl-param-head">
            <span>参数名</span><span>显示名</span><span>类型</span><span>选项 / 默认值</span><span>必填</span><span></span>
          </div>
          <div v-for="(param, index) in form.inputParams" :key="index" class="tpl-param-row">
            <el-input v-model="param.name" size="small" placeholder="onuType" class="tpl-mono" :disabled="form.isBuiltin" />
            <el-input v-model="param.label" size="small" placeholder="ONU 型号" :disabled="form.isBuiltin" />
            <el-select v-model="param.type" size="small" :disabled="form.isBuiltin">
              <el-option label="文本" value="text" />
              <el-option label="VLAN" value="vlan" />
              <el-option label="下拉选项" value="select" />
            </el-select>
            <div class="tpl-param-values">
              <el-select
                v-if="param.type === 'select'"
                v-model="param.options"
                size="small"
                multiple
                filterable
                allow-create
                default-first-option
                placeholder="输入选项后回车"
                :disabled="form.isBuiltin"
              />
              <el-select v-if="param.type === 'select'" v-model="param.defaultValue" size="small" clearable placeholder="默认" :disabled="form.isBuiltin">
                <el-option v-for="option in param.options" :key="option" :label="option" :value="option" />
              </el-select>
              <el-input v-else v-model="param.defaultValue" size="small" :placeholder="param.type === 'vlan' ? '默认 VLAN（可空）' : '默认值（可空）'" :disabled="form.isBuiltin" />
            </div>
            <el-switch v-model="param.required" size="small" :disabled="form.isBuiltin" />
            <el-button v-if="!form.isBuiltin" link type="danger" size="small" aria-label="删除参数" @click="form.inputParams.splice(index, 1)"><el-icon><Delete /></el-icon></el-button>
            <span v-else></span>
          </div>
        </div>
        <el-button v-if="!form.isBuiltin" size="small" class="tpl-add-param" @click="addParam"><el-icon class="inline-icon"><Plus /></el-icon>添加参数</el-button>
        <div v-else-if="!form.inputParams.length" class="tpl-empty">无</div>
      </el-card>

      <!-- 实时预览与检查 -->
      <el-card shadow="never" class="tpl-preview">
        <template #header>
          <div class="tpl-card-head">
            <strong>实时预览</strong>
            <el-button size="small" @click="copyPreview">复制</el-button>
          </div>
        </template>

        <div class="tpl-sample">
          <span class="tpl-sample-label">样本</span>
          <span class="param-chip">{{ sample.chassis }}/{{ sample.board }}/{{ sample.pon }}</span>
          <span class="param-chip">ID {{ sample.onuId }}</span>
          <span class="param-chip">外层 {{ sample.outerVlan || "无" }}</span>
          <span class="param-chip">网口 {{ (sample.ethPorts || []).join(",") || "无" }}</span>
          <el-button link type="primary" size="small" @click="sampleEditing = !sampleEditing">{{ sampleEditing ? "收起" : "修改样本" }}</el-button>
        </div>
        <el-form v-if="sampleEditing" size="small" label-width="72px" class="tpl-sample-form">
          <div class="tpl-sample-grid">
            <el-form-item label="机框"><el-input v-model="sample.chassis" /></el-form-item>
            <el-form-item label="槽位"><el-input v-model="sample.board" /></el-form-item>
            <el-form-item label="PON"><el-input v-model="sample.pon" /></el-form-item>
            <el-form-item label="ONU ID"><el-input v-model="sample.onuId" /></el-form-item>
            <el-form-item label="序列号"><el-input v-model="sample.serial" /></el-form-item>
            <el-form-item label="外层 VLAN"><el-input v-model="sample.outerVlan" placeholder="空表示台账未登记" /></el-form-item>
          </div>
          <el-form-item label="网口">
            <el-checkbox-group v-model="sample.ethPorts">
              <el-checkbox v-for="port in portOptions" :key="port" :label="port">{{ port }}</el-checkbox>
            </el-checkbox-group>
          </el-form-item>
          <el-form-item v-for="param in namedParams" :key="param.name" :label="param.label || param.name">
            <el-select v-if="param.type === 'select'" v-model="sample.inputs[param.name]" clearable :placeholder="param.defaultValue || '请选择'">
              <el-option v-for="option in param.options" :key="option" :label="option" :value="option" />
            </el-select>
            <el-input v-else v-model="sample.inputs[param.name]" :placeholder="param.defaultValue || ''" />
          </el-form-item>
        </el-form>

        <pre class="tpl-preview-code"><code v-html="previewHtml"></code></pre>

        <div class="tpl-section-head"><span>检查结果</span></div>
        <ul class="tpl-checks">
          <li v-for="(item, index) in checkItems" :key="index" :class="['tpl-check', `is-${item.level}`]">
            <el-icon class="tpl-check-icon"><component :is="checkIcon(item.level)" /></el-icon>
            <span>{{ item.message }}</span>
            <el-button v-if="item.line" link size="small" @click="codeEditorRef?.focusLine(item.line)">定位</el-button>
            <el-button v-if="item.suggestion && !form.isBuiltin" link type="primary" size="small" @click="applyFix(item)">改为 {{ item.suggestion }}</el-button>
          </li>
        </ul>
      </el-card>
    </div>
  </section>
</template>

<script>
import { computed, ref } from "vue";
import { ElMessage } from "element-plus/es/components/message/index.mjs";
import { ElMessageBox } from "element-plus/es/components/message-box/index.mjs";
import { buildRenderVariables, checkConfigTemplate, extractTemplateVariables, renderTemplateString, resolveTemplateInputs } from "../config-plan-engine.mjs";
import { useAppContext } from "../app-context.js";
import TemplateCodeEditor from "../components/TemplateCodeEditor.vue";

const PROFILE_OPTIONS = Object.freeze({
  zte: [{ value: "zte-c300", label: "C300" }, { value: "zte-c600", label: "C600 (TITAN)" }],
  huawei: [{ value: "huawei-ma5800", label: "MA5800" }]
});
const PROFILE_LABELS = Object.freeze({ "zte-c300": "C300", "zte-c600": "C600", "huawei-ma5800": "MA5800" });
const VARIABLE_GROUPS = Object.freeze([
  { key: "coordinate", title: "设备与坐标" },
  { key: "onu", title: "终端与 SN" },
  { key: "business", title: "业务与 VLAN" },
  { key: "port", title: "物理网口（多选时逐行展开）" }
]);

function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function comparable(tpl = {}) {
  return JSON.stringify({
    name: tpl.name || "",
    vendor: tpl.vendor || "",
    deviceProfiles: [...(tpl.deviceProfiles || [])].sort(),
    defaultParams: { innerVlan: String(tpl.defaultParams?.innerVlan ?? ""), defaultPort: String(tpl.defaultParams?.defaultPort ?? "") },
    commandTemplate: tpl.commandTemplate || "",
    inputParams: (tpl.inputParams || []).map((item) => ({
      name: item.name || "",
      label: item.label || "",
      type: item.type || "text",
      options: item.type === "select" ? [...(item.options || [])] : [],
      defaultValue: item.defaultValue || "",
      required: item.required !== false
    })),
    remark: tpl.remark || ""
  });
}

// 配置方案管理：左侧方案列表，中间编辑，右侧用样本实时预览和检查。只读写本地 SQLite 模板。
export default {
  name: "ConfigTemplatesView",
  components: { TemplateCodeEditor },
  setup() {
    const ctx = useAppContext();
    const { copyText, loadConfigTemplates, onuApi, selectTemplate, state } = ctx;
    const codeEditorRef = ref(null);
    const builtinCollapsed = ref(false);
    const sampleEditing = ref(false);
    const saving = ref(false);

    const form = computed(() => {
      const value = state.templateEditor.form;
      if (!Array.isArray(value.inputParams)) value.inputParams = [];
      if (!value.defaultParams || typeof value.defaultParams !== "object") value.defaultParams = {};
      return value;
    });
    const sample = computed(() => {
      const value = state.templateEditor.testParams;
      if (!Array.isArray(value.ethPorts)) value.ethPorts = value.ethPort ? [value.ethPort] : [];
      if (!value.inputs || typeof value.inputs !== "object") value.inputs = {};
      return value;
    });

    const visibleTemplates = computed(() => {
      const vendor = state.templateEditor.filterVendor;
      const keyword = (state.templateEditor.searchKeyword || "").trim().toLowerCase();
      return (state.templateEditor.templates || []).filter((tpl) => {
        if (tpl.projectId) return false;
        if (vendor && String(tpl.vendor || "").toLowerCase() !== vendor) return false;
        if (!keyword) return true;
        return [tpl.name, tpl.remark, tpl.id].some((text) => String(text || "").toLowerCase().includes(keyword));
      });
    });
    const customTemplates = computed(() => visibleTemplates.value.filter((tpl) => !tpl.isBuiltin));
    const builtinTemplates = computed(() => visibleTemplates.value.filter((tpl) => tpl.isBuiltin));
    const savedTemplate = computed(() => (state.templateEditor.templates || []).find((tpl) => tpl.id === form.value.id) || null);
    const dirty = computed(() => !form.value.isBuiltin && (!form.value.id || !savedTemplate.value || comparable(form.value) !== comparable(savedTemplate.value)));

    const profileOptions = computed(() => PROFILE_OPTIONS[form.value.vendor] || PROFILE_OPTIONS.zte);
    const portOptions = computed(() => {
      if (form.value.vendor === "huawei") return ["eth1", "eth2", "eth3", "eth4"];
      const ports = ["eth_0/1", "eth_0/2", "eth_0/3", "eth_0/4"];
      return (form.value.deviceProfiles || []).includes("zte-c600") ? [...ports, "veip_1"] : ports;
    });
    const namedParams = computed(() => form.value.inputParams.filter((item) => String(item.name || "").trim()));
    const paramNames = computed(() => namedParams.value.map((item) => item.name.trim()));
    const paramLabels = computed(() => Object.fromEntries(namedParams.value.map((item) => [item.name.trim(), item.label || ""])));
    const variableGroups = computed(() => {
      const variables = state.templateEditor.variables || [];
      const groups = VARIABLE_GROUPS.map((group) => ({ title: group.title, items: variables.filter((item) => item.category === group.key) }));
      if (paramNames.value.length) groups.unshift({ title: "生成时填写的参数", items: paramNames.value.map((name) => ({ name, label: namedParams.value.find((item) => item.name === name)?.label || "" })) });
      return groups.filter((group) => group.items.length);
    });

    const check = computed(() => checkConfigTemplate(form.value));
    const errorLines = computed(() => check.value.errors.map((item) => item.line).filter(Boolean));
    const sampleInputs = computed(() => resolveTemplateInputs(form.value, sample.value.inputs));
    const previewText = computed(() => {
      const text = form.value.commandTemplate || "";
      if (!text.trim()) return "";
      const ports = sample.value.ethPorts.length ? sample.value.ethPorts : [];
      const variables = buildRenderVariables({
        ...form.value.defaultParams,
        vendor: form.value.vendor,
        chassis: sample.value.chassis,
        board: sample.value.board,
        pon: sample.value.pon,
        onuId: sample.value.onuId,
        actualOntId: sample.value.onuId,
        serial: sample.value.serial,
        outerVlan: sample.value.outerVlan,
        ethPorts: ports,
        ethPort: ports[0],
        customVariables: sampleInputs.value.values
      });
      return renderTemplateString(text, variables);
    });
    const previewHtml = computed(() => {
      if (!previewText.value) return "在中间输入命令模板后，这里会按样本即时生成。";
      return escapeHtml(previewText.value).replace(/\{\{[^{}]*\}\}/g, (match) => `<span class="tpl-preview-bad">${match}</span>`);
    });
    const checkItems = computed(() => {
      const items = [
        ...check.value.errors.map((item) => ({ ...item, level: "error" })),
        ...check.value.warnings.map((item) => ({ ...item, level: "warning" })),
        ...sampleInputs.value.problems.map((message) => ({ message: `生成时会拦截：${message}`, level: "warning" }))
      ];
      const used = new Set(check.value.usedVariables);
      if (used.has("outerVlan") && !String(sample.value.outerVlan || "").trim()) {
        items.push({ level: "warning", message: "样本没有外层 VLAN：PON 口在 ONU 数据管理里没登记外层 VLAN 时，svlan 会是空的。" });
      }
      if (used.has("ethPort") && sample.value.ethPorts.length > 1) {
        items.push({ level: "info", message: `含网口的行会按勾选的 ${sample.value.ethPorts.length} 个网口逐行展开。` });
      }
      items.push(...check.value.hints.map((item) => ({ ...item, level: "info" })));
      if (!check.value.errors.length && !check.value.warnings.length && form.value.commandTemplate.trim()) {
        items.unshift({ level: "ok", message: form.value.isBuiltin ? "变量都能识别。" : "变量都能识别，可以保存。" });
      }
      return items;
    });

    function checkIcon(level) {
      return { error: "CircleClose", warning: "Warning", info: "InfoFilled", ok: "CircleCheck" }[level] || "InfoFilled";
    }

    function profileLabels(tpl) {
      return (tpl.deviceProfiles || []).map((profile) => PROFILE_LABELS[profile] || profile);
    }

    async function confirmDiscard() {
      if (!dirty.value) return true;
      try {
        await ElMessageBox.confirm("当前方案有未保存的修改，切换后这些修改会丢失。", "放弃修改？", { confirmButtonText: "放弃修改", cancelButtonText: "继续编辑", type: "warning" });
        return true;
      } catch {
        return false;
      }
    }

    function resetSamplePorts() {
      const options = portOptions.value;
      const preferred = form.value.defaultParams.defaultPort;
      sample.value.ethPorts = [options.includes(preferred) ? preferred : options[0]];
      sample.value.chassis = form.value.vendor === "huawei" ? "0" : "1";
      if (!options.includes(form.value.defaultParams.defaultPort)) form.value.defaultParams.defaultPort = options[0];
    }

    async function trySelect(tpl) {
      if (tpl.id === form.value.id) return;
      if (!(await confirmDiscard())) return;
      selectTemplate(tpl);
      sample.value.inputs = {};
      resetSamplePorts();
    }

    async function createNewTemplate() {
      if (!(await confirmDiscard())) return;
      state.templateEditor.selectedId = "";
      state.templateEditor.form = {
        id: "",
        name: "新的配置方案",
        vendor: "zte",
        deviceProfiles: ["zte-c300"],
        businessType: "custom",
        portMode: "single",
        defaultParams: { innerVlan: "3301", defaultPort: "eth_0/1" },
        commandTemplate: `interface gpon-olt_{{chassis}}/{{board}}/{{pon}}
onu {{onuId}} type GPON-SFU sn {{serial}}
exit

interface gpon-onu_{{chassis}}/{{board}}/{{pon}}:{{onuId}}
service-port 1 vport 1 user-vlan {{innerVlan}} vlan {{innerVlan}} svlan {{outerVlan}}
exit

show running-config interface gpon-onu_{{chassis}}/{{board}}/{{pon}}:{{onuId}}`,
        inputParams: [],
        remark: "",
        isBuiltin: false
      };
      sample.value.inputs = {};
      resetSamplePorts();
    }

    function handleVendorChange(vendor) {
      form.value.deviceProfiles = [(PROFILE_OPTIONS[vendor] || PROFILE_OPTIONS.zte)[0].value];
      resetSamplePorts();
    }

    function addParam() {
      form.value.inputParams.push({ name: "", label: "", type: "text", options: [], defaultValue: "", required: true });
    }

    function insertVariable(name) {
      codeEditorRef.value?.insertVariable(name);
    }

    function applyFix(item) {
      form.value.commandTemplate = form.value.commandTemplate
        .split("\n")
        .map((line, index) => (index + 1 === item.line ? line.replace(new RegExp(`\\{\\{\\s*${item.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\}\\}`, "g"), `{{${item.suggestion}}}`) : line))
        .join("\n");
    }

    function payload(overrides = {}) {
      return {
        ...form.value,
        inputParams: form.value.inputParams.map((item) => ({ ...item, name: String(item.name || "").trim() })),
        ...overrides
      };
    }

    async function persist(data, successText) {
      saving.value = true;
      try {
        const res = await onuApi.saveConfigTemplate(data);
        ElMessage.success(successText);
        await loadConfigTemplates();
        if (res.template?.id) selectTemplate(res.template);
        return true;
      } catch (err) {
        ElMessage.error(err.message || "保存失败");
        return false;
      } finally {
        saving.value = false;
      }
    }

    async function saveTemplate() {
      if (!form.value.name?.trim()) return ElMessage.warning("请填写方案名称。");
      if (!check.value.ok) return ElMessage.warning(check.value.errors[0].message);
      await persist(payload(), "已保存");
    }

    async function saveAsNewTemplate() {
      if (!check.value.ok) return ElMessage.warning(check.value.errors[0].message);
      await persist(payload({ id: "", name: `${form.value.name}（副本）`, isBuiltin: false }), "已另存为新方案");
    }

    async function copyAsMine() {
      await persist(payload({ id: "", name: `${form.value.name}（我的）`, isBuiltin: false, businessType: "custom" }), "已复制，可以在副本上修改");
    }

    async function deleteCurrentTemplate() {
      if (!form.value.id || form.value.isBuiltin) return;
      try {
        await ElMessageBox.confirm(`删除方案“${form.value.name}”？删除后无法恢复。`, "删除方案", { confirmButtonText: "删除", cancelButtonText: "取消", type: "warning" });
      } catch {
        return;
      }
      try {
        await onuApi.deleteConfigTemplate(form.value.id);
        ElMessage.success("已删除");
        state.templateEditor.selectedId = "";
        await loadConfigTemplates();
      } catch (err) {
        ElMessage.error(err.message || "删除失败");
      }
    }

    async function copyPreview() {
      if (!previewText.value) return ElMessage.warning("还没有可复制的预览。");
      if (extractTemplateVariables(previewText.value).length) ElMessage.warning("预览里还有不认识的变量，复制前请先修正。");
      const copied = await copyText(previewText.value);
      if (copied) ElMessage.success("已复制预览命令");
      else ElMessage.error("复制失败，请手工选择文本复制");
    }

    return { ...ctx, form, sample, codeEditorRef, builtinCollapsed, sampleEditing, saving, customTemplates, builtinTemplates, dirty, profileOptions, portOptions, namedParams, paramNames, paramLabels, variableGroups, errorLines, previewHtml, checkItems, checkIcon, profileLabels, trySelect, createNewTemplate, handleVendorChange, resetSamplePorts, addParam, insertVariable, applyFix, saveTemplate, saveAsNewTemplate, copyAsMine, deleteCurrentTemplate, copyPreview };
  }
};
</script>
