/**
 * Pi Durable 适配层（ADR-085）。
 *
 * 基于 @earendil-works/pi-durable 的持久会话：每个 conversationKey（例如飞书“会话|用户”）
 * 对应一条永久保存的对话，模型调用和工具调用都先落盘再展示，进程重启后自动续跑。
 * 只注册本文件定义的 7 个只读工具，不安装 pi-durable 自带的 read/write/edit/bash。
 * 模块不在导入时加载 SDK，加载失败时返回 null，由 engine 回退到既有链路。
 */

import path from "node:path";
import { matchOltCandidate } from "./olt-command-matcher.mjs";
import { queryKnowledgeBase } from "./knowledge-base.mjs";
import { dataRoot } from "../runtime-paths.mjs";

export const PI_SDK_PACKAGE_NAME = "@earendil-works/pi-durable";
export const PI_DURABLE_STORAGE_FILE = "pi-durable.sqlite";
export const PI_SDK_READONLY_TOOL_NAMES = Object.freeze([
  "olt_read_snapshot",
  "olt_query_onus",
  "olt_search_records",
  "olt_read_resolved_onu",
  "olt_read_unregistered",
  "olt_search_commands",
  "olt_match_candidate"
]);
// 按地名（村、小组、小区、片区）查询：复用飞书规则路径的区域字典与夜间基线（ADR-085）。
export const PI_PLACE_TOOL_NAMES = Object.freeze(["olt_find_weak_light", "olt_find_place_pons"]);
const WEAK_RX_DBM = -27;

const PROVIDER_ID = "olt-manager";
const EXTENSION_NAME = "olt-readonly";
const DESKTOP_EXTENSION_NAME = "olt-desktop";
const DEFAULT_WAIT_MS = 180_000;
// GLM-5.3 支持 1M，但外勤问答主要依赖最近几轮；按 128K 压缩，保持每次请求的响应速度。
const DEFAULT_CONTEXT_WINDOW = 131072;

// 本地模型，用户资料（姓名、电话、地址、LOID、SN）不再脱敏；OLT 管理地址和凭据仍然剔除。
const SENSITIVE_KEYS = /^(?:host|.*ip|telnet.*|.*community|.*password|.*secret|.*token|cookie|authorization)$/i;

function text(value) {
  return String(value ?? "").trim();
}

function redactText(value) {
  return text(value)
    .replace(/\u001b\[[0-?]*[ -\/]*[@-~]/g, "")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[REDACTED_IP]")
    .replace(/\b(?:password|community|token|cookie|secret|credential|username|login)\s*(?:[:=]\s*|\s+)[^\s,;]+/gi, "$1=[REDACTED]");
}

export function sanitizeTerminalContext(value, maxLength = 3000) {
  const raw = typeof value === "string"
    ? value
    : JSON.stringify(stripSensitive(value));
  return redactText(raw).slice(-Math.max(0, Number(maxLength) || 0));
}

function safeScope(value = {}) {
  const scope = value && typeof value === "object" ? value : {};
  const oltIds = Array.isArray(scope.oltIds)
    ? scope.oltIds.map((item) => text(item)).filter(Boolean)
    : [];
  return { oltIds: [...new Set(oltIds)] };
}

export function requireExplicitOltScope(args = {}, context = {}) {
  const oltId = text(args.oltId || context.oltId);
  const scope = safeScope(args.scope || context.readonlyScope || context.scope);
  if (!oltId) throw new Error("Pi SDK 只读工具必须显式提供 oltId。");
  if (scope.oltIds.length === 0) throw new Error("Pi SDK 只读工具必须显式提供非空 readonlyScope.oltIds。");
  if (!scope.oltIds.includes(oltId)) throw new Error("oltId 不在显式 readonlyScope.oltIds 中。");
  return { oltId, scope };
}

export function requirePiChatScope(context = {}) {
  const scope = safeScope(context.readonlyScope || context.scope);
  const oltId = text(context.oltId);
  if (oltId && !scope.oltIds.includes(oltId)) {
    throw new Error("当前 oltId 不在显式 readonlyScope.oltIds 中。");
  }
  return { oltId, scope };
}

export function projectPiContext(context = {}) {
  const scope = safeScope(context.readonlyScope || context.scope);
  return {
    oltId: text(context.oltId),
    vendor: text(context.vendor),
    model: text(context.model),
    version: text(context.version),
    deviceProfile: text(context.deviceProfile),
    coordinate: context.coordinate && typeof context.coordinate === "object"
      ? {
          chassis: text(context.coordinate.chassis),
          board: text(context.coordinate.board || context.coordinate.slot),
          pon: text(context.coordinate.pon),
          onuId: text(context.coordinate.onuId)
        }
      : null,
    readonlyScope: scope,
    terminalContext: sanitizeTerminalContext(context.terminalContext)
  };
}

function stripSensitive(value, key = "") {
  if (SENSITIVE_KEYS.test(key)) return undefined;
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map((item) => stripSensitive(item)).filter((item) => item !== undefined);
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    const projected = stripSensitive(childValue, childKey);
    if (projected !== undefined) result[childKey] = projected;
  }
  return result;
}

