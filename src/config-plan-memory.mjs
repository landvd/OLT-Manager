// 生成方案弹窗记住每台 OLT 上次用的模板（ADR-084 第二批）。只存本机浏览器存储，读写失败时忽略。
const KEY_PREFIX = "olt-manager:config-plan-template:";

export function rememberedTemplateId(oltId, storage = globalThis.localStorage) {
  try {
    return oltId ? String(storage?.getItem(`${KEY_PREFIX}${oltId}`) || "") : "";
  } catch {
    return "";
  }
}

export function rememberTemplateId(oltId, templateId, storage = globalThis.localStorage) {
  try {
    if (oltId && templateId) storage?.setItem(`${KEY_PREFIX}${oltId}`, String(templateId));
  } catch {
    // 浏览器存储不可用时不记。
  }
}

/** 打开弹窗时选哪个模板：上次用的（还在可用列表里）优先，否则第一个。 */
export function initialTemplateId(templates = [], remembered = "") {
  if (remembered && templates.some((template) => template.id === remembered)) return remembered;
  return templates[0]?.id || "";
}

/** 下拉分组：我的方案、专线项目、内置方案。 */
export function groupConfigTemplates(templates = []) {
  const groups = [
    { label: "我的方案", options: templates.filter((template) => !template.isBuiltin && !template.projectId) },
    { label: "专线项目", options: templates.filter((template) => template.projectId) },
    { label: "内置方案", options: templates.filter((template) => template.isBuiltin && !template.projectId) }
  ];
  return groups.filter((group) => group.options.length);
}

const SUMMARY_KEYS = [
  ["actualOntId", "ONU ID"], ["suggestedOnuId", "ONU ID"], ["onuId", "ONU ID"],
  ["outerVlan", "外层 VLAN"], ["ledgerOuterVlan", "外层 VLAN"], ["innerVlan", "内层 VLAN"],
  ["customVlan", "业务 VLAN"], ["projectVlan", "项目 VLAN"], ["ethPorts", "网口"], ["projectName", "项目"]
];

/** 变量来源一行摘要：ONU ID、VLAN、网口等最常核对的几项。 */
export function configPlanSummary(variables = {}, formatValue = (key, value) => (Array.isArray(value) ? value.join(", ") : String(value))) {
  const seen = new Set();
  const parts = [];
  for (const [key, label] of SUMMARY_KEYS) {
    const value = variables[key];
    if (seen.has(label) || value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length)) continue;
    seen.add(label);
    parts.push(`${label} ${formatValue(key, value)}`);
  }
  return parts.join(" · ");
}
