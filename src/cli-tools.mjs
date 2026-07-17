const stringProperty = (description) => ({ type: "string", description, minLength: 1 });
const coordinateProperties = {
  chassis: { ...stringProperty("机框或槽编号。"), pattern: "^\\d+$" },
  board: { ...stringProperty("板卡编号。"), pattern: "^\\d+$" },
  pon: { ...stringProperty("PON 口编号。"), pattern: "^\\d+$" }
};

function objectSchema(properties = {}, required = []) {
  return { type: "object", properties, required, additionalProperties: false };
}

export const cliTools = [
  {
    name: "olt_status",
    description: "读取指定或默认 OLT 的状态、SNMP 可达性和台账摘要。",
    parameters: objectSchema({ oltId: stringProperty("OLT ID；省略时使用默认 OLT。") })
  },
  {
    name: "olt_list",
    description: "列出本地 OLT，不返回 SNMP community 或 Telnet 凭据。",
    parameters: objectSchema()
  },
  {
    name: "onu_list",
    description: "按 OLT、坐标或关键词查询已注册 ONU。",
    parameters: objectSchema({
      oltId: stringProperty("OLT ID；省略时使用默认 OLT。"),
      ...coordinateProperties,
      q: { type: "string", description: "地址、序列号或状态等搜索关键词。" }
    })
  },
  {
    name: "onu_get_config",
    description: "读取单个 ONU 的详情和固定白名单只读配置输出。",
    parameters: objectSchema({
      oltId: stringProperty("OLT ID；省略时使用默认 OLT。"),
      ...coordinateProperties,
      onuId: { ...stringProperty("ONU/ONT ID。"), pattern: "^\\d+$" }
    }, ["chassis", "board", "pon", "onuId"])
  },
  {
    name: "onu_list_unregistered",
    description: "列出指定或默认 OLT 上未注册的 ONU/ONT。",
    parameters: objectSchema({ oltId: stringProperty("OLT ID；省略时使用默认 OLT。") })
  },
  {
    name: "onu_list_recent",
    description: "列出指定时间范围内最近上线的 ONU。",
    parameters: objectSchema({
      oltId: stringProperty("OLT ID；省略时使用默认 OLT。"),
      hours: { type: "integer", description: "回溯小时数。", minimum: 1, maximum: 168 }
    })
  },
  {
    name: "pon_port_list",
    description: "读取本地 PON 台账。",
    parameters: objectSchema()
  },
  {
    name: "project_list",
    description: "读取本地专线项目列表，可按关键词搜索。",
    parameters: objectSchema({ q: { type: "string", description: "项目名称、地址、联系人或 VLAN。" } })
  },
  {
    name: "project_onu_list",
    description: "读取项目 ONU 台账，并尽量刷新只读设备状态。",
    parameters: objectSchema({ projectId: stringProperty("项目 ID。") }, ["projectId"])
  },
  {
    name: "config_template_list",
    description: "列出内置和项目配置方案模板。",
    parameters: objectSchema()
  },
  {
    name: "config_plan_preview",
    description: "为未注册 ONU 生成配置命令预览；绝不登录、执行或保存到 OLT。",
    parameters: objectSchema({
      unregisteredId: stringProperty("未注册 ONU 的稳定标识，用于 API 路径。"),
      oltId: stringProperty("OLT ID；省略时使用默认 OLT。"),
      ...coordinateProperties,
      serial: stringProperty("ONU/ONT 序列号。"),
      templateId: stringProperty("配置模板 ID。"),
      ethPorts: {
        type: "array",
        description: "所选设备物理端口。",
        items: { type: "string", minLength: 1 },
        minItems: 1
      },
      customVlan: { type: "integer", description: "自定义业务 VLAN。", minimum: 1, maximum: 4094 }
    }, ["unregisteredId", "chassis", "board", "pon", "serial", "templateId", "ethPorts"])
  },
  {
    name: "snmp_get",
    description: "对已配置 OLT 执行只读 SNMP GET，并记录本地审计历史。",
    parameters: objectSchema({
      oltId: stringProperty("OLT ID；省略时使用默认 OLT。"),
      oid: { type: "string", description: "数字点分 OID。", pattern: "^\\d+(?:\\.\\d+)+$" }
    }, ["oid"])
  },
  {
    name: "snmp_walk",
    description: "对已配置 OLT 执行只读 SNMP WALK，并记录本地审计历史。",
    parameters: objectSchema({
      oltId: stringProperty("OLT ID；省略时使用默认 OLT。"),
      oid: { type: "string", description: "数字点分 OID。", pattern: "^\\d+(?:\\.\\d+)+$" }
    }, ["oid"])
  },
  {
    name: "snmp_history_list",
    description: "读取本地 SNMP 只读探测历史。",
    parameters: objectSchema({ limit: { type: "integer", description: "最大返回条数。", minimum: 1, maximum: 500 } })
  },
  {
    name: "admin_event_list",
    description: "读取本地管理操作事件。",
    parameters: objectSchema({ limit: { type: "integer", description: "最大返回条数。", minimum: 1, maximum: 500 } })
  }
].map((tool) => ({ type: "function", ...tool }));