function toolResult(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(stripSensitive(value)) }],
    details: { readOnly: true }
  };
}

// 参数 schema：SDK 提供 TypeBox 时用 TypeBox（pi-durable 会据此校验参数），否则退回等价的 JSON Schema。
function schemaKit(Type) {
  if (Type && typeof Type.Object === "function") {
    return {
      string: () => Type.String(),
      number: () => Type.Number(),
      optional: (schema) => Type.Optional(schema),
      scope: () => Type.Object({ oltIds: Type.Array(Type.String()) }),
      looseScope: () => Type.Object({ oltIds: Type.Optional(Type.Array(Type.String())) }),
      anyObject: () => Type.Object({}, { additionalProperties: true }),
      object: (properties) => Type.Object(properties, { additionalProperties: false })
    };
  }
  const OPTIONAL = Symbol("optional");
  return {
    string: () => ({ type: "string" }),
    number: () => ({ type: "number" }),
    optional: (schema) => ({ ...schema, [OPTIONAL]: true }),
    scope: () => ({ type: "object", properties: { oltIds: { type: "array", items: { type: "string" } } }, required: ["oltIds"], additionalProperties: false }),
    looseScope: () => ({ type: "object", properties: { oltIds: { type: "array", items: { type: "string" } } } }),
    anyObject: () => ({ type: "object" }),
    object: (properties) => ({
      type: "object",
      properties: Object.fromEntries(Object.entries(properties).map(([key, schema]) => {
        const { [OPTIONAL]: _optional, ...rest } = schema;
        return [key, rest];
      })),
      required: Object.entries(properties).filter(([, schema]) => !schema[OPTIONAL]).map(([key]) => key),
      additionalProperties: false
    })
  };
}

function makeTool(sdk, definition) {
  const tool = { ...definition, replay: "safe" };
  return typeof sdk?.durable?.defineTool === "function" ? sdk.durable.defineTool(tool) : tool;
}

export function createPiReadonlyTools({ sdk = {}, executeTool, getOltSnapshot, verifiedCommands = [] } = {}) {
  if (typeof executeTool !== "function") throw new TypeError("executeTool is required");
  const s = schemaKit(sdk?.ai?.Type);
  const runScoped = async (name, params) => {
    const scope = requireExplicitOltScope(params);
    return executeTool(name, { ...params, oltId: scope.oltId }, { oltId: scope.oltId, readonlyScope: scope.scope });
  };
  // 工具都是只读查询，崩溃后重放安全（replay: "safe"）；错误一律作为结果返回给模型。
  const guarded = (run) => async (params) => {
    try {
      return toolResult(await run(params || {}));
    } catch (error) {
      return toolResult({ status: "rejected", error: error.message });
    }
  };
  return [
    makeTool(sdk, {
      name: "olt_read_snapshot",
      label: "读取 OLT 只读快照",
      description: "读取已授权 OLT 的厂商、型号、版本、设备 profile 和明确的只读能力摘要，不返回管理 IP 或凭据。",
      parameters: s.object({ oltId: s.string(), scope: s.scope() }),
      execute: guarded(async (params) => getOltSnapshot(requireExplicitOltScope(params).oltId))
    }),
    makeTool(sdk, {
      name: "olt_query_onus",
      label: "读取 ONU 只读状态",
      description: "只读查询显式授权 OLT 的 ONU 状态；不执行任何终端、SNMP 写或配置命令。",
      parameters: s.object({
        oltId: s.string(),
        scope: s.scope(),
        board: s.optional(s.string()),
        pon: s.optional(s.string()),
        q: s.optional(s.string())
      }),
      execute: guarded((params) => runScoped("query_onus", params))
    }),
    makeTool(sdk, {
      name: "olt_search_records",
      label: "搜索用户和 ONU 资料",
      description: "不要求板卡和 PON，优先搜索本地用户资源库、统一 ONU 资料库和一级地址；姓名、电话、地址、SN、LOID、MAC、设备号都可以直接查询。",
      parameters: s.object({
        query: s.string(),
        intent: s.optional(s.string()),
        oltId: s.optional(s.string()),
        scope: s.optional(s.looseScope())
      }),
      execute: guarded((params) => executeTool("search_resource_users", params, {
        oltId: params.oltId,
        readonlyScope: params.scope || { oltIds: [] }
      }))
    }),
    makeTool(sdk, {
      name: "olt_read_resolved_onu",
      label: "读取已定位 ONU",
      description: "根据资料库候选自动读取 ONU 实时状态，不要求用户重新输入板卡/PON；实时读取必须使用显式授权 OLT。",
      parameters: s.object({ candidateId: s.string(), oltId: s.string(), scope: s.scope() }),
      execute: guarded((params) => runScoped("read_resolved_onu", params))
    }),
    makeTool(sdk, {
      name: "olt_read_unregistered",
      label: "读取未注册 ONU",
      description: "只读读取显式授权 OLT 的未注册 ONU/ONT 列表。",
      parameters: s.object({ oltId: s.string(), scope: s.scope() }),
      execute: guarded((params) => runScoped("get_unregistered_onus", params))
    }),
    makeTool(sdk, {
      name: "olt_search_commands",
      label: "检索已验证 OLT 命令",
      description: "按当前 OLT 的厂商、型号、分类或关键词检索本地已验证且只读的命令目录；结果只能用于预览，不能自动执行。",
      parameters: s.object({
        oltId: s.string(),
        scope: s.scope(),
        category: s.optional(s.string()),
        keyword: s.optional(s.string())
      }),
      execute: guarded(async (params) => {
        const { oltId } = requireExplicitOltScope(params);
        const snapshot = await getOltSnapshot(oltId);
        const entries = queryKnowledgeBase({
          vendor: snapshot.vendor,
          model: snapshot.deviceProfile || snapshot.model,
          category: params.category,
          keyword: params.keyword
        }).filter((entry) => entry.verified && entry.readOnly).slice(0, 12);
        return { oltId, count: entries.length, entries };
      })
    }),
    makeTool(sdk, {
      name: "olt_match_candidate",
      label: "匹配外部候选方案",
      description: "使用确定性匹配器将外部候选命令与现网快照和本地已验证命令表比较；候选内容不能直接成为执行命令。",
      parameters: s.object({ oltId: s.string(), scope: s.scope(), candidate: s.anyObject() }),
      execute: guarded(async (params) => {
        const { oltId } = requireExplicitOltScope(params);
        const snapshot = await getOltSnapshot(oltId);
        return matchOltCandidate({ candidate: params.candidate, snapshot, verifiedCommands });
      })
    })
  ];
}

