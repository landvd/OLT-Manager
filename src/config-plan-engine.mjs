import { huaweiSnAuthSerial } from "./config-plan.mjs";

export { huaweiSnAuthSerial };

/**
 * 模板变量元数据说明，供前端方案编辑器展示与快捷插入
 */
export const SUPPORTED_TEMPLATE_VARIABLES = [
  { name: "chassis", label: "机框号", category: "coordinate", desc: "OLT机框号 (ZTE通常为1, 华为通常为0)" },
  { name: "board", label: "槽位/板卡", category: "coordinate", desc: "PON板槽位号 (例如 1, 3)" },
  { name: "slot", label: "槽位(别名)", category: "coordinate", desc: "与 board 等价" },
  { name: "pon", label: "PON口号", category: "coordinate", desc: "PON端口号 (例如 1, 8)" },
  { name: "onuId", label: "ONU ID", category: "coordinate", desc: "自动分配的下一个可用 ONU/ONT ID" },
  { name: "actualOntId", label: "华为实际ONT ID", category: "coordinate", desc: "华为注册回显填入的 ONT ID (默认与 onuId 一致)" },
  { name: "serial", label: "原始序列号", category: "onu", desc: "ONU SN (例如 ZTEG030C0914)" },
  { name: "snAuthSerial", label: "华为16进制SN", category: "onu", desc: "华为注册专用16进制SN (如 5A544547030C0914)" },
  { name: "address", label: "一级箱地址", category: "business", desc: "关联PON台账的一级箱物理安装地址" },
  { name: "outerVlan", label: "外层VLAN", category: "business", desc: "外层 SVLAN (通常来自 PON 台账关联)" },
  { name: "innerVlan", label: "内层业务VLAN", category: "business", desc: "内层 CVLAN / 业务 VLAN (默认如 3301)" },
  { name: "ethPort", label: "物理网口 (支持逐行展开)", category: "port", desc: "配置所绑定的物理端口 (如 eth_0/1, eth 1；模板中写单行规则，生成时多选端口可智能逐行展开)" }
];

/** 生成时填写参数的类型：文本、VLAN（1–4094）、下拉选项。 */
export const TEMPLATE_INPUT_TYPES = Object.freeze(["text", "vlan", "select"]);

const INPUT_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
// 自动取值的变量不能被“生成时填写”覆盖；内层 VLAN 例外，允许改成生成时由人填写。
const RESERVED_INPUT_NAMES = new Set([
  ...SUPPORTED_TEMPLATE_VARIABLES.map((item) => item.name).filter((name) => name !== "innerVlan"),
  "ethPorts",
  "vendor",
  "deviceProfile"
]);

function isValidVlan(value) {
  const text = String(value ?? "").trim();
  return /^\d+$/.test(text) && Number(text) >= 1 && Number(text) <= 4094;
}

/** 规整模板声明的“生成时填写的参数”。 */
export function normalizeTemplateInputs(list) {
  if (!Array.isArray(list)) return [];
  return list.map((item) => {
    const type = TEMPLATE_INPUT_TYPES.includes(item?.type) ? item.type : "text";
    const options = type === "select"
      ? (Array.isArray(item?.options) ? item.options : String(item?.options || "").split(/[,，\n]/))
        .map((option) => String(option).trim()).filter(Boolean)
      : [];
    return {
      name: String(item?.name || "").trim(),
      label: String(item?.label || "").trim(),
      type,
      options,
      defaultValue: String(item?.defaultValue ?? "").trim(),
      required: item?.required !== false
    };
  });
}

/** 模板中引用的变量及所在行号（从 1 开始）。 */
export function extractTemplateVariables(text = "") {
  const found = [];
  String(text || "").split("\n").forEach((line, index) => {
    for (const match of line.matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g)) {
      found.push({ name: match[1], line: index + 1 });
    }
  });
  return found;
}

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

function suggestVariable(name, candidates) {
  const lower = name.toLowerCase();
  let best = null;
  for (const candidate of candidates) {
    const distance = candidate.toLowerCase() === lower ? 0 : editDistance(lower, candidate.toLowerCase());
    if (distance <= 2 && (!best || distance < best.distance)) best = { name: candidate, distance };
  }
  return best?.name || "";
}

