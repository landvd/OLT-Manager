const maxZteOnuId = 128;
const defaultEthPorts = ["eth_0/1"];
const allEthPorts = ["eth_0/1", "eth_0/2", "eth_0/3", "eth_0/4"];

export const configTemplates = [
  {
    id: "zte-self-operated-internet",
    name: "ZTE 自营上网",
    vendor: "zte",
    businessType: "self-operated-internet",
    vlanRules: { innerVlan: "3301", outerVlan: "required" },
    portRules: { mode: "selectable", defaults: defaultEthPorts, allowed: allEthPorts }
  },
  {
    id: "zte-link-booth",
    name: "ZTE 内部网络",
    vendor: "zte",
    businessType: "link-booth",
    vlanRules: { innerVlan: "100", outerVlan: "none" },
    portRules: { mode: "selectable", defaults: defaultEthPorts, allowed: allEthPorts }
  },
  {
    id: "zte-mdu-ott",
    name: "ZTE MDU+OTT",
    vendor: "zte",
    businessType: "mdu-ott",
    vlanRules: {
      liveVlan: "86",
      defaultVlan: "90",
      intranetVlan: "100",
      innerVlan: "dynamic",
      outerVlan: "dynamic",
      ottVlan: "dynamic"
    },
    portRules: { mode: "fixed-mapping", defaults: allEthPorts, allowed: allEthPorts }
  }
];

export function suggestNextOnuId(rows = []) {
  const lastOnuId = rows.reduce((max, row) => {
    const value = Number(row?.onuId);
    return Number.isFinite(value) ? Math.max(max, value) : max;
  }, 0);
  if (lastOnuId >= maxZteOnuId) {
    return {
      blocked: true,
      onuId: "",
      lastOnuId,
      warning: "PON 口 ONU ID 已达到 128，不能自动生成新 ONU ID。"
    };
  }
  return { blocked: false, onuId: lastOnuId + 1, lastOnuId, warning: "" };
}

function asVlan(value) {
  const text = String(value || "").trim();
  return /^\d{1,4}$/.test(text) && text !== "0" ? text : "";
}

function normalizeEthPorts(ethPorts = defaultEthPorts) {
  const ports = Array.isArray(ethPorts) ? ethPorts : [ethPorts];
  const clean = ports.map((port) => String(port || "").trim()).filter((port) => allEthPorts.includes(port));
  return clean.length ? [...new Set(clean)] : defaultEthPorts;
}

function templateById(templateId) {
  return configTemplates.find((template) => template.id === templateId) || configTemplates[0];
}

export function extractMduOttVlans(servicePorts = []) {
  const rows = servicePorts.map((row) => ({
    ...row,
    userVlan: asVlan(row.userVlan),
    cVlan: asVlan(row.cVlan),
    sVlan: asVlan(row.sVlan)
  }));
  const internetRow = rows.find((row) => row.sVlan && row.userVlan);
  const fixed = new Set(["86", "90", "100"]);
  const ottRow = rows.find((row) => row.userVlan && !row.sVlan && !fixed.has(row.userVlan));

  const vlans = {
    innerVlan: internetRow?.userVlan || internetRow?.cVlan || "",
    outerVlan: internetRow?.sVlan || "",
    ottVlan: ottRow?.userVlan || ottRow?.cVlan || "",
    liveVlan: "86",
    defaultVlan: "90",
    intranetVlan: "100"
  };
  const missing = Object.entries(vlans)
    .filter(([key, value]) => key !== "defaultVlan" && !value)
    .map(([key]) => key);

  return {
    ok: missing.length === 0,
    vlans,
    missing,
    source: internetRow || ottRow ? "同 PON 已配置样板 ONU service-port" : ""
  };
}

function baseVariables({ slot, pon, serial, onuId }) {
  return {
    slot: String(slot || "").trim(),
    pon: String(pon || "").trim(),
    serial: String(serial || "").trim(),
    onuId: String(onuId || "").trim()
  };
}

function blockedPlan(template, warnings, variables = {}) {
  return {
    blocked: true,
    id: template.id,
    name: template.name,
    vendor: template.vendor,
    businessType: template.businessType,
    warnings,
    variables,
    commands: ""
  };
}

function plan(template, commands, warnings, variables) {
  return {
    blocked: false,
    id: template.id,
    name: template.name,
    vendor: template.vendor,
    businessType: template.businessType,
    warnings,
    variables,
    commands: commands.join("\n"),
    template: commands.join("\n")
  };
}

function validateBase(template, vars) {
  const missing = Object.entries(vars).filter(([, value]) => !value).map(([key]) => key);
  return missing.length ? blockedPlan(template, [`缺少必要参数：${missing.join("、")}。`], vars) : null;
}

export function buildConfigPlanFromTemplate(input = {}) {
  const template = templateById(input.templateId);
  const vars = baseVariables(input);
  const invalid = validateBase(template, vars);
  if (invalid) return invalid;

  if (template.id === "zte-link-booth") {
    return buildLinkBoothPlan(template, vars, input);
  }
  if (template.id === "zte-mdu-ott") {
    return buildMduOttPlan(template, vars, input);
  }
  return buildSelfOperatedPlan(template, vars, input);
}