// 桌面版工具：沿用 engine 的 16 个只读工具定义（OpenAI function 格式），由同一个 executeTool 执行。
// 未传 oltId 时默认使用本轮上下文中的当前 OLT，与原桌面链路一致。
export function createPiDesktopTools({ sdk = {}, executeTool, definitions = [], readToolContext = async () => ({}) } = {}) {
  if (typeof executeTool !== "function") throw new TypeError("executeTool is required");
  const Type = sdk?.ai?.Type;
  return definitions
    .map((definition) => definition?.function || definition)
    .filter((definition) => definition?.name)
    .map((definition) => makeTool(sdk, {
      name: definition.name,
      label: definition.name,
      description: definition.description || definition.name,
      parameters: typeof Type?.Unsafe === "function"
        ? Type.Unsafe(definition.parameters || { type: "object", properties: {} })
        : definition.parameters || { type: "object", properties: {} },
      execute: async (params, api, ctx) => {
        try {
          return toolResult(await executeTool(definition.name, params || {}, await readToolContext(api, ctx)));
        } catch (error) {
          return toolResult({ status: "rejected", error: error.message });
        }
      }
    }));
}

// 外勤常说“厚街村向北小组”，区域字典里登记的是村“厚街村”+ 小组“向北”：依次试原文、去掉“小组/组”、再去掉开头的村名。
export function placeVariants(place) {
  const original = text(place).replace(/\s+/g, "");
  const noGroup = original.replace(/(?:小组|组)$/u, "");
  const noVillage = noGroup.replace(/^[\u4e00-\u9fa5]{1,6}?村(?=[\u4e00-\u9fa5])/u, "");
  return [...new Set([original, noGroup, noVillage].filter(Boolean))];
}

