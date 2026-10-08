/**
 * 统一系统配置向导（Setup Wizard）纯逻辑模型
 * 提供步骤规则校验、OLT 资产映射转换与批量凭据分发计算
 */

export const WIZARD_STEPS = Object.freeze([
  { id: 1, title: "网管登录配置", description: "一期与二期网管访问账号与凭据" },
  { id: 2, title: "发现与选择 OLT", description: "从二期网管读取并勾选集成设备" },
  { id: 3, title: "填写 OLT 连接凭据", description: "SNMP Community 与 Telnet 账号密码" },
  { id: 4, title: "ONU 台账管理", description: "Excel 模板下载与预检导入" },
  { id: 5, title: "网管数据同步", description: "一期增量/历史与二期全量融合" },
  { id: 6, title: "同步外层 VLAN", description: "自动抓取各 PON 口 SVLAN 台账" },
  { id: 7, title: "智能能力配置", description: "飞书机器人、Pi Agent、AnySearch" }
]);

/**
 * 根据二期支撑网 IP 智能推导管理 host
 * 例如 22.0.6.50 -> 10.106.0.50 或直接使用原始 IP
 */
export function deriveManagementHostFromResourceIp(resourceIp = "") {
  const ip = String(resourceIp || "").trim();
  const m106 = ip.match(/^22\.0\.6\.(\d+)$/);
  if (m106) return `10.106.0.${m106[1]}`;
  const m104 = ip.match(/^22\.0\.4\.(\d+)$/);
  if (m104) return `10.104.0.${m104[1]}`;
  return ip;
}

/**
 * 根据设备名称智能推断厂商与型号
 */
export function inferOltVendorAndProfile(name = "") {
  const norm = String(name || "").toLowerCase();
  if (norm.includes("c600")) {
    return { vendor: "zte", model: "ZXA10 C600", deviceProfile: "zte-c600", version: "V2.0" };
  }
  if (norm.includes("5800") || norm.includes("huawei") || norm.includes("华为")) {
    return { vendor: "huawei", model: "MA5800", deviceProfile: "huawei-ma5800", version: "V100R019" };
  }
  // 默认中兴 C300
  return { vendor: "zte", model: "ZXA10 C300", deviceProfile: "zte-c300", version: "V2.1" };
}

/**
 * 将二期勾选的 OLT 列表与批量凭据融合，生成待纳管的完整 OLT 对象数组
 * 支持解构对象参数 { selectedOssOlts, batchCredentials, existingOlts, ossOlts }
 * 或位置参数 (selectedOssOlts, batchCredentials, existingOlts)
 */
