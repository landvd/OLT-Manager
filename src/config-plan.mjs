const maxZteOnuId = 128;
const defaultEthPorts = ["eth_0/1"];
const allEthPorts = ["eth_0/1", "eth_0/2", "eth_0/3", "eth_0/4"];
const defaultHuaweiEthPorts = ["eth1"];
const allHuaweiEthPorts = ["eth1", "eth2", "eth3", "eth4"];

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
    id: "zte-custom-vlan",
    name: "ZTE 自定义 VLAN",
    vendor: "zte",
    businessType: "custom-vlan",
    vlanRules: { innerVlan: "custom", outerVlan: "none" },
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
  },
  {
    id: "huawei-self-operated-internet",
    name: "Huawei 自营上网",
    vendor: "huawei",
    businessType: "self-operated-internet",
    vlanRules: { innerVlan: "3301", outerVlan: "required" },
    portRules: { mode: "selectable", defaults: defaultHuaweiEthPorts, allowed: allHuaweiEthPorts },
    profileRules: { lineProfileId: "300", serviceProfileId: "300", gemportId: "0" }
  },
  {
    id: "huawei-link-booth",
    name: "Huawei 内部网络",
    vendor: "huawei",
    businessType: "link-booth",
    vlanRules: { innerVlan: "100", outerVlan: "none" },
    portRules: { mode: "selectable", defaults: allHuaweiEthPorts, allowed: allHuaweiEthPorts },
    profileRules: { lineProfileId: "300", serviceProfileId: "300", gemportId: "0" }
  },
  {
    id: "huawei-custom-vlan",
    name: "Huawei 自定义 VLAN",
    vendor: "huawei",
    businessType: "custom-vlan",
    vlanRules: { innerVlan: "custom", outerVlan: "none" },
    portRules: { mode: "selectable", defaults: allHuaweiEthPorts, allowed: allHuaweiEthPorts },
    profileRules: { lineProfileId: "300", serviceProfileId: "300", gemportId: "0" }
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
  if (!/^\d{1,4}$/.test(text)) return "";
  const vlan = Number(text);
  return vlan >= 1 && vlan <= 4094 ? text : "";
}

function normalizeEthPorts(ethPorts = defaultEthPorts) {
  const ports = Array.isArray(ethPorts) ? ethPorts : [ethPorts];
  const clean = ports.map((port) => String(port || "").trim()).filter((port) => allEthPorts.includes(port));
  return clean.length ? [...new Set(clean)] : defaultEthPorts;
}