// 地名工具：村名、区域字典小组和“地名改归属”的解析都在数据网关里完成，Pi 不需要知道 PON 口。
// resolveOltIds 返回本轮可查的 OLT（飞书为授权范围，桌面为全部已启用 OLT）。
export function createPiPlaceTools({ sdk = {}, getPlaceGateway, resolveOltIds = async () => [] } = {}) {
  if (typeof getPlaceGateway !== "function") return [];
  const s = schemaKit(sdk?.ai?.Type);
  const run = (handler) => async (params, api, ctx) => {
    try {
      const gateway = await getPlaceGateway();
      const oltIds = await resolveOltIds(api, ctx);
      if (!oltIds.length) throw new Error("没有可查询的 OLT。");
      return toolResult(await handler(gateway, params || {}, oltIds));
    } catch (error) {
      return toolResult({ status: "rejected", error: error.message });
    }
  };
  const pickUser = (user) => ({
    name: user.name,
    address: user.address,
    phone: user.phone,
    oltId: user.oltId,
    oltName: user.oltName,
    pon: `${user.pon.chassis}/${user.pon.board}/${user.pon.pon}`,
    onuId: user.onuId,
    rxDbm: user.rxDbm
  });
  return [
    makeTool(sdk, {
      name: "olt_find_weak_light",
      label: "按地名筛查弱光",
      description: "按村名、小组名、小区或片区筛查弱光和光衰最差的用户。数据来自最近一晚的夜间采集（覆盖该地全部用户，不读设备，秒出结果），按区域字典和地名归属确定范围，不会混入别的村。问“某村弱光”“哪个光衰最大”“把光衰大的筛出来”时优先用它，不需要板卡和 PON。",
      parameters: s.object({
        place: s.string(),
        threshold: s.optional(s.number())
      }),
      execute: run(async (gateway, params, oltIds) => {
        const threshold = Number.isFinite(params.threshold) ? params.threshold : WEAK_RX_DBM;
        // 每种写法都查一遍：用第一个命中的，其余命中的写法连同户数告诉模型，由外勤确认。
        const tried = [];
        for (const variant of placeVariants(params.place)) {
          tried.push({ value: variant, result: await gateway.queryWeakLight({ value: variant, oltIds, threshold, limit: 50 }) });
        }
        const chosen = tried.find((item) => item.result.status === "ok") || tried.find((item) => item.result.status !== "no-match") || tried[0];
        const { value, result: weak } = chosen;
        const otherMatches = tried
          .filter((item) => item !== chosen && item.result.status === "ok" && item.result.totalUsers !== chosen.result.totalUsers)
          .map((item) => ({ place: item.value, totalUsers: item.result.totalUsers, weakCount: item.result.weakCount }));
        if (weak.status !== "ok") return { ...weak, place: text(params.place), tried: tried.map((item) => item.value) };
        // 阈值以 0 dBm 查询即全部在线用户按收光从差到好排列，用于回答“哪个最差”。
        const worst = await gateway.queryWeakLight({ value, oltIds, threshold: 0, limit: 10 });
        return {
          status: "ok",
          place: weak.place,
          dataSource: "夜间采集（不是实时读取）",
          sampleDate: weak.sampleDate,
          totalUsers: weak.totalUsers,
          sampledUsers: weak.sampled,
          offlineAtSampling: weak.offline,
          // 当晚 SNMP 读取失败、改用网管二期 0 点数据的户数。
          fromOssNgbUsers: weak.fallbackSampled || 0,
          threshold,
          weakCount: weak.weakCount,
          weakUsers: weak.users.map(pickUser),
          otherMatches,
          weakPons: weak.pons.map((pon) => ({ oltName: pon.oltName, pon: `${pon.pon.chassis}/${pon.pon.board}/${pon.pon.pon}`, weakCount: pon.weakCount, worstRx: pon.worstRx })),
          worstUsers: (worst.users || []).map(pickUser)
        };
      })
    }),
    makeTool(sdk, {
      name: "olt_find_place_pons",
      label: "按地名列出 PON 口",
      description: "按村名、小组名、小区或片区列出对应的 PON 口（OLT、坐标、分光地址、命中户数 / 口上总户数），区域字典小组按管理员审核的范围。scope: main=主要口（默认），sparse=零星沾边的口，all=全部。需要某个口的实时状态时，再用返回的 oltId 和坐标调用整口查询工具。",
      parameters: s.object({
        place: s.string(),
        scope: s.optional(s.string())
      }),
      execute: run(async (gateway, params, oltIds) => {
        const ponScope = ["main", "sparse", "all"].includes(text(params.scope)) ? text(params.scope) : "main";
        const tried = [];
        for (const variant of placeVariants(params.place)) {
          tried.push({ value: variant, result: await gateway.queryVillagePons({ value: variant, oltIds, offset: 0, limit: 20, ponScope }) });
        }
        const hit = (item) => Number(item.result.mainCount) + Number(item.result.sparseCount) > 0;
        // 区域字典登记过的小组优先，其次是第一个命中的写法。
        const chosen = tried.find((item) => item.result.region && hit(item)) || tried.find(hit) || tried[0];
        const value = chosen.value;
        let result = chosen.result;
        const otherMatches = tried
          .filter((item) => item !== chosen && hit(item) &&
            !(item.result.region && item.result.region.id === chosen.result.region?.id) &&
            !(item.result.mainCount === chosen.result.mainCount && item.result.sparseCount === chosen.result.sparseCount && !item.result.region === !chosen.result.region))
          .map((item) => ({ place: item.value, mainCount: item.result.mainCount, sparseCount: item.result.sparseCount, region: item.result.region }));
        // 只有零星口（用户分散在别的村的口上）时，主要口列表为空，改为列出全部口。
        if (ponScope === "main" && !result.candidates?.length && Number(result.sparseCount) > 0) {
          result = await gateway.queryVillagePons({ value, oltIds, offset: 0, limit: 20, ponScope: "all" });
        }
        return {
          place: text(params.place),
          matchedAs: value,
          otherMatches,
          region: result.region,
          ponScope,
          total: result.total,
          mainCount: result.mainCount,
          sparseCount: result.sparseCount,
          hasMore: result.hasMore,
          pons: (result.candidates || []).map((item) => ({
            oltId: item.oltId,
            oltName: item.oltName,
            chassis: item.pon.chassis,
            board: item.pon.board,
            pon: item.pon.pon,
            address: item.address,
            matchedUsers: item.matchedUserCount,
            ponUsers: item.ponUserCount,
            sparse: item.sparse
          }))
        };
      })
    })
  ];
}

