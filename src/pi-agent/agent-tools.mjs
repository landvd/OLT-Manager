/**
 * Pi Agent 严格只读工具集
 * 提供给 Agent 调用的受限工具定义与安全执行器，不包含任何设备写操作或 Shell 执行
 */

import { queryKnowledgeBase, getCommandDifferences } from "./knowledge-base.mjs";
import { searchWeb, extractWebPage } from "./web-search.mjs";

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
  }
];

/**
 * 创建只读工具执行器
 */
export function createPiAgentToolExecutor({
  dataGateway = null,
  getOlts = async () => [],
  getOnuList = async () => ({ rows: [] }),
  getUnregisteredOnus = async () => ({ rows: [] }),
  getOnuDetail = async () => null
} = {}) {

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
          deviceProfile: safeOlt.deviceProfile,
          host: safeOlt.host,
          enabled: Boolean(safeOlt.enabled)
        };
      }

      case "query_onus": {
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