export const cliToolByName = new Map(cliTools.map((tool) => [tool.name, tool]));

function publicOlt(olt) {
  return {
    id: olt.id,
    name: olt.name,
    vendor: olt.vendor,
    model: olt.model,
    deviceProfile: olt.deviceProfile,
    version: olt.version,
    host: olt.host,
    snmpPort: olt.snmpPort,
    telnetPort: olt.telnetPort,
    enabled: olt.enabled
  };
}

function queryPath(pathname, input, keys) {
  const query = new URLSearchParams();
  for (const key of keys) {
    if (input[key] !== undefined) query.set(key, String(input[key]));
  }
  const suffix = query.size ? `?${query}` : "";
  return `${pathname}${suffix}`;
}

export function requestForTool(name, input) {
  switch (name) {
    case "olt_status": return { path: queryPath("/api/status", input, ["oltId"]) };
    case "olt_list": return { path: "/api/bootstrap", select: (data) => ({ rows: data.olts.map(publicOlt) }) };
    case "onu_list": return { path: queryPath("/api/onus", input, ["oltId", "chassis", "board", "pon", "q"]) };
    case "onu_get_config": return { path: queryPath("/api/onu-config", input, ["oltId", "chassis", "board", "pon", "onuId"]) };
    case "onu_list_unregistered": return { path: queryPath("/api/unregistered-onus", input, ["oltId"]) };
    case "onu_list_recent": return { path: queryPath("/api/recent-onus", input, ["oltId", "hours"]) };
    case "pon_port_list": return { path: "/api/admin/pon-ports", select: (data) => ({ rows: data }) };
    case "project_list": return { path: queryPath("/api/admin/projects", input, ["q"]) };
    case "project_onu_list": return { path: `/api/admin/projects/${encodeURIComponent(input.projectId)}/onus` };
    case "config_template_list": return { path: "/api/config-templates" };
    case "config_plan_preview": {
      const { unregisteredId, ...body } = input;
      return {
        path: `/api/unregistered-onus/${encodeURIComponent(unregisteredId)}/config-plan`,
        method: "POST",
        body
      };
    }
    case "snmp_get": return { path: "/api/admin/snmp-test", method: "POST", body: { ...input, operation: "get" } };
    case "snmp_walk": return { path: "/api/admin/snmp-test", method: "POST", body: { ...input, operation: "walk" } };
    case "snmp_history_list": return { path: queryPath("/api/admin/snmp-history", input, ["limit"]), select: (data) => ({ rows: data }) };
    case "admin_event_list": return { path: queryPath("/api/admin/events", input, ["limit"]), select: (data) => ({ rows: data }) };
    default: throw new Error(`Unknown CLI tool: ${name}`);
  }
}

export function validateToolInput(tool, input) {
  if (!input || Array.isArray(input) || typeof input !== "object") return "输入必须是 JSON 对象。";
  const schema = tool.parameters;
  const allowed = new Set(Object.keys(schema.properties));
  const unknown = Object.keys(input).find((key) => !allowed.has(key));
  if (unknown) return `不支持参数 ${unknown}。`;
  const missing = schema.required.find((key) => input[key] === undefined);
  if (missing) return `缺少必填参数 ${missing}。`;
  for (const [key, value] of Object.entries(input)) {
    const property = schema.properties[key];
    if (property.type === "string") {
      if (typeof value !== "string" || (property.minLength && value.length < property.minLength)) return `参数 ${key} 必须是非空字符串。`;
      if (property.pattern && !new RegExp(property.pattern).test(value)) return `参数 ${key} 格式无效。`;
    }
    if (property.type === "integer") {
      if (!Number.isInteger(value)) return `参数 ${key} 必须是整数。`;
      if (property.minimum !== undefined && value < property.minimum) return `参数 ${key} 不能小于 ${property.minimum}。`;
      if (property.maximum !== undefined && value > property.maximum) return `参数 ${key} 不能大于 ${property.maximum}。`;
    }
    if (property.type === "array") {
      if (!Array.isArray(value) || (property.minItems && value.length < property.minItems)) return `参数 ${key} 必须是非空数组。`;
      if (value.some((item) => typeof item !== "string" || !item)) return `参数 ${key} 只能包含非空字符串。`;
    }
  }
  return "";
}
