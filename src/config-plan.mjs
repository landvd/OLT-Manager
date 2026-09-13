const maxZteOnuId = 128;
const maxHuaweiOntId = 255;
const defaultZteChassis = "1";
const defaultHuaweiChassis = "0";
const defaultEthPorts = ["eth_0/1"];
const allEthPorts = ["eth_0/1", "eth_0/2", "eth_0/3", "eth_0/4"];
const ethPortLabels = { "eth_0/1": "网口1", "eth_0/2": "网口2", "eth_0/3": "网口3", "eth_0/4": "网口4" };
const defaultHuaweiEthPorts = ["eth1"];
const allHuaweiEthPorts = ["eth1", "eth2", "eth3", "eth4"];
const huaweiEthPortLabels = { eth1: "网口1", eth2: "网口2", eth3: "网口3", eth4: "网口4" };
const defaultZteC600Ports = ["veip_1"];
const allZteC600Ports = ["veip_1", "eth_0/1", "eth_0/2", "eth_0/3", "eth_0/4"];
const zteC600PortLabels = {
  veip_1: "虚拟网口 (VEIP/智能网关)",
  "eth_0/1": "网口1",
  "eth_0/2": "网口2",
  "eth_0/3": "网口3",
  "eth_0/4": "网口4"
};

export const configTemplates = [
  {
    id: "zte-self-operated-internet",
    name: "ZTE 自营上网",
    vendor: "zte",
    deviceProfiles: ["zte-c300"],
    businessType: "self-operated-internet",
    vlanRules: { innerVlan: "3301", outerVlan: "required" },
    portRules: { mode: "selectable", defaults: defaultEthPorts, allowed: allEthPorts, labels: ethPortLabels }
  },
  {
    id: "zte-c600-self-operated-internet",
    name: "ZTE 自营上网",
    vendor: "zte",
    deviceProfiles: ["zte-c600"],
    businessType: "self-operated-internet",
    vlanRules: { innerVlan: "3301", outerVlan: "none" },
    portRules: { mode: "selectable", defaults: defaultZteC600Ports, allowed: allZteC600Ports, labels: zteC600PortLabels }
  },
  {
    id: "zte-link-booth",
    name: "ZTE 内部网络",
    vendor: "zte",
    deviceProfiles: ["zte-c300"],
    businessType: "link-booth",
    vlanRules: { innerVlan: "100", outerVlan: "none" },
    portRules: { mode: "selectable", defaults: defaultEthPorts, allowed: allEthPorts, labels: ethPortLabels }
  },
  {
    id: "zte-c600-link-booth",
    name: "ZTE 内部网络",
    vendor: "zte",
    deviceProfiles: ["zte-c600"],
    businessType: "link-booth",
    vlanRules: { innerVlan: "100", outerVlan: "none" },
    portRules: { mode: "selectable", defaults: defaultZteC600Ports, allowed: allZteC600Ports, labels: zteC600PortLabels }
  },
  {
    id: "zte-custom-vlan",
    name: "ZTE 自定义 VLAN",
    vendor: "zte",
    deviceProfiles: ["zte-c300"],
    businessType: "custom-vlan",
    vlanRules: { innerVlan: "custom", outerVlan: "none" },
    portRules: { mode: "selectable", defaults: defaultEthPorts, allowed: allEthPorts, labels: ethPortLabels }
  },
  {
    id: "zte-c600-custom-vlan",
    name: "ZTE 自定义 VLAN",
    vendor: "zte",
    deviceProfiles: ["zte-c600"],
    businessType: "custom-vlan",
    vlanRules: { innerVlan: "custom", outerVlan: "none" },
    portRules: { mode: "selectable", defaults: defaultZteC600Ports, allowed: allZteC600Ports, labels: zteC600PortLabels }
  },
  {
    id: "zte-mdu-ott",
    name: "ZTE MDU+OTT",
    vendor: "zte",
    deviceProfiles: ["zte-c300"],
    businessType: "mdu-ott",
    vlanRules: {
      liveVlan: "86",
      defaultVlan: "90",
      intranetVlan: "100",
      innerVlan: "dynamic",
      outerVlan: "dynamic",
      ottVlan: "dynamic"
    },
    portRules: { mode: "fixed-mapping", defaults: allEthPorts, allowed: allEthPorts, labels: ethPortLabels }
  },
  {
    id: "huawei-self-operated-internet",
    name: "Huawei 自营上网",
    vendor: "huawei",
    deviceProfiles: ["huawei-ma5800"],
    businessType: "self-operated-internet",
    vlanRules: { innerVlan: "3301", outerVlan: "required" },
    portRules: { mode: "selectable", defaults: defaultHuaweiEthPorts, allowed: allHuaweiEthPorts, labels: huaweiEthPortLabels },
    profileRules: { lineProfileId: "300", serviceProfileId: "300", gemportId: "0" }
  },
  {
    id: "huawei-link-booth",
    name: "Huawei 内部网络",
    vendor: "huawei",
    deviceProfiles: ["huawei-ma5800"],
    businessType: "link-booth",
    vlanRules: { innerVlan: "100", outerVlan: "none" },
    portRules: { mode: "selectable", defaults: allHuaweiEthPorts, allowed: allHuaweiEthPorts, labels: huaweiEthPortLabels },
    profileRules: { lineProfileId: "300", serviceProfileId: "300", gemportId: "0" }
  },
  {
    id: "huawei-custom-vlan",
    name: "Huawei 自定义 VLAN",
    vendor: "huawei",
    deviceProfiles: ["huawei-ma5800"],
    businessType: "custom-vlan",
    vlanRules: { innerVlan: "custom", outerVlan: "none" },
    portRules: { mode: "selectable", defaults: allHuaweiEthPorts, allowed: allHuaweiEthPorts, labels: huaweiEthPortLabels },
    profileRules: { lineProfileId: "300", serviceProfileId: "300", gemportId: "0" }
  },
  {
    id: "zte-hotel-quad-play",
    name: "ZTE 酒店全光网/四口复合方案",
    vendor: "zte",
    deviceProfiles: ["zte-c300"],
    businessType: "hotel-quad-play",
    vlanRules: {
      internetVlan: "3301",
      liveVlan: "86",
      ottVlan: "90",
      intranetVlan: "100",
      diaInnerVlan: "10",
      diaOuterVlan: "3500"
    },
    portRules: { mode: "fixed-mapping", defaults: allEthPorts, allowed: allEthPorts, labels: ethPortLabels }
  },
  {
    id: "zte-c600-hotel-quad-play",
    name: "ZTE C600 酒店全光网/四口复合方案",
    vendor: "zte",
    deviceProfiles: ["zte-c600"],
    businessType: "hotel-quad-play",
    vlanRules: {
      internetVlan: "3301",
      liveVlan: "86",
      ottVlan: "90",
      intranetVlan: "100",
      diaInnerVlan: "10",
      diaOuterVlan: "3500"
    },
    portRules: { mode: "fixed-mapping", defaults: allEthPorts, allowed: allEthPorts, labels: ethPortLabels }
  },
  {
    id: "huawei-hotel-quad-play",
    name: "Huawei 酒店全光网/四口复合方案",
    vendor: "huawei",
    deviceProfiles: ["huawei-ma5800"],
    businessType: "hotel-quad-play",
    vlanRules: {
      internetVlan: "3301",
      liveVlan: "86",
      ottVlan: "90",
      intranetVlan: "100",
      diaInnerVlan: "10",
      diaOuterVlan: "3500"
    },
    portRules: { mode: "fixed-mapping", defaults: allHuaweiEthPorts, allowed: allHuaweiEthPorts, labels: huaweiEthPortLabels },
    profileRules: { lineProfileId: "300", serviceProfileId: "300", gemportId: "1" }
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

export function suggestHuaweiOntId(rows = []) {
  const occupied = new Set();
  let lastOnuId = 0;
  for (const row of rows) {
    const value = Number(row?.onuId);
    if (!Number.isInteger(value) || value < 0 || value > maxHuaweiOntId) continue;
    occupied.add(value);
    lastOnuId = Math.max(lastOnuId, value);
  }
  const onuId = Array.from({ length: maxHuaweiOntId + 1 }, (_, index) => index)
    .find((candidate) => !occupied.has(candidate));
  if (onuId === undefined) {
    return {
      blocked: true,
      onuId: "",
      lastOnuId,
      warning: "PON 口 ONT ID 0-255 均已占用，不能自动选择空闲 ONT ID。"
    };
  }
  return { blocked: false, onuId, lastOnuId, warning: "" };
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

function hasInvalidHuaweiEthPortSelection(ethPorts) {
  if (ethPorts === undefined) return false;
  const ports = Array.isArray(ethPorts) ? ethPorts : [ethPorts];
  return ports.some((port) => !allHuaweiEthPorts.includes(String(port || "").trim()));
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

function baseVariables({ chassis, board, slot, pon, serial, onuId, actualOntId }) {
  const safeBoard = String(board ?? slot ?? "").trim();
  return {
    chassis: String(chassis ?? "").trim(),
    board: safeBoard,
    slot: safeBoard,
    pon: String(pon ?? "").trim(),
    serial: String(serial ?? "").trim(),
    onuId: String(onuId ?? "").trim(),
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
  const chassis = String(vars?.chassis || defaultZteChassis).trim();
  const board = String(vars?.board || vars?.slot || "").trim();
  const pon = String(vars?.pon || "").trim();
  const onuId = String(vars?.onuId || "").trim();
  if (!chassis || !board || !pon || !onuId) return [];
  const onuName = `gpon-onu_${chassis}/${board}/${pon}:${onuId}`;
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
  const required = template.vendor === "huawei" ? ["chassis", "board", "pon", "serial"] : ["chassis", "board", "pon", "serial", "onuId"];
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
  const vars = baseVariables({
    ...input,
    chassis: input.chassis ?? (template.vendor === "huawei" ? defaultHuaweiChassis : defaultZteChassis)
  });
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
  if (template.id === "zte-c600-self-operated-internet") {
    return buildZteC600SelfOperatedPlan(template, vars, input);
  }
  if (template.id === "zte-c600-link-booth") {
    return buildZteC600LinkBoothPlan(template, vars, input);
  }
  if (template.id === "zte-c600-custom-vlan") {
    return buildZteC600CustomVlanPlan(template, vars, input);
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
  if (template.id === "zte-hotel-quad-play") {
    return buildZteHotelQuadPlayPlan(template, vars, input);
  }
  if (template.id === "zte-c600-hotel-quad-play") {
    return buildZteC600HotelQuadPlayPlan(template, vars, input);
  }
  if (template.id === "huawei-hotel-quad-play") {
    return buildHuaweiHotelQuadPlayPlan(template, vars, input);
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
  if (hasInvalidHuaweiEthPortSelection(input.ethPorts)) {
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
    `interface gpon ${vars.chassis}/${vars.board}`,
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
    `service-port vlan ${outerVlan} gpon ${vars.chassis}/${vars.board}/${vars.pon} ont ${actualOntId} gemport ${gemportId} multi-service user-vlan ${innerVlan} tag-transform translate-and-add inner-vlan ${innerVlan} inner-priority 0`
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
    `interface gpon ${vars.chassis}/${vars.board}`,
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
    `service-port vlan ${innerVlan} gpon ${vars.chassis}/${vars.board}/${vars.pon} ont ${actualOntId} gemport ${gemportId} multi-service user-vlan ${innerVlan} tag-transform translate`
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
    `interface gpon-olt_${vars.chassis}/${vars.board}/${vars.pon}`,
    `onu ${vars.onuId} type GPON-SFU sn ${vars.serial}`,
    "exit",
    "",
    `interface gpon-onu_${vars.chassis}/${vars.board}/${vars.pon}:${vars.onuId}`,
    "tcont 1 profile MDUtcont",
    "gemport 1 tcont 1",
    `service-port 1 vport 1 user-vlan ${innerVlan} vlan ${innerVlan} svlan ${outerVlan}`,
    "exit",
    "",
    `pon-onu-mng gpon-onu_${vars.chassis}/${vars.board}/${vars.pon}:${vars.onuId}`,
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
    `interface gpon-olt_${vars.chassis}/${vars.board}/${vars.pon}`,
    `onu ${vars.onuId} type GPON-SFU sn ${vars.serial}`,
    "exit",
    "",
    `interface gpon-onu_${vars.chassis}/${vars.board}/${vars.pon}:${vars.onuId}`,
    "sn-bind disable",
    "tcont 1 profile MDUtcont",
    "gemport 1 tcont 1",
    `service-port 1 vport 1 user-vlan ${innerVlan} vlan ${innerVlan}`,
    "exit",
    "",
    `pon-onu-mng gpon-onu_${vars.chassis}/${vars.board}/${vars.pon}:${vars.onuId}`,
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
    `interface gpon-olt_${vars.chassis}/${vars.board}/${vars.pon}`,
    `onu ${vars.onuId} type GPON-SFU sn ${vars.serial}`,
    "exit",
    "",
    `interface gpon-onu_${vars.chassis}/${vars.board}/${vars.pon}:${vars.onuId}`,
    "sn-bind disable",
    "tcont 1 profile MDUtcont",
    "gemport 1 tcont 1",
    `service-port 1 vport 1 user-vlan ${innerVlan} vlan ${innerVlan} svlan ${outerVlan}`,
    `service-port 2 vport 1 user-vlan ${ottVlan} vlan ${ottVlan}`,
    `service-port 3 vport 1 user-vlan ${liveVlan} vlan ${liveVlan}`,
    `service-port 4 vport 1 user-vlan ${intranetVlan} vlan ${intranetVlan}`,
    "exit",
    "",
    `pon-onu-mng gpon-onu_${vars.chassis}/${vars.board}/${vars.pon}:${vars.onuId}`,
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

function normalizeZteC600Ports(ethPorts = defaultZteC600Ports) {
  const ports = Array.isArray(ethPorts) ? ethPorts : [ethPorts];
  const clean = ports.map((port) => String(port || "").trim()).filter((port) => allZteC600Ports.includes(port));
  return clean.length ? [...new Set(clean)] : defaultZteC600Ports;
}

export function zteC600VerificationCommands(vars) {
  const chassis = String(vars?.chassis || defaultZteChassis).trim();
  const board = String(vars?.board || vars?.slot || "").trim();
  const pon = String(vars?.pon || "").trim();
  const onuId = String(vars?.onuId || "").trim();
  if (!chassis || !board || !pon || !onuId) return [];
  const onuName = `gpon_onu-${chassis}/${board}/${pon}:${onuId}`;
  return [
    `interface ${onuName}`,
    "show this",
    "exit",
    "",
    `pon-onu-mng ${onuName}`,
    "show this",
    "exit"
  ];
}

function appendZteC600VerificationCommands(commands, vars) {
  return [
    ...commands,
    "",
    ...zteC600VerificationCommands(vars)
  ];
}

function renderZteC600PortCommands(ports, innerVlan) {
  const lines = [];
  for (const port of ports) {
    if (port === "veip_1") {
      lines.push("vlan port veip_1 mode trunk", `vlan port veip_1 vlan ${innerVlan}`);
    } else {
      lines.push(`vlan port ${port} mode hybrid def-vlan ${innerVlan}`);
    }
  }
  return lines;
}

function buildZteC600SelfOperatedPlan(template, vars, input) {
  const innerVlan = "3301";
  const ethPorts = normalizeZteC600Ports(input.ethPorts);
  const commands = [
    "configure terminal",
    `interface gpon_olt-${vars.chassis}/${vars.board}/${vars.pon}`,
    `onu ${vars.onuId} type GPON-SFU sn ${vars.serial}`,
    "exit",
    "",
    `interface gpon_onu-${vars.chassis}/${vars.board}/${vars.pon}:${vars.onuId}`,
    "vport-mode manual",
    "tcont 1 name PPPoE profile PPPoE",
    "sn-bind disable",
    "gemport 1 name 1 tcont 1",
    "vport 1 name vlan map-type vlan",
    `vport-map 1 1 vlan ${innerVlan}`,
    "exit",
    "",
    `pon-onu-mng gpon_onu-${vars.chassis}/${vars.board}/${vars.pon}:${vars.onuId}`,
    `service PPPoE gemport 1 vlan ${innerVlan}`,
    ...renderZteC600PortCommands(ethPorts, innerVlan),
    "exit"
  ];
  return plan(template, appendZteC600VerificationCommands(commands, vars), [
    "按已验证 ZTE C600 (ZXA10-TITAN) 架构生成命令预览；只供人工核对复制，系统不会下发或保存到 OLT。"
  ], { ...vars, innerVlan, ethPorts });
}

function buildZteC600LinkBoothPlan(template, vars, input) {
  return buildZteC600SingleVlanPlan(template, vars, input, "100", "intranet");
}

function buildZteC600CustomVlanPlan(template, vars, input) {
  const innerVlan = asVlan(input.customVlan);
  if (!innerVlan) {
    return blockedPlan(template, ["缺少自定义 VLAN，不能生成 ZTE C600 自定义 VLAN 配置方案。"], { ...vars, innerVlan });
  }
  return buildZteC600SingleVlanPlan(template, vars, input, innerVlan, `vlan${innerVlan}`);
}

function buildZteC600SingleVlanPlan(template, vars, input, innerVlan, serviceName = "service1") {
  const ethPorts = normalizeZteC600Ports(input.ethPorts);
  const commands = [
    "configure terminal",
    `interface gpon_olt-${vars.chassis}/${vars.board}/${vars.pon}`,
    `onu ${vars.onuId} type GPON-SFU sn ${vars.serial}`,
    "exit",
    "",
    `interface gpon_onu-${vars.chassis}/${vars.board}/${vars.pon}:${vars.onuId}`,
    "vport-mode manual",
    `tcont 1 name ${serviceName} profile PPPoE`,
    "sn-bind disable",
    "gemport 1 name 1 tcont 1",
    "vport 1 name vlan map-type vlan",
    `vport-map 1 1 vlan ${innerVlan}`,
    "exit",
    "",
    `pon-onu-mng gpon_onu-${vars.chassis}/${vars.board}/${vars.pon}:${vars.onuId}`,
    `service ${serviceName} gemport 1 vlan ${innerVlan}`,
    ...renderZteC600PortCommands(ethPorts, innerVlan),
    "exit"
  ];
  return plan(template, appendZteC600VerificationCommands(commands, vars), [
    "按已验证 ZTE C600 (ZXA10-TITAN) 架构生成命令预览；只供人工核对复制，系统不会下发或保存到 OLT。"
  ], { ...vars, innerVlan, ethPorts });
}

export function buildZteHotelQuadPlayPlan(template, vars, input = {}) {
  const internetVlan = asVlan(input.internetVlan) || "3301";
  const liveVlan = asVlan(input.liveVlan) || "86";
  const ottVlan = asVlan(input.ottVlan) || "90";
  const intranetVlan = asVlan(input.intranetVlan) || "100";
  const diaInnerVlan = asVlan(input.diaInnerVlan) || "10";
  const diaOuterVlan = asVlan(input.diaOuterVlan) || "3500";
  const speed = input.diaSpeed || "100M";

  const preCheck = [
    `! 【前置状态核查】`,
    `show gpon onu state gpon-olt_${vars.chassis}/${vars.board}/${vars.pon}`,
    `show pon power onu-rx gpon-olt_${vars.chassis}/${vars.board}/${vars.pon}`
  ];

  const configCommands = [
    `! 【步骤 1: 物理注册 ONU】`,
    `interface gpon-olt_${vars.chassis}/${vars.board}/${vars.pon}`,
    `onu ${vars.onuId} type GPON-SFU sn ${vars.serial}`,
    `exit`,
    ``,
    `! 【步骤 2: 四大业务独立 T-CONT / GEM Port 硬件管道隔离 (防专线/IPTV带宽被抢占)】`,
    `interface gpon-onu_${vars.chassis}/${vars.board}/${vars.pon}:${vars.onuId}`,
    `sn-bind disable`,
    `tcont 1 name INTERNET profile PPPoE`,
    `tcont 2 name IPTV profile IPTV`,
    `tcont 3 name INTRANET profile INTRANET`,
    `tcont 4 name DIA profile DIA_${speed}`,
    `gemport 1 name INTERNET tcont 1`,
    `gemport 2 name IPTV tcont 2`,
    `gemport 3 name INTRANET tcont 3`,
    `gemport 4 name DIA tcont 4`,
    `exit`,
    ``,
    `! 【步骤 3: 全局业务流打标 (一口宽带/二口IPTV/三口内网/四口QinQ专线)】`,
    `service-port 1 vport 1 user-vlan ${internetVlan} vlan ${internetVlan}`,
    `service-port 2 vport 2 user-vlan ${ottVlan} vlan ${ottVlan}`,
    `service-port 3 vport 3 user-vlan ${intranetVlan} vlan ${intranetVlan}`,
    `service-port 4 vport 4 user-vlan ${diaInnerVlan} svlan ${diaOuterVlan}`,
    ``,
    `! 【步骤 4: ONU 网口精细绑定与 IPTV 组播注入】`,
    `pon-onu-mng gpon-onu_${vars.chassis}/${vars.board}/${vars.pon}:${vars.onuId}`,
    `service 1 gemport 1 vlan ${internetVlan}`,
    `service 2 gemport 2 vlan ${ottVlan},${liveVlan}`,
    `service 3 gemport 3 vlan ${intranetVlan}`,
    `service 4 gemport 4 vlan ${diaInnerVlan}`,
    `vlan port eth_0/1 mode hybrid def-vlan ${internetVlan}`,
    `vlan port eth_0/2 mode hybrid def-vlan ${ottVlan}`,
    `mvlan ${liveVlan}`,
    `igmp eth_0/2 profile GPONSFU`,
    `vlan port eth_0/3 mode hybrid def-vlan ${intranetVlan}`,
    `vlan port eth_0/4 mode trunk`,
    `exit`
  ];

  const postCheck = [
    `! 【分口验收排障命令】`,
    `! 一口验证 (宽带): 查用户 MAC 是否在线`,
    `show mac gpon-onu_${vars.chassis}/${vars.board}/${vars.pon}:${vars.onuId}`,
    `! 二口验证 (IPTV): 查机顶盒组播频道拉流`,
    `show igmp user gpon-onu_${vars.chassis}/${vars.board}/${vars.pon}:${vars.onuId}`,
    `! 四口验证 (专线): 核对业务流与线路光衰`,
    `show service-port gpon-onu_${vars.chassis}/${vars.board}/${vars.pon}:${vars.onuId}`,
    `show pon power attenuation gpon-onu_${vars.chassis}/${vars.board}/${vars.pon}:${vars.onuId}`
  ];

  return plan(template, [...preCheck, "", ...configCommands, "", ...postCheck], [
    "酒店全光网多业务复合方案：一口自营宽带、二口IPTV组播点播、三口内部专网、四口企业专线。",
    "采用 4 个独立 T-CONT / GEM Port 硬件级隔离，防止宽带下载挤占专线与电视带宽。",
    "只生成命令预览供人工核对复制，系统不会下发或保存到 OLT。"
  ], { ...vars, internetVlan, liveVlan, ottVlan, intranetVlan, diaInnerVlan, diaOuterVlan, speed });
}

export function buildZteC600HotelQuadPlayPlan(template, vars, input = {}) {
  const internetVlan = asVlan(input.internetVlan) || "3301";
  const liveVlan = asVlan(input.liveVlan) || "86";
  const ottVlan = asVlan(input.ottVlan) || "90";
  const intranetVlan = asVlan(input.intranetVlan) || "100";
  const diaInnerVlan = asVlan(input.diaInnerVlan) || "10";
  const diaOuterVlan = asVlan(input.diaOuterVlan) || "3500";
  const speed = input.diaSpeed || "100M";

  const preCheck = [
    `! 【前置状态核查】`,
    `show gpon onu rx-power gpon_olt-${vars.chassis}/${vars.board}/${vars.pon}`,
    `show gpon uncfg-onu`
  ];

  const configCommands = [
    `! 【步骤 1: 物理注册 ONU】`,
    `configure terminal`,
    `interface gpon_olt-${vars.chassis}/${vars.board}/${vars.pon}`,
    `onu ${vars.onuId} type GPON-SFU sn ${vars.serial}`,
    `exit`,
    ``,
    `! 【步骤 2: C600 TITAN 端口内 4 组 vport 绑定 (彻底废除全局 service-port)】`,
    `interface gpon_onu-${vars.chassis}/${vars.board}/${vars.pon}:${vars.onuId}`,
    `vport-mode manual`,
    `tcont 1 name INTERNET profile PPPoE`,
    `tcont 2 name IPTV profile IPTV`,
    `tcont 3 name INTRANET profile INTRANET`,
    `tcont 4 name DIA profile DIA_${speed}`,
    `gemport 1 name 1 tcont 1`,
    `gemport 2 name 2 tcont 2`,
    `gemport 3 name 3 tcont 3`,
    `gemport 4 name 4 tcont 4`,
    `vport 1 name internet map-type vlan`,
    `vport-map 1 1 vlan ${internetVlan}`,
    `vport 2 name iptv map-type vlan`,
    `vport-map 2 1 vlan ${ottVlan}`,
    `vport 3 name intranet map-type vlan`,
    `vport-map 3 1 vlan ${intranetVlan}`,
    `vport 4 name dia map-type vlan`,
    `vport-map 4 1 vlan ${diaInnerVlan}`,
    `exit`,
    ``,
    `! 【步骤 3: ONU 网口精细绑定与 IPTV 组播注入】`,
    `pon-onu-mng gpon_onu-${vars.chassis}/${vars.board}/${vars.pon}:${vars.onuId}`,
    `service 1 gemport 1 vlan ${internetVlan}`,
    `service 2 gemport 2 vlan ${ottVlan}`,
    `service 3 gemport 3 vlan ${intranetVlan}`,
    `service 4 gemport 4 vlan ${diaInnerVlan}`,
    `vlan port eth_0/1 mode hybrid def-vlan ${internetVlan}`,
    `vlan port eth_0/2 mode hybrid def-vlan ${ottVlan}`,
    `vlan port eth_0/3 mode hybrid def-vlan ${intranetVlan}`,
    `vlan port eth_0/4 mode trunk`,
    `exit`
  ];

  const postCheck = [
    `! 【分口验收核对 (C600 视图内敲 show this)】`,
    `interface gpon_onu-${vars.chassis}/${vars.board}/${vars.pon}:${vars.onuId}`,
    `show this`,
    `exit`,
    `pon-onu-mng gpon_onu-${vars.chassis}/${vars.board}/${vars.pon}:${vars.onuId}`,
    `show this`,
    `exit`
  ];

  return plan(template, [...preCheck, "", ...configCommands, "", ...postCheck], [
    "中兴 C600 (TITAN 架构) 酒店全光网多业务复合方案：一口自营、二口IPTV、三口内网、四口专线。",
    "TITAN 架构废除全局 service-port，全在接口内完成 4 组 vport 绑定与硬件级 T-CONT 管道隔离。",
    "只生成命令预览供人工核对复制，系统不会下发或保存到 OLT。"
  ], { ...vars, internetVlan, liveVlan, ottVlan, intranetVlan, diaInnerVlan, diaOuterVlan, speed });
}

export function buildHuaweiHotelQuadPlayPlan(template, vars, input = {}) {
  const internetVlan = asVlan(input.internetVlan) || "3301";
  const liveVlan = asVlan(input.liveVlan) || "86";
  const ottVlan = asVlan(input.ottVlan) || "90";
  const intranetVlan = asVlan(input.intranetVlan) || "100";
  const diaInnerVlan = asVlan(input.diaInnerVlan) || "10";
  const diaOuterVlan = asVlan(input.diaOuterVlan) || "3500";
  const snAuthSerial = huaweiSnAuthSerial(vars.serial);
  const actualOntId = vars.actualOntId || "1";

  const preCheck = [
    `! 【前置状态核查】`,
    `display ont optical-info 0/${vars.board} ${vars.pon} all`,
    `display ont autofind all`
  ];

  const configCommands = [
    `! 【步骤 1: 注册 ONT 并划分 4 个网口 Native-VLAN】`,
    `config`,
    `interface gpon 0/${vars.board}`,
    `ont add ${vars.pon} sn-auth ${snAuthSerial} omci ont-lineprofile-id 300 ont-srvprofile-id 300`,
    `ont port native-vlan ${vars.pon} ${actualOntId} eth 1 vlan ${internetVlan}`,
    `ont port native-vlan ${vars.pon} ${actualOntId} eth 2 vlan ${ottVlan}`,
    `ont port native-vlan ${vars.pon} ${actualOntId} eth 3 vlan ${intranetVlan}`,
    `ont port native-vlan ${vars.pon} ${actualOntId} eth 4 vlan ${diaInnerVlan}`,
    `quit`,
    ``,
    `! 【步骤 2: 分别下发四大业务流 service-port (专线使用 translate-and-add 做 QinQ)】`,
    `service-port vlan ${internetVlan} gpon 0/${vars.board}/${vars.pon} ont ${actualOntId} gemport 1 multi-service user-vlan ${internetVlan} tag-transform default`,
    `service-port vlan ${ottVlan} gpon 0/${vars.board}/${vars.pon} ont ${actualOntId} gemport 2 multi-service user-vlan ${ottVlan} tag-transform default`,
    `service-port vlan ${intranetVlan} gpon 0/${vars.board}/${vars.pon} ont ${actualOntId} gemport 3 multi-service user-vlan ${intranetVlan} tag-transform default`,
    `service-port vlan ${diaOuterVlan} gpon 0/${vars.board}/${vars.pon} ont ${actualOntId} gemport 4 multi-service user-vlan ${diaInnerVlan} tag-transform translate-and-add inner-vlan ${diaInnerVlan}`
  ];

  const postCheck = [
    `! 【分口验收排障命令】`,
    `display current-configuration ont 0/${vars.board}/${vars.pon} ${actualOntId}`,
    `display service-port ont ${actualOntId}`
  ];

  return plan(template, [...preCheck, "", ...configCommands, "", ...postCheck], [
    "华为 MA5800 酒店全光网多业务复合方案：一口自营、二口IPTV、三口内网、四口专线。",
    "四业务分别挂钩 GEM Port 1~4，专线口自动应用 translate-and-add 硬件级 QinQ 双层打标。",
    "只生成命令预览供人工核对复制，系统不会下发或保存到 OLT。"
  ], { ...vars, snAuthSerial, internetVlan, liveVlan, ottVlan, intranetVlan, diaInnerVlan, diaOuterVlan });
}

export function buildCompositeQuadPlayPlan(options = {}) {
  const {
    vendor = "zte",
    deviceProfile = "zte-c300",
    chassis = "1",
    board,
    slot,
    pon = "1",
    onuId = "1",
    serial = "ZTEG12345678",
    internetVlan = "3301",
    liveVlan = "86",
    ottVlan = "90",
    intranetVlan = "100",
    diaInnerVlan = "10",
    diaOuterVlan = "3500",
    speed = "100M"
  } = options;
  const safeVendor = String(vendor || "").toLowerCase();
  const safeProfile = String(deviceProfile || "").toLowerCase();
  const effectiveBoard = String(board || slot || "1").trim();
  const baseInput = {
    chassis: chassis || "1",
    board: effectiveBoard,
    slot: effectiveBoard,
    pon: pon || "1",
    onuId: onuId || "1",
    actualOntId: onuId || "1",
    serial: serial || "ZTEG12345678",
    internetVlan,
    liveVlan,
    ottVlan,
    intranetVlan,
    diaInnerVlan,
    diaOuterVlan,
    diaSpeed: speed
  };

  if (safeProfile.includes("c600")) {
    const tpl = templateById("zte-c600-hotel-quad-play");
    return buildZteC600HotelQuadPlayPlan(tpl, baseVariables({ ...baseInput, chassis: "1" }), baseInput);
  }
  if (safeVendor.includes("huawei") || safeProfile.includes("5800")) {
    const tpl = templateById("huawei-hotel-quad-play");
    return buildHuaweiHotelQuadPlayPlan(tpl, baseVariables({ ...baseInput, chassis: "0" }), baseInput);
  }
  const tpl = templateById("zte-hotel-quad-play");
  return buildZteHotelQuadPlayPlan(tpl, baseVariables({ ...baseInput, chassis: "1" }), baseInput);
}
