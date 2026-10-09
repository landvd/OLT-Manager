// ONU 只读查询、状态、配置预览与配置方案生成。依赖由 server.mjs 注入，避免在此直接持有运行时单例。
import { queryZteOnuReadOnly } from "../zte-telnet.mjs";
import { queryHuaweiOnuReadOnly } from "../huawei-telnet.mjs";
import { buildConfigPlanFromTemplate, configTemplates, extractMduOttVlans, huaweiSnAuthSerial, suggestHuaweiOntId, suggestNextOnuId } from "../config-plan.mjs";
import { renderConfigPlan } from "../config-plan-engine.mjs";
import { profileById, supportsConfigPlan } from "../device-profiles.mjs";
import { defaultChassisForVendor, normalizePonCoordinate, onuCoordinateLabel, ponCoordinateKey } from "../pon-coordinate.mjs";
import { decodeHexSerial, decodeDistance, decodeHuaweiRxPower, decodeRawHexString, decodeSnmpDisplayString, decodeSnmpDateAndTime, decodeZteOfflineCause, decodeZteC600RxPower, encodeZtePonIfIndex, decodeZteRxPower, encodeZtePonIndex, encodeZteC600PonIndex, encodeZteVportIndex, filterHuaweiUnregisteredSerialRows, huaweiRunStatus, huaweiUnconfiguredStatus, indexRows, collectHuaweiOntIndexes, parseDateTimeText, parseHuaweiIfNameRows, parseHuaweiOntIndex, parseHuaweiOuterVlanRows, parseZteC600Index, parseZteIndex, parseZteOuterVlanRows, parseZteUnconfiguredIndex, phaseLabel, requestCoordinate, cleanSnmpValue, ztePonGroupKey, HUAWEI_SRV_FLOW_FRAME_OID as huaweiSrvFlowFrame, HUAWEI_SRV_FLOW_SLOT_OID as huaweiSrvFlowSlot, HUAWEI_SRV_FLOW_PON_OID as huaweiSrvFlowPon, HUAWEI_SRV_FLOW_PARAM_TYPE_OID as huaweiSrvFlowParaType, HUAWEI_SRV_FLOW_VLAN_ID_OID as huaweiSrvFlowVlanId, ZTE_VLAN_IF_CONF_VLAN_OID as zteVlanIfConfVlan } from "../snmp-oid-codecs.mjs";
import { buildSnmpStatusDiagnostics, snmpGet, snmpGetMany, snmpWalk } from "./snmp-access.mjs";
import { oidProfiles, resolveOidProfile, zteServicePortOids } from "./oid-profiles.mjs";