/**
 * 检查模板：拼错或不认识的变量、未闭合的 {{、参数声明问题。
 * errors 会阻止保存和生成；warnings、hints 只提示。
 */
export function checkConfigTemplate(template = {}) {
  const errors = [];
  const warnings = [];
  const hints = [];
  const text = String(template.commandTemplate || "");
  const inputs = normalizeTemplateInputs(template.inputParams);
  const known = new Set(SUPPORTED_TEMPLATE_VARIABLES.map((item) => item.name));
  const seen = new Set();
  for (const input of inputs) {
    if (!input.name) {
      errors.push({ message: "有参数还没填参数名。" });
      continue;
    }
    if (!INPUT_NAME_PATTERN.test(input.name)) {
      errors.push({ message: `参数名“${input.name}”只能用英文字母开头，由字母、数字、下划线组成。` });
      continue;
    }
    if (RESERVED_INPUT_NAMES.has(input.name)) {
      errors.push({ message: `参数名 ${input.name} 是系统自动取值的变量，请换一个名字。` });
      continue;
    }
    if (seen.has(input.name)) {
      errors.push({ message: `参数名 ${input.name} 重复。` });
      continue;
    }
    seen.add(input.name);
    if (input.type === "select" && !input.options.length) errors.push({ message: `参数 ${input.name} 是下拉选项，但没有填写选项。` });
    if (input.type === "vlan" && input.defaultValue && !isValidVlan(input.defaultValue)) errors.push({ message: `参数 ${input.name} 的默认值 ${input.defaultValue} 不是 1–4094 之间的 VLAN。` });
    if (input.type === "select" && input.defaultValue && input.options.length && !input.options.includes(input.defaultValue)) {
      errors.push({ message: `参数 ${input.name} 的默认值 ${input.defaultValue} 不在选项里。` });
    }
  }
  const declared = new Set([...known, ...seen]);
  const used = new Set();
  for (const { name, line } of extractTemplateVariables(text)) {
    used.add(name);
    if (declared.has(name)) continue;
    const suggestion = suggestVariable(name, [...declared]);
    errors.push({
      line,
      name,
      suggestion,
      message: suggestion
        ? `第 ${line} 行 {{${name}}} 不是已知变量，是否想写 {{${suggestion}}}？`
        : `第 ${line} 行 {{${name}}} 不是已知变量；如需生成时填写，请先在“生成时填写的参数”里添加。`
    });
  }
  text.split("\n").forEach((line, index) => {
    const stripped = line.replace(/\{\{[^{}]*\}\}/g, "");
    if (stripped.includes("{{") || stripped.includes("}}")) errors.push({ line: index + 1, message: `第 ${index + 1} 行有不成对的 {{ 或 }}。` });
  });
  for (const name of seen) {
    if (!used.has(name)) warnings.push({ message: `参数 ${name} 已声明，但模板里没有用到。` });
  }
  if (text.trim() && !used.has("serial") && !used.has("snAuthSerial")) warnings.push({ message: "模板没有用到 ONU 序列号 {{serial}}。" });
  if (text.trim() && !used.has("onuId") && !used.has("actualOntId")) warnings.push({ message: "模板没有用到 ONU ID {{onuId}}。" });
  if (String(template.vendor || "").toLowerCase() === "zte" && text.trim() && !/^\s*show\s/m.test(text)) {
    hints.push({ message: "没有 show 核查命令，建议末尾加上，执行后便于核对结果。" });
  }
  return { ok: errors.length === 0, errors, warnings, hints, usedVariables: [...used] };
}

/** 按模板声明取出生成时填写的参数值；缺必填或 VLAN 不合法时返回阻止原因。 */
export function resolveTemplateInputs(template = {}, provided = {}) {
  const values = {};
  const problems = [];
  for (const input of normalizeTemplateInputs(template.inputParams)) {
    if (!INPUT_NAME_PATTERN.test(input.name)) continue;
    const raw = provided?.[input.name];
    const value = String(raw === undefined || raw === null || raw === "" ? input.defaultValue : raw).trim();
    const label = input.label || input.name;
    if (!value) {
      if (input.required) problems.push(`请填写“${label}”。`);
      continue;
    }
    if (input.type === "vlan" && !isValidVlan(value)) {
      problems.push(`“${label}”必须是 1–4094 之间的 VLAN。`);
      continue;
    }
    if (input.type === "select" && input.options.length && !input.options.includes(value)) {
      problems.push(`“${label}”只能从 ${input.options.join("、")} 中选择。`);
      continue;
    }
    values[input.name] = value;
  }
  return { values, problems };
}