async function loadDefaultSdk() {
  try {
    const [durable, ai, chord, sqlite, completions, responses] = await Promise.all([
      import("@earendil-works/pi-durable"),
      import("@earendil-works/pi-ai"),
      import("@earendil-works/chord/context"),
      import("@earendil-works/pi-durable/storage/sqlite/node"),
      import("@earendil-works/pi-ai/api/openai-completions.lazy"),
      import("@earendil-works/pi-ai/api/openai-responses.lazy")
    ]);
    return {
      durable,
      ai,
      context: chord.BACKGROUND_CONTEXT,
      openStorage: (file) => sqlite.openNodeSqliteStorage(file),
      apis: { "openai-completions": completions.openAICompletionsApi, "openai-responses": responses.openAIResponsesApi }
    };
  } catch (error) {
    return { unavailable: true, reason: `Pi Durable 不可用：${error?.code || error?.message || "import failed"}` };
  }
}

export function defaultPiDurableStoragePath() {
  return path.join(dataRoot, PI_DURABLE_STORAGE_FILE);
}

const STATIC_INSTRUCTIONS = [
  "你是 OLT Manager 的只读网络助手，服务对象是在现场的外勤装维人员，他们不知道 OLT、板卡和 PON 口。只使用提供的自定义只读工具。",
  "这是一段持续的对话：可以结合之前的问答理解“刚才那个用户”“换个口”之类的追问。",
  "【现场标准】接收光功率 ≤ -27 dBm 为弱光，需要处理；-24 ~ -27 dBm 为偏低，可以关注；高于 -24 dBm 为正常。数值越负越差，-22 dBm 不算光衰大。同一用户比以前变差 2 dB 以上，说明光路有问题（例如熔接不好）。",
  "【按地名查询】问到村、小组、小区、片区的弱光、光衰最大、光衰情况，或“把光衰大的筛出来”时，直接调用 olt_find_weak_light，它覆盖该地全部用户；问该地有哪些 PON 口、整体情况时调用 olt_find_place_pons。不要用 olt_search_records 去筛整村，它只返回少量候选。地名范围以工具结果为准，不要自己把别的村、别的片区的结果加进来；地址里“5桥头片”这类开头是片区编码，不是村名。工具结果里的 otherMatches 表示换一种写法也能查到（例如只说小组名），户数明显更多时要告诉外勤，并问是否按那个地名查。",
  "【数据来源】筛查和统计优先用夜间采集或资料库快照，回答里写明是哪天的数据。只有核实单个用户、或外勤明确要求“现在 / 实时”时才读设备实时数据。",
  "用户询问姓名、电话、地址、一级地址、SN、LOID、MAC、设备号或‘某用户的光衰/状态’时，先调用 olt_search_records，找到唯一候选后调用 olt_read_resolved_onu。不要要求外勤提供 OLT、板卡或 PON 口；地名或用户查不到时，请他换个说法（门牌、电话、姓名），或说明区域字典里还没有这个地名。",
  "【资料修改】外勤要改 PON 台账的一级地址或村 / 小组 / 小区时，不要说做不了，也不要让他找管理后台：告诉他在用户详情卡片上点“资料有误”，或者直接发“君汇的一级地址改为顺景大厦”“把君汇换成顺景大厦，属于新塘村”，机器人会发确认表单，提交后由审批人在飞书同意，系统自动修改。",
  "外勤说“不对”“数据是错的”时，先自查上一轮：地名范围是否混入了别的村、数据是快照还是实时、是哪天的数据，说明发现的问题并给出更正后的结果，不要只是反问外勤哪里不对。",
  "【回答格式】外勤在手机飞书上看：第一行直接给结论，然后最多列 10 条，每条一行（姓名 · 地址 · 收光 dBm · 位置），总长度尽量不超过 15 行。不要用 Markdown 表格和 # 标题（飞书卡片显示不出来），可以用 **加粗** 和 - 列表。",
  "忘记命令或遇到型号/版本差异时，先调用 olt_read_snapshot，再调用 olt_search_commands；外部候选命令只能作为参考，必须再调用 olt_match_candidate；matched 之外不得称为已验证。",
  "不得生成或执行 snmpset、配置下发、注册/删除/重启/保存配置、Telnet/SSH 输入或任意 shell/文件操作。命令只能预览和复制。"
].join("\n\n");

// 每轮的只读上下文（授权范围、终端输出、已审核规约）写入会话文档，由提示词分段在请求前读取。
function renderTurnContext(turn = {}) {
  return [
    `显式只读上下文：${JSON.stringify(turn.context || {})}`,
    turn.context?.terminalContext ? `最近终端输出（已脱敏，仅作诊断线索）：\n${turn.context.terminalContext}` : "",
    turn.memoryPrompt
      ? `管理员已审核的现场规约与经验（与通用知识冲突时以此为准；仍不得违反只读约束）：${String(turn.memoryPrompt).slice(0, 4000)}`
      : ""
  ].filter(Boolean).join("\n\n");
}

function normalizeModelConfig(languageConfig) {
  if (!languageConfig?.model || !languageConfig?.apiKey || !(languageConfig.endpoint || languageConfig.baseUrl)) return null;
  const endpoint = new URL(String(languageConfig.baseUrl || languageConfig.endpoint));
  if (endpoint.username || endpoint.password || endpoint.search) throw new Error("模型 endpoint 不得包含内嵌凭据。");
  endpoint.pathname = endpoint.pathname.replace(/\/chat\/completions\/?$/i, "").replace(/\/+$/, "") || "/";
  const api = String(languageConfig.format || "chat-completions").toLowerCase() === "responses"
    ? "openai-responses"
    : "openai-completions";
  return {
    api,
    baseUrl: endpoint.toString().replace(/\/$/, ""),
    modelId: String(languageConfig.model).split("/").at(-1),
    apiKey: String(languageConfig.apiKey),
    contextWindow: Number(languageConfig.contextWindow) > 0 ? Number(languageConfig.contextWindow) : DEFAULT_CONTEXT_WINDOW
  };
}