export function buildOltsFromOssSelection(arg1 = [], arg2 = {}, arg3 = []) {
  let selectedOssOlts = [];
  let batchCredentials = {};
  let existingOlts = [];
  let ossOlts = [];

  if (arg1 && !Array.isArray(arg1) && typeof arg1 === "object") {
    selectedOssOlts = Array.isArray(arg1.selectedOssOlts) ? arg1.selectedOssOlts : [];
    batchCredentials = arg1.batchCredentials || {};
    existingOlts = Array.isArray(arg1.existingOlts) ? arg1.existingOlts : [];
    ossOlts = Array.isArray(arg1.ossOlts) ? arg1.ossOlts : [];
  } else {
    selectedOssOlts = Array.isArray(arg1) ? arg1 : [];
    batchCredentials = arg2 || {};
    existingOlts = Array.isArray(arg3) ? arg3 : [];
  }

  // 现有 OLT 索引
  const existingByHost = new Map(existingOlts.map((o) => [o.host, o]));
  const existingById = new Map(existingOlts.map((o) => [o.id, o]));

  // 获取选中的 key 集合
  const selectedKeys = new Set(
    selectedOssOlts.map((item) => (typeof item === "string" ? item : (item._wizardUid || item.resourceIp || item.host || item.cuid || item.name || "")))
  );

  let rawList = [];
  if (ossOlts.length > 0 && selectedKeys.size > 0) {
    rawList = ossOlts.filter((o) => {
      const key = o.resourceIp || o.host || o.cuid || o.name || "";
      const uid = o._wizardUid || "";
      return selectedKeys.has(key) || (uid && selectedKeys.has(uid));
    });
  }
  if (rawList.length === 0 && ossOlts.length > 0) {
    rawList = ossOlts;
  }
  if (rawList.length === 0) {
    rawList = selectedOssOlts
      .filter((item) => typeof item !== "string" || !item.startsWith("wz-"))
      .map((item) => (typeof item === "string" ? { resourceIp: item } : item));
  }
  if (rawList.length === 0 && existingOlts.length > 0) {
    return existingOlts.map((item) => ({ ...item }));
  }

  return rawList.map((ossOlt) => {
    const rawIp = ossOlt.resourceIp || ossOlt.host || "";
    // 优先尝试从已有 OLT 查找
    let existing = existingByHost.get(rawIp) || existingByHost.get(ossOlt.host);
    if (!existing) {
      // 尾数匹配 (例如 22.0.4.102 匹配 172.19.104.102，22.0.6.50 匹配 172.19.106.50)
      const m = String(rawIp).match(/^22\.0\.(\d+)\.(\d+)$/);
      if (m) {
        existing = existingOlts.find((o) => o.host && (o.host.includes(`10${m[1]}.${m[2]}`) || o.host.endsWith(`.${m[2]}`)));
      }
    }

    const derivedHost = ossOlt.host || existing?.host || deriveManagementHostFromResourceIp(rawIp);
    const inferred = inferOltVendorAndProfile(ossOlt.name || existing?.name || "");
    const vendor = ossOlt.vendor || batchCredentials.vendor || existing?.vendor || inferred.vendor;
    const deviceProfile = ossOlt.deviceProfile || batchCredentials.deviceProfile || existing?.deviceProfile || inferred.deviceProfile;
    const model = ossOlt.model || batchCredentials.model || existing?.model || inferred.model;
    const version = ossOlt.version || batchCredentials.version || existing?.version || inferred.version;

    const baseSlug = (ossOlt.name || existing?.name || `olt-${derivedHost || rawIp}`)
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "") || `olt-${(derivedHost || rawIp).replace(/\./g, "-")}`;
    const id = ossOlt.id || existing?.id || (existingById.has(baseSlug) ? `${baseSlug}-${Date.now().toString(36)}` : baseSlug);

    const name = ossOlt.name || existing?.name || (ossOlt.roomName ? `${ossOlt.roomName} OLT ${derivedHost}` : `OLT-${derivedHost}`);

    return {
      id,
      name,
      vendor,
      model,
      deviceProfile,
      version,
      host: derivedHost,
      snmpCommunity: ossOlt.snmpCommunity || batchCredentials.community || batchCredentials.readCommunity || existing?.snmpCommunity || existing?.readCommunity || "public",
      readCommunity: ossOlt.readCommunity || batchCredentials.readCommunity || batchCredentials.community || existing?.readCommunity || existing?.snmpCommunity || "public",
      telnetPort: Number(ossOlt.telnetPort || batchCredentials.telnetPort || existing?.telnetPort || 23),
      telnetUser: ossOlt.telnetUser || batchCredentials.telnetUser || batchCredentials.telnetUsername || existing?.telnetUser || existing?.telnetUsername || "admin",
      telnetUsername: ossOlt.telnetUsername || batchCredentials.telnetUsername || batchCredentials.telnetUser || existing?.telnetUsername || existing?.telnetUser || "admin",
      telnetPassword: ossOlt.telnetPassword !== undefined ? ossOlt.telnetPassword : (batchCredentials.telnetPassword !== undefined ? batchCredentials.telnetPassword : (existing?.telnetPassword || "")),
      roomName: ossOlt.roomName || existing?.roomName || "",
      resourceIp: rawIp,
      enabled: true
    };
  });
}