/**
 * 系统内置出厂标准模板定义
 */
export const BUILTIN_CONFIG_TEMPLATES = [
  {
    id: "zte-self-operated-internet",
    name: "ZTE C300 自营上网",
    vendor: "zte",
    deviceProfiles: ["zte-c300"],
    businessType: "self-operated-internet",
    portMode: "single",
    defaultParams: {
      innerVlan: "3301",
      outerVlanSource: "ledger",
      defaultPort: "eth_0/1"
    },
    remark: "中兴 C300 GPON-SFU 自营宽带标准配置方案，自动绑定台账外层 VLAN 与 3301 内层 VLAN。",
    commandTemplate: `interface gpon-olt_{{chassis}}/{{board}}/{{pon}}
onu {{onuId}} type GPON-SFU sn {{serial}}
exit

interface gpon-onu_{{chassis}}/{{board}}/{{pon}}:{{onuId}}
tcont 1 profile MDUtcont
gemport 1 tcont 1
service-port 1 vport 1 user-vlan {{innerVlan}} vlan {{innerVlan}} svlan {{outerVlan}}
exit

pon-onu-mng gpon-onu_{{chassis}}/{{board}}/{{pon}}:{{onuId}}
Service ziying gemport 1 vlan {{innerVlan}}
vlan port {{ethPort}} mode hybrid def-vlan {{innerVlan}}
exit

show running-config interface gpon-onu_{{chassis}}/{{board}}/{{pon}}:{{onuId}}
show onu running config gpon-onu_{{chassis}}/{{board}}/{{pon}}:{{onuId}}`
  },
  {
    id: "zte-link-booth",
    name: "ZTE C300 内部网络",
    vendor: "zte",
    deviceProfiles: ["zte-c300"],
    businessType: "link-booth",
    portMode: "single",
    defaultParams: {
      innerVlan: "100",
      defaultPort: "eth_0/1"
    },
    remark: "中兴 C300 内部业务/展厅网络，默认绑定 VLAN 100 单层打标。",
    commandTemplate: `interface gpon-olt_{{chassis}}/{{board}}/{{pon}}
onu {{onuId}} type GPON-SFU sn {{serial}}
exit

interface gpon-onu_{{chassis}}/{{board}}/{{pon}}:{{onuId}}
sn-bind disable
tcont 1 profile MDUtcont
gemport 1 tcont 1
service-port 1 vport 1 user-vlan {{innerVlan}} vlan {{innerVlan}}
exit

pon-onu-mng gpon-onu_{{chassis}}/{{board}}/{{pon}}:{{onuId}}
service 1 gemport 1
vlan port {{ethPort}} mode hybrid def-vlan {{innerVlan}}
exit

show running-config interface gpon-onu_{{chassis}}/{{board}}/{{pon}}:{{onuId}}
show onu running config gpon-onu_{{chassis}}/{{board}}/{{pon}}:{{onuId}}`
  },
  {
    id: "zte-custom-vlan",
    name: "ZTE C300 自定义 VLAN",
    vendor: "zte",
    deviceProfiles: ["zte-c300"],
    businessType: "custom-vlan",
    portMode: "single",
    defaultParams: {
      innerVlan: "",
      defaultPort: "eth_0/1"
    },
    remark: "中兴 C300 自定义单层业务 VLAN 方案，生成时由运维人员填写具体业务 VLAN。",
    commandTemplate: `interface gpon-olt_{{chassis}}/{{board}}/{{pon}}
onu {{onuId}} type GPON-SFU sn {{serial}}
exit

interface gpon-onu_{{chassis}}/{{board}}/{{pon}}:{{onuId}}
sn-bind disable
tcont 1 profile MDUtcont
gemport 1 tcont 1
service-port 1 vport 1 user-vlan {{innerVlan}} vlan {{innerVlan}}
exit

pon-onu-mng gpon-onu_{{chassis}}/{{board}}/{{pon}}:{{onuId}}
service 1 gemport 1
vlan port {{ethPort}} mode hybrid def-vlan {{innerVlan}}
exit

show running-config interface gpon-onu_{{chassis}}/{{board}}/{{pon}}:{{onuId}}
show onu running config gpon-onu_{{chassis}}/{{board}}/{{pon}}:{{onuId}}`
  },
  {
    id: "zte-c600-self-operated-internet",
    name: "ZTE C600 自营上网",
    vendor: "zte",
    deviceProfiles: ["zte-c600"],
    businessType: "self-operated-internet",
    portMode: "single",
    defaultParams: {
      innerVlan: "3301",
      outerVlanSource: "ledger",
      defaultPort: "veip_1"
    },
    remark: "中兴 TITAN C600 自营宽带方案，采用 Vport 模式及 PPPoE 业务打标。",
    commandTemplate: `configure terminal
interface gpon_olt-{{chassis}}/{{board}}/{{pon}}
onu {{onuId}} type GPON-SFU sn {{serial}}
exit

interface gpon_onu-{{chassis}}/{{board}}/{{pon}}:{{onuId}}
vport-mode manual
tcont 1 name PPPoE profile PPPoE
sn-bind disable
gemport 1 name 1 tcont 1
vport 1 map-type vlan
vport-map 1 1 vlan {{innerVlan}}
exit

interface vport-{{chassis}}/{{board}}/{{pon}}.{{onuId}}:1
service-port 1 user-vlan untagged user-etype PPPOE vlan {{innerVlan}} svlan {{outerVlan}}
exit

pon-onu-mng gpon_onu-{{chassis}}/{{board}}/{{pon}}:{{onuId}}
service PPPoE gemport 1 vlan {{innerVlan}}
vlan port {{ethPort}} mode hybrid def-vlan {{innerVlan}}
exit

interface gpon_onu-{{chassis}}/{{board}}/{{pon}}:{{onuId}}
show this
exit
interface vport-{{chassis}}/{{board}}/{{pon}}.{{onuId}}:1
show this
exit
pon-onu-mng gpon_onu-{{chassis}}/{{board}}/{{pon}}:{{onuId}}
show this
exit`
  },
  {
    id: "zte-c600-link-booth",
    name: "ZTE C600 内部网络",
    vendor: "zte",
    deviceProfiles: ["zte-c600"],
    businessType: "link-booth",
    portMode: "single",
    defaultParams: {
      innerVlan: "100",
      defaultPort: "eth_0/1"
    },
    remark: "中兴 TITAN C600 内部业务网络，绑定 VLAN 100。",
    commandTemplate: `configure terminal
interface gpon_olt-{{chassis}}/{{board}}/{{pon}}
onu {{onuId}} type GPON-SFU sn {{serial}}
exit

interface gpon_onu-{{chassis}}/{{board}}/{{pon}}:{{onuId}}
vport-mode manual
tcont 1 name MDUtcont profile MDUtcont
sn-bind disable
gemport 1 name 1 tcont 1
vport 1 map-type vlan
vport-map 1 1 vlan {{innerVlan}}
exit

interface vport-{{chassis}}/{{board}}/{{pon}}.{{onuId}}:1
service-port 1 user-vlan {{innerVlan}} vlan {{innerVlan}}
exit

pon-onu-mng gpon_onu-{{chassis}}/{{board}}/{{pon}}:{{onuId}}
service intranet gemport 1 vlan {{innerVlan}}
vlan port {{ethPort}} mode tag vlan {{innerVlan}}
exit

interface gpon_onu-{{chassis}}/{{board}}/{{pon}}:{{onuId}}
show this
exit
interface vport-{{chassis}}/{{board}}/{{pon}}.{{onuId}}:1
show this
exit
pon-onu-mng gpon_onu-{{chassis}}/{{board}}/{{pon}}:{{onuId}}
show this
exit`
  },
  {
    id: "huawei-self-operated-internet",
    name: "Huawei MA5800 自营上网",
    vendor: "huawei",
    deviceProfiles: ["huawei-ma5800"],
    businessType: "self-operated-internet",
    portMode: "single",
    defaultParams: {
      innerVlan: "3301",
      outerVlanSource: "ledger",
      defaultPort: "eth1"
    },
    remark: "华为 MA5800 自营宽带方案，自动转换 16 进制 sn-auth 并配置 translate-and-add QinQ 双层打标。",
    commandTemplate: `config
interface gpon {{chassis}}/{{board}}
ont add {{pon}} sn-auth {{snAuthSerial}} omci ont-lineprofile-id 300 ont-srvprofile-id 300
ont port native-vlan {{pon}} {{actualOntId}} {{ethPort}} vlan {{innerVlan}}
quit

service-port vlan {{outerVlan}} gpon {{chassis}}/{{board}}/{{pon}} ont {{actualOntId}} gemport 0 multi-service user-vlan {{innerVlan}} tag-transform translate-and-add inner-vlan {{innerVlan}} inner-priority 0

display current-configuration ont {{chassis}}/{{board}}/{{pon}} {{actualOntId}}
display service-port ont {{actualOntId}}`
  },
  {
    id: "huawei-link-booth",
    name: "Huawei MA5800 内部网络",
    vendor: "huawei",
    deviceProfiles: ["huawei-ma5800"],
    businessType: "link-booth",
    portMode: "single",
    defaultParams: {
      innerVlan: "100",
      defaultPort: "eth1"
    },
    remark: "华为 MA5800 内部网络方案，绑定 VLAN 100 单层打标。",
    commandTemplate: `config
interface gpon {{chassis}}/{{board}}
ont add {{pon}} sn-auth {{snAuthSerial}} omci ont-lineprofile-id 300 ont-srvprofile-id 300
ont port native-vlan {{pon}} {{actualOntId}} {{ethPort}} vlan {{innerVlan}} priority 0
quit

service-port vlan {{innerVlan}} gpon {{chassis}}/{{board}}/{{pon}} ont {{actualOntId}} gemport 0 multi-service user-vlan {{innerVlan}} tag-transform translate

display current-configuration ont {{chassis}}/{{board}}/{{pon}} {{actualOntId}}
display service-port ont {{actualOntId}}`
  }
];

