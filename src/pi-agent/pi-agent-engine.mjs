/**
 * Pi Agent 核心智能体引擎
 * 版本感知的 OLT 只读问答、工具编排与降级回退调度器
 */

import http from "node:http";
import https from "node:https";
import { PI_AGENT_TOOL_DEFINITIONS, createPiAgentToolExecutor } from "./agent-tools.mjs";
import { queryKnowledgeBase, getCommandDifferences } from "./knowledge-base.mjs";
import { buildCompositeQuadPlayPlan } from "../config-plan.mjs";
import { createPiSdkAdapter, sanitizeTerminalContext } from "./pi-sdk-adapter.mjs";

function builtInNodeFetch(input, options = {}) {
  const url = input instanceof URL ? input : new URL(input);
  const client = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.request(url, {
      method: options.method || "GET",
      headers: options.headers || {}
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          text: async () => text,
          json: async () => JSON.parse(text)
        });
      });
      res.on("error", reject);
    });
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function cleanLlmReply(text) {
  return String(text || "").replace(/<think>[\s\S]*?<\/think>\s*/gi, "").trim();
}

const DEFAULT_SYSTEM_PROMPT = `你是由 DeepMind 与 OLT Manager 团队共同打造的“Pi Agent”——专为宽带网络接入层打造的【版本感知 OLT 智能运维助手】。
你的服务对象是一线网络运维与光纤排障工程师。

### 核心原则与安全红线（必须无条件遵守）：
1. 【严格只读】：本系统为纯只读管理架构。严禁向用户提供任何可能引发设备重启、恢复出厂、删除 ONU、解绑配置的破坏性自动化脚本。
2. 【禁止自动下发】：所有生成的配置或查询命令仅供工程师在终端中【人工核对与手动执行】，系统绝不自动向终端或设备下发执行命令。
3. 【敏感数据保护】：绝不在回复中透露设备的 SNMP 团体字、Telnet 明文密码或会话令牌。
4. 【设备命令语法权威字典（绝对红线，严禁捏造虚假命令）】：
   - 【中兴 C300 (ROS 架构)】：
     * 物理端口三级坐标格式必须为：gpon-olt_1/<槽位>/<PON端口>！
       一线工程师口头常说“2/5 口”或“2 槽 5 口”，在 CLI 中【必须补齐机框编号 1】，即写为 "gpon-olt_1/2/5"！绝对严禁写成 "gpon-olt_2/5"（漏掉机框号设备必定报错 "%Error 20202: Invalid parameter"）！
     * 单个 ONU 接口格式：gpon-onu_1/<槽位>/<PON端口>:<ONU_ID>（例如 gpon-onu_1/2/5:1）！
     * 【光功率权威命令体系（严禁使用任何不存在的命令）】：
       ⚠️ 绝无 "show gpon onu optical-info" 这条命令！敲此命令设备必报 "%Error 20200: Invalid command"！
       - 查看整 PON 口所有在线 ONU 接收光：\`show pon power onu-rx gpon-olt_1/<槽位>/<PON口>\`
       - 查看整 PON 口 OLT 接收到的各 ONU 上行光：\`show pon power olt-rx gpon-olt_1/<槽位>/<PON口>\`
       - 查看 OLT 端口发光：\`show pon power olt-tx gpon-olt_1/<槽位>/<PON口>\`
       - 查看单台 ONU 双向光衰与收发光：\`show pon power attenuation gpon-onu_1/<槽位>/<PON口>:<ONU_ID>\`
       - 查看单台 ONU 详细状态与光模块（含电压/温度/偏置电流）：\`show gpon onu detail-info gpon-onu_1/<槽位>/<PON口>:<ONU_ID>\`
     * 【ONU 运行状态与下线原因】：
       - 查看整 PON 口所有 ONU 状态：\`show gpon onu state gpon-olt_1/<槽位>/<PON口>\`
       - 查看整 PON 口所有 ONU 测距：\`show gpon onu distance gpon-olt_1/<槽位>/<PON口>\`
       - 查看未注册未配置 ONT：\`show gpon onu uncfg\`
   - 【中兴 C600 (TITAN 架构)】：
     * 端口命名下划线与连字符反转：\`interface gpon_olt-1/<槽位>/<PON口>\` 与 \`interface gpon_onu-1/<槽位>/<PON口>:<ONU_ID>\`！
     * 必须全写 "configure terminal"，敲缩写 "con t" 报 Ambiguous 错误！
     * 查看光功率：\`show gpon onu rx-power gpon_olt-1/<槽位>/<PON口>\` 或 \`show pon power onu-rx gpon_onu-1/<槽位>/<PON口>:<ONU_ID>\`
     * 查看未配置 ONT：\`show gpon uncfg-onu\`（同时兼容 \`show gpon onu uncfg\`）
     * 查看接口配置：必须进入接口视图后敲 \`show this\`，无法跨视图全局查询。
   - 【华为 MA5800】：
     * 端口坐标格式：\`0/<槽位>/<端口>\`
     * 查看单台 ONT 光功率：\`display ont optical-info 0/<槽位> <端口> <ONT_ID>\`
     * 查看整口 ONT 光功率：\`display ont optical-info 0/<槽位> <端口> all\`
     * 自动发现未注册设备：\`display ont autofind all\`
     * 认证绑定 SN：必须使用 16 进制原始 SN（如 5A544547030C0914），严禁输入带括号字符串（如 ZTEG-xxxx）。
5. 【语言规范】：全程、无条件使用严谨、清晰的中文交流。
6. 【数据呈现结构化规范】（至关重要）：
   回答必须结构清晰，严禁输出无分段、杂乱的长篇纯文本！必须按照以下核心模块组织回复：
   - 【诊断结论】：用简洁有力的 1-2 句话给出定位或结论。
   - 【推荐命令】：给出分步骤的准确命令代码块（\`\`\`bash ... \`\`\`），并明确标注执行视图（如全局配置模式、GPON 接口模式）。
   - 【参数标准】：若涉及光功率、丢包率、衰耗门限、离线原因代码等数值，必须使用 Markdown 表格（| 参量 | 正常门限 | 现场判定 |）结构化列出。
7. 【全场景方案装配规范（酒店全光网 / 园区 POL / 互联网专线 / MDU 互联）】：
   - 当用户要求生成或排查复合业务配置时（如“酒店全光网”、“一口自营宽带、二口 IPTV、三口内网、四口专线”），必须输出完整可交付的“三件套”：
     1) 前置核查命令（端口状态、光功率、未注册 ONT 核对）；
     2) 硬件级管道隔离的分步配置脚本（必须划分为 4 个独立 T-CONT / GEM Port 硬件管道，严禁混用单一 T-CONT，防止自营满速下载挤占专线和电视带宽；专线采用 QinQ 双层打标；IPTV 划分组播 MVLAN 与单播点播）；
     3) 分口验收与排障排查命令（包含一口查 MAC 在线、二口查机顶盒 IGMP 组播拉流、三口查内网互通、四口查 QinQ 业务流与衰耗）。

你可以调用提供的只读工具查询设备实时状态、光功率、未注册 ONT 及本地知识库；当遇到本地知识库未收录的内容、其它厂商设备（如烽火/诺基亚/瑞斯康达）、未知告警代码或外部标准时，你可以调用 search_web 工具在互联网上检索权威技术文档与排障方案。`;