function buildSelfOperatedPlan(template, vars, input) {
  const outerVlan = asVlan(input.outerVlan);
  const innerVlan = "3301";
  if (!outerVlan) {
    return blockedPlan(template, ["缺少 OUTERVLAN，不能生成自营上网配置方案。"], { ...vars, innerVlan, outerVlan });
  }
  const ethPorts = normalizeEthPorts(input.ethPorts);
  const commands = [
    "configure terminal",
    "",
    `interface gpon-olt_1/${vars.slot}/${vars.pon}`,
    `onu ${vars.onuId} type GPON-SFU sn ${vars.serial}`,
    "exit",
    "",
    `interface gpon-onu_1/${vars.slot}/${vars.pon}:${vars.onuId}`,
    "tcont 1 profile MDUtcont",
    "gemport 1 tcont 1",
    `service-port 1 vport 1 user-vlan ${innerVlan} vlan ${innerVlan} svlan ${outerVlan}`,
    "exit",
    "",
    `pon-onu-mng gpon-onu_1/${vars.slot}/${vars.pon}:${vars.onuId}`,
    `Service ziying gemport 1 vlan ${innerVlan}`,
    ...ethPorts.map((port) => `Vlan port ${port} mode hybrid def-vlan ${innerVlan}`),
    "exit"
  ];
  return plan(template, commands, ["只生成命令预览，不会执行或下发到 OLT。"], { ...vars, innerVlan, outerVlan, ethPorts });
}

function buildLinkBoothPlan(template, vars, input) {
  const innerVlan = "100";
  const ethPorts = normalizeEthPorts(input.ethPorts);
  const commands = [
    "configure terminal",
    "",
    `interface gpon-olt_1/${vars.slot}/${vars.pon}`,
    `onu ${vars.onuId} type GPON-SFU sn ${vars.serial}`,
    "exit",
    "",
    `interface gpon-onu_1/${vars.slot}/${vars.pon}:${vars.onuId}`,
    "sn-bind disable",
    "tcont 1 profile MDUtcont",
    "gemport 1 tcont 1",
    `service-port 1 vport 1 user-vlan ${innerVlan} vlan ${innerVlan}`,
    "exit",
    "",
    `pon-onu-mng gpon-onu_1/${vars.slot}/${vars.pon}:${vars.onuId}`,
    "service 1 gemport 1",
    ...ethPorts.map((port) => `vlan port ${port} mode hybrid def-vlan ${innerVlan}`),
    "exit"
  ];
  return plan(template, commands, ["只生成命令预览，不会执行或下发到 OLT。"], { ...vars, innerVlan, ethPorts });
}

function buildMduOttPlan(template, vars, input) {
  const dynamicVlans = input.dynamicVlans || {};
  const innerVlan = asVlan(dynamicVlans.innerVlan);
  const outerVlan = asVlan(dynamicVlans.outerVlan);
  const ottVlan = asVlan(dynamicVlans.ottVlan);
  const liveVlan = "86";
  const defaultVlan = "90";
  const intranetVlan = "100";
  const missing = [
    ["内层 VLAN", innerVlan],
    ["外层 VLAN", outerVlan],
    ["互动 VLAN", ottVlan]
  ].filter(([, value]) => !value).map(([label]) => label);
  const variables = { ...vars, innerVlan, outerVlan, ottVlan, liveVlan, defaultVlan, intranetVlan };
  if (missing.length) {
    return blockedPlan(template, [`缺少 ${missing.join("、")}，不能生成 MDU+OTT 配置方案。`], variables);
  }
  const commands = [
    "configure terminal",
    "",
    `interface gpon-olt_1/${vars.slot}/${vars.pon}`,
    `onu ${vars.onuId} type GPON-SFU sn ${vars.serial}`,
    "exit",
    "",
    `interface gpon-onu_1/${vars.slot}/${vars.pon}:${vars.onuId}`,
    "sn-bind disable",
    "tcont 1 profile MDUtcont",
    "gemport 1 tcont 1",
    `service-port 1 vport 1 user-vlan ${innerVlan} vlan ${innerVlan} svlan ${outerVlan}`,
    `service-port 2 vport 1 user-vlan ${ottVlan} vlan ${ottVlan}`,
    `service-port 3 vport 1 user-vlan ${liveVlan} vlan ${liveVlan}`,
    `service-port 4 vport 1 user-vlan ${intranetVlan} vlan ${intranetVlan}`,
    "exit",
    "",
    `pon-onu-mng gpon-onu_1/${vars.slot}/${vars.pon}:${vars.onuId}`,
    `service 1 gemport 1 vlan ${innerVlan},${liveVlan},${ottVlan},${intranetVlan}`,
    "igmp eth_0/2 profile GPONSFU",
    "igmp eth_0/3 profile GPONSFU",
    `vlan port eth_0/1 mode hybrid def-vlan ${innerVlan}`,
    `vlan port eth_0/2 mode hybrid def-vlan ${ottVlan}`,
    `vlan port eth_0/3 mode hybrid def-vlan ${ottVlan}`,
    `vlan port eth_0/4 mode hybrid def-vlan ${intranetVlan}`,
    `mvlan ${liveVlan}`,
    "exit"
  ];
  return plan(template, commands, ["MDU+OTT 动态 VLAN 来自同 PON 已配置样板 ONU。", "只生成命令预览，不会执行或下发到 OLT。"], variables);
}