function normalizeHuaweiEthPorts(ethPorts, defaults = defaultHuaweiEthPorts) {
  const ports = ethPorts === undefined ? defaults : (Array.isArray(ethPorts) ? ethPorts : [ethPorts]);
  const clean = ports.map((port) => String(port || "").trim()).filter((port) => allHuaweiEthPorts.includes(port));
  return [...new Set(clean)];
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

function baseVariables({ slot, pon, serial, onuId, actualOntId }) {
  return {
    slot: String(slot || "").trim(),
    pon: String(pon || "").trim(),
    serial: String(serial || "").trim(),
    onuId: String(onuId || "").trim(),
    actualOntId: String(actualOntId ?? "").trim()
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

export function zteVerificationCommands(vars) {
  const slot = String(vars?.slot || "").trim();
  const pon = String(vars?.pon || "").trim();
  const onuId = String(vars?.onuId || "").trim();
  if (!slot || !pon || !onuId) return [];
  const onuName = `gpon-onu_1/${slot}/${pon}:${onuId}`;
  return [
    `show running-config interface ${onuName}`,
    `show onu running config ${onuName}`
  ];
}

function appendZteVerificationCommands(commands, vars) {
  return [
    ...commands,
    "",
    ...zteVerificationCommands(vars)
  ];
}

function validateBase(template, vars) {
  const required = template.vendor === "huawei" ? ["slot", "pon", "serial"] : ["slot", "pon", "serial", "onuId"];
  const missing = required.filter((key) => !vars[key]);
  return missing.length ? blockedPlan(template, [`缺少必要参数：${missing.join("、")}。`], vars) : null;
}

function isValidHuaweiOntId(value) {
  const text = String(value ?? "").trim();
  if (!/^\d{1,3}$/.test(text)) return false;
  const id = Number(text);
  return id >= 0 && id <= 255;
}

function huaweiOntIdPromptPlan(template, commands, warning, variables) {
  return plan(template, commands, [
    warning,
    "Huawei ONT ID 由 OLT 自动分配；执行 ont add 后，从终端回显的 PortID/ONTID 获取实际 ID，再填入“实际 ONT ID”生成后续命令。",
    "未填实际 ONT ID 前，系统只生成注册命令，不生成 native-vlan 或 service-port。"
  ], variables);
}

function asciiToHex(text) {
  return [...text].map((char) => char.charCodeAt(0).toString(16).padStart(2, "0").toUpperCase()).join("");
}

export function huaweiSnAuthSerial(serial) {
  const text = String(serial || "").trim();
  const clean = text.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  if (/^[0-9A-F]{16}$/.test(clean)) return clean;
  const match = clean.match(/^([A-Z0-9]{4})([0-9A-F]{8})$/);
  return match ? `${asciiToHex(match[1])}${match[2]}` : text;
}

export function buildConfigPlanFromTemplate(input = {}) {
  const template = templateById(input.templateId);
  const vars = baseVariables(input);
  const invalid = validateBase(template, vars);
  if (invalid) return invalid;

  if (template.id === "huawei-self-operated-internet") {
    return buildHuaweiSelfOperatedPlan(template, vars, input);
  }
  if (template.id === "huawei-link-booth") {
    return buildHuaweiLinkBoothPlan(template, vars, input);
  }
  if (template.id === "huawei-custom-vlan") {
    return buildHuaweiCustomVlanPlan(template, vars, input);
  }
  if (template.id === "zte-link-booth") {
    return buildLinkBoothPlan(template, vars, input);
  }
  if (template.id === "zte-custom-vlan") {
    return buildCustomVlanPlan(template, vars, input);
  }
  if (template.id === "zte-mdu-ott") {
    return buildMduOttPlan(template, vars, input);
  }
  return buildSelfOperatedPlan(template, vars, input);
}

function buildHuaweiSelfOperatedPlan(template, vars, input) {
  const outerVlan = asVlan(input.outerVlan);
  const innerVlan = "3301";
  const lineProfileId = "300";
  const serviceProfileId = "300";
  const gemportId = "0";
  const snAuthSerial = huaweiSnAuthSerial(vars.serial);
  const ethPorts = normalizeHuaweiEthPorts(input.ethPorts, template.portRules.defaults);
  if (!ethPorts.length) {
    return blockedPlan(template, ["请至少选择一个有效的 Huawei eth 端口。"], {
      ...vars,
      snAuthSerial,
      innerVlan,
      outerVlan,
      lineProfileId,
      serviceProfileId,
      gemportId,
      ethPorts
    });
  }
  if (!outerVlan) {
    return blockedPlan(template, ["缺少 OUTERVLAN，不能生成 Huawei 自营上网配置方案。"], {
      ...vars,
      snAuthSerial,
      innerVlan,
      outerVlan,
      lineProfileId,
      serviceProfileId,
      gemportId,
      ethPorts
    });
  }
  const registerCommands = [
    "config",
    `interface gpon 0/${vars.slot}`,
    `ont add ${vars.pon} sn-auth ${snAuthSerial} omci ont-lineprofile-id ${lineProfileId} ont-srvprofile-id ${serviceProfileId}`
  ];
  const actualOntId = vars.actualOntId;
  const variables = {
    ...vars,
    snAuthSerial,
    innerVlan,
    outerVlan,
    lineProfileId,
    serviceProfileId,
    gemportId,
    ethPorts
  };
  if (!isValidHuaweiOntId(actualOntId)) {
    return huaweiOntIdPromptPlan(template, registerCommands, "按已验证 Huawei 自营上网文档生成注册命令预览；不会执行或下发到 OLT。", variables);
  }
  const commands = [
    ...registerCommands,
    ...ethPorts.map((port) => `ont port native-vlan ${vars.pon} ${actualOntId} ${port} vlan ${innerVlan}`),
    "quit",
    `service-port vlan ${outerVlan} gpon 0/${vars.slot}/${vars.pon} ont ${actualOntId} gemport ${gemportId} multi-service user-vlan ${innerVlan} tag-transform translate-and-add inner-vlan ${innerVlan} inner-priority 0`
  ];
  return plan(template, commands, ["按已验证 Huawei 自营上网文档生成命令预览；不会执行或下发到 OLT。"], variables);
}

function buildHuaweiLinkBoothPlan(template, vars, input) {
  return buildHuaweiSingleVlanPlan(template, vars, input, "100", "按 Huawei MA5800 内部网络现场命令生成预览；不会执行或下发到 OLT。");
}

function buildHuaweiCustomVlanPlan(template, vars, input) {
  const innerVlan = asVlan(input.customVlan);
  if (!innerVlan) {
    return blockedPlan(template, ["缺少自定义 VLAN，不能生成 Huawei 自定义 VLAN 配置方案。"], { ...vars, innerVlan });
  }
  return buildHuaweiSingleVlanPlan(template, vars, input, innerVlan, "按 Huawei MA5800 自定义 VLAN 方案生成命令预览；不会执行或下发到 OLT。");
}

function buildHuaweiSingleVlanPlan(template, vars, input, innerVlan, warning) {
  const lineProfileId = "300";
  const serviceProfileId = "300";
  const gemportId = "0";
  const snAuthSerial = huaweiSnAuthSerial(vars.serial);
  const ethPorts = normalizeHuaweiEthPorts(input.ethPorts, template.portRules.defaults);
  if (!ethPorts.length) {
    return blockedPlan(template, ["请至少选择一个有效的 Huawei eth 端口。"], {
      ...vars,
      snAuthSerial,
      innerVlan,
      gemportId,
      lineProfileId,
      serviceProfileId,
      ethPorts
    });
  }
  const registerCommands = [
    "config",
    `interface gpon 0/${vars.slot}`,
    `ont add ${vars.pon} sn-auth ${snAuthSerial} omci ont-lineprofile-id ${lineProfileId} ont-srvprofile-id ${serviceProfileId}`
  ];
  const actualOntId = vars.actualOntId;
  const variables = {
    ...vars,
    snAuthSerial,
    innerVlan,
    gemportId,
    lineProfileId,
    serviceProfileId,
    ethPorts
  };
  if (!isValidHuaweiOntId(actualOntId)) {
    return huaweiOntIdPromptPlan(template, registerCommands, warning.replace("命令预览", "注册命令预览"), variables);
  }
  const commands = [
    ...registerCommands,
    ...ethPorts.map((port) => `ont port native-vlan ${vars.pon} ${actualOntId} ${port} vlan ${innerVlan} priority 0`),
    "quit",
    "",
    `service-port vlan ${innerVlan} gpon 0/${vars.slot}/${vars.pon} ont ${actualOntId} gemport ${gemportId} multi-service user-vlan ${innerVlan} tag-transform translate`
  ];
  return plan(template, commands, [warning], variables);
}

function buildSelfOperatedPlan(template, vars, input) {
  const outerVlan = asVlan(input.outerVlan);
  const innerVlan = "3301";
  if (!outerVlan) {
    return blockedPlan(template, ["缺少 OUTERVLAN，不能生成自营上网配置方案。"], { ...vars, innerVlan, outerVlan });
  }
  const ethPorts = normalizeEthPorts(input.ethPorts);
  const commands = [
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
  return plan(template, appendZteVerificationCommands(commands, vars), ["只生成命令预览，不会执行或下发到 OLT。"], { ...vars, innerVlan, outerVlan, ethPorts });
}

function buildLinkBoothPlan(template, vars, input) {
  const innerVlan = "100";
  return buildZteSingleVlanPlan(template, vars, input, innerVlan);
}

function buildCustomVlanPlan(template, vars, input) {
  const innerVlan = asVlan(input.customVlan);
  if (!innerVlan) {
    return blockedPlan(template, ["缺少自定义 VLAN，不能生成 ZTE 自定义 VLAN 配置方案。"], { ...vars, innerVlan });
  }
  return buildZteSingleVlanPlan(template, vars, input, innerVlan);
}

function buildZteSingleVlanPlan(template, vars, input, innerVlan) {
  const ethPorts = normalizeEthPorts(input.ethPorts);
  const commands = [
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
  return plan(template, appendZteVerificationCommands(commands, vars), ["只生成命令预览，不会执行或下发到 OLT。"], { ...vars, innerVlan, ethPorts });
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
  return plan(template, appendZteVerificationCommands(commands, vars), ["MDU+OTT 动态 VLAN 来自同 PON 已配置样板 ONU。", "只生成命令预览，不会执行或下发到 OLT。"], variables);
}