export function createPiAgentEngine({
  getLanguageConfig = async () => null, // 返回 { endpoint, model, apiKey, format }
  dataGateway = null,
  getOlts = async () => [],
  getOnuList = async () => ({ rows: [] }),
  getUnregisteredOnus = async () => ({ rows: [] }),
  getOnuDetail = async () => null,
  getOnuConfig = null,
  getOnuStatusHistory = null,
  analyzePonWeakSignals = null,
  diagnoseOfflineCause = null,
  fetchImpl = null,
  piSdkAdapter = null,
  piSdkEnabled = false,
  piSdkModel = null,
  verifiedCommands = []
} = {}) {
  const safeFetch = typeof fetchImpl === "function"
    ? fetchImpl
    : (typeof globalThis.fetch === "function" ? globalThis.fetch.bind(globalThis) : builtInNodeFetch);

  const toolExecutor = createPiAgentToolExecutor({
    dataGateway,
    getOlts,
    getOnuList,
    getUnregisteredOnus,
    getOnuDetail,
    getOnuConfig,
    getOnuStatusHistory,
    analyzePonWeakSignals,
    diagnoseOfflineCause
  });

  const officialPiSdk = piSdkAdapter || createPiSdkAdapter({
    executeTool: toolExecutor,
    getOlts,
    verifiedCommands: verifiedCommands.length > 0
      ? verifiedCommands
      : queryKnowledgeBase().filter((entry) => entry.verified && entry.readOnly),
    enabled: piSdkEnabled,
    model: piSdkModel,
    getLanguageConfig
  });

function extractPortFromQuery(text) {
  const str = String(text || "").trim();
  const m3 = str.match(/(?:gpon[-_]olt[-_])?(\d+)[/_-](\d+)[/_-](\d+)/i);
  if (m3) {
    return { chassis: m3[1], slot: m3[2], pon: m3[3], portStr: `${m3[1]}/${m3[2]}/${m3[3]}` };
  }
  const m2 = str.match(/(?:gpon[-_]olt[-_])?(\d+)[/_-](\d+)/i) || str.match(/(\d+)\s*(?:槽|板卡|slot)\s*(\d+)\s*(?:口|pon|端口)/i);
  if (m2) {
    return { chassis: "1", slot: m2[1], pon: m2[2], portStr: `1/${m2[1]}/${m2[2]}` };
  }
  return null;
}

  /**
   * 当未配置远程大模型或网络不可用时的本地确定性知识库回退处理
   */
  function fallbackLocalAnswer(query, context = {}) {
    const norm = String(query || "").trim().toLowerCase();
    let vendor = context.vendor || "";
    let model = context.model || "";

    // 智能推断厂商与型号
    if (!vendor) {
      if (norm.includes("中兴") || norm.includes("zte")) vendor = "zte";
      else if (norm.includes("华为") || norm.includes("huawei")) vendor = "huawei";
    }
    if (!model) {
      if (norm.includes("c600")) { model = "zte-c600"; vendor = "zte"; }
      else if (norm.includes("c300")) { model = "zte-c300"; vendor = "zte"; }
      else if (norm.includes("ma5800") || norm.includes("5800")) { model = "huawei-ma5800"; vendor = "huawei"; }
    }

    const portInfo = extractPortFromQuery(query);
    const portStr = portInfo?.portStr || "1/1/1";
    const slotNum = portInfo?.slot || "1";
    const ponNum = portInfo?.pon || "1";
    const chassisNum = portInfo?.chassis || (vendor === "huawei" ? "0" : "1");

    // A. 酒店全光网 / 园区 POL 多业务复合方案（一口宽带、二口IPTV、三口内网、四口专线）
    if (
      norm.includes("酒店") ||
      norm.includes("全光网") ||
      norm.includes("四口") ||
      norm.includes("复合") ||
      (norm.includes("方案") && (norm.includes("iptv") || norm.includes("专线") || norm.includes("多业务") || norm.includes("自营")))
    ) {
      const targetVendor = vendor || "zte";
      const targetModel = model || (targetVendor === "huawei" ? "huawei-ma5800" : "zte-c300");
      const generatedPlan = buildCompositeQuadPlayPlan({
        vendor: targetVendor,
        deviceProfile: targetModel,
        chassis: chassisNum,
        board: slotNum,
        slot: slotNum,
        pon: ponNum,
        onuId: "1",
        serial: "ZTEG12345678",
        internetVlan: "3301",
        liveVlan: "86",
        ottVlan: "90",
        intranetVlan: "100",
        diaInnerVlan: "10",
        diaOuterVlan: "3500",
        speed: "100M"
      });

      const vendorName = targetVendor === "huawei" ? "华为 MA5800" : (targetModel.includes("c600") ? "中兴 C600 TITAN" : "中兴 C300");

      return `### 💡 方案设计：${vendorName} 酒店全光网 / 园区 POL 多业务复合配置方案

根据您的业务需求，为避免宽带下载突发流量挤占企业专线与 IPTV 电视点播组播带宽，本方案采用**硬件级 4 个独立 T-CONT / GEM Port 管道物理隔离**，实现 4 个物理网口精细化映射。

### 📊 4 个物理网口业务规划表
| 物理端口 | 承载业务 | 传输模式 / VLAN | 硬件管道隔离 (T-CONT / GEM Port) | 业务保障级别 |
| :--- | :--- | :--- | :--- | :--- |
| **网口 1 (Port 1)** | **自营宽带** | Hybrid / Def-VLAN 3301 | T-CONT 1 / GEM Port 1 (Profile: PPPoE) | 尽力而为 (Best Effort) |
| **网口 2 (Port 2)** | **IPTV 电视** | 单播 90 + 组播 MVLAN 86 | T-CONT 2 / GEM Port 2 (Profile: IPTV) | 高优先级 (Fast-Leave 组播加速) |
| **网口 3 (Port 3)** | **内部专网 / 办公** | Hybrid / Def-VLAN 100 | T-CONT 3 / GEM Port 3 (Profile: INTRANET) | 内部互通隔离 |
| **网口 4 (Port 4)** | **互联网专线 (DIA)**| QinQ (内层10 / 外层3500) | T-CONT 4 / GEM Port 4 (Profile: DIA_100M) | 最高保障 (SLA 独享带宽) |

---

### 📋 完整配置与验收排障脚本（前置核查 + 配置下发 + 分口验收）
\`\`\`bash
${generatedPlan.commands}
\`\`\`

---

### ⚠️ 现场实施避坑指南
1. **硬件隔离铁律**：绝不能将 4 个业务混用同一个 T-CONT 1！必须分别绑定 T-CONT 1~4 和 GEM Port 1~4，确保专线和电视在光物理层具备独占带宽切片。
2. **专线 QinQ 打标模式**：
   - 中兴 C300: 在全局使用 \`service-port 4 ... user-vlan 10 svlan 3500\`；
   - 华为 MA5800: 必须使用 \`tag-transform translate-and-add inner-vlan 10\`，由板卡硬件完成内外双层打标。
3. **只读安全原则**：以上方案仅供预览，请在终端人工核对端口坐标 \`${portStr}\` 及实际 ONU SN 后手动复制执行，系统不会自动向设备下发。`;
    }

    // B. 不同 OLT 之间 / OLT 与汇聚交换机 MDU 互联方案
    if (norm.includes("mdu") && (norm.includes("互联") || norm.includes("对接") || norm.includes("跨olt") || norm.includes("级联"))) {
      return `### 💡 方案设计：不同 OLT 之间 / OLT 与汇聚交换机 MDU 互联方案

在跨 OLT 割接、局端汇聚或多 OLT 级联场景下，MDU（多住户单元）通常采用光纤上联至主 OLT，或通过上联口（GE/XGE）与对端 OLT / 汇聚交换机进行跨设备互联。

### 📊 MDU 互联架构与规划表
| 互联环节 | 协议 / 模式 | VLAN 规划建议 | 关键防护机制 |
| :--- | :--- | :--- | :--- |
| **管理通道** | 带内管理 (In-Band) | 管理 VLAN（如 100 或 4000） | 配置 Loopback 管理 IP，ACL 限制访问源 |
| **用户宽带流** | QinQ / 802.1Q 透传 | SVLAN 汇聚（外层 1000~2000，内层 3000+） | 严格限速与广播抑制 |
| **防环机制** | STP / RSTP / LBD | 边缘端口开启 Loopback-detection | 防止 MDU 用户侧私接交换机回环瘫痪上级 OLT |

---

### 📋 推荐互联配置步骤示例（以中兴 / 华为上联与 MDU 互通为例）

#### 1. OLT 上联口透传业务与管理 VLAN (全局与上联口配置)
\`\`\`bash
! 1. 创建互联业务与管理 VLAN
vlan 100,1065,3609
exit

! 2. 上联口 Trunk 放行并配置双向流控
interface gei_1/19/1
  switchport mode trunk
  switchport trunk vlan 100,1065
  negotiation auto
exit
\`\`\`

#### 2. MDU PON 口注册与管道绑定
\`\`\`bash
! MDU 注册为 GPON-MDU 类型 (支持多业务与大带宽)
interface gpon-olt_${portStr}
  onu 1 type GPON-MDU sn ZTEG98765432
exit

interface gpon-onu_${portStr}:1
  sn-bind disable
  tcont 1 profile MDU_UP_1000M
  gemport 1 tcont 1
  service-port 1 vport 1 user-vlan 100 vlan 100
  service-port 2 vport 1 user-vlan 3609 vlan 3609 svlan 1065
exit
\`\`\`

#### 3. 跨设备互联验收命令
\`\`\`bash
! 验证对端 MAC 与 ARP 是否学习到
show mac vlan 100
show arp

! 验证 PON 链路光功率与 MDU 在线状态
show pon power attenuation gpon-onu_${portStr}:1
show gpon onu state gpon-olt_${portStr}
\`\`\`

---

### ⚠️ 现场避坑指南
1. **防止广播风暴**：MDU 下挂较多用户，必须在上联口和 PON 端口开启 \`storm-control broadcast\` 广播风暴抑制。
2. **环路风险**：不同 OLT 之间禁止形成物理双环且未起生成树，否则极易引发广播风暴击穿 CPU。`;
    }

    // 0. CLI 报错排障诊断（针对 Invalid parameter / Invalid command / 报错 20202 / 20200 / 错的）
    if (norm.includes("20202") || norm.includes("20200") || norm.includes("invalid parameter") || norm.includes("invalid command") || norm.includes("错的") || norm.includes("报错") || norm.includes("提示错误")) {
      const displayPort = portInfo?.portStr || "1/2/5";
      return `### 💡 诊断结论：中兴 C300 CLI 命令行报错原因定位
您在终端执行时遇到的报错，通常由【坐标缺失机框编号】与【光功率命令语法记混】引发：

1. **%Error 20202: Invalid parameter (光标指在端口处)**
   - **根本原因**：中兴 OLT 端口坐标必须是三段式（机框/槽位/PON口）。现场若只输入 \`2/5\`（如 \`gpon-olt_2/5\`），因缺少机框号（通常为 1）直接报参数无效。
   - **正确写法**：必须补齐机框编号 \`1/\`，即写为 \`gpon-olt_${displayPort}\`。

2. **%Error 20200: Invalid command (光标指在 optical-info 处)**
   - **根本原因**：中兴 C300 根本没有 \`show gpon onu optical-info\` 语法（此为华为体系命令记混）。
   - **正确写法**：中兴 C300 查光功率必须使用官方标准 \`show pon power\` 体系。

### 📋 中兴 C300 官方标准正确命令
| 查询目标 | 标准正确命令 (点击一键复制) | 说明 |
| :--- | :--- | :--- |
| **查看整口各 ONU 接收光** | \`show pon power onu-rx gpon-olt_${displayPort}\` | 查看该口所有在线光猫收光功率 |
| **查看整口 OLT 接收光** | \`show pon power olt-rx gpon-olt_${displayPort}\` | 查看 OLT 接收到的各光猫上行光 |
| **查看整口各 ONU 状态** | \`show gpon onu state gpon-olt_${displayPort}\` | 查看 Phase State、在线状态与离线原因 |
| **查看单台 ONU 详细光衰** | \`show pon power attenuation gpon-onu_${displayPort}:1\` | 查 1 号 ONU 衰耗及双向收发光 |
| **查看单台 ONU 完整详情** | \`show gpon onu detail-info gpon-onu_${displayPort}:1\` | 查 1 号 ONU 光模块参数、测距、电压温度 |

### ⚠️ 现场避坑指南
- 如果当前处于 \`(config)#\` 配置模式，中兴 C300 允许直接执行 \`show\` 命令；但必须使用三段端口编号 \`gpon-olt_${displayPort}\` 和 \`show pon power\` 关键字。`;
    }

    // 1. 询问 C600 与 C300 区别
    if (norm.includes("c600") && (norm.includes("区别") || norm.includes("差异") || norm.includes("c300") || norm.includes("注意"))) {
      return `### 💡 诊断结论
中兴 C600 属于 TITAN 分布式 ROSNG 架构，与传统 C300 (ROS 集中式) 在视图模式、接口命名、配置打标逻辑上存在根本差异，直接沿用 C300 脚本会导致批量报错。

### 📋 推荐命令与核心差异对比
| 特性维度 | 中兴 C300 (ROS) | 中兴 C600 TITAN | 关键避坑要点 |
| :--- | :--- | :--- | :--- |
| **进入全局配置** | \`configure terminal\` / \`con t\` | \`configure terminal\` | **C600 严禁缩写 \`con t\`**，敲缩写报 Ambiguous 错误 |
| **PON 接口命名** | \`interface gpon-olt_1/1/1\` | \`interface gpon_olt-1/1/1\` | **下划线与连字符位置彻底反转** |
| **ONU 接口命名** | \`interface gpon-onu_1/1/1:1\` | \`interface gpon_onu-1/1/1:1\` | 同上，下划线在前连字符在后 |
| **业务打标模式** | 全局配置 \`service-port ...\` | ONU 视图 \`vport-mode manual\` + \`vport-map\` | **C600 废除全局 service-port**，改为端口级打标 |
| **当前视图配置** | 跨视图 \`show running-config interface ...\` | 视图内敲 \`show this\` | C600 废除跨视图打印，进入接口后敲 \`show this\` |

### ⚠️ 现场避坑指南
1. C600 无法在全局直接查询某接口配置，必须先 \`interface gpon_onu-X/X/X:X\` 进入视图后再执行 \`show this\`。
2. 批量开通时，C600 必须确认 VLAN profile 与 vport 绑定正常。`;
    }

    // 2. 询问未注册 / autofind
    if (norm.includes("未注册") || norm.includes("autofind") || norm.includes("uncfg") || norm.includes("新上线")) {
      return `### 💡 诊断结论
未注册 ONU 指物理光纤已通、物理测距正常但未在 OLT 上完成开通认证的设备。排查时应先调取未认证表，获取其准确的物理 SN 与自动分配的临时通道。

### 📋 推荐命令
| 厂商设备 | 查询命令 | 所处视图 | 关键提取字段 |
| :--- | :--- | :--- | :--- |
| **中兴 C300** | \`show gpon onu uncfg\` | 特权模式 | 物理 SN、所在 PON 口、链路距离 |
| **中兴 C600** | \`show gpon onu uncfg\` | 特权模式 | 物理 SN、gpon_olt 端口编号 |
| **华为 MA5800** | \`display ont autofind all\` | 全局配置视图 | \`Ont SN\`（十六进制原始 SN）、Ont ID |

### 📊 典型 SN 格式对比
| 设备厂商 | SN 格式示例 | 认证命令关键点 |
| :--- | :--- | :--- |
| **中兴 (ZTE)** | \`ZTEG030C0914\` | 在 \`gpon-olt\` 视图敲 \`onu 1 type ... sn ZTEG...\` |
| **华为 (Huawei)** | \`5A544547030C0914\` (16进制) | 必须敲十六进制原始 SN，**严禁输入带括号的 ZTEG 字符** |

### ⚠️ 现场避坑指南
- 华为 MA5800 在 \`ont add ... sn-auth\` 时，若误输入带括号的字符（如 \`ZTEG-xxxx\`），将导致认证一直卡在 \`initial\` 状态无法工作。`;
    }

    // 3. 询问光功率 / 弱光聚类分析 / 接收功率 / 衰减
    if (norm.includes("弱光") || norm.includes("光功率") || norm.includes("收光") || norm.includes("发光") || norm.includes("衰减") || norm.includes("聚类") || norm.includes("power")) {
      return `### 💡 诊断结论：整口光功率与弱光聚类定界分析
GPON 物理层通信基于树状点对多点（P2MP）分光网络。排查弱光时，必须先进行【聚类分析】以快速定界是**主干光缆/一级分光器故障**、**楼道二级分光器故障**、还是**个别入户皮线故障**，避免盲目入户。

### 📊 弱光聚类定界三级法则（装维必读）
| 聚类故障级别 | 现场判定特征 | 故障根因定界 | 现场装维处置指引 |
| :--- | :--- | :--- | :--- |
| 🔴 **整口/主干级故障** | 弱光比例 $\\ge 50\\%$，或整口平均光功率 $< -26.5\\text{ dBm}$ | **机房至一级光交箱主干大衰耗 / 一级分光器损坏 / OLT发光不足** | **【严禁盲目入户修线】**。优先检查机房 PON 发射光功率，测试一级光交箱分光器上联主干光衰，清洁主干法兰。 |
| 🟡 **分支/二级箱级故障** | 弱光比例 $20\\% \\sim 50\\%$，集中在特定楼栋或分纤箱 | **二级分光器输入法兰脏污 / 楼道分支光缆弯折** | 锁定弱光用户共用的二级分光箱，测试二级箱输入光功率，清洁二级分光器法兰盘。 |
| 🟢 **散发性单户故障** | 仅 $1 \\sim 2$ 户弱光（占比 $< 20\\%$），其余用户均优于 $-24\\text{ dBm}$ | **单户室内皮线弯折 / 冷接子老化 / 尾纤损坏** | 主干与分光良好，直接上门排查特定弱光用户室内布线，重新制作冷接子或更换尾纤。 |

### 📋 实时推荐命令
| 序号 | 适用设备 | 命令 | 视图模式 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| 1 | 中兴 C300 | \`show pon power onu-rx gpon-olt_${portStr}\` | 特权/配置模式 | 查看整端口所有 ONU 接收光 |
| 2 | 中兴 C300 | \`show pon power olt-rx gpon-olt_${portStr}\` | 特权/配置模式 | 查看 OLT 接收各 ONU 上行光 |
| 3 | 中兴 C300 | \`show pon power attenuation gpon-onu_${portStr}:1\` | 特权/配置模式 | 查看单台 ONU 收发光与线路衰耗 |
| 4 | 中兴 C600 | \`show gpon onu rx-power gpon_olt-${portStr}\` | 特权模式 | C600 TITAN 架构整口光功率 |
| 5 | 华为 MA5800 | \`display ont optical-info 0/${slotNum} ${ponNum} all\` | 诊断/配置视图 | 华为查看 PON 口下所有 ONT 光功率 |

### ⚠️ 现场避坑指南
1. **中兴 C300 必须使用三段式机框坐标**：写为 \`gpon-olt_${portStr}\`，严禁遗漏机框编号写成 \`2/5\`；中兴无 \`optical-info\` 命令，必须使用 \`show pon power\` 体系。
2. **中兴 C600 命令语法不同**：C600 接口名称为 \`gpon_olt-\`（下划线在前），不能敲 C300 的 \`gpon-olt_\`，否则报错。
3. **光饱和风险**：短距离跳线测试时，Rx 若高于 \`-8 dBm\` 可能击穿光模块接收灵敏度，需加配 5dB/10dB 光衰。`;
    }

    // 4. 离线原因与下线分析（DyingGasp vs LOS）
    if (norm.includes("离线") || norm.includes("掉线") || norm.includes("下线") || norm.includes("dyinggasp") || norm.includes("掉电") || norm.includes("断纤") || norm.includes("los") || norm.includes("原因")) {
      return `### 💡 诊断结论：ONU 离线根因快速研判
ONU 离线主要分为两类根本原因：**DyingGasp（终端掉电）** 与 **LOS / WireCut（光纤断开/物理衰耗过大）**。排查时切勿盲目上门，先查历史下线原因。

### 📊 离线原因代码与装维处置决策树
| 离线根因分类 | 现场判定依据 (Offline Reason) | 故障根本原因 | 现场装维处置决策（避坑指引） |
| :--- | :--- | :--- | :--- |
| ⚡ **用户侧掉电关机** | **DyingGasp** / code=2 / power-off | 用户拔除电源、家中拉闸停电、光猫适配器故障 | **【100% 物理光路正常，切勿上门动光纤】**。电话联系用户确认通电状态，或排查 12V 电源适配器电容鼓包。 |
| 🚨 **光路物理中断** | **LOS** / code=3 / WireDown / WireCut | 室内外皮线光缆剪断、分光器跳线脱落、冷接子拉脱 | **【必须上门排查物理光路】**。携带红光笔与光功率计，排查分纤箱跳线及室内皮线断点。 |
| ⚠️ **帧失步/严重劣化** | **LOF** / code=4 | 光衰劣化至接收极限（$<-30\\text{ dBm}$），误码率过大失步 | 清洁光纤法兰盘，排查皮线转弯死弯，重新冷接。 |
| 🔄 **频繁闪断震荡** | 短时间内多次上下线记录 (Flapping) | 电源接触不良、或室外光缆受风吹晃动导致光衰跳变 | 检查电源插头虚接、更换电源适配器，或加固室外悬挂光缆。 |

### 📋 常用下线原因查询命令
| 厂商设备 | 离线原因查询命令 | 关键关注字段 |
| :--- | :--- | :--- |
| **中兴 C300** | \`show gpon onu state gpon-olt_${portStr}\` | \`Phase State\`、\`Offline Reason\` |
| **中兴 C300 单台** | \`show gpon onu detail-info gpon-onu_${portStr}:1\` | \`Offline Reason\`（看下线根因代码） |
| **中兴 C600** | \`show gpon onu detail-info gpon_onu-${portStr}:1\` | \`Last down cause\`、\`Last down time\` |
| **华为 MA5800** | \`display ont info 0/${slotNum} ${ponNum} 1\` | \`Last down cause\`、\`Last up time\` |

### ⚠️ 现场避坑指南
- 如果同一 PON 口下大面积 ONU 同时报 \`LOS\`，属于主干光纤断裂；如果整口大面积同时报 \`DyingGasp\`，属于机房或台区停电。`;
    }

    // 5. 流氓 ONU（长发光干扰）排查
    if (norm.includes("流氓") || norm.includes("常发光") || norm.includes("长发光") || norm.includes("干扰") || norm.includes("rogue")) {
      return `### 💡 诊断结论
PON 采用时分多址（TDMA）机制，所有 ONU 上行必须按时隙突发发光。若某台光猫光模块损坏变为【常发光】（流氓 ONU），将持续发射激光淹没整个 PON 口，导致整口其他所有正常 ONU 无法通信甚至集体离线。

### 📋 推荐排查命令
| 厂商设备 | 检测与隔离命令 | 视图模式 | 说明 |
| :--- | :--- | :--- | :--- |
| **中兴 C300** | \`show pon power onu-rx gpon-olt_1/1/1\` | 特权模式 | 静默时隙若检测到持续光功率即有流氓光猫 |
| **中兴 C600** | \`show gpon rogue-onu gpon_olt-1/1/1\` | 特权模式 | C600 自动流氓 ONU 扫描识别表 |
| **华为 MA5800** | \`anti-rogueont continuous-send-check\` | 全局/接口 | 开启常发光自动探测与隔离 |

### 📊 处置三步法
| 步骤 | 阶段目标 | 具体操作 |
| :--- | :--- | :--- |
| **Step 1** | **现象识别** | PON 端口下多个 ONU 突然同步离线且光衰正常 |
| **Step 2** | **软件定位** | 执行流氓检测命令，定位常发光的具体 ONU 坐标与 SN |
| **Step 3** | **物理隔离** | 在 OLT 执行端口级去激活，或在分光器处拔出该跳纤 |

### ⚠️ 现场避坑指南
- 流氓 ONU 会阻断测距过程，排障期间任何新接光猫都无法上线。建议采用二分法拔插分光器端口快速缩小范围。`;
    }

    // 6. 测距距离查询
    if (norm.includes("测距") || norm.includes("距离") || norm.includes("光纤长度") || norm.includes("distance")) {
      const entries = queryKnowledgeBase({ vendor, model, category: "onu_running_status" }).filter((e) => e.title.includes("测距") || e.command.includes("distance"));
      if (entries.length) {
        return `【ONU 测距距离查询命令】\n\n` +
          entries.map((e) => `### ${e.title} (${e.model})\n- **命令**：\`${e.command}\`\n- **说明**：${e.description}`).join("\n\n");
      }
    }

    // 7. 端口流量、带宽与丢包
    if (norm.includes("流量") || norm.includes("带宽") || norm.includes("丢包") || norm.includes("crc") || norm.includes("速率")) {
      const entries = queryKnowledgeBase({ vendor, model, category: "traffic_bandwidth" });
      if (entries.length) {
        return `【PON 端口实时流量与丢包统计】\n\n` +
          entries.map((e) => `### ${e.title} (${e.model})\n- **命令**：\`${e.command}\`\n- **说明**：${e.description}`).join("\n\n");
      }
    }

    // 8. 系统健康、CPU、内存与温度
    if (norm.includes("cpu") || norm.includes("内存") || norm.includes("温度") || norm.includes("风扇") || norm.includes("负荷")) {
      const entries = queryKnowledgeBase({ vendor, model, category: "system_health" });
      if (entries.length) {
        return `【OLT 系统 CPU、内存与环境温度检查】\n\n` +
          entries.map((e) => `### ${e.title} (${e.model})\n- **命令**：\`${e.command}\`\n- **说明**：${e.description}`).join("\n\n");
      }
    }

    // 9. 用户 MAC 地址学习
    if (norm.includes("mac") || norm.includes("学到") || norm.includes("学习")) {
      const entries = queryKnowledgeBase({ vendor, model, category: "mac_learning" });
      if (entries.length) {
        return `【业务 VLAN / 端口用户 MAC 地址查询】\n\n` +
          entries.map((e) => `### ${e.title} (${e.model})\n- **命令**：\`${e.command}\`\n- **说明**：${e.description}`).join("\n\n");
      }
    }

    // 10. 设备当前活动告警
    if (norm.includes("告警") || norm.includes("alarm") || norm.includes("故障")) {
      const entries = queryKnowledgeBase({ vendor, model, category: "alarm_log" });
      if (entries.length) {
        return `【设备当前未消除活动告警查询】\n\n` +
          entries.map((e) => `### ${e.title} (${e.model})\n- **命令**：\`${e.command}\`\n- **说明**：${e.description}`).join("\n\n");
      }
    }

    // 11. 默认关键词模糊匹配
    const matches = queryKnowledgeBase({ vendor, model, keyword: query });
    if (matches.length) {
      return `根据您的问题，Pi Agent 为您匹配到以下命令与排障知识：\n\n` +
        matches.slice(0, 4).map((m) => `### ${m.title} (${m.model})\n- **命令**：\`${m.command}\`\n- **视图**：${m.view}\n- **说明**：${m.description}`).join("\n\n");
    }

    return `您好，我是 OLT 智能运维助手 Pi Agent。您可以直接向我询问：\n` +
      `- 查光功率、收光发光、弱光整治标准（如“中兴怎样查光功率”、“光功率正常范围”）\n` +
      `- 查未注册或新发现 ONT（如“华为查看未注册设备”）\n` +
      `- 排查掉线原因（如“怎样看ONU离线原因是掉电还是断纤”）\n` +
      `- 排查流氓 ONU / 连续常发光（如“流氓ONU怎么查”）\n` +
      `- 查 PON 端口实时流量、丢包 CRC、测距距离\n` +
      `- 中兴 C600 TITAN 架构相比传统 C300 命令的核心差异与避坑点\n` +
      `- 华为 MA5800 常用查看命令与 SN 认证规范`;
  }

  /**
   * 处理单次对话请求
   */
  async function chat({ messages = [], context = {} } = {}) {
    const userQuery = messages.filter((m) => m.role === "user").at(-1)?.content || "";

    // 仅在调用方明确打开 Pi SDK 且给出只读范围时进入官方 SDK；SDK 不可用时继续走既有回退链路。
    if (officialPiSdk && (context.piSdk === true || piSdkEnabled || process.env.OLT_PI_SDK_ENABLED === "1")) {
      const piResult = await officialPiSdk.chat({ messages, context });
      if (piResult?.source === "pi-sdk-agent" || piResult?.source === "pi-sdk-rejected") return piResult;
    }

    const langConfig = await getLanguageConfig();

    // 如果未配置 LLM 或配置不全，无缝平滑回退至本地确定性知识库
    if (!langConfig || !langConfig.endpoint || !langConfig.model || !langConfig.apiKey) {
      const reply = fallbackLocalAnswer(userQuery, context);
      return {
        reply,
        source: "local-knowledge-base",
        toolsUsed: []
      };
    }

    // 智能提取用户提到的端口坐标
    const portInfo = extractPortFromQuery(userQuery);
    const targetSlot = portInfo?.slot || "1";
    const targetPon = portInfo?.pon || "1";

    // 智能推断厂商与型号
    let queryVendor = context.vendor || "";
    let queryModel = context.model || "";
    const lowerQ = userQuery.toLowerCase();
    if (!queryVendor) {
      if (lowerQ.includes("中兴") || lowerQ.includes("zte")) queryVendor = "zte";
      else if (lowerQ.includes("华为") || lowerQ.includes("huawei")) queryVendor = "huawei";
    }

    // 检索本地知识库条目作为权威真值基线
    const matchedKb = queryKnowledgeBase({
      vendor: queryVendor,
      model: queryModel,
      keyword: userQuery
    });

    let kbBaseline = "";
    if (matchedKb.length > 0) {
      kbBaseline = "\n\n【本地知识库官方权威命令真值基线（若涉及命令，必须严格采用以下标准语法，严禁自创未收录命令）：】\n" +
        matchedKb.slice(0, 5).map((e) => {
          let cmd = e.command
            .replace(/\{slot\}/g, targetSlot)
            .replace(/\{board\}/g, targetSlot)
            .replace(/\{pon\}/g, targetPon)
            .replace(/\{onuId\}/g, "1");
          return `- 【${e.title}】: \`${cmd}\` （说明：${e.description}）`;
        }).join("\n");
    }

    // 构建完整上下文提示
    const contextPrompt = [
      context.vendor ? `当前 OLT 厂商: ${context.vendor}` : "",
      context.model ? `当前设备型号: ${context.model}` : "",
      context.oltId ? `当前 OLT ID: ${context.oltId}` : "",
      context.coordinate ? `当前选中坐标: ${JSON.stringify(context.coordinate)}` : "",
      sanitizeTerminalContext(context.terminalContext) ? `最近终端输出（已脱敏）: ${sanitizeTerminalContext(context.terminalContext)}` : "",
      portInfo ? `识别到用户关注端口: ${portInfo.portStr} (机框${portInfo.chassis} 槽位${portInfo.slot} PON口${portInfo.pon})` : ""
    ].filter(Boolean).join(" | ");

    const systemMessage = {
      role: "system",
      content: DEFAULT_SYSTEM_PROMPT + (contextPrompt ? `\n\n【当前终端上下文】: ${contextPrompt}` : "") + kbBaseline
    };

    const requestMessages = [systemMessage, ...messages.slice(-10)];
    const toolsUsed = [];

    // 最多允许 3 轮工具调用循环
    for (let round = 0; round < 3; round += 1) {
      const payload = {
        model: langConfig.model,
        messages: requestMessages,
        tools: PI_AGENT_TOOL_DEFINITIONS,
        tool_choice: "auto",
        temperature: 0.2
      };

      let response;
      try {
        const url = langConfig.endpoint.endsWith("/chat/completions")
          ? langConfig.endpoint
          : `${langConfig.endpoint.replace(/\/+$/, "")}/chat/completions`;

        const res = await safeFetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${langConfig.apiKey}`
          },
          body: JSON.stringify(payload)
        });

        if (!res.ok) {
          const errBody = await res.text();
          throw new Error(`LLM upstream error ${res.status}: ${errBody.slice(0, 200)}`);
        }
        response = await res.json();
      } catch (err) {
        // 请求上游大模型失败时，降级使用本地知识库，绝不报错阻断工程师
        return {
          reply: `${fallbackLocalAnswer(userQuery, context)}\n\n*(注：远程大模型通信暂不可用，已自动切换为本地知识库解答)*`,
          source: "fallback-local-on-error",
          error: err.message,
          toolsUsed
        };
      }

      const choice = response.choices?.[0];
      const message = choice?.message;
      if (!message) break;

      // 如果模型决定调用工具
      if (message.tool_calls && message.tool_calls.length > 0) {
        requestMessages.push(message);

        for (const toolCall of message.tool_calls) {
          const funcName = toolCall.function?.name;
          let funcArgs = {};
          try {
            funcArgs = JSON.parse(toolCall.function?.arguments || "{}");
          } catch {
            funcArgs = {};
          }

          toolsUsed.push({ name: funcName, args: funcArgs });
          const toolResult = await toolExecutor(funcName, funcArgs, context);

          requestMessages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify(toolResult)
          });
        }
        // 继续循环让模型综合工具结果生成回答
        continue;
      }

      // 模型完成纯文本回复
      const cleaned = cleanLlmReply(message.content);
      if (/^\s*\{\s*"count"\s*:\s*\d+/i.test(cleaned)) {
        const onuQueryTool = toolsUsed.find((t) => t.name === "query_onus");
        const queryTerm = onuQueryTool?.args?.q ? `【${onuQueryTool.args.q}】` : "该地址或条件";
        return {
          reply: `在系统台账中未查询到与 ${queryTerm} 匹配的在线用户或光猫记录。\n\n` +
            `💡 **现场排障建议**：\n` +
            `1. 请核对装机门牌地址，可尝试只输入所属路名或村名；\n` +
            `2. 建议改用用户姓名、11位手机号或光猫 LOID/SN 重新查询；\n` +
            `3. 若属新装未录入用户，可在终端执行未配置发现命令核对设备上线情况。`,
          source: "llm-tool-sanitized",
          toolsUsed
        };
      }
      return {
        reply: cleaned,
        source: "llm-agent",
        toolsUsed
      };
    }

    // 循环退出兜底
    const finalMsg = requestMessages.at(-1);
    let finalReply = "";
    if (finalMsg?.role === "assistant" && typeof finalMsg.content === "string" && finalMsg.content.trim()) {
      finalReply = cleanLlmReply(finalMsg.content);
    } else {
      const onuQueryTool = toolsUsed.find((t) => t.name === "query_onus");
      if (onuQueryTool) {
        const queryTerm = onuQueryTool.args?.q ? `【${onuQueryTool.args.q}】` : "该地址或条件";
        finalReply = `在系统台账中未查询到与 ${queryTerm} 匹配的在线用户或光猫记录。\n\n` +
          `💡 **现场排障建议**：\n` +
          `1. 请核对装机门牌地址，现场报修单若包含特定巷号，可尝试只输入所属主路名或村名；\n` +
          `2. 建议优先改用 **用户姓名**、**11位手机号** 或 **光猫 LOID / 序列号 (SN)** 进行精确反查；\n` +
          `3. 若属新装未录入用户，可在对应 OLT 终端执行未配置发现命令（中兴 \`show gpon onu uncfg\` / 华为 \`display ont autofind all\`）核实设备是否已通光上线。`;
      } else {
        finalReply = fallbackLocalAnswer(userQuery, context);
      }
    }

    return {
      reply: finalReply,
      source: "llm-agent-completed",
      toolsUsed
    };
  }

  return {
    chat,
    fallbackLocalAnswer,
    executeTool: toolExecutor,
    getKnowledgeBase: () => queryKnowledgeBase()
  };
}