/**
 * 校验 OLT 凭据参数完整性
 */
export function validateOltListCredentials(olts = []) {
  if (!Array.isArray(olts) || olts.length === 0) {
    return { valid: false, error: "未勾选或未配置任何 OLT 设备。", errors: ["未勾选或未配置任何 OLT 设备。"] };
  }
  const errors = [];
  for (let i = 0; i < olts.length; i += 1) {
    const olt = olts[i];
    if (!olt.name) {
      errors.push(`第 ${i + 1} 台 OLT 缺少设备名称。`);
    }
    if (!olt.host) {
      errors.push(`第 ${i + 1} 台 OLT [${olt.name || "未命名"}] 缺少管理 IP (host)。`);
    }
    if (!olt.snmpCommunity && !olt.readCommunity) {
      errors.push(`第 ${i + 1} 台 OLT [${olt.name || "未命名"}] 缺少 SNMP Read Community 团体字。`);
    }
  }
  return { valid: errors.length === 0, error: errors[0] || "", errors };
}

/**
 * 判断向导当前步骤是否满足进入下一步的前提
 */
export function canProceedToNextStep(step, state = {}) {
  const current = Number(step);
  switch (current) {
    case 1: {
      // 只要二期网管（用于读取 OLT）或一期网管登录成功，即可进入下一步
      const resourceLoggedIn = Boolean(state.resource?.loggedIn);
      const ossLoggedIn = Boolean(state.oss?.loggedIn);
      return ossLoggedIn || resourceLoggedIn;
    }
    case 2: {
      // 勾选了二期 OLT，或者系统已有纳管 OLT，或者有草稿 OLT
      const selected = state.wizard?.selectedOssOlts || [];
      const drafts = state.wizard?.oltDrafts || [];
      const adminOlts = state.adminOlts || [];
      return selected.length > 0 || drafts.length > 0 || adminOlts.length > 0;
    }
    case 3: {
      // 已纳管 OLT 数量大于 0 或有草稿
      const adminOlts = state.adminOlts || [];
      const drafts = state.wizard?.oltDrafts || [];
      return adminOlts.length > 0 || drafts.length > 0;
    }
    case 4: {
      // 台账管理步骤允许自由跳过或完成导入
      return true;
    }
    case 5: {
      // 网管数据同步步骤
      const datasetSynced = Boolean(state.mergedOnu?.dataset?.synced);
      const networkSynced = Boolean(state.mergedOnu?.sources?.network?.synced);
      const nmseSynced = Boolean(state.mergedOnu?.sources?.nmse?.synced);
      return datasetSynced || networkSynced || nmseSynced;
    }
    case 6: {
      // 外层 VLAN 同步步骤允许推进
      return true;
    }
    case 7: {
      // 智能生态配置步骤
      return true;
    }
    default:
      return false;
  }
}

/**
 * 判断系统是否已经完成初始基础纳管
 */
// “已完成初始化”看的是配置是否齐全，而不是此刻是否在线：
// 网管会话过期属于正常情况，只要凭据已配置且合并数据同步过，就不再提示初始化。
export function isSystemFullyConfigured(state = {}) {
  if (state.wizardCompleted) return true;
  const hasOlts = (Array.isArray(state.adminOlts) && state.adminOlts.length > 0) || (Array.isArray(state.olts) && state.olts.length > 0);
  const setup = state.setupStatus || {};
  const networkConfigured = Boolean(
    state.oss?.loggedIn || state.resource?.loggedIn ||
    state.oss?.credentialConfigured || state.oss?.autoLoginConfigured ||
    setup.ossConfigured || setup.resourceConfigured
  );
  const dataSynced = Boolean(state.mergedOnu?.dataset?.synced || setup.dataSynced);
  return hasOlts && networkConfigured && dataSynced;
}