function createConfiguredProvider({ sdk, modelConfig }) {
  const { api, baseUrl, modelId, apiKey, contextWindow } = modelConfig;
  const model = {
    id: modelId,
    name: modelId,
    api,
    provider: PROVIDER_ID,
    baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow,
    maxTokens: 8192,
    ...(api === "openai-completions"
      ? { compat: { supportsDeveloperRole: false, supportsReasoningEffort: false, supportsStore: false } }
      : {})
  };
  return sdk.ai.createProvider({
    id: PROVIDER_ID,
    name: "OLT Manager",
    baseUrl,
    auth: { apiKey: { name: "OLT Manager 模型", resolve: async () => ({ auth: { apiKey } }) } },
    models: [model],
    api: sdk.apis[api]()
  });
}

function messageText(message) {
  const content = message?.content;
  if (typeof content === "string") return content;
  return (Array.isArray(content) ? content : [])
    .filter((block) => block?.type === "text")
    .map((block) => block.text)
    .join("");
}

function clipText(value, max) {
  const textValue = typeof value === "string" ? value : JSON.stringify(value ?? "");
  return textValue.length > max ? `${textValue.slice(0, max)}…（共 ${textValue.length} 字）` : textValue;
}

/**
 * 调试日志用的本轮过程（ADR-091）：模型每一步说的话、调用的工具和参数、工具返回（截断）、用时和用量。
 */
export function turnTrace(turnMessages = []) {
  const trace = [];
  for (const message of turnMessages) {
    if (message?.role === "assistant") {
      const blocks = Array.isArray(message.content) ? message.content : [];
      const said = blocks.filter((block) => block?.type === "text").map((block) => block.text).join("").trim();
      const thinking = blocks.filter((block) => block?.type === "thinking").map((block) => block.thinking || "").join("").trim();
      if (thinking) trace.push({ type: "thinking", text: clipText(thinking, 3000) });
      if (said) trace.push({ type: "text", text: clipText(said, 3000) });
      for (const block of blocks.filter((item) => item?.type === "toolCall")) {
        trace.push({ type: "toolCall", id: String(block.id || ""), name: String(block.name || ""), arguments: block.arguments ?? {} });
      }
      if (message.stopReason === "error" || message.errorMessage) trace.push({ type: "error", text: clipText(message.errorMessage || message.stopReason, 1000) });
      if (message.usage) trace.push({ type: "usage", input: Number(message.usage.input || 0), output: Number(message.usage.output || 0) });
    } else if (message?.role === "toolResult") {
      trace.push({
        type: "toolResult",
        id: String(message.toolCallId || ""),
        name: String(message.toolName || ""),
        isError: Boolean(message.isError),
        ...(Number.isFinite(message.durationMs) ? { durationMs: message.durationMs } : {}),
        result: clipText(messageText(message), 4000)
      });
    }
  }
  return trace;
}

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
      timer.unref?.();
    })
  ]).finally(() => clearTimeout(timer));
}