/**
 * 格式化参数并提取完整变量表
 */
export function buildRenderVariables(input = {}) {
  const isHuawei = String(input.vendor || "").toLowerCase() === "huawei";
  const chassis = String(input.chassis ?? (isHuawei ? "0" : "1")).trim();
  const board = String(input.board ?? input.slot ?? "1").trim();
  const pon = String(input.pon ?? "1").trim();
  const onuId = String(input.onuId ?? input.suggestedOnuId ?? "1").trim();
  const actualOntId = String(input.actualOntId || onuId).trim();
  const serial = String(input.serial || "").trim();
  const snAuthSerial = huaweiSnAuthSerial(serial);
  const address = String(input.address || input.boxAddress || "").trim();

  // 基础 VLAN
  const innerVlan = String(input.innerVlan ?? input.customVlan ?? "3301").trim();
  const outerVlan = String(input.outerVlan ?? input.ledgerOuterVlan ?? "").trim();
  
  // 端口列表与首选端口
  let ethPorts = [];
  if (Array.isArray(input.ethPorts) && input.ethPorts.length > 0) {
    ethPorts = input.ethPorts.map((p) => String(p).trim()).filter(Boolean);
  } else if (input.ethPort) {
    ethPorts = [String(input.ethPort).trim()];
  }
  if (!ethPorts.length) {
    ethPorts = [isHuawei ? "eth 1" : "eth_0/1"];
  }
  const ethPort = ethPorts[0];

  return {
    chassis,
    board,
    slot: board,
    pon,
    onuId,
    actualOntId,
    serial,
    snAuthSerial,
    address,
    innerVlan,
    outerVlan,
    ethPort,
    ethPorts,
    ...input.customVariables
  };
}