export function createOnuQueryService({
  getOnuStatusHistory,
  getPonPorts,
  getProject,
  listConfigTemplates,
  recordOnuStatusHistory,
  telnetReadOnlyOptionsForOlt,
  updatePonPortVlans,
  getOnuDataEnrichment
} = {}) {
  // onuDataEnrichment 与本服务互相依赖，按需取值，避免创建顺序问题。
  const onuDataEnrichmentProxy = () => getOnuDataEnrichment();

  async function refreshPonVlans(body, olts) {
    const allPorts = await getPonPorts();
    const requestedOltIp = String(body.oltIp || "").trim();
    const requestedPonPort = String(body.ponPort || "").trim();
    const candidateOlts = olts.filter((olt) => ["zte", "huawei"].includes(olt.vendor) && (!requestedOltIp || olt.host === requestedOltIp));
    const updates = [];
    const results = [];

    for (const olt of candidateOlts) {
      const ports = allPorts.filter((port) =>
        port.oltIp === olt.host && (!requestedPonPort || port.ponPort === requestedPonPort)
      );
      if (!ports.length) continue;
      if (olt.vendor === "huawei") {
        const [frameRows, slotRows, ponRows, typeRows, vlanRows] = await Promise.all([
          snmpWalk(olt, huaweiSrvFlowFrame, "-On", 120000),
          snmpWalk(olt, huaweiSrvFlowSlot, "-On", 120000),
          snmpWalk(olt, huaweiSrvFlowPon, "-On", 120000),
          snmpWalk(olt, huaweiSrvFlowParaType, "-On", 120000),
          snmpWalk(olt, huaweiSrvFlowVlanId, "-On", 120000)
        ]);
        const walks = [frameRows, slotRows, ponRows, typeRows, vlanRows];
        const failed = walks.find((walk) => !walk.ok);
        if (failed) {
          results.push({ oltIp: olt.host, ok: false, updated: 0, error: failed.error || "Huawei service-flow walk failed" });
          continue;
        }
        const vlanByPonPort = parseHuaweiOuterVlanRows({
          frameRows: frameRows.rows,
          slotRows: slotRows.rows,
          ponRows: ponRows.rows,
          typeRows: typeRows.rows,
          vlanRows: vlanRows.rows
        });
        let updated = 0;
        for (const port of ports) {
          const outerVlan = vlanByPonPort.get(ponCoordinateKey(port));
          if (!outerVlan) continue;
          updates.push({ oltIp: olt.host, ponPort: port.ponPort, outerVlan });
          updated += 1;
        }
        results.push({ oltIp: olt.host, ok: true, updated, walkedRows: vlanRows.rows.length });
        continue;
      }

      const walk = await snmpWalk(olt, zteVlanIfConfVlan, "-On", 120000);
      if (!walk.ok) {
        results.push({ oltIp: olt.host, ok: false, updated: 0, error: walk.error || "SNMP walk failed" });
        continue;
      }
      const vlanByIfIndex = parseZteOuterVlanRows(walk.rows);
      const directVlanByPonPort = new Map();
      const vlanValuesByGroup = new Map();
      let updated = 0;
      for (const port of ports) {
        const { board, pon } = normalizePonCoordinate(port, { vendor: olt.vendor });
        if (!board || !pon) continue;
        const ifIndex = encodeZtePonIfIndex(board, pon);
        const outerVlan = vlanByIfIndex.get(String(ifIndex));
        if (!outerVlan) continue;
        directVlanByPonPort.set(port.ponPort, outerVlan);
        const groupKey = ztePonGroupKey(board, pon);
        if (!vlanValuesByGroup.has(groupKey)) vlanValuesByGroup.set(groupKey, []);
        vlanValuesByGroup.get(groupKey).push(outerVlan);
        updates.push({ oltIp: olt.host, ponPort: port.ponPort, outerVlan });
        updated += 1;
      }

      let inferred = 0;
      for (const port of ports) {
        if (directVlanByPonPort.has(port.ponPort)) continue;
        const { board, pon } = normalizePonCoordinate(port, { vendor: olt.vendor });
        if (!board || !pon) continue;
        const values = vlanValuesByGroup.get(ztePonGroupKey(board, pon)) || [];
        const counts = values.reduce((map, value) => map.set(value, (map.get(value) || 0) + 1), new Map());
        const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
        if (!best || best[1] < 2) continue;
        updates.push({ oltIp: olt.host, ponPort: port.ponPort, outerVlan: best[0] });
        inferred += 1;
      }

      results.push({ oltIp: olt.host, ok: true, updated: updated + inferred, direct: updated, inferred, walkedRows: walk.rows.length });
    }

    await updatePonPortVlans(updates, "snmp_vlan_refresh");
    return { ok: true, count: updates.length, results, ponPorts: await getPonPorts() };
  }

  function phaseSearchText(phase) {
    const key = String(phase || "").trim().toLowerCase();
    const map = {
      working: "working 在线 正常",
      online: "online 在线 正常",
      offline: "offline 离线",
      los: "los 光路断 光信号丢失",
      dyinggasp: "dyinggasp 断电 掉电",
      authfailed: "authfailed 认证失败",
      logging: "logging 登录中",
      syncmib: "syncmib 同步中"
    };
    return `${phase || ""} ${map[key] || ""}`;
  }

  function rxPowerSearchText(rxPower) {
    const raw = String(rxPower || "");
    const value = Number.parseFloat(raw);
    if (!Number.isFinite(value)) return `${raw} unknown 未知`;
    if (value <= -12 && value >= -25) return `${raw} 绿色 正常`;
    if (value < -25 && value >= -27) return `${raw} 黄色 警告 偏低`;
    return `${raw} 红色 异常 过高 过低`;
  }

  function onuSearchText(onu) {
    return [
      onu.id,
      onuCoordinateLabel(onu),
      onu.name,
      onu.deviceNumber,
      onu.serial,
      onu.loid,
      onu.username,
      onu.phase,
      phaseSearchText(onu.phase),
      onu.rxPower,
      rxPowerSearchText(onu.rxPower),
      onu.distance,
      onu.address,
      onu.project?.name,
      onu.projectName
    ].join(" ").toLowerCase();
  }

  function findLedgerPort(ponPorts, olt, board, pon, chassis = defaultChassisForVendor(olt?.vendor)) {
    const key = ponCoordinateKey({ chassis, board, pon });
    const legacyKey = `${board}/${pon}`;
    return ponPorts.find((port) => {
      if (port.oltIp !== olt.host) return false;
      return ponCoordinateKey(port) === key || port.ponPort === key || port.ponPort === legacyKey;
    }) || {};
  }

  function zteBusinessName(userVlan, vport) {
    const vlan = String(userVlan || "");
    if (vlan === "3301") return "上网业务";
    if (vlan === "3111") return "互动 VLAN";
    if (vlan === "90") return "ONU 内置下发 VLAN";
    if (vlan === "86") return "直播 VLAN";
    return `业务 VLAN ${vlan || vport}`;
  }

  async function readZteServicePorts(olt, { board, slot, pon, onuId }) {
    const safeBoard = board || slot;
    if (!safeBoard || !pon || !onuId) return [];
    const ponIfIndex = encodeZtePonIfIndex(safeBoard, pon);
    const candidateVports = Array.from({ length: 8 }, (_, index) => index + 1);
    const rows = [];

    for (const vport of candidateVports) {
      const vportIndex = encodeZteVportIndex(onuId, vport);
      const oidRefs = [];
      for (const [field, baseOid] of Object.entries(zteServicePortOids)) {
        oidRefs.push({ field, vport, oid: `${baseOid}.${ponIfIndex}.${vportIndex}` });
      }
      const result = await snmpGetMany(olt, oidRefs.map((item) => item.oid), 5000);
      const byOid = new Map(result.rows.map((row) => [row.oid.replace(/^\./, ""), cleanSnmpValue(row.value).replace(/^"|"$/g, "")]));
      const values = {};
      for (const [field, baseOid] of Object.entries(zteServicePortOids)) {
        values[field] = byOid.get(`${baseOid}.${ponIfIndex}.${vportIndex}`) || "";
      }
      if (values.userVlan && !/No Such Instance|No Such Object/i.test(values.userVlan)) {
        rows.push({
          servicePort: vport,
          vport: values.vport || String(vport),
          serviceMode: values.serviceMode || "",
          userVlan: values.userVlan,
          cVlan: values.cVlan || "",
          sVlan: values.sVlan === "0" ? "" : values.sVlan,
          business: zteBusinessName(values.userVlan, vport),
          source: "SNMP 已验证"
        });
      }
    }

    return rows;
  }

  function buildConfigPlan({ olt, chassis, board, slot, pon, onuId = "<ONU_ID>", serial = "<ONU_SN>", outerVlan = "", address = "" }) {
    const safeChassis = String(chassis || defaultChassisForVendor(olt?.vendor)).trim();
    const safeBoard = String(board || slot || "").trim();
    const vendor = String(olt.vendor || "").toLowerCase();
    if (!supportsConfigPlan(olt.deviceProfile)) {
      const profile = profileById(olt.deviceProfile);
      const label = profile ? `${profile.vendorLabel} ${profile.model}` : `${vendor} ${olt.model || ""}`.trim();
      return {
        name: "暂未支持的设备型号",
        vendor,
        outerVlan: outerVlan || "",
        innerVlan: "",
        notes: [
          `${label || "当前设备型号"} 暂未配置可用的配置方案模板。`,
          "系统已阻止生成命令预览，避免误用其它型号命令。"
        ],
        template: ""
      };
    }
    const vlan = outerVlan || "<待补充外层VLAN>";
    const innerVlan = "<待填写内层VLAN>";
    const planName = vendor === "huawei" ? "Huawei MA5800 上网业务模板" : "ZTE C300 上网业务模板";
    const notes = [
      "只读系统仅展示命令模板，不会执行、不下发、不保存到 OLT。",
      outerVlan ? `外层 VLAN 已按 OLT IP + PON 台账带出：${outerVlan}` : "当前 PON 台账缺少外层 VLAN，配置前需要人工补充。",
      "内层 VLAN、profile、gemport、service-port 编号需按现场规划填写。"
    ];

    if (vendor === "huawei") {
      const snAuthSerial = serial ? huaweiSnAuthSerial(serial) : "<ONU_SN_HEX>";
      return {
        name: planName,
        vendor,
        outerVlan: outerVlan || "",
        innerVlan: "3301",
        notes,
        template: [
          `interface gpon ${safeChassis}/${safeBoard}`,
          `ont add ${pon} sn-auth ${snAuthSerial} omci ont-lineprofile-id 300 ont-srvprofile-id 300 desc "${address || "<地址/客户名>"}"`,
          `ont port native-vlan ${pon} <ONT_ID> eth 1 vlan 3301`,
          "quit",
          `service-port vlan ${vlan} gpon ${safeChassis}/${safeBoard}/${pon} ont <ONT_ID> gemport 0 multi-service user-vlan 3301 tag-transform translate-and-add inner-vlan 3301 inner-priority 0`
        ].join("\n")
      };
    }

    return {
      name: planName,
      vendor: vendor || "zte",
      outerVlan: outerVlan || "",
      innerVlan,
      notes,
      template: [
        `interface gpon-onu_${safeChassis}/${safeBoard}/${pon}:${onuId || "<ONU_ID>"}`,
        `name ${address || "<地址/客户名>"}`,
        "tcont <TCONT_ID> profile <TCONT_PROFILE>",
        "gemport <GEMPORT_ID> tcont <TCONT_ID>",
        "switchport mode hybrid vport <VPORT_ID>",
        `service-port <SERVICE_PORT_ID> vport <VPORT_ID> user-vlan ${innerVlan} vlan ${vlan} svlan ${vlan}`
      ].join("\n")
    };
  }

  function buildConfigChecks(olt) {
    if (olt.vendor === "huawei") {
      return [
        { name: "ONT line profile", status: "待现场确认", value: "未接入正式 OID 解析" },
        { name: "ONT service profile", status: "待现场确认", value: "未接入正式 OID 解析" },
        { name: "GEM/TCONT", status: "待现场确认", value: "未接入正式 OID 解析" },
        { name: "Service-port / 内层 VLAN", status: "待现场确认", value: "仅展示模板，不推断真实配置" }
      ];
    }
    return [
      { name: "ONU profile", status: "待现场确认", value: "未接入正式 OID 解析" },
      { name: "TCONT/GEMPORT", status: "待现场确认", value: "未接入正式 OID 解析" },
      { name: "VPORT", status: "待现场确认", value: "未接入正式 OID 解析" },
      { name: "Service-port / 内层 VLAN", status: "待现场确认", value: "仅展示模板，不推断真实配置" }
    ];
  }

  function projectConfigTemplateName(project) {
    return `项目:${project.name}(VLAN号:${project.vlan})`;
  }

  function buildProjectConfigTemplates(projects = []) {
    const zteBase = configTemplates.find((template) => template.id === "zte-link-booth");
    const huaweiBase = configTemplates.find((template) => template.id === "huawei-link-booth");
    return projects.flatMap((project) => [
      {
        ...zteBase,
        id: `project:${project.id}:zte`,
        name: projectConfigTemplateName(project),
        businessType: "project",
        vlanRules: { innerVlan: "project", outerVlan: "none" },
        projectId: project.id,
        projectName: project.name,
        vlan: project.vlan
      },
      {
        ...huaweiBase,
        id: `project:${project.id}:huawei`,
        name: projectConfigTemplateName(project),
        businessType: "project",
        vlanRules: { innerVlan: "project", outerVlan: "none" },
        projectId: project.id,
        projectName: project.name,
        vlan: project.vlan
      }
    ]);
  }

  async function resolveProjectConfigTemplate(templateId) {
    const requestedTemplateId = String(templateId || "").trim();
    const match = requestedTemplateId.match(/^project:([^:]+):(zte|huawei)$/);
    if (!match) return { templateId: requestedTemplateId, requestedTemplateId, project: null };
    const project = await getProject(match[1]);
    if (!project) {
      const error = new Error("项目不存在，不能生成项目模板配置方案。");
      error.status = 404;
      throw error;
    }
    return {
      templateId: match[2] === "huawei" ? "huawei-custom-vlan" : "zte-custom-vlan",
      requestedTemplateId,
      project
    };
  }

  function applyProjectPlanContext(plan, project, requestedTemplateId) {
    if (!project) return plan;
    const projectVlan = String(project.vlan);
    return {
      ...plan,
      id: requestedTemplateId,
      name: projectConfigTemplateName(project),
      businessType: "project",
      variables: {
        ...(plan.variables || {}),
        projectId: project.id,
        projectName: project.name,
        projectVlan,
        innerVlan: projectVlan
      }
    };
  }

  async function findMduOttSampleVlans(olt, { chassis, board, slot, pon }) {
    const safeBoard = board || slot;
    const registeredRows = await listOnus(olt, { chassis, board: safeBoard, pon });
    for (const row of registeredRows) {
      const servicePorts = await readZteServicePorts(olt, { board: safeBoard, pon, onuId: row.onuId });
      const parsed = extractMduOttVlans(servicePorts);
      if (parsed.ok) {
        return {
          ok: true,
          sampleOnuId: row.onuId,
          servicePorts,
          ...parsed
        };
      }
    }
    return {
      ok: false,
      sampleOnuId: "",
      servicePorts: [],
      vlans: {},
      missing: ["innerVlan", "outerVlan", "ottVlan"],
      source: ""
    };
  }

  async function buildUnregisteredConfigPlan(olt, body = {}) {
    const coordinate = requestCoordinate(body, olt);
    const chassis = String(coordinate.chassis || "").trim();
    const board = String(coordinate.board || "").trim();
    const slot = board;
    const pon = String(coordinate.pon || "").trim();
    const serial = String(body.serial || "").trim();
    const defaultTemplateId = String(olt?.vendor || "").toLowerCase() === "huawei"
      ? "huawei-self-operated-internet"
      : (olt?.deviceProfile === "zte-c600" ? "zte-c600-self-operated-internet" : "zte-self-operated-internet");
    const requestedTemplateId = String(body.templateId || defaultTemplateId).trim();
    if (!olt?.id) return { ok: false, status: 404, error: "未找到 OLT。" };
    if (!chassis || !board || !pon || !serial) {
      return { ok: false, status: 400, error: "缺少 chassis、board、pon 或 serial。" };
    }
    const isHuawei = String(olt.vendor || "").toLowerCase() === "huawei";
    if (!supportsConfigPlan(olt.deviceProfile)) {
      const profile = profileById(olt.deviceProfile);
      const label = profile ? `${profile.vendorLabel} ${profile.model}` : `${olt.vendor || ""} ${olt.model || ""}`.trim();
      return {
        ok: true,
        blocked: true,
        id: requestedTemplateId,
        name: "暂未支持的设备型号",
        vendor: olt.vendor,
        businessType: "",
        warnings: [`${label || "当前设备型号"} 暂未配置可用的配置方案模板，已阻止生成，避免误用其它型号命令。`],
        variables: { chassis, board, slot, pon, serial, deviceProfile: olt.deviceProfile || "" },
        commands: ""
      };
    }

    let templateId = requestedTemplateId;
    let projectTemplate = null;
    try {
      const resolvedTemplate = await resolveProjectConfigTemplate(requestedTemplateId);
      templateId = resolvedTemplate.templateId;
      projectTemplate = resolvedTemplate.project;
    } catch (error) {
      return { ok: false, status: error.status || 500, error: error.message };
    }

    const dbTemplates = await listConfigTemplates();
    const allAvailableTemplates = [...dbTemplates, ...configTemplates, ...(projectTemplate ? buildProjectConfigTemplates([projectTemplate]) : [])];
    const matchedTemplate = allAvailableTemplates.find((t) => t.id === requestedTemplateId) || allAvailableTemplates.find((t) => t.id === templateId);
    if (matchedTemplate?.deviceProfiles && olt.deviceProfile && !matchedTemplate.deviceProfiles.includes(olt.deviceProfile)) {
      const profile = profileById(olt.deviceProfile);
      const label = profile ? `${profile.vendorLabel} ${profile.model}` : `${olt.vendor || ""} ${olt.model || ""}`.trim();
      return {
        ok: true,
        blocked: true,
        id: requestedTemplateId,
        name: matchedTemplate.name || "暂未支持的设备型号",
        vendor: olt.vendor,
        businessType: "",
        warnings: [`${label || "当前设备型号"} 暂未配置可用的配置方案模板，已阻止生成，避免误用其它型号命令。`],
        variables: { chassis, board, slot, pon, serial, deviceProfile: olt.deviceProfile || "" },
        commands: ""
      };
    }

    const ponPorts = await getPonPorts();
    const ledger = findLedgerPort(ponPorts, olt, board, pon, chassis);
    const registeredRows = await listOnus(olt, { chassis, board, pon });
    const next = isHuawei ? suggestHuaweiOntId(registeredRows) : suggestNextOnuId(registeredRows);
    if (!isHuawei && next.blocked) {
      return {
        ok: true,
        blocked: true,
        warnings: [next.warning],
        variables: { chassis, board, slot, pon, serial, lastOnuId: next.lastOnuId },
        commands: "",
        templateId: requestedTemplateId
      };
    }

    let dynamicVlans = {};
    let sample = null;
    if (String(olt.vendor || "").toLowerCase() === "zte" && templateId === "zte-mdu-ott") {
      sample = await findMduOttSampleVlans(olt, { chassis, board, pon });
      dynamicVlans = {
        ...sample.vlans,
        ...(body.dynamicVlans || {})
      };
    }

    const huaweiActualOntId = isHuawei ? String(body.actualOntId || next.onuId).trim() : "";
    let plan;
    if (matchedTemplate?.commandTemplate) {
      plan = renderConfigPlan(matchedTemplate, {
        vendor: olt.vendor,
        deviceProfile: olt.deviceProfile,
        chassis,
        board,
        slot,
        pon,
        serial,
        onuId: isHuawei ? "" : next.onuId,
        actualOntId: huaweiActualOntId,
        suggestedOnuId: next.onuId,
        outerVlan: body.outerVlan || ledger.outerVlan || "",
        ledgerOuterVlan: ledger.outerVlan || "",
        address: ledger.address || "",
        ethPort: Array.isArray(body.ethPorts) ? body.ethPorts[0] : (body.ethPorts || (isHuawei ? "eth1" : "eth_0/1")),
        ethPorts: body.ethPorts,
        innerVlan: projectTemplate?.vlan || body.customVlan || body.innerVlan,
        customVlan: projectTemplate?.vlan || body.customVlan,
        templateInputs: body.templateInputs && typeof body.templateInputs === "object" ? body.templateInputs : {}
      });
    } else {
      plan = buildConfigPlanFromTemplate({
        templateId,
        chassis,
        board,
        slot,
        pon,
        serial,
        onuId: isHuawei ? "" : next.onuId,
        actualOntId: huaweiActualOntId,
        outerVlan: body.outerVlan || ledger.outerVlan || "",
        ethPorts: body.ethPorts,
        customVlan: projectTemplate?.vlan || body.customVlan,
        dynamicVlans
      });
    }
    const contextualPlan = applyProjectPlanContext(plan, projectTemplate, requestedTemplateId);
    const idReferenceWarning = isHuawei
      ? `已扫描同 PON 的 ONT ID，自动选择空闲候选 ONT ID ${next.onuId}；后续 native-vlan 和 service-port 统一使用 ONT ${next.onuId}。`
      : (next.lastOnuId ? `ONU ID 按同 PON 最大 ID ${next.lastOnuId} + 1 建议为 ${next.onuId}。` : "当前 PON 未读取到已注册 ONU，ONU ID 建议为 1。");
    const warnings = [
      ...(contextualPlan.warnings || []),
      idReferenceWarning,
      ...(templateId === "zte-mdu-ott" && sample?.ok ? [`MDU+OTT VLAN 来源：同 PON 样板 ONU ${chassis}/${board}/${pon}:${sample.sampleOnuId}。`] : []),
      ...(templateId === "zte-mdu-ott" && sample && !sample.ok ? ["未找到可识别的同 PON MDU+OTT 样板 ONU，需要人工补充动态 VLAN。"] : [])
    ];

    return {
      ok: true,
      ...contextualPlan,
      warnings,
      variables: {
        ...(contextualPlan.variables || {}),
        lastOnuId: next.lastOnuId,
        suggestedOnuId: next.onuId,
        ledgerOuterVlan: ledger.outerVlan || "",
        sampleOnuId: sample?.sampleOnuId || ""
      },
      sampleServicePorts: sample?.servicePorts || []
    };
  }

  async function buildStatus(olt) {
    const profile = resolveOidProfile(olt);
    const timeout = olt.vendor === "huawei" ? 3500 : 5000;
    const [sysDescr, uptime] = await Promise.all([snmpGet(olt, profile.sysDescr, timeout), snmpGet(olt, profile.sysUpTime, timeout)]);
    const reachable = sysDescr.ok || uptime.ok;
    const snmpDiagnostics = buildSnmpStatusDiagnostics({
      olt,
      checks: [
        { label: "sysDescr", result: sysDescr },
        { label: "sysUpTime", result: uptime }
      ]
    });
    const failedDiagnostics = snmpDiagnostics.filter((item) => !item.ok);
    const offlineText = olt.vendor === "huawei"
      ? "网络可达，但 SNMP 161/udp 对当前 community 无响应；请检查华为 SNMP agent、ACL/view 或 community。"
      : "当前未读取到 SNMP 响应，界面显示模拟数据。";
    return {
      oltId: olt.id,
      reachable,
      snmpState: reachable ? "connected" : "mock/offline",
      sysDescr: reachable ? sysDescr.value : `${olt.vendor.toUpperCase()} ${olt.model} (${olt.host || "no host"})`,
      uptime: reachable ? uptime.value : "SNMP unavailable, showing cached/mock data",
      diagnostics: { snmp: snmpDiagnostics },
      alarms: reachable
        ? []
        : [
            { level: "warning", text: offlineText },
            ...failedDiagnostics.map((item) => ({
              level: "info",
              text: `${item.check} 失败：${item.error}；工具：${item.tool}；目标：${item.target}；OID：${item.oid}`
            })),
            { level: "info", text: "当前系统处于只读模式，仅执行 SNMP 查询。" }
          ]
    };
  }

  async function listOnus(olt, query, { includeLastOnlineTime = false, includeOfflineDetails = false, includeResourceUsers = false } = {}) {
    const ponPorts = (await getPonPorts()).filter((p) => !olt.host || p.oltIp === olt.host);
    const requested = requestCoordinate(query, olt);
    const profile = resolveOidProfile(olt);
    let rows;

    if (olt.deviceProfile === "zte-c600" || (olt.vendor === "zte" && olt.model === "C600")) {
      const hasScopedPon = requested.board && requested.pon;
      if (hasScopedPon) {
        const encodedPon = encodeZteC600PonIndex(requested.board, requested.pon, requested.chassis);
        const scoped = (oid) => `${oid}.${encodedPon}`;
        const reads = [
          snmpWalk(olt, scoped(profile.serialNumber), "-Onx"),
          snmpWalk(olt, scoped(profile.phaseState)),
          snmpWalk(olt, scoped(profile.vendor)),
          snmpWalk(olt, scoped(profile.softwareVersion)),
          snmpWalk(olt, scoped(profile.adminState)),
          snmpWalk(olt, scoped(profile.realType)),
          snmpWalk(olt, scoped(profile.rxPower), "-On", 30000)
        ];
        const [serials, phases, vendors, versions, adminStates, realTypes, optical] = await Promise.all(reads);

        if (serials.ok && serials.rows.length) {
          const phaseByKey = indexRows(phases.rows, profile.phaseState, parseZteC600Index, (value) => phaseLabel(profile, value));
          const vendorByKey = indexRows(vendors.rows, profile.vendor, parseZteC600Index, decodeSnmpDisplayString);
          const versionByKey = indexRows(versions.rows, profile.softwareVersion, parseZteC600Index, decodeSnmpDisplayString);
          const adminStateByKey = indexRows(adminStates.rows, profile.adminState, parseZteC600Index, cleanSnmpValue);
          const realTypeByKey = indexRows(realTypes.rows, profile.realType, parseZteC600Index, decodeSnmpDisplayString);
          const opticalByKey = indexRows(
            optical.rows,
            profile.rxPower,
            parseZteC600Index,
            decodeZteC600RxPower
          );

          rows = serials.rows.map((row) => {
            const idx = parseZteC600Index(row.oid, profile.serialNumber);
            const port = findLedgerPort(ponPorts, olt, idx.board, idx.pon, idx.chassis);
            const serial = decodeHexSerial(row.value);
            const vendor = vendorByKey.get(idx.key)?.value || "";
            const realType = realTypeByKey.get(idx.key)?.value || "";
            return {
              id: onuCoordinateLabel(idx),
              oltId: olt.id,
              oltHost: olt.host,
              chassis: idx.chassis,
              board: idx.board,
              slot: idx.slot,
              pon: idx.pon,
              onuId: idx.onuId,
              name: realType || (vendor ? `${vendor}-${idx.onuId}` : `ONU-${idx.onuId}`),
              serial: serial || "unknown",
              phase: phaseByKey.get(idx.key)?.value || "unknown",
              adminState: adminStateByKey.get(idx.key)?.value || "unknown",
              softwareVersion: versionByKey.get(idx.key)?.value || "",
              vendor,
              realType,
              rxPower: opticalByKey.get(idx.key)?.value || "unknown",
              distance: "unknown",
              lastOnlineTime: "",
              lastOfflineTime: "",
              lastOfflineCauseCode: null,
              lastOfflineCause: "",
              address: port.address || "",
              source: "snmp"
            };
          });
        }
      }
    } else if (olt.vendor === "zte") {
      const hasScopedPon = requested.board && requested.pon;
      if (hasScopedPon) {
        const encodedPon = encodeZtePonIndex(requested.board, requested.pon);
        const scoped = (oid) => `${oid}.${encodedPon}`;
        const reads = [
          snmpWalk(olt, scoped(profile.onuName)),
          snmpWalk(olt, scoped(profile.phaseState)),
          snmpWalk(olt, scoped(profile.serialNumber), "-Onx"),
          snmpWalk(olt, scoped(profile.rxPower)),
          snmpWalk(olt, scoped(profile.distance))
        ];
        if (includeLastOnlineTime) reads.push(snmpWalk(olt, scoped(profile.lastOnlineTime)));
        if (includeOfflineDetails) {
          reads.push(snmpWalk(olt, scoped(profile.lastOfflineTime)));
          reads.push(snmpWalk(olt, scoped(profile.lastOfflineCause)));
        }
        const [names, phases, serials, rxPowers, distances, ...optionalReads] = await Promise.all(reads);
        const lastOnlineTimes = includeLastOnlineTime ? optionalReads.shift() : { rows: [] };
        const lastOfflineTimes = includeOfflineDetails ? optionalReads.shift() : { rows: [] };
        const lastOfflineCauses = includeOfflineDetails ? optionalReads.shift() : { rows: [] };

        if (names.ok && names.rows.length) {
          const phaseByKey = indexRows(phases.rows, profile.phaseState, parseZteIndex, (value) => phaseLabel(profile, value));
          const serialByKey = indexRows(serials.rows, profile.serialNumber, parseZteIndex, decodeHexSerial);
          const rxByKey = indexRows(rxPowers.rows, profile.rxPower, parseZteIndex, decodeZteRxPower);
          const distanceByKey = indexRows(distances.rows, profile.distance, parseZteIndex, decodeDistance);
          const lastOnlineByKey = indexRows(
            lastOnlineTimes.rows,
            profile.lastOnlineTime,
            parseZteIndex,
            (value) => decodeSnmpDateAndTime(value)?.label || cleanSnmpValue(value)
          );
          const lastOfflineByKey = indexRows(
            lastOfflineTimes.rows,
            profile.lastOfflineTime,
            parseZteIndex,
            (value) => decodeSnmpDateAndTime(value)?.label || parseDateTimeText(value)?.label || ""
          );
          const lastOfflineCauseByKey = indexRows(
            lastOfflineCauses.rows,
            profile.lastOfflineCause,
            parseZteIndex,
            (value) => decodeZteOfflineCause(value, profile)
          );

          rows = names.rows.map((row) => {
            const idx = parseZteIndex(row.oid, profile.onuName);
            const port = findLedgerPort(ponPorts, olt, idx.board, idx.pon, idx.chassis);
            return {
              id: onuCoordinateLabel(idx),
              oltId: olt.id,
              oltHost: olt.host,
              chassis: idx.chassis,
              board: idx.board,
              slot: idx.slot,
              pon: idx.pon,
              onuId: idx.onuId,
              name: cleanSnmpValue(row.value),
              serial: serialByKey.get(idx.key)?.value || "unknown",
              phase: phaseByKey.get(idx.key)?.value || "unknown",
              rxPower: rxByKey.get(idx.key)?.value || "unknown",
              distance: distanceByKey.get(idx.key)?.value || "unknown",
              lastOnlineTime: lastOnlineByKey.get(idx.key)?.value || "",
              lastOfflineTime: lastOfflineByKey.get(idx.key)?.value || "",
              lastOfflineCauseCode: lastOfflineCauseByKey.get(idx.key)?.value?.code ?? null,
              lastOfflineCause: lastOfflineCauseByKey.get(idx.key)?.value?.label || "",
              address: port.address || "",
              source: "snmp"
            };
          });
        }
      }
    } else {
      const hasScopedPon = requested.board && requested.pon;
      if (hasScopedPon) {
        const ifNames = await snmpWalk(olt, profile.ifName, "-On", 8000);
        const ifIndexByPon = ifNames.ok ? parseHuaweiIfNameRows(ifNames.rows) : new Map();
        const portKey = ponCoordinateKey(requested);
        let portInfo = ifIndexByPon.get(portKey);
        if (!portInfo && olt.vendor === "huawei" && String(requested.chassis) !== "0") {
          portInfo = ifIndexByPon.get(ponCoordinateKey({ ...requested, chassis: "0" }));
        }
        if (portInfo) {
          const scoped = (oid) => `${oid}.${portInfo.ifIndex}`;
          const reads = [
            snmpWalk(olt, scoped(profile.ontDescription), "-On", 10000),
            snmpWalk(olt, scoped(profile.ontSerialNumber), "-Onx", 10000),
            snmpWalk(olt, scoped(profile.runStatus), "-On", 10000),
            snmpWalk(olt, scoped(profile.rxPower), "-On", 10000),
            snmpWalk(olt, scoped(profile.distance), "-On", 10000)
          ];
          if (includeLastOnlineTime) reads.push(snmpWalk(olt, scoped(profile.lastOnlineTime), "-On", 10000));
          const [names, serials, phases, rxPowers, distances, lastOnlineTimes = { rows: [] }] = await Promise.all(reads);

          const ontIndexes = collectHuaweiOntIndexes([
            { rows: names.rows, baseOid: profile.ontDescription },
            { rows: serials.rows, baseOid: profile.ontSerialNumber },
            { rows: phases.rows, baseOid: profile.runStatus },
            { rows: rxPowers.rows, baseOid: profile.rxPower },
            { rows: distances.rows, baseOid: profile.distance },
            { rows: lastOnlineTimes.rows, baseOid: profile.lastOnlineTime }
          ]);

          if (ontIndexes.length) {
            const nameByKey = indexRows(names.rows, profile.ontDescription, parseHuaweiOntIndex, cleanSnmpValue);
            const serialByKey = indexRows(serials.rows, profile.ontSerialNumber, parseHuaweiOntIndex, decodeRawHexString);
            const phaseByKey = indexRows(phases.rows, profile.runStatus, parseHuaweiOntIndex, huaweiRunStatus);
            const rxByKey = indexRows(rxPowers.rows, profile.rxPower, parseHuaweiOntIndex, decodeHuaweiRxPower);
            const distanceByKey = indexRows(distances.rows, profile.distance, parseHuaweiOntIndex, decodeDistance);
            const port = findLedgerPort(ponPorts, olt, portInfo.board, portInfo.pon, portInfo.chassis);

            rows = ontIndexes.map((idx) => {
              return {
                id: onuCoordinateLabel({ ...portInfo, onuId: idx.onuId }),
                oltId: olt.id,
                oltHost: olt.host,
                chassis: portInfo.chassis,
                board: portInfo.board,
                slot: portInfo.slot,
                pon: portInfo.pon,
                onuId: idx.onuId,
                name: nameByKey.get(idx.key)?.value || `ONT-${idx.onuId}`,
                serial: serialByKey.get(idx.key)?.value || "N/A",
                phase: phaseByKey.get(idx.key)?.value || "unknown",
                rxPower: rxByKey.get(idx.key)?.value || "unknown",
                distance: distanceByKey.get(idx.key)?.value || "unknown",
                address: port.address || "",
                source: `snmp: ${portInfo.name}`
              };
            });
          }
        }
      }
    }

    if (includeResourceUsers) rows = await onuDataEnrichmentProxy().attachResourceUserFields(rows || [], olt);
    rows = await onuDataEnrichmentProxy().attachProjectAssignments(rows || [], olt.id);

    if (query.search) {
      const keyword = String(query.search).toLowerCase();
      rows = rows.filter((onu) => onuSearchText(onu).includes(keyword));
    }
    if (requested.chassis && query.chassis) rows = rows.filter((onu) => String(onu.chassis) === String(requested.chassis));
    if (requested.board && (query.board || query.slot)) rows = rows.filter((onu) => String(onu.board || onu.slot) === String(requested.board));
    if (requested.pon) rows = rows.filter((onu) => String(onu.pon) === String(requested.pon));
    return rows;
  }

  async function listUnregisteredOnus(olt) {
    const ponPorts = await getPonPorts();
    if (olt.vendor === "zte") {
      const profile = resolveOidProfile(olt);
      const isC600 = olt.deviceProfile === "zte-c600" || olt.model === "C600";
      const [serials, types, versions, loids, firstOnlineTimes, lastOnlineTimes] = isC600
        ? await Promise.all([
          snmpWalk(olt, profile.unconfiguredSerial, "-Onx", 10000),
          snmpWalk(olt, profile.unconfiguredType, "-Onx", 10000),
          snmpWalk(olt, profile.unconfiguredSoftwareVersion, "-Onx", 10000),
          snmpWalk(olt, profile.unconfiguredLoid, "-Onx", 10000),
          snmpWalk(olt, profile.unconfiguredFirstOnlineTime, "-Onx", 10000),
          snmpWalk(olt, profile.unconfiguredLastOnlineTime, "-Onx", 10000)
        ])
        : [await snmpWalk(olt, profile.unconfiguredSerial, "-Onx", 10000), null, null, null, null, null];
      const unconfiguredRows = (result) => result?.ok
        ? result.rows.filter((row) => !/No Such Object|No Such Instance/i.test(row.value))
        : [];
      const typeByKey = isC600
        ? indexRows(unconfiguredRows(types), profile.unconfiguredType, parseZteUnconfiguredIndex, decodeSnmpDisplayString)
        : new Map();
      const versionByKey = isC600
        ? indexRows(unconfiguredRows(versions), profile.unconfiguredSoftwareVersion, parseZteUnconfiguredIndex, decodeSnmpDisplayString)
        : new Map();
      const loidByKey = isC600
        ? indexRows(unconfiguredRows(loids), profile.unconfiguredLoid, parseZteUnconfiguredIndex, decodeSnmpDisplayString)
        : new Map();
      const firstOnlineByKey = isC600
        ? indexRows(unconfiguredRows(firstOnlineTimes), profile.unconfiguredFirstOnlineTime, parseZteUnconfiguredIndex, (value) => decodeSnmpDateAndTime(value)?.label || "")
        : new Map();
      const lastOnlineByKey = isC600
        ? indexRows(unconfiguredRows(lastOnlineTimes), profile.unconfiguredLastOnlineTime, parseZteUnconfiguredIndex, (value) => decodeSnmpDateAndTime(value)?.label || "")
        : new Map();
      const rows = serials.ok
        ? unconfiguredRows(serials)
          .map((row) => {
            const idx = parseZteUnconfiguredIndex(row.oid, profile.unconfiguredSerial);
            const ledger = findLedgerPort(ponPorts, olt, idx.board, idx.pon, idx.chassis);
            const serial = decodeHexSerial(row.value);
            return {
              chassis: idx.chassis,
              board: idx.board,
              slot: idx.slot,
              pon: idx.pon,
              entryIndex: idx.entryIndex,
              serial,
              oltId: olt.id,
              oltName: olt.name,
              oltHost: olt.host,
              oltVendor: olt.vendor,
              oltModel: olt.model,
              model: typeByKey.get(idx.key)?.value || "",
              softwareVersion: versionByKey.get(idx.key)?.value || "",
              loid: loidByKey.get(idx.key)?.value || "",
              firstOnlineTime: firstOnlineByKey.get(idx.key)?.value || "",
              lastOnlineTime: lastOnlineByKey.get(idx.key)?.value || "",
              detectedAt: new Date().toISOString(),
              state: "未注册",
              address: ledger.address || "",
              configPlan: buildConfigPlan({
                olt,
                chassis: idx.chassis,
                board: idx.board,
                slot: idx.slot,
                pon: idx.pon,
                serial,
                outerVlan: ledger.outerVlan,
                address: ledger.address
              })
            };
          })
        : [];
      return {
        oltId: olt.id,
        oltHost: olt.host,
        source: profile.unconfiguredSerial,
        message: rows.length ? "" : `${olt.model === "C600" ? "ZTE C600" : "ZTE C300"} 当前未读取到未注册 ONU。`,
        rows
      };
    }
    if (olt.vendor === "huawei") {
      const profile = oidProfiles.huawei;
      const [serials, statuses, ifNames] = await Promise.all([
        snmpWalk(olt, profile.unconfiguredSerial, "-Onx", 10000),
        snmpWalk(olt, profile.unconfiguredStatus, "-On", 10000),
        snmpWalk(olt, profile.ifName, "-On", 8000)
      ]);
      const ifIndexByPon = ifNames.ok ? parseHuaweiIfNameRows(ifNames.rows) : new Map();
      const ponByIfIndex = new Map([...ifIndexByPon.values()].map((port) => [port.ifIndex, port]));
      const statusByKey = statuses.ok
        ? indexRows(statuses.rows, profile.unconfiguredStatus, parseHuaweiOntIndex, huaweiUnconfiguredStatus)
        : new Map();
      const candidatePorts = new Map();
      if (serials.ok) {
        for (const row of serials.rows) {
          const idx = parseHuaweiOntIndex(row.oid, profile.unconfiguredSerial);
          const port = ponByIfIndex.get(idx.ifIndex);
          if (port) candidatePorts.set(ponCoordinateKey(port), port);
        }
      }
      const registeredRows = (await Promise.all(
        [...candidatePorts.values()].map((port) => listOnus(olt, {
          chassis: port.chassis,
          board: port.board,
          pon: port.pon
        }))
      )).flat();
      const rows = serials.ok
        ? filterHuaweiUnregisteredSerialRows({
          serialRows: serials.rows,
          statusRows: statuses.ok ? statuses.rows : [],
          registeredSerialRows: registeredRows.map((row) => ({ value: row.serial })),
          serialBaseOid: profile.unconfiguredSerial,
          statusBaseOid: profile.unconfiguredStatus
        })
          .map((row) => {
            const idx = parseHuaweiOntIndex(row.oid, profile.unconfiguredSerial);
            const port = ponByIfIndex.get(idx.ifIndex) || {};
            const ledger = findLedgerPort(ponPorts, olt, port.board ?? port.slot ?? "-", port.pon ?? "-", port.chassis ?? defaultChassisForVendor(olt.vendor));
            const serial = decodeHexSerial(row.value);
            return {
              oltId: olt.id,
              oltName: olt.name,
              oltHost: olt.host,
              oltVendor: olt.vendor,
              oltModel: olt.model,
              chassis: port.chassis ?? "-",
              board: port.board ?? port.slot ?? "-",
              slot: port.slot ?? "-",
              pon: port.pon ?? "-",
              serial,
              detectedAt: new Date().toISOString(),
              state: statusByKey.get(idx.key)?.value || "未注册",
              address: ledger.address || "",
              configPlan: buildConfigPlan({
                olt,
                chassis: port.chassis ?? defaultChassisForVendor(olt.vendor),
                board: port.board ?? port.slot ?? "<板卡>",
                slot: port.slot ?? "<槽位>",
                pon: port.pon ?? "<PON>",
                serial,
                outerVlan: ledger.outerVlan,
                address: ledger.address
              })
            };
          })
        : [];
      return {
        oltId: olt.id,
        oltHost: olt.host,
        source: profile.unconfiguredSerial,
        message: rows.length ? "" : "Huawei MA5800 当前未读取到未注册 ONU。",
        rows
      };
    }
    const vendorName = olt.vendor === "huawei" ? "Huawei MA5800" : "ZTE C300";
    return {
      oltId: olt.id,
      oltHost: olt.host,
      source: "read-only: unregistered ONU OID not verified",
      message: `${vendorName} 未注册 ONU 查询 OID 尚未完成现场验证，当前不显示占位数据。`,
      rows: []
    };
  }

  async function listAllUnregisteredOnus(olts = []) {
    const activeOlts = olts.filter((item) => item.enabled !== false && item.enabled !== 0);
    const results = await Promise.allSettled(
      activeOlts.map(async (olt) => {
        try {
          const res = await listUnregisteredOnus(olt);
          const rows = (res.rows || []).map((row) => ({
            ...row,
            oltId: olt.id,
            oltName: olt.name,
            oltHost: olt.host,
            oltVendor: olt.vendor,
            oltModel: olt.model
          }));
          return {
            ok: true,
            oltId: olt.id,
            oltHost: olt.host,
            oltName: olt.name,
            oltVendor: olt.vendor,
            oltModel: olt.model,
            rows,
            count: rows.length,
            message: res.message || ""
          };
        } catch (err) {
          return {
            ok: false,
            oltId: olt.id,
            oltHost: olt.host,
            oltName: olt.name,
            oltVendor: olt.vendor,
            oltModel: olt.model,
            rows: [],
            count: 0,
            error: err.message
          };
        }
      })
    );

    const allRows = [];
    const oltSummaries = [];
    let successCount = 0;
    for (const r of results) {
      if (r.status === "fulfilled") {
        const val = r.value;
        if (val.ok) {
          successCount++;
          allRows.push(...val.rows);
        }
        oltSummaries.push({
          id: val.oltId,
          host: val.oltHost,
          name: val.oltName,
          vendor: val.oltVendor,
          model: val.oltModel,
          ok: val.ok,
          count: val.count || 0,
          error: val.error || "",
          message: val.message || ""
        });
      }
    }

    return {
      all: true,
      totalOlts: activeOlts.length,
      scannedOlts: successCount,
      rows: allRows,
      oltSummaries,
      message: allRows.length === 0 ? "全网所有已启用 OLT 暂未发现未注册 ONU 数据" : ""
    };
  }

  function buildOnuHistorySummary(samples = []) {
    const numericRxSamples = samples
      .filter((sample) => Number.isFinite(Number.parseFloat(sample.rxPower)))
      .map((sample) => ({
        sampledAt: sample.sampledAt,
        rxPower: Number.parseFloat(sample.rxPower)
      }))
      .reverse();
    const reasonEvents = [];
    const seenReasons = new Set();
    for (const sample of samples) {
      if (!sample.lastOfflineCause) continue;
      const key = `${sample.lastOfflineTime || "unknown"}|${sample.lastOfflineCause}`;
      if (seenReasons.has(key)) continue;
      seenReasons.add(key);
      reasonEvents.push({
        time: sample.lastOfflineTime || sample.sampledAt,
        reason: sample.lastOfflineCause,
        code: sample.lastOfflineCauseCode
      });
    }
    const offlinePhases = new Set(["offline", "los", "dyinggasp", "authfailed"]);
    let transitions = 0;
    let previousOffline = false;
    for (const sample of [...samples].reverse()) {
      const currentOffline = offlinePhases.has(String(sample.phase || "").toLowerCase());
      if (currentOffline && !previousOffline) transitions += 1;
      previousOffline = currentOffline;
    }
    return {
      sampleCount: samples.length,
      rxPower: numericRxSamples.slice(-48),
      offlineCount: Math.max(reasonEvents.length, transitions),
      recentOfflineReasons: reasonEvents.slice(0, 5)
    };
  }

  async function getOnuConfig(olt, query) {
    const requested = requestCoordinate(query, olt);
    const chassis = String(requested.chassis ?? "").trim();
    const board = String(requested.board ?? "").trim();
    const slot = board;
    const pon = String(requested.pon ?? "").trim();
    const onuId = String(query.onuId ?? "").trim();
    const serial = String(query.serial ?? "").trim();
    if (!board || !pon) {
      return { ok: false, status: 400, error: "缺少板卡或 PON 参数。" };
    }

    const ponPorts = await getPonPorts();
    const ledger = findLedgerPort(ponPorts, olt, board, pon, chassis);
    const rows = await listOnus(olt, { chassis, board, pon }, { includeResourceUsers: true, includeLastOnlineTime: true, includeOfflineDetails: true });
    const row = rows.find((item) =>
      (onuId && String(item.onuId) === onuId) ||
      (serial && String(item.serial).toLowerCase() === serial.toLowerCase())
    );
    if (!row) {
      return { ok: false, status: 404, error: "当前槽/板卡/PON 未读取到匹配的 ONU，请确认搜索结果是否仍在线。" };
    }

    try {
      await recordOnuStatusHistory({ oltId: olt.id, oltIp: olt.host, rows: [row] });
    } catch {
      // History is best-effort; it must not block the current read-only detail.
    }
    let history = { sampleCount: 0, rxPower: [], offlineCount: 0, recentOfflineReasons: [] };
    try {
      history = buildOnuHistorySummary(await getOnuStatusHistory({
        oltId: olt.id,
        chassis,
        board,
        pon,
        onuId: row.onuId
      }));
    } catch {
      // History is best-effort; the current ONU fields remain available.
    }

    const servicePorts = olt.vendor === "zte"
      ? await readZteServicePorts(olt, { board, pon, onuId: row.onuId })
      : [];
    const telnetOptions = telnetReadOnlyOptionsForOlt(olt);
    const cliConfig = olt.vendor === "zte"
      ? await queryZteOnuReadOnly({
        host: olt.host,
        ...telnetOptions,
        chassis,
        board,
        slot,
        pon,
        onuId: row.onuId
      })
      : await queryHuaweiOnuReadOnly({
        host: olt.host,
        ...telnetOptions,
        chassis,
        board,
        slot,
        pon,
        onuId: row.onuId
      });
    const configChecks = buildConfigChecks(olt);
    if (olt.vendor === "zte" && servicePorts.length) {
      const pendingIndex = configChecks.findIndex((item) => item.name === "Service-port / 内层 VLAN");
      if (pendingIndex >= 0) configChecks.splice(pendingIndex, 1);
      configChecks.push({
        name: "Service-port / 业务 VLAN",
        status: "SNMP 已验证",
        value: `读取到 ${servicePorts.length} 条业务 VLAN：${servicePorts.map((item) => `${item.business} ${item.userVlan}`).join("、")}`
      });
    }

    return {
      ok: true,
      olt: {
        id: olt.id,
        name: olt.name,
        vendor: olt.vendor,
        model: olt.model,
        version: olt.version,
        host: olt.host
      },
      onu: {
        ...row,
        address: row.address || ledger.address || "",
        outerVlan: ledger.outerVlan || ""
      },
      linkStatus: {
        phase: row.phase,
        rxPower: row.rxPower,
        distance: row.distance
      },
      history,
      ledger: {
        ponPort: ponCoordinateKey({ chassis, board, pon }),
        chassis,
        board,
        pon,
        address: ledger.address || "",
        outerVlan: ledger.outerVlan || ""
      },
      configChecks: [],
      servicePorts,
      cliConfig,
      configPlan: buildConfigPlan({
        olt,
        chassis,
        board,
        slot,
        pon,
        onuId: row.onuId,
        serial: row.serial,
        outerVlan: ledger.outerVlan,
        address: row.address || ledger.address
      })
    };
  }

  async function listRecentOnus(olt, query = {}) {
    const profile = resolveOidProfile(olt);
    const ponPorts = (await getPonPorts()).filter((p) => !olt.host || p.oltIp === olt.host);
    const hours = Math.max(1, Math.min(168, Number(query.hours || 48)));
    const cutoff = Date.now() - hours * 60 * 60 * 1000;

    if (olt.deviceProfile === "zte-c600" || (olt.vendor === "zte" && olt.model === "C600")) {
      return {
        oltId: olt.id,
        oltHost: olt.host,
        source: profile.phaseState || "",
        hours,
        message: "ZTE C600 暂不支持全设备最近上线 ONU 批量检索，请指定具体 PON 端口查看实时在线 ONU 列表。",
        rows: []
      };
    }

    if (olt.vendor === "zte") {
      const [lastOnlineRows, serials, phases] = await Promise.all([
        snmpWalk(olt, profile.lastOnlineTime, "-On", 30000),
        snmpWalk(olt, profile.serialNumber, "-Onx", 30000),
        snmpWalk(olt, profile.phaseState, "-On", 30000)
      ]);
      const serialByKey = serials.ok || serials.rows.length
        ? indexRows(serials.rows, profile.serialNumber, parseZteIndex, decodeHexSerial)
        : new Map();
      const phaseByKey = phases.ok || phases.rows.length
        ? indexRows(phases.rows, profile.phaseState, parseZteIndex, (value) => phaseLabel(profile, value))
        : new Map();
      const rows = lastOnlineRows.ok || lastOnlineRows.rows.length
        ? lastOnlineRows.rows
          .map((row) => {
            const idx = parseZteIndex(row.oid, profile.lastOnlineTime);
            const seen = parseDateTimeText(row.value);
            if (!seen || seen.ts < cutoff) return null;
            const port = findLedgerPort(ponPorts, olt, idx.board, idx.pon, idx.chassis);
            return {
              chassis: idx.chassis,
              board: idx.board,
              slot: idx.slot,
              pon: idx.pon,
              onuId: idx.onuId,
              serial: serialByKey.get(idx.key)?.value || "N/A",
              lastOnlineAt: seen.label,
              state: phaseByKey.get(idx.key)?.value || "已注册",
              address: port.address || ""
            };
          })
          .filter(Boolean)
        : [];
      rows.sort((a, b) => b.lastOnlineAt.localeCompare(a.lastOnlineAt));
      return {
        oltId: olt.id,
        oltHost: olt.host,
        source: profile.lastOnlineTime,
        hours,
        message: rows.length ? "" : `ZTE C300 最近 ${hours} 小时未读取到已注册 ONU 上线记录。`,
        rows
      };
    }

    if (olt.vendor === "huawei") {
      const [lastOnlineRows, statuses, serials, ifNames] = await Promise.all([
        snmpWalk(olt, profile.lastOnlineTime, "-On", 30000),
        snmpWalk(olt, profile.runStatus, "-On", 30000),
        snmpWalk(olt, profile.ontSerialNumber, "-Onx", 30000),
        snmpWalk(olt, profile.ifName, "-On", 8000)
      ]);
      const ifIndexByPon = ifNames.ok || ifNames.rows.length ? parseHuaweiIfNameRows(ifNames.rows) : new Map();
      const ponByIfIndex = new Map([...ifIndexByPon.values()].map((port) => [port.ifIndex, port]));
      const statusByKey = statuses.ok || statuses.rows.length
        ? indexRows(statuses.rows, profile.runStatus, parseHuaweiOntIndex, huaweiRunStatus)
        : new Map();
      const serialByKey = serials.ok || serials.rows.length
        ? indexRows(serials.rows, profile.ontSerialNumber, parseHuaweiOntIndex, decodeRawHexString)
        : new Map();
      const rows = lastOnlineRows.ok || lastOnlineRows.rows.length
        ? lastOnlineRows.rows
          .map((row) => {
            const idx = parseHuaweiOntIndex(row.oid, profile.lastOnlineTime);
            const seen = decodeSnmpDateAndTime(row.value);
            if (!seen || seen.ts < cutoff) return null;
            const port = ponByIfIndex.get(idx.ifIndex) || {};
            const ledger = port.board != null && port.pon != null
              ? findLedgerPort(ponPorts, olt, port.board, port.pon, port.chassis)
              : {};
            return {
              chassis: port.chassis ?? "-",
              board: port.board ?? "-",
              slot: port.slot ?? "-",
              pon: port.pon ?? "-",
              onuId: idx.onuId,
              serial: serialByKey.get(idx.key)?.value || "N/A",
              lastOnlineAt: seen.label,
              state: statusByKey.get(idx.key)?.value || "已注册",
              address: ledger.address || ""
            };
          })
          .filter(Boolean)
        : [];
      rows.sort((a, b) => b.lastOnlineAt.localeCompare(a.lastOnlineAt));
      return {
        oltId: olt.id,
        oltHost: olt.host,
        source: profile.lastOnlineTime,
        hours,
        message: rows.length ? "" : `Huawei MA5800 最近 ${hours} 小时未读取到已注册 ONU 上线记录。`,
        rows
      };
    }

    return {
      oltId: olt.id,
      oltHost: olt.host,
      source: "",
      hours,
      message: "当前厂商暂未配置最近上线 ONU 查询 OID。",
      rows: []
    };
  }

  return { buildProjectConfigTemplates, buildStatus, buildUnregisteredConfigPlan, getOnuConfig, listAllUnregisteredOnus, listOnus, listRecentOnus, listUnregisteredOnus, refreshPonVlans };
}