export function createPiSdkAdapter({
  sdkLoader = loadDefaultSdk,
  storageFactory = (sdk) => sdk.openStorage(defaultPiDurableStoragePath()),
  providerFactory = createConfiguredProvider,
  executeTool,
  getOlts = async () => [],
  verifiedCommands = [],
  enabled = false,
  getLanguageConfig = async () => null,
  waitTimeoutMs = DEFAULT_WAIT_MS,
  desktopToolDefinitions = [],
  desktopSystemPrompt = "",
  getPlaceGateway = null
} = {}) {
  let sdkPromise;
  let harnessPromise;
  let runtime;
  const loadSdk = async () => {
    sdkPromise ??= Promise.resolve().then(() => sdkLoader());
    return sdkPromise;
  };

  async function getOltSnapshot(oltId) {
    const olts = await getOlts();
    const olt = olts.find((item) => String(item.id) === String(oltId));
    if (!olt) throw new Error("未找到指定 OLT。");
    return {
      oltId: String(olt.id),
      vendor: text(olt.vendor),
      model: text(olt.model),
      version: text(olt.version),
      deviceProfile: text(olt.deviceProfile),
      capabilities: olt.capabilities && typeof olt.capabilities === "object"
        ? stripSensitive(olt.capabilities)
        : {}
    };
  }

  // 进程内只打开一个 Harness（pi-durable 不做跨进程锁）；打开后立即续跑上次中断的任务。
  async function openHarness(sdk) {
    harnessPromise ??= (async () => {
      const { durable, ai, context } = sdk;
      const ConversationKeys = durable.defineDoc({
        kind: "olt.conversation-keys",
        version: 1,
        scope: "session",
        history: "latest",
        initial: () => ({ keys: {} })
      });
      const TurnContext = durable.defineDoc({
        kind: "olt.turn-context",
        version: 1,
        scope: "conversation",
        history: "latest",
        fork: "current",
        initial: () => ({ context: {}, memoryPrompt: "" })
      });
      const models = ai.createModels();
      const registry = durable.createRegistry();
      const readTurnContext = async (api, ctx) => (await api.snapshot(TurnContext, api.conversationId, ctx))?.context || {};
      // 地名工具可查的 OLT：已启用的 OLT；飞书再限制在本轮授权范围内。
      const placeOltIds = (channel) => async (api, ctx) => {
        const enabled = (await getOlts()).filter((olt) => olt.enabled !== false).map((olt) => String(olt.id));
        const scoped = channel === "feishu" ? (await readTurnContext(api, ctx)).readonlyScope?.oltIds || [] : [];
        return scoped.length ? enabled.filter((id) => scoped.includes(id)) : enabled;
      };
      const turnSection = durable.section("olt-turn", async (input, ctx) => renderTurnContext(
        await input.read.snapshot(TurnContext, input.conversationId, ctx)
      ), { tag: false });
      // 飞书（外勤）：7 个显式授权范围的只读工具。
      const readonlyExtension = durable.defineExtension({
        name: EXTENSION_NAME,
        tools: [
          ...createPiReadonlyTools({ sdk, executeTool, getOltSnapshot, verifiedCommands }),
          ...createPiPlaceTools({ sdk, getPlaceGateway, resolveOltIds: placeOltIds("feishu") })
        ],
        sections: [durable.section("olt-rules", () => STATIC_INSTRUCTIONS, { tag: false }), turnSection]
      });
      registry.install(readonlyExtension);
      // 桌面内置终端（内勤）：原桌面链路的 16 个只读工具和系统提示词。
      let desktopExtension;
      if (desktopToolDefinitions.length > 0) {
        desktopExtension = durable.defineExtension({
          name: DESKTOP_EXTENSION_NAME,
          tools: [...createPiPlaceTools({ sdk, getPlaceGateway, resolveOltIds: placeOltIds("desktop") }), ...createPiDesktopTools({
            sdk,
            executeTool,
            definitions: desktopToolDefinitions,
            readToolContext: async (api, ctx) => {
              const { oltId, vendor, model, version, deviceProfile, coordinate, readonlyScope } = await readTurnContext(api, ctx);
              return { oltId, vendor, model, version, deviceProfile, coordinate, readonlyScope, channel: "desktop" };
            }
          })],
          sections: [durable.section("olt-desktop-rules", () => desktopSystemPrompt || STATIC_INSTRUCTIONS, { tag: false }), turnSection]
        });
        registry.install(desktopExtension);
      }
      const storage = await storageFactory(sdk);
      const harness = await durable.Harness.open(storage, {
        models,
        registry,
        settings: {
          extensions: [readonlyExtension],
          stream: { timeoutMs: 120_000 },
          retry: { maxRetries: 2 },
          compaction: { enabled: true, reserveTokens: 16384, keepRecentTokens: 32000, backgroundTokens: 16384 },
          toolExecution: "sequential"
        },
        onReport: () => {}
      }, context);
      harness.resume();
      runtime = { harness, models, ConversationKeys, TurnContext, context, readonlyExtension, desktopExtension };
      return runtime;
    })();
    try {
      return await harnessPromise;
    } catch (error) {
      harnessPromise = undefined;
      throw error;
    }
  }

  async function findConversation(rt, key) {
    const existingId = (await rt.harness.snapshot(rt.ConversationKeys, rt.context))?.keys?.[key];
    return existingId ? rt.harness.conversation(existingId, rt.context) : undefined;
  }

  // 不加载模型配置也能打开存储，用于读取历史和开启新对话。
  async function openForKey(conversationKey) {
    const key = text(conversationKey);
    if (!key) throw new Error("缺少 conversationKey。");
    const sdk = await loadSdk();
    if (!sdk || sdk.unavailable || !sdk.durable?.Harness) return null;
    const rt = await openHarness(sdk);
    return { rt, conversation: await findConversation(rt, key) };
  }

  // 每条对话固定选择一个工具扩展；已有对话的模型或扩展与本轮不一致时改配置。
  async function conversationFor(rt, key, modelRef, extension) {
    const { harness, ConversationKeys, context } = rt;
    let conversation = await findConversation(rt, key);
    if (!conversation) {
      conversation = await harness.createConversation({ ownership: { kind: "ownerless" }, agent: { model: modelRef, extensions: [extension] } }, context);
      const id = conversation.id;
      await conversation.commit(async (tx) => { (await tx.doc(ConversationKeys)).keys[key] = id; }, context);
      return conversation;
    }
    const agent = await conversation.agent(context);
    const change = {};
    if (agent.model?.provider !== modelRef.provider || agent.model?.modelId !== modelRef.modelId) change.model = modelRef;
    if (agent.extensions.map((item) => item.name).join(",") !== extension.name) change.extensions = [extension];
    if (Object.keys(change).length > 0) await conversation.configure(change, context);
    return conversation;
  }

  return {
    async chat({ messages = [], context = {} } = {}) {
      const shouldEnable = enabled || context.piSdk === true || process.env.OLT_PI_SDK_ENABLED === "1";
      if (!shouldEnable) return null;
      let scope;
      try {
        scope = requirePiChatScope(context);
      } catch (error) {
        return { reply: `Gd Agent 已拒绝本次请求：${error.message}`, source: "pi-sdk-rejected", toolsUsed: [] };
      }
      const question = text([...(Array.isArray(messages) ? messages : [])].reverse().find((m) => m?.role === "user")?.content);
      if (!question) return null;

      const sdk = await loadSdk();
      if (!sdk || sdk.unavailable || !sdk.durable?.Harness) return null;
      try {
        const modelConfig = normalizeModelConfig(await getLanguageConfig());
        if (!modelConfig) return null;
        const rt = await openHarness(sdk);
        rt.models.setProvider(providerFactory({ sdk, modelConfig }));
        const key = text(context.conversationKey) || text(context.channel) || "default";
        const extension = text(context.channel) === "desktop" && rt.desktopExtension ? rt.desktopExtension : rt.readonlyExtension;
        const conversation = await conversationFor(rt, key, { provider: PROVIDER_ID, modelId: modelConfig.modelId }, extension);
        const turn = { context: projectPiContext({ ...context, readonlyScope: scope.scope }), memoryPrompt: text(context.memoryPrompt) };
        await conversation.commit(async (tx) => { Object.assign(await tx.doc(rt.TurnContext, conversation.id), turn); }, rt.context);

        const submission = await conversation.submit({
          type: "input",
          content: question,
          ...(text(context.requestId) ? { requestId: text(context.requestId) } : {})
        }, rt.context);
        const settled = await withTimeout(submission.wait(rt.context), waitTimeoutMs, "模型仍在处理，请稍后再问一次。");
        if (settled.status !== "done") throw new Error(`本轮未得到回答（${settled.reason || settled.status}）。`);

        const view = await conversation.context(rt.context);
        const lastUser = view.messages.findLastIndex((message) => message.role === "user");
        const turnMessages = view.messages.slice(lastUser + 1);
        const toolsUsed = turnMessages
          .filter((message) => message.role === "assistant" && Array.isArray(message.content))
          .flatMap((message) => message.content.filter((block) => block?.type === "toolCall").map((block) => ({ name: block.name })));
        const reply = text(messageText(turnMessages.findLast((message) => message.role === "assistant")));
        if (!reply) throw new Error("Pi Durable 未返回文本结果。");
        return { reply, source: "pi-sdk-agent", toolsUsed, trace: turnTrace(turnMessages), conversationId: String(conversation.id), model: modelConfig.modelId };
      } catch (error) {
        return { reply: `Gd Agent 暂不可用：${error.message}`, source: "pi-sdk-error", toolsUsed: [] };
      }
    },
    // 当前上下文（最近一次“新对话”之后）的问答，只取用户提问和带文字的回答，按时间正序。
    async history({ conversationKey, limit = 60 } = {}) {
      const opened = await openForKey(conversationKey);
      if (!opened?.conversation) return { messages: [] };
      const { rt, conversation } = opened;
      const collected = [];
      let cursor;
      let done = false;
      while (!done) {
        const page = await conversation.entries({ order: "descending" }, 100, cursor, rt.context);
        for (const entry of page.items) {
          if (entry.kind === "pi.reset" || collected.length >= limit) { done = true; break; }
          if (entry.kind !== "pi.user" && entry.kind !== "pi.assistant") continue;
          const content = text(messageText(entry.model?.[0]));
          if (content) collected.push({ role: entry.kind === "pi.user" ? "user" : "assistant", content });
        }
        cursor = page.next;
        if (!cursor) done = true;
      }
      return { conversationId: String(conversation.id), messages: collected.reverse() };
    },
    // 开启新对话：模型从此看不到之前的内容，旧记录仍永久保留在存储中。
    async reset({ conversationKey } = {}) {
      const opened = await openForKey(conversationKey);
      if (!opened?.conversation) return { ok: true, reset: false };
      await opened.conversation.reset(undefined, opened.rt.context);
      return { ok: true, reset: true };
    },
    async getStatus() {
      const sdk = await loadSdk();
      const available = Boolean(sdk && !sdk.unavailable && sdk.durable?.Harness);
      const status = {
        package: PI_SDK_PACKAGE_NAME,
        available,
        tools: [...PI_SDK_READONLY_TOOL_NAMES],
        sessionPersistence: "durable-sqlite",
        storageFile: PI_DURABLE_STORAGE_FILE,
        builtInTools: "disabled"
      };
      if (runtime) {
        try { status.usage = await runtime.harness.usage(runtime.context); } catch { /* best effort */ }
      }
      return status;
    },
    async close() {
      if (!harnessPromise) return;
      const rt = await harnessPromise.catch(() => null);
      harnessPromise = undefined;
      runtime = undefined;
      if (rt) await rt.harness.close(rt.context);
    }
  };
}