/**
 * 模板变量渲染函数（支持 {{ethPort}} 单规则智能逐行展开）
 * @param {string} templateString 包含 {{variable}} 占位符的命令模板文本
 * @param {object} variables 变量键值对 (若 variables.ethPorts 包含多端口，自动按行展开)
 * @returns {string} 替换后的命令文本
 */
export function renderTemplateString(templateString = "", variables = {}) {
  if (typeof templateString !== "string") return "";

  const ethPorts = Array.isArray(variables.ethPorts) && variables.ethPorts.length > 0
    ? variables.ethPorts
    : (variables.ethPort ? [variables.ethPort] : []);

  const renderLine = (line, lineVars) => {
    return line.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, varName) => {
      if (Object.prototype.hasOwnProperty.call(lineVars, varName)) {
        const val = lineVars[varName];
        return val !== undefined && val !== null ? String(val) : "";
      }
      return match;
    });
  };

  const lines = templateString.split("\n");
  const outputLines = [];

  for (const line of lines) {
    // 检查此行是否包含 {{ethPort}} 占位符
    if (/\{\{\s*ethPort\s*\}\}/.test(line) && ethPorts.length > 1) {
      // 存在多个端口，按勾选端口智能逐行展开
      for (const p of ethPorts) {
        let singlePortLine = line;
        // 智能兼容：如果模板中写了 "eth {{ethPort}}" 且端口本身自带 "eth " 前缀 (如 "eth 1")，规整为单个 "eth"
        if (/eth\s+\{\{\s*ethPort\s*\}\}/i.test(singlePortLine) && /^eth\s+/i.test(p)) {
          singlePortLine = singlePortLine.replace(/eth\s+\{\{\s*ethPort\s*\}\}/gi, "{{ethPort}}");
        }
        outputLines.push(renderLine(singlePortLine, { ...variables, ethPort: p }));
      }
    } else {
      let singleLine = line;
      if (/eth\s+\{\{\s*ethPort\s*\}\}/i.test(singleLine) && /^eth\s+/i.test(variables.ethPort)) {
        singleLine = singleLine.replace(/eth\s+\{\{\s*ethPort\s*\}\}/gi, "{{ethPort}}");
      }
      outputLines.push(renderLine(singleLine, variables));
    }
  }

  return outputLines.join("\n");
}

