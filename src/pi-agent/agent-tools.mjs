/**
 * Pi Agent 严格只读工具集
 * 提供给 Agent 调用的受限工具定义与安全执行器，不包含任何设备写操作或 Shell 执行
 */

import { queryKnowledgeBase, getCommandDifferences } from "./knowledge-base.mjs";
import { searchWeb, extractWebPage } from "./web-search.mjs";
import { matchOltCandidate } from "./olt-command-matcher.mjs";
import { searchOnuCatalog } from "./onu-catalog.mjs";

export const PI_AGENT_TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "get_olt_status",
      description: "读取指定 OLT 的基本信息、厂商型号、SNMP 可达性与台账状态（不包含任何明文密码或 community）。",
      parameters: {
        type: "object",
        properties: {
          oltId: {
            type: "string",
            description: "OLT ID，例如 zte-c300-104-98、zte-c600-106-50 等；缺省时使用当前上下文 OLT。"
          }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "query_onus",
      description: "按机框、板卡、PON 端口或关键词搜索已注册的 ONU 列表及接收光功率。",
      parameters: {
        type: "object",
        properties: {
          oltId: { type: "string", description: "目标 OLT ID" },
          board: { type: "string", description: "板卡编号，例如 1 或 7" },
          pon: { type: "string", description: "PON 口编号，例如 1 或 12" },
          q: { type: "string", description: "模糊搜索关键词（如用户姓名、地址或 SN）" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "search_resource_users",
      description: "优先从本地用户资源库、统一 ONU 资料库和一级地址台账中查找用户或 ONU。没有板卡/PON 时必须先使用此工具；支持姓名、电话、地址、一级地址、SN、LOID、MAC 和设备号。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "自然语言中的姓名、电话、地址、一级地址、SN、LOID、MAC 或设备号" },
          intent: { type: "string", description: "可选：name、phone、address、primary_address、sn、loid、mac、device_number、onu_coordinate" },
          oltId: { type: "string", description: "可选，已知 OLT ID；缺省时搜索当前授权或本地资料库" }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "read_resolved_onu",
      description: "根据 search_resource_users 返回的候选 ONU 自动读取实时状态、光功率、距离和序列号。用户不需要再次输入板卡/PON；没有 OLT 配置或设备不可达时返回资料库结果并标记实时数据未验证。",
      parameters: {
        type: "object",
        properties: {
          candidateId: { type: "string", description: "search_resource_users 返回的候选 ID" },
          oltId: { type: "string", description: "可选，已授权 OLT ID" },
          chassis: { type: "string" },
          board: { type: "string" },
          pon: { type: "string" },
          onuId: { type: "string" }
        },
        required: ["candidateId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_unregistered_onus",
      description: "读取指定 OLT 上实时发现的未注册 / 未配置 ONT 列表。",
      parameters: {
        type: "object",
        properties: {
          oltId: { type: "string", description: "目标 OLT ID" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_onu_detail",
      description: "读取单个特定 ONU 的详细物理状态、测距距离、接收/发射光功率及历史快照。",
      parameters: {
        type: "object",
        properties: {
          oltId: { type: "string", description: "目标 OLT ID" },
          board: { type: "string", description: "板卡编号" },
          pon: { type: "string", description: "PON 口编号" },
          onuId: { type: "string", description: "ONU 编号 (1-128)" }
        },
        required: ["board", "pon", "onuId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "lookup_knowledge_base",
      description: "查询 OLT 厂商命令知识库，获取特定厂商/型号下已验证的运维命令、语法避坑说明或多型号差异对比。",
      parameters: {
        type: "object",
        properties: {
          vendor: { type: "string", description: "厂商：zte 或 huawei" },
          model: { type: "string", description: "设备型号：zte-c300, zte-c600, huawei-ma5800" },
          category: { type: "string", description: "分类：unregistered_onu, optical_power, board_status, vlan_service 等" },
          keyword: { type: "string", description: "搜索关键词" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_model_differences",
      description: "查看不同厂商和型号（如中兴 C300 ROS 与 C600 TITAN、华为 MA5800）在进入配置、接口命名、业务打标等方面的核心语法差异对比。",
      parameters: {
        type: "object",
        properties: {
          feature: { type: "string", description: "特性名称，如 config_terminal, interface_naming, vlan_service, optical_power 等" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "match_external_olt_candidate",
      description: "将外部搜索得到的候选命令与指定 OLT 的厂商、型号、版本、设备 profile、坐标能力和本地已验证命令表做确定性匹配；候选只可参考，不能自动执行。",
      parameters: {
        type: "object",
        properties: {
          oltId: { type: "string", description: "目标 OLT ID" },
          candidate: { type: "object", description: "外部候选方案，至少包含 vendor/model/version/deviceProfile/coordinate/command" }
        },
        required: ["oltId", "candidate"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "search_web",
      description: "在互联网上检索技术文档、未知 OLT 告警代码、非中兴/华为的其它厂商命令（如烽火、诺基亚、瑞斯康达）或光模块/路由器参数规范。当本地知识库没有收录或需要核实外部技术方案时使用。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "搜索关键词，例如 '烽火 AN5516 查看光功率命令' 或 '华为 OLT 0x2e11a002 告警原因'" }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "extract_web_page",
      description: "从搜索结果或其他技术网页的 URL 中提取正文 Markdown 内容。当需要深入查看某篇官方文档、论坛排障帖子、RFC 规范或设备参数手册的详细步骤时使用。",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "需要提取正文的完整 HTTP/HTTPS 链接" }
        },
        required: ["url"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "analyze_pon_weak_signals",
      description: "对指定 OLT 和 PON 端口（如 1/1/1 或 0/1/1）下的所有已配置/在线 ONU 进行光功率聚合分析与故障定界，区分整口主干光缆/一级分光器衰耗、局部二级分光器故障与散发性单户皮线故障，输出装维排障指引。",
      parameters: {
        type: "object",
        properties: {
          oltId: { type: "string", description: "目标 OLT ID（缺省时使用当前上下文 OLT）" },
          board: { type: "string", description: "板卡/槽位编号，例如 1 或 4" },
          pon: { type: "string", description: "PON 端口编号，例如 1 或 8" },
          chassis: { type: "string", description: "机框编号（中兴默认 1，华为默认 0）" }
        },
        required: ["board", "pon"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "diagnose_offline_cause",
      description: "对特定用户/ONU（支持按姓名、地址、SN、LOID 或端口+onuId）进行离线根因研判与装维排障建议。精准区分用户侧掉电关机（DyingGasp，切勿盲目上门翻光纤）、物理光纤折断（LOS，需上门排查皮线与法兰）、帧失步（LOF）或频繁闪断震荡。",
      parameters: {
        type: "object",
        properties: {
          oltId: { type: "string", description: "目标 OLT ID" },
          board: { type: "string", description: "板卡编号" },
          pon: { type: "string", description: "PON 口编号" },
          onuId: { type: "string", description: "ONU 编号 (1-128)" },
          q: { type: "string", description: "模糊检索关键词（如用户姓名、装机地址、SN 或 LOID），支持直接通过用户身份查找并诊断" }
        }
      }
    }
  }
];

/**
 * 整口弱光聚类与主干/分支/皮线故障定界分析实现
 */
export function analyzePonWeakSignalsImpl(rows = [], { olt = null, board = "1", pon = "1", chassis = "1" } = {}) {
  const allRows = Array.isArray(rows) ? rows : [];
  if (allRows.length === 0) {
    return {
      status: "empty",
      summary: `端口 ${chassis}/${board}/${pon} 下未查询到已注册或配置的 ONU 终端。`,
      diagnosis: {
        level: "info",
        conclusion: "无终端数据",
        rootCause: "当前端口下暂无 ONU 终端记录。",
        actionAdvice: ["请确认端口坐标是否正确，或该 PON 口尚未开通用户。"]
      },
      stats: { totalOnus: 0, totalOnline: 0, totalOffline: 0, weakCount: 0, severeWeakCount: 0 }
    };
  }

  const onlineRows = [];
  const offlineRows = [];
  const validRxRows = [];

  for (const r of allRows) {
    const rx = Number.parseFloat(r.rxPower);
    const hasValidRx = Number.isFinite(rx);
    const isOnline = r.status === "online" || String(r.phase || "").toLowerCase() === "working" || hasValidRx;
    if (isOnline) {
      onlineRows.push(r);
      if (hasValidRx) {
        validRxRows.push({ ...r, rxNumeric: rx });
      }
    } else {
      offlineRows.push(r);
    }
  }

  const totalOnus = allRows.length;
  const totalOnline = onlineRows.length;
  const totalOffline = offlineRows.length;

  const weakRows = validRxRows.filter((r) => r.rxNumeric < -27.0);
  const severeWeakRows = validRxRows.filter((r) => r.rxNumeric < -30.0);
  const healthyRows = validRxRows.filter((r) => r.rxNumeric >= -27.0);

  let avgRx = null;
  let minRx = null;
  let maxRx = null;

  if (validRxRows.length > 0) {
    const sum = validRxRows.reduce((acc, cur) => acc + cur.rxNumeric, 0);
    avgRx = Number((sum / validRxRows.length).toFixed(2));
    minRx = Math.min(...validRxRows.map((r) => r.rxNumeric));
    maxRx = Math.max(...validRxRows.map((r) => r.rxNumeric));
  }

  const weakCount = weakRows.length;
  const severeWeakCount = severeWeakRows.length;
  const weakRate = totalOnline > 0 ? Number((weakCount / totalOnline).toFixed(3)) : 0;

  let level = "healthy";
  let conclusion = "";
  let rootCause = "";
  let actionAdvice = [];

  if (totalOnline === 0 && totalOffline > 0) {
    level = "critical";
    conclusion = "🔴 整口全阻断（全部终端离线）";
    rootCause = `当前 PON 口共 ${totalOffline} 户全部离线，无任何在线终端。`;
    actionAdvice = [
      "1. 检查机房 OLT 对应 PON 口激光器发射状态（光模块是否失效或端口被管理员 shutdown）；",
      "2. 检查 ODF 架主跳纤与机房配线光缆是否脱落或严重折损；",
      "3. 检查一级光交箱分光器上联主干光缆是否发生外力施工挖断。"
    ];
  } else if (weakRate >= 0.5 || (totalOnline >= 3 && avgRx !== null && avgRx < -26.5)) {
    level = "severe_trunk";
    conclusion = "🔴 整口大面积弱光（主干光路严重衰耗 / 一级分光器异常）";
    rootCause = `整口弱光比例高达 ${(weakRate * 100).toFixed(1)}%（${weakCount}/${totalOnline} 户），平均接收光功率低至 ${avgRx} dBm。具有极强的主干级共性衰耗特征。`;
    actionAdvice = [
      "1. 【切勿盲目入户】：当前为整口系统性故障，严禁装维人员盲目入户翻动或更换用户侧皮线；",
      "2. 测量机房 OLT PON 口实际发射光功率，核对光模块发光是否衰退；",
      "3. 优先前往一级光交箱，使用光功率计测试分光器上联主干光纤输入功率，排查主干光纤跳线法兰脏污或主干大衰耗；",
      "4. 若主干输入光功率正常，更换一级分光器。"
    ];
  } else if (weakRate >= 0.2 && weakRate < 0.5) {
    level = "branch_splitter";
    conclusion = "🟡 局部/二级分光器级弱光异常";
    rootCause = `整口在线 ${totalOnline} 户，存在 ${weakCount} 户弱光（占比 ${(weakRate * 100).toFixed(1)}%），且伴随部分正常用户。通常表现为特定楼道或分支箱集中弱光。`;
    actionAdvice = [
      "1. 聚类核对弱光用户的装机地址或分纤箱归属，重点排查共用的二级分光器/楼道分光箱；",
      "2. 测试二级分光箱上联支路光纤输入端光功率，检查二级分光器分光损耗；",
      "3. 使用光纤清洁笔清洁二级分光器法兰盘与跳线插头。"
    ];
  } else if (weakCount > 0) {
    level = "individual_drop";
    conclusion = "🟢 散发性个别入户弱光（主干与分光良好）";
    rootCause = `整口在线 ${totalOnline} 户，仅 ${weakCount} 户为弱光（弱光率仅 ${(weakRate * 100).toFixed(1)}%），全口平均光功率达 ${avgRx} dBm，主干链路健康度高。`;
    actionAdvice = [
      "1. 主干光缆与各级分光器运行良好，无需排查机房与主干；",
      "2. 弱光系用户室内微弯、皮线光缆挤压老化或冷接子制作不良造成；",
      `3. 安排装维人员针对这 ${weakCount} 户弱光用户进行入户排查，重新制作冷接子或更换尾纤即可恢复。`
    ];
  } else {
    level = "healthy";
    conclusion = "🟢 整口光功率全部优良";
    rootCause = `全口在线 ${totalOnline} 户接收光功率均在 -27.0 dBm 以上，平均光功率达 ${avgRx} dBm，最差仅为 ${minRx} dBm，光路余量非常充足。`;
    actionAdvice = [
      "整口物理光路处于健康状态，无需任何物理割接或上门维护。"
    ];
  }

  return {
    oltId: olt?.id || "",
    port: `${chassis}/${board}/${pon}`,
    diagnosis: {
      level,
      conclusion,
      rootCause,
      actionAdvice
    },
    stats: {
      totalOnus,
      totalOnline,
      totalOffline,
      weakCount,
      severeWeakCount,
      healthyCount: healthyRows.length,
      weakRate: `${(weakRate * 100).toFixed(1)}%`,
      avgRxPower: avgRx !== null ? `${avgRx} dBm` : "N/A",
      minRxPower: minRx !== null ? `${minRx} dBm` : "N/A",
      maxRxPower: maxRx !== null ? `${maxRx} dBm` : "N/A"
    },
    weakOnus: weakRows.map((r) => ({
      onuIndex: r.onuIndexDisplay || r.onuIndex || `${r.board}/${r.pon}:${r.onuId}`,
      username: r.username || "未知",
      address: r.installationAddress || r.address || "未知地址",
      rxPower: r.rxPower,
      sn: r.sn || r.serial || ""
    }))
  };
}

/**
 * 单个 ONU 离线根因研判与装维排障建议实现
 */
export function diagnoseOfflineCauseImpl({ onu = null, config = null, history = null } = {}) {
  if (!onu && !config) {
    return {
      status: "not_found",
      conclusion: "未找到指定的 ONU 终端数据，请核对姓名、地址、SN 或端口号。"
    };
  }

  const target = { ...onu, ...config };
  const rawStatus = String(target.status || "").toLowerCase();
  const rawPhase = String(target.phase || target.linkStatus?.phase || "").toLowerCase();
  const isOnline = rawStatus === "online" || rawPhase === "working";

  const lastOfflineCause = target.lastOfflineCause || target.history?.recentOfflineReasons?.[0]?.reason || "";
  const lastOfflineCauseCode = target.lastOfflineCauseCode || target.history?.recentOfflineReasons?.[0]?.code;
  const lastOfflineTime = target.lastOfflineTime || target.history?.recentOfflineReasons?.[0]?.time || "未知";
  const lastOnlineTime = target.lastOnlineTime || "未知";
  const recentReasons = history?.recentOfflineReasons || target.history?.recentOfflineReasons || [];
  const offlineCount = history?.offlineCount || target.history?.offlineCount || 0;

  const rxPower = target.rxPower || target.linkStatus?.rxPower || "";
  const distance = target.distance || target.linkStatus?.distance || "";

  const causeNorm = String(lastOfflineCause).toLowerCase();

  let category = "unknown";
  let conclusion = "";
  let causeAnalysis = "";
  let actionAdvice = [];

  if (causeNorm.includes("dyinggasp") || lastOfflineCauseCode === 2 || causeNorm.includes("power-off") || causeNorm.includes("poweroff")) {
    category = "power_off";
    conclusion = "⚡ 用户侧掉电关机 (DyingGasp) · 切勿盲目上门翻光纤";
    causeAnalysis = `光猫在掉电前向 OLT 成功发送了 DyingGasp 告警报文。这直接证明【光纤物理链路 100% 畅通】，终端下线原因完全是由于供电中断。`;
    actionAdvice = [
      "1. 【切勿盲目上门】：严禁装维人员盲目翻动光缆、更换法兰或重熔皮线，光路无任何故障；",
      "2. 电话联系用户核实：家中是否拔掉光猫电源插头、外出关闭了总电闸、或房屋正在装修断电；",
      "3. 排除欠费停电或片区电网检修；",
      "4. 若用户反馈光猫插电但指示灯不亮或频繁出现 DyingGasp 闪断，重点排查光猫电源适配器（12V）老化鼓包，更换电源适配器即可。"
    ];
  } else if (causeNorm.includes("los") || causeNorm.includes("wiredown") || causeNorm.includes("wirecut") || lastOfflineCauseCode === 3) {
    category = "los_broken_fiber";
    conclusion = "🚨 光路物理中断 (LOS 信号丢失) · 需上门排查光路";
    causeAnalysis = `OLT 接收该终端的光信号彻底丢失，且光猫未能发出 DyingGasp 报文（表明光猫在通电状态下突然失去光信号），判定为物理断纤或光路严重阻断。`;
    actionAdvice = [
      "1. 【需要上门排障】：装维师傅携带红光笔、光功率计及皮线熔接工具上门；",
      "2. 检查楼道分纤箱、二级分光器对应端口跳线是否脱落被碰拔；",
      "3. 沿入户皮线光缆排查是否有外力挤压、折断或鼠咬；",
      "4. 检查室内光猫尾纤插头（SC/UPC）是否松脱，测试入户光功率是否达标。"
    ];
  } else if (causeNorm.includes("lof") || lastOfflineCauseCode === 4) {
    category = "lof_frame_loss";
    conclusion = "⚠️ 帧失步 / 光衰严重劣化 (LOF)";
    causeAnalysis = `光信号未完全中断，但误码率极高或光功率劣于灵敏度极限导致 GPON 帧无法同步。通常由微弯、接头严重污染引起。`;
    actionAdvice = [
      "1. 清洁入户尾纤插头和法兰盘；",
      "2. 检查皮线盘留半径是否过小（死弯）；",
      "3. 重新制作或冷接冷接子。"
    ];
  } else if (causeNorm.includes("deactive") || lastOfflineCauseCode === 8) {
    category = "deactive";
    conclusion = "⏸️ 管理性去激活 / 端口去使能 (Deactive)";
    causeAnalysis = `终端被 OLT 管理下发去激活或业务解绑。`;
    actionAdvice = [
      "检查 OLT 端口状态配置或重新激活 ONT。"
    ];
  } else if (causeNorm.includes("reboot") || lastOfflineCauseCode === 9) {
    category = "reboot";
    conclusion = "🔄 终端软件重启 (Reboot)";
    causeAnalysis = `用户主动在光猫后台点击了软重启，或升级固件自动重启。`;
    actionAdvice = [
      "若非人工重启，观察重启后能否稳定在线，排查光猫死机问题。"
    ];
  } else {
    category = "unspecified";
    conclusion = `❓ 离线原因：${lastOfflineCause || "未记录具体下线代码"}`;
    causeAnalysis = `设备未上报标准的下线告警代码，可能为网管脱管、SNMP 记录截断或超长离线。`;
    actionAdvice = [
      "结合当前在线状态与历史光功率综合判断，必要时通过内置终端执行只读命令查询。"
    ];
  }

  let flappingAlert = null;
  if (offlineCount >= 3 || recentReasons.length >= 3) {
    flappingAlert = `⚠️ 该终端近期记录了 ${offlineCount} 次掉线离线事件，存在链路闪断（Flapping）现象。请注意排查电源适配器接触不良或室外引入光缆在风吹下的晃动光衰波动。`;
  }

  return {
    userInfo: {
      onuIndex: target.onuIndexDisplay || target.onuIndex || `${target.board}/${target.pon}:${target.onuId || ""}`,
      username: target.username || "未知用户",
      installationAddress: target.installationAddress || target.address || "未知地址",
      sn: target.sn || target.serial || "",
      loid: target.loid || ""
    },
    currentState: {
      isOnline,
      status: isOnline ? "在线 (Online/Working)" : "离线 (Offline)",
      rxPower: rxPower || "N/A",
      distance: distance || "N/A",
      lastOnlineTime,
      lastOfflineTime
    },
    offlineDiagnosis: {
      category,
      conclusion,
      causeAnalysis,
      flappingAlert,
      actionAdvice
    },
    recentHistory: recentReasons.slice(0, 5)
  };
}

/**
 * 创建只读工具执行器
 */
export function createPiAgentToolExecutor({
  dataGateway = null,
  getOlts = async () => [],
  getOnuList = async () => ({ rows: [] }),
  getMergedOnuRecords = async () => [],
  getResourceUserRecords = async () => [],
  getPonPorts = async () => [],
  getUnregisteredOnus = async () => ({ rows: [] }),
  getOnuDetail = async () => null,
  analyzePonWeakSignals = null,
  diagnoseOfflineCause = null,
  getOnuConfig = null,
  getOnuStatusHistory = null
} = {}) {
  const resolvedCandidates = new Map();
  let resolvedCandidateSequence = 0;

  async function searchCatalog(args = {}, context = {}) {
    const mergedRows = await getMergedOnuRecords();
    const resourceRows = await getResourceUserRecords();
    const olts = await getOlts();
    const requestedScope = Array.isArray(args.scope?.oltIds)
      ? args.scope.oltIds.map((item) => String(item)).filter(Boolean)
      : Array.isArray(context.readonlyScope?.oltIds)
        ? context.readonlyScope.oltIds.map((item) => String(item)).filter(Boolean)
        : [];
    const targetOltId = String(args.oltId || context.oltId || "").trim();
    const scopeIds = [...new Set([...requestedScope, ...(targetOltId ? [targetOltId] : [])])];
    const allowedOltIps = olts
      .filter((olt) => !scopeIds.length || scopeIds.includes(String(olt.id)))
      .map((olt) => String(olt.host || "").trim())
      .filter(Boolean);
    const result = searchOnuCatalog({
      query: args.query,
      intent: args.intent || "auto",
      mergedRows,
      resourceRows,
      ponPorts: await getPonPorts(),
      limit: args.limit || 10,
      allowedOltIps
    });
    const oltByHost = new Map(olts.map((olt) => [String(olt.host || ""), olt]));
    const candidates = result.candidates.map((candidate) => {
      const candidateId = `catalog-${++resolvedCandidateSequence}`;
      const target = oltByHost.get(candidate.oltIp);
      const internal = { ...candidate, candidateId, oltId: target?.id ? String(target.id) : "" };
      resolvedCandidates.set(candidateId, internal);
      const { oltIp, ...safeCandidate } = internal;
      return safeCandidate;
    });
    return { ...result, candidates };
  }

  return async function executeTool(name, args = {}, context = {}) {
    const targetOltId = args.oltId || context.oltId || "";

    switch (name) {
      case "get_olt_status": {
        const olts = await getOlts();
        const matched = targetOltId ? olts.find((o) => o.id === targetOltId) : olts[0];
        if (!matched) return { error: `未找到指定 OLT: ${targetOltId || "default"}` };
        // 严格脱敏：不返回 readCommunity, telnetUsername, telnetPassword
        const { readCommunity, telnetUsername, telnetPassword, ...safeOlt } = matched;
        return {
          id: safeOlt.id,
          name: safeOlt.name,
          vendor: safeOlt.vendor,
          model: safeOlt.model,
          version: safeOlt.version,
          deviceProfile: safeOlt.deviceProfile,
          capabilities: safeOlt.capabilities && typeof safeOlt.capabilities === "object"
            ? safeOlt.capabilities
            : {},
          enabled: Boolean(safeOlt.enabled)
        };
      }

      case "query_onus": {
        if (args.q && !args.board && !args.pon) {
          return searchCatalog({ query: args.q, oltId: targetOltId, scope: args.scope }, context);
        }
        const result = await getOnuList({
          oltId: targetOltId,
          board: args.board,
          pon: args.pon,
          q: args.q
        });
        const rows = (result?.rows || []).slice(0, 30).map((r) => ({
          onuIndex: r.onuIndexDisplay || r.onuIndex,
          rxPower: r.rxPower,
          status: r.status,
          sn: r.sn,
          loid: r.loid,
          username: r.username,
          address: r.installationAddress
        }));
        return { count: rows.length, rows };
      }

      case "search_resource_users": {
        if (!args.query) return { status: "rejected", error: "查询内容不能为空" };
        return searchCatalog(args, context);
      }

      case "read_resolved_onu": {
        const resolved = resolvedCandidates.get(String(args.candidateId || "")) || {
          ...args,
          coordinate: {
            chassis: args.chassis,
            board: args.board,
            pon: args.pon,
            onuId: args.onuId
          }
        };
        const coordinate = {
          chassis: String(args.chassis || resolved.coordinate?.chassis || "").trim(),
          board: String(args.board || resolved.coordinate?.board || "").trim(),
          pon: String(args.pon || resolved.coordinate?.pon || "").trim(),
          onuId: String(args.onuId || resolved.coordinate?.onuId || "").trim()
        };
        const snapshot = {
          username: resolved.username || "",
          phone: resolved.phone || "",
          installationAddress: resolved.installationAddress || "",
          primaryAddress: resolved.primaryAddress || "",
          serial: resolved.serial || "",
          loid: resolved.loid || "",
          mac: resolved.mac || "",
          deviceNumber: resolved.deviceNumber || "",
          coordinate,
          source: resolved.source || "local-onu-catalog",
          syncedAt: resolved.syncedAt || ""
        };
        if (Object.values(coordinate).some((value) => !value)) {
          return { status: "catalog-only", snapshot, message: "资料库已找到记录，但缺少完整 ONU 坐标，无法读取实时状态。" };
        }
        const olts = await getOlts();
        const targetOlt = (args.oltId && olts.find((olt) => String(olt.id) === String(args.oltId))) ||
          (resolved.oltId && olts.find((olt) => String(olt.id) === String(resolved.oltId))) || null;
        if (!targetOlt) {
          return { status: "catalog-only", snapshot, message: "资料库已找到记录，但当前没有可用的 OLT 配置，实时 ONU 数据未验证。" };
        }
        try {
          const result = await getOnuList({
            oltId: targetOlt.id,
            chassis: coordinate.chassis,
            board: coordinate.board,
            pon: coordinate.pon
          });
          const row = (result?.rows || []).find((item) =>
            String(item.chassis) === coordinate.chassis &&
            String(item.board || item.slot) === coordinate.board &&
            String(item.pon) === coordinate.pon &&
            String(item.onuId) === coordinate.onuId
          );
          if (!row) return { status: "live-unavailable", snapshot, message: "已定位资料库记录，但实时 ONU 查询没有返回该坐标。" };
          return {
            status: "live-verified",
            source: "live-device",
            snapshot,
            live: {
              phase: row.phase || row.status || "unknown",
              rxPower: row.rxPower || "unknown",
              distance: row.distance || "unknown",
              serial: row.serial || snapshot.serial || "unknown",
              lastOnlineTime: row.lastOnlineTime || "",
              lastOfflineTime: row.lastOfflineTime || "",
              lastOfflineCause: row.lastOfflineCause || ""
            }
          };
        } catch {
          return { status: "live-unavailable", snapshot, message: "已定位资料库记录，但当前设备不可达，实时 ONU 数据未验证。" };
        }
      }

      case "get_unregistered_onus": {
        const result = await getUnregisteredOnus({ oltId: targetOltId });
        const rows = (result?.rows || []).map((r) => ({
          oltId: r.oltId,
          chassis: r.chassis,
          board: r.board,
          pon: r.pon,
          sn: r.sn || r.serial,
          vendor: r.vendor,
          discoveredAt: r.discoveredAt
        }));
        return { count: rows.length, rows };
      }

      case "get_onu_detail": {
        const detail = await getOnuDetail({
          oltId: targetOltId,
          board: args.board,
          pon: args.pon,
          onuId: args.onuId
        });
        if (!detail) return { error: "未能读取到该 ONU 的详细信息" };
        return {
          onuIndex: `${args.board}/${args.pon}:${args.onuId}`,
          rxPower: detail.rxPower,
          txPower: detail.txPower,
          distance: detail.distance,
          status: detail.status,
          username: detail.username,
          sn: detail.sn,
          loid: detail.loid
        };
      }

      case "analyze_pon_weak_signals": {
        if (typeof analyzePonWeakSignals === "function") {
          return analyzePonWeakSignals(args, context);
        }
        const olts = await getOlts();
        const matched = targetOltId ? olts.find((o) => o.id === targetOltId) : olts[0];
        const defaultChassis = matched?.vendor === "huawei" ? "0" : "1";
        const chassis = String(args.chassis || defaultChassis);
        const board = String(args.board || "1");
        const pon = String(args.pon || "1");

        const listResult = await getOnuList({
          oltId: matched?.id || targetOltId,
          board,
          pon,
          chassis
        });
        return analyzePonWeakSignalsImpl(listResult?.rows || [], {
          olt: matched,
          board,
          pon,
          chassis
        });
      }

      case "diagnose_offline_cause": {
        if (typeof diagnoseOfflineCause === "function") {
          return diagnoseOfflineCause(args, context);
        }
        const olts = await getOlts();
        const matched = targetOltId ? olts.find((o) => o.id === targetOltId) : olts[0];

        let targetOnu = null;
        let board = args.board;
        let pon = args.pon;
        let onuId = args.onuId;

        if (args.q) {
          const searchResult = await getOnuList({
            oltId: matched?.id || targetOltId,
            q: args.q
          });
          const rows = searchResult?.rows || [];
          if (rows.length === 0) {
            return { error: `未找到与关键词 "${args.q}" 匹配的 ONU 用户` };
          }
          targetOnu = rows[0];
          board = board || targetOnu.board;
          pon = pon || targetOnu.pon;
          onuId = onuId || targetOnu.onuId;
        }

        let detailConfig = null;
        let history = null;
        if (typeof getOnuConfig === "function" && matched && board && pon && onuId) {
          try {
            detailConfig = await getOnuConfig(matched, { board, pon, onuId, serial: targetOnu?.serial || targetOnu?.sn });
          } catch {
            // best-effort
          }
        }
        if (!detailConfig && typeof getOnuDetail === "function" && board && pon && onuId) {
          try {
            detailConfig = await getOnuDetail({ oltId: matched?.id, board, pon, onuId });
          } catch {
            // best-effort
          }
        }

        if (typeof getOnuStatusHistory === "function" && matched && board && pon && onuId) {
          try {
            const rawHistory = await getOnuStatusHistory({
              oltId: matched.id,
              chassis: args.chassis || (matched.vendor === "huawei" ? "0" : "1"),
              board,
              pon,
              onuId
            });
            history = {
              offlineCount: rawHistory.filter((h) => h.lastOfflineCause).length,
              recentOfflineReasons: rawHistory.filter((h) => h.lastOfflineCause).map((h) => ({
                time: h.lastOfflineTime || h.sampledAt,
                reason: h.lastOfflineCause,
                code: h.lastOfflineCauseCode
              }))
            };
          } catch {
            // best-effort
          }
        }

        return diagnoseOfflineCauseImpl({
          onu: targetOnu,
          config: detailConfig,
          history
        });
      }

      case "lookup_knowledge_base": {
        const entries = queryKnowledgeBase({
          vendor: args.vendor || context.vendor,
          model: args.model || context.model,
          category: args.category,
          keyword: args.keyword
        });
        return { count: entries.length, entries: entries.slice(0, 10) };
      }

      case "get_model_differences": {
        const diffs = getCommandDifferences({ feature: args.feature });
        return { differences: diffs };
      }

      case "match_external_olt_candidate": {
        const olts = await getOlts();
        const matched = targetOltId ? olts.find((olt) => String(olt.id) === String(targetOltId)) : null;
        if (!matched) return { status: "unknown", error: "必须提供有效 oltId，且不能使用默认 OLT 推断。" };
        const verifiedCommands = queryKnowledgeBase({
          vendor: matched.vendor,
          model: matched.deviceProfile || matched.model,
          keyword: args.candidate?.command || ""
        }).filter((entry) => entry.verified && entry.readOnly);
        return matchOltCandidate({
          candidate: args.candidate,
          snapshot: {
            vendor: matched.vendor,
            model: matched.model,
            version: matched.version,
            deviceProfile: matched.deviceProfile,
            capabilities: matched.capabilities
          },
          verifiedCommands
        });
      }

      case "search_web": {
        const query = String(args.query || "").trim();
        if (!query) return { error: "搜索关键词不能为空" };
        const result = await searchWeb({ query, limit: 4 });
        return result;
      }

      case "extract_web_page": {
        const url = String(args.url || "").trim();
        if (!url) return { error: "网页链接不能为空" };
        const result = await extractWebPage({ url });
        return result;
      }

      default:
        return { error: `未知或未授权的只读工具: ${name}` };
    }
  };
}