/**
 * 完整的配置方案生成函数
 * @param {object} template 模板对象 (含 commandTemplate, portMode 等)
 * @param {object} input 输入参数 (坐标、SN、VLAN等)
 */
export function renderConfigPlan(template, input = {}) {
  if (!template) {
    return {
      blocked: true,
      warnings: ["未找到对应配置模板。"],
      commands: "",
      variables: {}
    };
  }

  // 调用方传 undefined 的字段不能盖掉模板默认值（例如自定义方案的默认内层 VLAN）。
  const definedInput = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== null && value !== ""));
  const { values: templateInputs, problems } = resolveTemplateInputs(template, input.templateInputs || {});
  const variables = buildRenderVariables({
    ...template.defaultParams,
    ...definedInput,
    vendor: template.vendor || input.vendor,
    customVariables: { ...(definedInput.customVariables || {}), ...templateInputs }
  });

  // 基础必填检查
  const warnings = [];
  if (!variables.serial) {
    warnings.push("缺少 ONU 序列号 (serial)。");
  }
  warnings.push(...problems);

  // 如果模板命令中用到了 outerVlan 且为空，提示告警
  const templateBody = template.commandTemplate || template.template || "";
  if (templateBody.includes("{{outerVlan}}") && !variables.outerVlan) {
    warnings.push("当前方案需要外层 VLAN (outerVlan)，但未在 PON 台账或输入中匹配到。");
  }

  const renderedCommands = renderTemplateString(templateBody, variables);
  const unresolved = [...new Set(extractTemplateVariables(renderedCommands).map((item) => item.name))];
  if (unresolved.length) {
    warnings.push(`模板里的 ${unresolved.map((name) => `{{${name}}}`).join("、")} 不是已知变量，已阻止生成；请到配置方案管理修正。`);
  }

  const blocked = !variables.serial || problems.length > 0 || unresolved.length > 0;
  return {
    blocked,
    id: template.id,
    name: template.name,
    vendor: template.vendor,
    businessType: template.businessType,
    portMode: template.portMode || "single",
    warnings: warnings.length ? warnings : ["只生成命令预览供人工核对复制，系统不会下发或保存到 OLT。"],
    variables,
    commands: blocked ? "" : renderedCommands
  };
}
