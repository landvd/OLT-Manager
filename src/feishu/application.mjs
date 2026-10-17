import { randomBytes } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { normalizeFeishuState } from "./state.mjs";
import { clone as cloneJson } from "./clone.mjs";
import {
  LANGUAGE_INTERPRETATION_CONTRACT_VERSION,
  SYNTHETIC_DATASET_ATTESTATION_REQUIRED,
  FEISHU_HELP_TOPICS,
  FEISHU_MENU_TOPICS,
  feishuHelpText,
  feishuHelpTopic,
  isFeishuHelpRequest
} from "./language-interpretation.mjs";
import { summarizeRepairResults, REPAIR_PATTERN_TEXT } from "../optical-baseline.mjs";
import { VILLAGE_MENU_PON_THRESHOLD } from "../village-regions.mjs";
import { isNegativeFeedback } from "../question-text.mjs";
import { QUOTA_MENU_KEY, createQuotaMode, isQuotaEntry } from "./quota-mode.mjs";

export const LANGUAGE_CONTRACT_VERSION = LANGUAGE_INTERPRETATION_CONTRACT_VERSION;
export const ALLOWED_INTENTS = Object.freeze([
  "find_by_name",
  "find_by_phone",
  "find_by_address",
  "find_by_sn",
  "find_by_device_number",
  "find_by_loid",
  "find_by_mac",
  "find_by_onu_coordinate",
  "find_pon_by_address",
  "find_pons_by_village",
  "read_live_status"
]);

const CANDIDATE_TTL_MS = 5 * 60 * 1000;
const CANDIDATE_MAX = 100;
const CANDIDATE_PAGE_SIZE = 5;
const MAX_VILLAGE_SAMPLE_ATTEMPTS = 128;
const PON_SORT_ACTIONS = new Set(["pon-sort-power", "pon-sort-onu"]);
const VILLAGE_PON_ACTION = "village-pon-sample";
const VILLAGE_REGION_PAGE_SIZE = 8;
const FRESHNESS_KINDS = new Set(["candidate-set", "pon-candidate-set", "onu-detail", "pon-detail", "onu-history", "village-pon-summary"]);
const FRESHNESS_CACHE_MS = 60 * 1000;
// Pi Agent 短期对话上下文：同一会话同一人 30 分钟内最近 3 轮问答，让“不对，应该是…”这类纠正能看到上一轮回答。
const AGENT_CONTEXT_TTL_MS = 30 * 60 * 1000;
const AGENT_CONTEXT_TURNS = 3;
const STALE_DATASET_MS = 36 * 60 * 60 * 1000;
const REPAIR_LIST_LIMIT = 20;

const USER_INTENTS = new Set([
  "find_by_name",
  "find_by_phone",
  "find_by_address",
  "find_by_sn",
  "find_by_device_number",
  "find_by_loid",
  "find_by_mac",
  "find_by_onu_coordinate"
]);

const PON_FALLBACK_INTENTS = new Set(["find_by_name", "find_by_address"]);
export const ORDERED_SEARCH_INTENTS = Object.freeze([
  "find_by_name",
  "find_pon_by_address",
  "find_by_loid",
  "find_by_sn",
  "find_by_phone",
  "find_by_address"
]);

function clone(value) {
  return cloneJson(value);
}

// 调试日志（ADR-091）：回复里的按钮令牌、过期时间不记，其余原样记下，方便看机器人到底回了什么。
const LOG_HIDDEN_KEYS = new Set(["token", "expiresAt", "selection", "sorting", "form", "decision", "copyLoidQuery", "historyQuery", "primaryAddressQuery", "editQuery", "action", "data"]);

export function replyLogText(reply) {
  if (!reply || typeof reply !== "object") return String(reply ?? "");
  const message = typeof reply.message === "string" ? reply.message : "";
  const others = Object.keys(reply).filter((key) => key !== "kind" && key !== "message" && !LOG_HIDDEN_KEYS.has(key));
  if (message && !others.length) return message;
  const detail = JSON.stringify(reply, (key, value) => (LOG_HIDDEN_KEYS.has(key) ? undefined : value));
  return message ? `${message}\n${detail}` : detail;
}

// 资料修改表单在外勤手里停留的时间比候选列表长。
const EDIT_FORM_TTL_MS = 30 * 60 * 1000;
const EDIT_DECISION_ACTIONS = new Set(["edit-request-approve", "edit-request-reject"]);

function compactText(value) {
  return String(value ?? "").replace(/\s+/g, "");
}

// 当天装机（ADR-090）：只有明确说新装 / 刚装，或按 LOID、手机号查不到时才去一期网管读当天工单。
// 机器人菜单“今天新装”的事件 ID（在飞书开发者后台配置菜单时填写）。
export const RECENT_INSTALL_MENU_KEY = "recent-installs";
const RECENT_INSTALL_WORDS = /(?:新装|刚装|今天装|今日装|刚安装|新安装|刚开通|新开通|新开户|装好)/;

/** “今天新装”“今日装机”“今天装了哪些”：列出当天装机工单。 */
export function isRecentInstallListRequest(text) {
  return /^(?:查一?下?|看一?下?|查看)?(?:今天|今日)(?:的)?(?:新装|装机|新装机|装了哪些|装了什么)(?:用户|工单|记录)?(?:情况|列表|名单|有哪些|明细)?[？?]?$/.test(compactText(text));
}

/** 查不到用户时是否值得去一期网管读当天工单。 */
export function shouldSyncRecentInstalls({ text = "", intent = "", value = "", useSearchOrder = false } = {}) {
  if (RECENT_INSTALL_WORDS.test(compactText(text))) return true;
  if (useSearchOrder) return false;
  const query = compactText(value);
  if (intent === "find_by_loid") return /^[A-Za-z0-9]{8,24}$/.test(query) && /\d/.test(query);
  if (intent === "find_by_phone") return /^1\d{10}$/.test(query);
  return false;
}

/** “君汇那个口的一级地址应该是顺景大厦”“君汇的一级地址改为顺景大厦”。explicit 表示明确说了“一级地址”。 */
export function parsePrimaryAddressEditRequest(text) {
  const match = compactText(text).match(/^(.+?)(?:那个口|这个口|那个PON口|这个PON口|口)?的?一级地址(?:应该|应当)?(?:是|为|改为|改成|写成|改作)[:：]?(.+)$/i);
  if (!match) return null;
  const previous = match[1].replace(/的$/, "");
  const next = match[2].replace(/[。.!！]+$/, "");
  if (previous.length < 2 || next.length < 2 || next.length > 100) return null;
  return { previous, next, place: "", explicit: true };
}

/**
 * 更口语的说法：“可以将君汇小区换成顺景大厦吗？属于新塘村”“把君汇改成顺景大厦，归新塘村”。
 * 只给出候选；调用方要在 PON 台账里找到对应的一级地址才当作修改申请，找不到按普通查询处理。
 */
export function parseLedgerEditRequest(text) {
  const explicit = parsePrimaryAddressEditRequest(text);
  if (explicit) return explicit;
  const source = compactText(text).replace(/[。.!！]+$/, "");
  const match = source.match(/^(?:请|麻烦|帮忙)?(?:可以|能不能|能否|可否)?(?:帮我)?(?:把|将)(.+?)(?:换成|改成|改为|更改为|更换为|更名为|改名为|改名成)(.+)$/);
  if (!match) return null;
  let rest = match[2];
  let place = "";
  const placeMatch = rest.match(/^(.+?)(?:吗|嘛|吧|呢)?[？?]?[，,；;。]?(?:它|这个口|这个地址)?(?:是)?(?:属于|归属于?|归到|归)(.+?)(?:的|吗|嘛)?[？?]?$/);
  if (placeMatch) {
    rest = placeMatch[1];
    place = placeMatch[2];
  }
  const next = rest.replace(/(?:吗|嘛|吧|呢)?[？?]*$/, "");
  const previous = match[1];
  if (previous.length < 2 || next.length < 2 || next.length > 100) return null;
  return { previous, next, place, explicit: false };
}

/** 在台账里找一级地址时依次尝试的写法：原样、去掉“小区 / 花园 / 那个口”等后缀。 */
function ledgerKeywordVariants(value) {
  const text = compactText(value);
  const stripped = text.replace(/(?:那个口|这个口|的口|小区|花园|大厦|楼盘|这里|那里)$/, "");
  return [...new Set([text, stripped].filter((item) => item.length >= 2))];
}

function publicEditRequest(request) {
  return {
    id: request.id,
    kind: request.kind,
    status: request.status,
    oltName: request.oltName,
    port: `${request.board}/${request.pon}`,
    onuId: request.onuId,
    username: request.username,
    userAddress: request.userAddress,
    rowAddress: request.rowAddress || "",
    previousValue: request.previousValue,
    proposedValue: request.proposedValue,
    finalValue: request.finalValue,
    requesterName: request.requesterName,
    approverName: request.approverName,
    result: request.result,
    createdAt: request.createdAt,
    decidedAt: request.decidedAt
  };
}

function auditRecord(event, decision, extra = {}) {
  return {
    occurredAt: new Date().toISOString(),
    eventType: event.kind === "callback" ? "callback" : "query",
    openId: event.openId,
    chatId: event.chatId,
    decision,
    ...extra
  };
}

function validEvent(event) {
  return event && typeof event.eventId === "string" && event.eventId.length > 0 &&
    typeof event.openId === "string" && event.openId.length > 0 &&
    typeof event.chatId === "string" && event.chatId.length > 0 &&
    typeof event.text === "string" && event.text.trim().length > 0;
}

function validCallbackEvent(event) {
  return event && typeof event.eventId === "string" && event.eventId.length > 0 &&
    typeof event.openId === "string" && event.openId.length > 0 &&
    typeof event.chatId === "string" && event.chatId.length > 0 &&
    event.binding && typeof event.binding === "object" &&
    typeof event.binding.token === "string" && event.binding.token.length > 0 &&
    Number.isInteger(event.binding.index) && event.binding.index >= 0 &&
    (event.binding.action === undefined || typeof event.binding.action === "string") &&
    (event.binding.page === undefined ||
      (Number.isInteger(event.binding.page) && event.binding.page >= 1)) &&
    (event.binding.expiresAt === undefined || typeof event.binding.expiresAt === "string");
}

function validQuery(value) {
  if (!value || typeof value !== "object") return false;
  const keys = Object.keys(value).sort();
  return keys.length === 4 &&
    keys.join(",") === "intent,type,value,version" &&
    value.type === "query" && value.version === LANGUAGE_CONTRACT_VERSION &&
    ALLOWED_INTENTS.includes(value.intent) &&
    typeof value.value === "string" && value.value.trim().length > 0;
}

function localExplicitLoidQuery(text) {
  const original = String(text ?? "").trim();
  const labeled = original.match(/(?:^|[^A-Za-z0-9_])LOID\s*(?:[:：=]\s*|\s+)([A-Za-z0-9._-]*)/iu);
  if (labeled) return { explicit: true, value: labeled[1] || null };
  const compact = original.replace(/\s+/g, "");
  const bare = compact.match(/(?:^|[^A-Za-z0-9_])(LOID[-_][A-Za-z0-9._-]+)/iu);
  return bare ? { explicit: true, value: bare[1] } : { explicit: false, value: null };
}

function localVillageRepairValue(text) {
  const value = String(text ?? "").trim().replace(/\s+/g, "");
  const match = value.match(/^(?:请|麻烦|帮忙|帮我)?(?:查查|查询|查找|查一下|查看|看看|看下|查)?([\u4e00-\u9fff·]{1,32}?(?:村|社区|居委)[\u4e00-\u9fff·]{0,12}?)(?:的)?(?:抢修情况|抢修|断纤情况|断纤|恢复情况|熔接情况)[?？。！!]*$/u);
  if (match) return match[1];
  // 只说小组名（例如“万达广场抢修情况”）：交给区域字典解析，不认识时按村名未找到处理。
  const regionOnly = value.match(/^(?:请|麻烦|帮忙|帮我)?(?:查查|查询|查找|查一下|查看|看看|看下|查)?([\u4e00-\u9fff·]{2,16}?)(?:的)?(?:抢修情况|断纤情况|恢复情况|熔接情况)[?？。！!]*$/u);
  return regionOnly?.[1] || null;
}

const PLACE_PREFIX = "^(?:请|麻烦|帮忙|帮我)?(?:查查|查询|查找|查一下|查看|看看|看下|查)?";
const PLACE_VALUE = "([\\u4e00-\\u9fff·0-9A-Za-z#]{2,32}?)";
const WEAK_LIGHT_PATTERN = new RegExp(`${PLACE_PREFIX}${PLACE_VALUE}(?:的)?(?:弱光|光衰|光功率差|光功率低|光功率不好)(?:的)?(?:用户|情况|名单|数量|有哪些|有多少|多少户)*[?？。！!]*$`, "u");

/** “厚街村弱光用户”“万达广场光衰情况”：按夜间采样列出弱光用户。 */
function localWeakLightValue(text) {
  return String(text ?? "").trim().replace(/\s+/g, "").match(WEAK_LIGHT_PATTERN)?.[1] || null;
}

function localVillagePonValue(text) {
  const repair = localVillageRepairValue(text);
  if (repair) return repair;
  const value = String(text ?? "").trim();
  const match = value.match(/(?:查查|查询|查找|查一下|帮我查|帮忙查|请查)?\s*([\u4e00-\u9fff·]{2,32}(?:村|社区|居委))\s*(?:的)?\s*(?:所有|全部|各个|所有的)?\s*(?:PON|pon)\s*口|(?:查查|查询|查找|查一下|帮我查|帮忙查|请查)?\s*([\u4e00-\u9fff·]{2,32}(?:村|社区|居委))\s*(?:的)?\s*(?:光口|端口)/u);
  return match?.[1] || match?.[2] || null;
}

function localPonIpQuery(text) {
  const match = String(text ?? "").match(/\b((?:\d{1,3}\.){3}\d{1,3})(?:\s*\/\s*|\s+)(\d+)\s*\/\s*(\d+)(?![\d./])/u);
  if (!match) return null;
  const parts = match[1].split(".");
  if (parts.some((part) => Number(part) > 255)) return { invalid: true, oltIp: match[1], board: match[2], pon: match[3] };
  return { oltIp: match[1], board: match[2], pon: match[3] };
}

function opticalNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) && Math.abs(value) !== 65535 ? value : null;
  }
  const raw = String(value).trim();
  if (!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:\s*dBm)?$/iu.test(raw)) return null;
  const number = Number(raw.replace(/\s*dBm$/iu, ""));
  return Number.isFinite(number) && Math.abs(number) !== 65535 ? number : null;
}

function validHistoryPoint(row, currentObservedAt) {
  const timestamp = row?.reportTime || row?.sampledAt;
  const time = Date.parse(String(timestamp || ""));
  const current = Date.parse(String(currentObservedAt || ""));
  const rx = opticalNumber(row?.rxOptical ?? row?.rxPower);
  if (!Number.isFinite(time) || !Number.isFinite(rx) || !Number.isFinite(current)) return null;
  if (time >= current) return null;
  return { time, timestamp: String(timestamp), rx };
}

function opticalComparison(sample, history) {
  const live = sample?.liveStatus;
  const observedAt = live?.observedAt || sample?.observedAt || null;
  const current = opticalNumber(live?.status?.rxPower ?? live?.rxPower);
  const rows = Array.isArray(history?.rows) ? history.rows : [];
  const points = rows.map((row) => validHistoryPoint(row, observedAt)).filter(Boolean)
    .sort((left, right) => right.time - left.time);
  const historical = points[0] || null;
  return {
    current: Number.isFinite(current) ? current : null,
    currentAt: observedAt,
    historical: historical?.rx ?? null,
    historicalAt: historical?.timestamp || null,
    rawDifference: Number.isFinite(current) && historical ? current - historical.rx : null,
    difference: Number.isFinite(current) && historical
      ? Number((current - historical.rx).toFixed(2)) : null,
    source: history?.source === "oss-ngb" ? "oss-ngb" : "local"
  };
}

const SAMPLE_BASELINE_AGE_MS = 24 * 60 * 60 * 1000;
const VILLAGE_SAMPLE_TARGET = 5;
// 先测 1 户，没超过 2 dB 就结束；超过才在同一个口加测，最多共 5 户再判断。
const VILLAGE_SAMPLE_QUICK = 1;
const SAMPLE_DEGRADED_DB = 2;
const PON_DEGRADED_SHARE = 0.6;

function medianOf(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * 抽样用户的“之前”光功率：取 24 小时以前历史记录的中位数，避开断纤期间和刚抢修完的读数；
 * 24 小时以前没有记录时才退回最近一次记录。
 */
export function sampleOpticalComparison(sample, history) {
  const base = opticalComparison(sample, history);
  const observed = Date.parse(String(base.currentAt || ""));
  if (!Number.isFinite(base.current) || !Number.isFinite(observed)) return { ...base, historicalMethod: "latest" };
  const rows = Array.isArray(history?.rows) ? history.rows : [];
  const older = rows.map((row) => validHistoryPoint(row, base.currentAt)).filter(Boolean)
    .filter((point) => observed - point.time >= SAMPLE_BASELINE_AGE_MS)
    .sort((left, right) => right.time - left.time);
  if (!older.length) return { ...base, historicalMethod: "latest" };
  const rx = medianOf(older.map((point) => point.rx));
  return {
    ...base,
    historical: rx,
    historicalAt: older[0].timestamp,
    rawDifference: base.current - rx,
    difference: Number((base.current - rx).toFixed(2)),
    historicalMethod: "median-24h",
    historicalPoints: older.length
  };
}

/**
 * 一个 PON 口多户抽测的判断：多数抽测用户同时变差 2 dB 以上才算该口光路（熔接）问题；
 * 只有少数用户变差算用户侧原因；只有 1 户可对比时样本不足，不下结论。
 */
export function judgePonSamples(differences = []) {
  const diffs = differences.filter(Number.isFinite);
  const degraded = diffs.filter((diff) => diff <= -SAMPLE_DEGRADED_DB).length;
  if (!diffs.length) return { judgement: "no-history", compared: 0, degraded: 0 };
  if (!degraded) return { judgement: "normal", compared: diffs.length, degraded };
  if (diffs.length === 1) return { judgement: "single-degraded", compared: 1, degraded };
  return { judgement: degraded / diffs.length >= PON_DEGRADED_SHARE ? "pon-degraded" : "user-side", compared: diffs.length, degraded };
}

export function createFeishuQueryApplication({
  stateStore,
  gateway,
  interpret,
  piAgentEngine = null,
  // 记录没能解决的问题（questionRecorder），管理员在“知识审核”里补答。
  fieldRecorder = null,
  // 查询日志与自我学习：记录每条提问、标记“没用”的上一条、提供已生效的别名和说法规则。
  queryLearning = null,
  // 资料修改申请（ADR-089）：外勤提交一级地址 / 归属修改，指定审批人在飞书同意后自动修改。
  editRequests = null,
  // 对话调试日志（ADR-091）：每条消息 / 按钮的输入、识别结果和全部回复。
  conversationLog = null,
  // 当天装机工单（ADR-090）：用户查不到时从一期网管拉当天的装机记录再查一次。
  recentInstalls = null,
  // 定额预算（ADR-092）：飞书“定额模式”录入定额、材料和管道，生成预算书；quotaModel 为本地规则拿不准时调用的大模型补全。
  quotaService = null,
  quotaModel = null,
  send: rawSend = async () => {},
  now = () => new Date().toISOString()
}) {
  if (!stateStore || typeof stateStore.read !== "function" ||
      typeof stateStore.write !== "function") {
    throw new TypeError("Feishu application requires a stateStore.");
  }
  if (!gateway || typeof gateway.listOlts !== "function" ||
      typeof gateway.queryUsers !== "function" || typeof gateway.queryPons !== "function") {
    throw new TypeError("Feishu application requires a complete OltDataGateway.");
  }
  if (typeof interpret !== "function") throw new TypeError("Feishu interpretation adapter is required.");

  const seenEvents = new Set();
  const rateEvents = [];
  const pendingBindings = new Map();
  const agentConversations = new Map();
  let freshnessCache = null;

  // 未解决问题记录是旁路功能：失败或未注入时静默跳过，不影响查询回复。
  function recordQuestion(question, reason) {
    if (typeof fieldRecorder?.recordQuestion !== "function") return;
    void Promise.resolve().then(() => fieldRecorder.recordQuestion({ question, reason, source: "feishu" })).catch(() => {});
  }

  function agentHistory(event) {
    const key = `${event.chatId}|${event.openId}`;
    const current = Date.parse(now());
    const entry = agentConversations.get(key);
    if (!entry || current - entry.at > AGENT_CONTEXT_TTL_MS) {
      agentConversations.delete(key);
      return [];
    }
    return entry.messages.map((message) => ({ ...message }));
  }

  function rememberAgentTurn(event, question, answer) {
    const key = `${event.chatId}|${event.openId}`;
    const messages = [...agentHistory(event), { role: "user", content: String(question) }, { role: "assistant", content: String(answer).slice(0, 2000) }]
      .slice(-AGENT_CONTEXT_TURNS * 2);
    agentConversations.set(key, { at: Date.parse(now()), messages });
    if (agentConversations.size > 500) agentConversations.delete(agentConversations.keys().next().value);
  }

  function parseTimestamp(value) {
    const text = String(value || "").trim();
    if (!text) return NaN;
    // SQLite CURRENT_TIMESTAMP 是不带时区的 UTC 时间。
    return Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? `${text.replace(" ", "T")}Z` : text);
  }

  /** 用户资料（合并数据集）的更新时间：超过 36 小时未同步或最近一次同步失败时提示可能不是最新。 */
  async function dataFreshness() {
    if (typeof gateway.datasetFreshness !== "function") return null;
    const current = Date.parse(now());
    if (freshnessCache && current - freshnessCache.at < FRESHNESS_CACHE_MS) return freshnessCache.value;
    let value = null;
    try {
      const status = await gateway.datasetFreshness();
      const syncedMs = parseTimestamp(status?.syncedAt);
      if (Number.isFinite(syncedMs)) {
        const latest = status?.latestRun;
        const failedAfter = latest?.status === "failed" && parseTimestamp(latest.completedAt) > syncedMs;
        value = {
          syncedAt: new Date(syncedMs).toISOString(),
          stale: current - syncedMs > STALE_DATASET_MS,
          lastSyncFailed: Boolean(failedAfter)
        };
      }
    } catch {
      value = null;
    }
    freshnessCache = { at: current, value };
    return value;
  }

  // 当前正在处理的消息 / 按钮，用来把这次处理中发出的所有回复记进调试日志。
  const logScope = new AsyncLocalStorage();
  const quotaMode = quotaService ? createQuotaMode({ quotaService, send: (...args) => send(...args), now, askModel: quotaModel }) : null;

  async function send(chatId, reply, options) {
    const scope = logScope.getStore();
    if (scope && reply) scope.replies.push({ kind: String(reply.kind || ""), text: replyLogText(reply), to: chatId === scope.chatId ? "" : "其它会话", replace: Boolean(options?.replaceOriginal) });
    if (reply && FRESHNESS_KINDS.has(reply.kind) && !reply.dataFreshness) {
      const freshness = await dataFreshness();
      if (freshness) reply.dataFreshness = freshness;
    }
    return options === undefined ? rawSend(chatId, reply) : rawSend(chatId, reply, options);
  }

  function enrichCandidates(candidates, olts) {
    const oltMetadata = new Map((olts ?? []).map((olt) => [olt.oltId, olt]));
    return cloneJson(candidates ?? []).map((candidate) => {
      const olt = oltMetadata.get(candidate.oltId);
      return {
        candidateId: String(candidate.candidateId || ""),
        oltId: String(candidate.oltId || ""),
        ...(typeof candidate.name === "string" ? { name: candidate.name } : {}),
        ...(typeof candidate.phone === "string" ? { phone: candidate.phone } : {}),
        ...(typeof candidate.address === "string" ? { address: candidate.address } : {}),
        ...(typeof candidate.primaryAddress === "string" ? { primaryAddress: candidate.primaryAddress } : {}),
        ...(typeof candidate.loid === "string" ? { loid: candidate.loid } : {}),
        ...(typeof candidate.mac === "string" ? { mac: candidate.mac } : {}),
        ...(typeof candidate.serialNumber === "string" ? { serialNumber: candidate.serialNumber } : {}),
        ...(typeof candidate.deviceNumber === "string" ? { deviceNumber: candidate.deviceNumber } : {}),
        ...(typeof candidate.place === "string" && candidate.place ? { place: candidate.place } : {}),
        ...(candidate.recentInstall === true ? { recentInstall: true } : {}),
        ...(candidate.onu && typeof candidate.onu === "object" ? { onu: clone(candidate.onu) } : {}),
        ...(candidate.pon && typeof candidate.pon === "object" ? { pon: clone(candidate.pon) } : {}),
        ...(candidate.snapshotAt === null || typeof candidate.snapshotAt === "string" ? { snapshotAt: candidate.snapshotAt } : {}),
        ...(olt?.name ? { oltName: olt.name } : {}),
        ...(olt?.vendor ? { vendor: olt.vendor } : {}),
        ...(olt?.ip ? { oltIp: olt.ip } : {})
      };
    });
  }

  function prunePendingCandidateSets(timestamp = Date.parse(now())) {
    for (const [token, pending] of pendingBindings) {
      if (Date.parse(pending.expiresAt) <= timestamp) pendingBindings.delete(token);
    }
    while (pendingBindings.size > 1000) {
      pendingBindings.delete(pendingBindings.keys().next().value);
    }
  }

  async function readState() {
    return normalizeFeishuState(await stateStore.read());
  }

  const eventMeta = new Map();
  function noteEvent(event, patch) {
    // 只记录正在处理中的消息；后台继续执行的汇总等异步步骤不再写入，避免残留。
    if (!event?.eventId || !eventMeta.has(event.eventId)) return;
    eventMeta.set(event.eventId, { ...(eventMeta.get(event.eventId) || {}), ...patch });
  }

  async function appendAudit(state, event, decision, extra) {
    noteEvent(event, { decision, queryType: extra?.queryType || extra?.reason || "", resultCount: extra?.resultCount });
    const next = {
      ...state,
      auditArchive: [
        ...state.auditArchive,
        auditRecord(event, decision, { occurredAt: now(), ...extra })
      ].slice(-1000)
    };
    await stateStore.write(next);
  }

  function rateAllowed(event) {
    const timestamp = Date.parse(now());
    const cutoff = timestamp - 60_000;
    while (rateEvents.length && rateEvents[0].at <= cutoff) rateEvents.shift();
    const operatorCount = rateEvents.filter((item) => item.openId === event.openId).length;
    const burstCount = rateEvents.filter((item) =>
      item.openId === event.openId && item.at > timestamp - 10_000
    ).length;
    const chatCount = rateEvents.filter((item) => item.chatId === event.chatId).length;
    if (operatorCount >= 10 || burstCount >= 3 || chatCount >= 20) return false;
    rateEvents.push({ at: timestamp, openId: event.openId, chatId: event.chatId });
    return true;
  }

  function replaceCallbackCardOptions(event) {
    return event?.messageId
      ? { messageId: event.messageId, replaceOriginal: true }
      : undefined;
  }

  function createEditFormBinding(pending) {
    prunePendingCandidateSets();
    const token = randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.parse(now()) + EDIT_FORM_TTL_MS).toISOString();
    pendingBindings.set(token, { ...pending, token, expiresAt, used: false });
    return { token, expiresAt };
  }

  async function sendEditText(state, event, message, extra = {}) {
    const reply = { kind: "edit-request-text", message };
    await appendAudit(state, event, "allowed", { queryType: "edit_request", ...extra });
    await send(event.chatId, reply);
    return reply;
  }

  async function syncRecentInstalls(state, event) {
    try {
      await send(event.chatId, { kind: "recent-install-syncing", message: "台账里没有查到，正在从一期网管同步今天的装机工单，请稍候（约半分钟）……" });
      const synced = await recentInstalls.syncToday({ trigger: "feishu" });
      await appendAudit(state, event, "allowed", { queryType: "recent_install_sync", resultCount: Number(synced?.newCount || 0) });
      return synced;
    } catch {
      return null;
    }
  }

  /** 列出当天装机工单：先读一次一期网管（两分钟内读过就直接用本机记录）。 */
  // sendOptions：机器人菜单没有会话 ID，按用户 open_id 发到单聊。
  async function listRecentInstalls(state, event, sendOptions = undefined) {
    let syncError = "";
    try {
      if (recentInstalls.canFetch?.()) {
        await send(event.chatId, { kind: "recent-install-syncing", message: "正在从一期网管读取今天的装机工单，请稍候（约半分钟）……" }, sendOptions);
        await recentInstalls.syncToday({ trigger: "feishu" });
      }
    } catch (error) {
      syncError = "一期网管读取失败，下面是本机已有的记录。";
    }
    let rows = [];
    try {
      rows = await recentInstalls.listToday();
    } catch {
      const failed = { kind: "retry-later", message: "今日装机记录读取失败，请稍后再试" };
      await appendAudit(state, event, "denied", { reason: failed.message });
      await send(event.chatId, failed, sendOptions);
      return failed;
    }
    const reply = {
      kind: "recent-install-list",
      rows: rows.slice(0, 30).map((row) => ({
        operation: row.operation, receivedAt: row.receivedAt, username: row.username, installationAddress: row.installationAddress,
        loid: row.loid, inLedger: Boolean(row.inLedger)
      })),
      total: rows.length,
      ...(syncError ? { warning: syncError } : {})
    };
    await appendAudit(state, event, "allowed", { queryType: "recent_install_list", resultCount: rows.length });
    await send(event.chatId, reply, sendOptions);
    return reply;
  }

  const NO_APPROVER_MESSAGE = "还没有指定资料修改审批人，请联系管理员在桌面版“飞书设置”中指定。";

  /** 用户详情卡片“资料有误”：发一张表单，默认填当前的一级地址和归属。 */
  async function openOnuEditForm(state, event, pending) {
    const candidate = pending.candidate;
    let context;
    try {
      context = await editRequests.onuFormContext({ oltId: candidate.oltId, onu: candidate.onu });
    } catch {
      return reject(state, event, "retry-later", "暂时无法读取资料，请稍后再试");
    }
    if (!context?.approver) return sendEditText(state, event, NO_APPROVER_MESSAGE);
    const rows = Array.isArray(context.rows) ? context.rows : [];
    const rowPlaces = Array.isArray(context.rowPlaces) ? context.rowPlaces : [];
    // 口在台账里时改的是台账行的归属：默认填该行按行指定的归属，没有指定时填这户现在的归属。
    const place = rows.length ? (rowPlaces[0] || context.place || "") : (context.place || "");
    const form = createEditFormBinding({ type: "onu-edit-form", chatId: event.chatId, candidate: clone(candidate), rows, place });
    const coordinate = candidate.onu ? `${candidate.onu.chassis}/${candidate.onu.board}/${candidate.onu.pon}:${candidate.onu.onuId}` : "";
    const reply = {
      kind: "onu-edit-form",
      title: "资料有误 · 提交修改",
      subject: [candidate.name, candidate.address].filter(Boolean).join(" · "),
      location: [context.oltName || candidate.oltName, coordinate].filter(Boolean).join(" "),
      rows,
      place,
      placeScope: rows.length ? "row" : "user",
      approverName: context.approver.name || "审批人",
      form
    };
    await appendAudit(state, event, "allowed", { queryType: "edit_request_form" });
    await send(event.chatId, reply);
    return reply;
  }

  /** 外勤说“君汇那个口的一级地址应该是顺景大厦”：找出台账行，发确认表单。 */
  /**
   * 外勤说“君汇那个口的一级地址应该是顺景大厦”“把君汇小区换成顺景大厦，属于新塘村”：找出台账行，发确认表单。
   * 口语说法（没说“一级地址”）在台账里找不到时返回 null，按普通查询继续处理。
   */
  async function openPonEditForm(state, event, parsed) {
    let found = null;
    let keyword = parsed.previous;
    try {
      for (const variant of ledgerKeywordVariants(parsed.previous)) {
        found = await editRequests.findPonRows(variant);
        keyword = variant;
        if (!found?.approver || found.rows.length) break;
      }
    } catch {
      if (!parsed.explicit) return null;
      return reject(state, event, "retry-later", "暂时无法读取 PON 台账，请稍后再试");
    }
    if (!found?.approver) return parsed.explicit || found?.rows?.length ? sendEditText(state, event, NO_APPROVER_MESSAGE) : null;
    if (!found.rows.length) {
      if (!parsed.explicit) return null;
      return sendEditText(state, event, `PON 台账里没有找到一级地址包含“${parsed.previous}”的口，请核对后再说一次，或在用户详情卡片上点“资料有误”。`, { resultCount: 0 });
    }
    const rows = found.rows.map((row) => clone(row));
    const firstPlace = rows[0].place || "";
    // 说了“属于新塘村”时归属默认填它；没说时填第一行现在的归属，不改就不会提交。
    const form = createEditFormBinding({ type: "pon-edit-form", chatId: event.chatId, rows, place: firstPlace });
    const reply = {
      kind: "onu-edit-form",
      title: parsed.place ? "修改一级地址和归属 · 请确认" : "修改一级地址 · 请确认",
      subject: rows.length > 1 ? `找到 ${rows.length} 行一级地址包含“${keyword}”，请选择要改的一行` : "",
      location: "",
      rows: rows.map((row) => `${row.oltName} ${row.board}/${row.pon} · ${row.address}`),
      rowAddresses: rows.map((row) => row.address),
      defaultPrimaryAddress: parsed.next,
      place: parsed.place || firstPlace,
      placeScope: "row",
      approverName: found.approver.name || "审批人",
      form
    };
    await appendAudit(state, event, "allowed", { queryType: "edit_request_form", resultCount: rows.length });
    await send(event.chatId, reply);
    return reply;
  }

  function editApprovalReply(request, warning = "") {
    return {
      kind: "edit-request-approval",
      request: publicEditRequest(request),
      ...(warning ? { warning } : {}),
      decision: { token: request.token }
    };
  }

  /** 提交表单：每个改动的字段生成一条申请，发给审批人。 */
  async function submitEditForm(state, event, pending) {
    if (pending.used) return sendEditText(state, event, "这张表单已经提交过了。");
    const form = event.formValue && typeof event.formValue === "object" ? event.formValue : {};
    const rowIndex = Math.max(0, Number.parseInt(String(form.row ?? "0"), 10) || 0);
    const items = [];
    const addressInput = typeof form.primaryAddress === "string" ? form.primaryAddress : "";
    if (pending.type === "pon-edit-form") {
      const row = pending.rows[rowIndex];
      if (row && compactText(addressInput) && compactText(addressInput) !== compactText(row.address)) {
        items.push({
          kind: "primary-address",
          target: { oltIp: row.oltIp, oltName: row.oltName, chassis: row.chassis, board: row.board, pon: row.pon },
          previousValue: row.address,
          proposedValue: addressInput
        });
      }
      const placeInput = typeof form.place === "string" ? form.place : "";
      if (row && compactText(placeInput) && compactText(placeInput) !== compactText(row.place || pending.place)) {
        items.push({
          kind: "row-place",
          target: { oltIp: row.oltIp, oltName: row.oltName, chassis: row.chassis, board: row.board, pon: row.pon, rowAddress: row.address },
          proposedValue: placeInput
        });
      }
    } else {
      const candidate = pending.candidate;
      const onu = candidate.onu || {};
      const row = pending.rows[pending.rows.length > 1 ? rowIndex : 0];
      if (row !== undefined && compactText(addressInput) && compactText(addressInput) !== compactText(row)) {
        items.push({
          kind: "primary-address",
          target: { oltId: candidate.oltId, chassis: onu.chassis, board: onu.board, pon: onu.pon },
          previousValue: row,
          proposedValue: addressInput
        });
      }
      const placeInput = typeof form.place === "string" ? form.place : "";
      if (compactText(placeInput) && compactText(placeInput) !== compactText(pending.place) && row !== undefined) {
        // 口在台账里：改所选台账行的归属，整行用户都按它算。
        items.push({
          kind: "row-place",
          target: { oltId: candidate.oltId, chassis: onu.chassis, board: onu.board, pon: onu.pon, rowAddress: row },
          proposedValue: placeInput
        });
      } else if (compactText(placeInput) && compactText(placeInput) !== compactText(pending.place)) {
        items.push({
          kind: "place",
          target: {
            oltId: candidate.oltId, chassis: onu.chassis, board: onu.board, pon: onu.pon, onuId: onu.onuId,
            loid: candidate.loid || "", username: candidate.name || "", userAddress: candidate.address || ""
          },
          proposedValue: placeInput
        });
      }
    }
    if (!items.length) return sendEditText(state, event, "没有修改任何内容。改好表单里的一级地址或村 / 小组 / 小区后再提交。");
    pending.used = true;
    const lines = [];
    for (const item of items) {
      const label = item.kind === "primary-address" ? "一级地址" : "村 / 小组 / 小区";
      let outcome;
      try {
        outcome = await editRequests.submit({ ...item, requester: { openId: event.openId, name: event.senderName || "", chatId: event.chatId } });
      } catch (error) {
        lines.push(`${label}：未提交，${error?.message || "提交失败"}`);
        continue;
      }
      if (outcome.unchanged) {
        lines.push(`${label}：和现在的一样，无需修改`);
        continue;
      }
      const { request, approver, duplicate } = outcome;
      if (duplicate) {
        lines.push(`${label}：“${request.proposedValue}”已经在等待审批，不用重复提交`);
        continue;
      }
      try {
        await send(approver.openId, editApprovalReply(request), { receiveIdType: "open_id" });
        lines.push(`${label}：“${request.previousValue || "（空）"}” → “${request.proposedValue}”，已发给 ${approver.name || "审批人"} 审批`);
      } catch {
        lines.push(`${label}：已记录，但审批消息没有发出去，请联系 ${approver.name || "审批人"} 在桌面版查看`);
      }
    }
    const reply = { kind: "edit-request-submitted", lines };
    await appendAudit(state, event, "allowed", { queryType: "edit_request", resultCount: items.length });
    await send(event.chatId, reply, replaceCallbackCardOptions(event));
    return reply;
  }

  /** 审批人点“同意 / 驳回”。 */
  async function decideEditRequest(state, event) {
    if (!editRequests) return reject(state, event, "invalid-callback", "资料修改审批未启用");
    const approve = event.binding.action === "edit-request-approve";
    const value = typeof event.formValue?.value === "string" ? event.formValue.value : undefined;
    let outcome;
    try {
      outcome = await editRequests.decide({ token: event.binding.token, operator: { openId: event.openId, name: event.senderName || "" }, approve, value });
    } catch {
      return reject(state, event, "retry-later", "审批处理失败，请稍后再试");
    }
    await appendAudit(state, event, outcome.status === "forbidden" ? "denied" : "allowed", { queryType: "edit_request_decision", outcome: outcome.status });
    if (["forbidden", "not-found", "invalid"].includes(outcome.status)) {
      const reply = { kind: "edit-request-text", message: outcome.message };
      await send(event.chatId, reply);
      return reply;
    }
    if (outcome.status === "conflict") {
      const reply = editApprovalReply(outcome.request, outcome.message);
      await send(event.chatId, reply, replaceCallbackCardOptions(event));
      return reply;
    }
    const reply = { kind: "edit-request-decided", request: publicEditRequest(outcome.request), message: outcome.message };
    await send(event.chatId, reply, replaceCallbackCardOptions(event));
    if (outcome.status !== "already" && outcome.request.requesterChatId) {
      try {
        await send(outcome.request.requesterChatId, { kind: "edit-request-notice", request: publicEditRequest(outcome.request) });
      } catch {
        // 通知外勤失败不影响审批结果。
      }
    }
    return reply;
  }

  function opticalQueryLoadingReply(pending, candidateOverride = null) {
    return {
      kind: pending.type === "village-pon-page"
        ? "village-pon-sample-loading"
        : pending.type === "onu-primary-address-pon"
        ? "onu-primary-address-loading"
        : "onu-history-loading",
      candidate: clone(candidateOverride || pending.candidate)
    };
  }

  async function reject(state, event, kind, reason, extra = {}) {
    await appendAudit(state, event, "denied", { reason, ...extra });
    const reply = { kind, message: reason };
    await send(event.chatId, reply);
    return reply;
  }

  async function sendHelp(state, event, topic = "main") {
    const content = FEISHU_HELP_TOPICS[topic] || FEISHU_HELP_TOPICS.main;
    const reply = { kind: "help", topic, title: content.title, template: content.template, sections: content.sections, footer: content.footer, message: feishuHelpText(topic) };
    await appendAudit(state, event, "allowed", { queryType: "help", topic });
    await send(event.chatId, reply);
    return reply;
  }

  async function sendVillageNoMatch(state, event, value) {
    recordQuestion(event.text || value, "village-no-match");
    const reply = {
      kind: "village-pon-empty",
      message: `未找到含${String(value || "该村")}用户的 PON。`
    };
    await appendAudit(state, event, "allowed", {
      queryType: "find_pons_by_village",
      resultCount: 0
    });
    await send(event.chatId, reply);
    return reply;
  }

  async function answerWeakLight(state, event, value, scope) {
    let result;
    try {
      result = await gateway.queryWeakLight({ value, oltIds: scope });
    } catch {
      return reject(state, event, "retry-later", "弱光查询暂时不可用，请稍后重试");
    }
    if (result.status === "no-match") return null;
    await appendAudit(state, event, "allowed", { queryType: "weak_light", resultCount: Number(result.weakCount || 0) });
    const reply = result.status === "ok"
      ? { kind: "weak-light", ...clone(result) }
      : { kind: "weak-light", status: "no-baseline", place: result.place || value, message: "还没有夜间光功率采集数据，弱光查询要等夜间采集跑过一晚后才能用。" };
    await send(event.chatId, reply);
    return reply;
  }

  async function sendLoidNoMatch(state, event, value) {
    const reply = { kind: "loid-no-match", message: `未找到精确匹配的 LOID：${String(value || "")}` };
    await appendAudit(state, event, "allowed", { queryType: "find_by_loid", resultCount: 0 });
    await send(event.chatId, reply);
    return reply;
  }

  async function queryBySearchOrder(value, oltIds) {
    for (const intent of ORDERED_SEARCH_INTENTS) {
      let result;
      if (intent === "find_by_device_number") {
        if (typeof gateway.queryUsersByDeviceNumber !== "function") continue;
        result = await gateway.queryUsersByDeviceNumber({ value, oltIds, limit: CANDIDATE_MAX });
      } else if (intent === "find_pon_by_address") {
        if (typeof gateway.queryPons !== "function") continue;
        result = await gateway.queryPons({ value, oltIds, limit: CANDIDATE_MAX });
      } else {
        result = await gateway.queryUsers({ intent, value, oltIds, limit: CANDIDATE_MAX });
      }
      if (result?.authorizedCount > 0) return { result, intent };
    }
    return { result: { authorizedCount: 0, candidates: [] }, intent: ORDERED_SEARCH_INTENTS.at(-1) };
  }

  async function queryVillagePons(value, oltIds, offset = 0, ponScope = "") {
    if (typeof gateway.queryVillagePons !== "function") {
      throw new Error("Village PON query unavailable");
    }
    return gateway.queryVillagePons({
      value,
      oltIds,
      offset,
      limit: CANDIDATE_PAGE_SIZE,
      ...(ponScope ? { ponScope } : {})
    });
  }

  function compactRepair(repair) {
    return {
      status: repair.status,
      counts: clone(repair.counts || {}),
      pattern: repair.pattern || "none",
      patternText: repair.patternText || "",
      medianDelta: repair.medianDelta ?? null,
      baselineFrom: repair.baselineFrom || "",
      baselineTo: repair.baselineTo || "",
      outageNight: repair.outageNight || "",
      degraded: clone((repair.degraded || []).slice(0, 10)),
      notRecovered: clone((repair.notRecovered || []).slice(0, 10))
    };
  }

  /** 有夜间基线时按整口逐户对比断纤前后；没有基线时返回 null，由调用方回退到抽样对比。 */
  async function readVillagePonRepair(pending, candidate) {
    if (typeof gateway.readPonRepairComparison !== "function") return null;
    let repair;
    try {
      repair = await gateway.readPonRepairComparison({ oltId: candidate.oltId, pon: clone(candidate.pon), oltIds: pending.oltIds });
    } catch {
      return null;
    }
    if (!repair || repair.status === "no-baseline") return null;
    return repair;
  }

  async function readSampleHistory(sample) {
    if (typeof gateway.readOnuHistoricalOptical === "function") {
      const observed = Date.parse(sample.liveStatus.observedAt || now());
      const end = new Date(Number.isFinite(observed) ? observed : Date.now());
      const start = new Date(end.getTime() - (6 * 24 * 60 * 60 * 1000));
      try {
        return await gateway.readOnuHistoricalOptical({
          oltId: sample.candidate.oltId,
          coordinate: clone(sample.candidate.onu),
          startDate: start.toISOString().slice(0, 10),
          endDate: end.toISOString().slice(0, 10),
          limit: 48
        });
      } catch (remoteError) {
        if (typeof gateway.readOnuHistory !== "function") throw remoteError;
      }
    }
    if (typeof gateway.readOnuHistory === "function") {
      return gateway.readOnuHistory({ oltId: sample.candidate.oltId, coordinate: clone(sample.candidate.onu), days: 7, limit: 48 });
    }
    return { rows: [] };
  }

  /**
   * 没有夜间基线时按抽样对比：每个口先抽 1 户，没超过 2 dB 就结束；超过才加测到 5 户，
   * 再按“多数变差 = 光路问题 / 少数变差 = 用户侧原因 / 只有 1 户 = 样本不足”判断。
   */
  async function readVillagePonComparison(pending, candidate) {
    if (typeof gateway.sampleVillagePonOnlineUser !== "function") {
      throw new Error("Village PON sample unavailable");
    }
    const excludedOnuIds = [];
    const triedOnuIds = new Set();
    const compared = [];
    let lastUsable = null;
    let lastPonStatus = null;
    const enough = () => compared.length >= VILLAGE_SAMPLE_TARGET ||
      (compared.length >= VILLAGE_SAMPLE_QUICK && compared.every((item) => item.comparison.rawDifference > -SAMPLE_DEGRADED_DB));
    for (let attempt = 0; attempt < MAX_VILLAGE_SAMPLE_ATTEMPTS && !enough(); attempt += 1) {
      const sample = await gateway.sampleVillagePonOnlineUser({
        value: pending.queryValue,
        oltIds: pending.oltIds,
        oltId: candidate.oltId,
        pon: clone(candidate.pon),
        ...(excludedOnuIds.length > 0 ? { excludeOnuIds: [...excludedOnuIds] } : {})
      });
      lastPonStatus = sample?.ponStatus ? clone(sample.ponStatus) : lastPonStatus;
      if (!compared.length && sample?.ponStatus?.status === "all-offline") {
        const configuredCount = Number(sample.ponStatus.configuredCount) || 0;
        return {
          status: "all-offline",
          sample: null,
          history: { rows: [] },
          comparison: null,
          ponStatus: clone(sample.ponStatus),
          message: `该 PON 下 ${configuredCount || "全部"} 个用户全部离线，按整口断纤风险处理。`
        };
      }
      if (!compared.length && ["state-incomplete", "no-configured-data"].includes(sample?.ponStatus?.status)) {
        const missingRows = sample.ponStatus.status === "no-configured-data";
        return {
          status: "state-incomplete",
          sample: null,
          history: { rows: [] },
          comparison: null,
          ponStatus: clone(sample.ponStatus),
          message: missingRows
            ? "设备未返回可核验的 ONU 状态数据，无法确认整口是否离线。"
            : `设备返回 ${Number(sample.ponStatus.unknownCount) || "部分"} 个状态未知的 ONU，不能据此认定整口离线。`
        };
      }
      const onuId = String(sample?.candidate?.onu?.onuId || "");
      if (!sample?.candidate || !sample?.liveStatus || !onuId || triedOnuIds.has(onuId)) break;
      triedOnuIds.add(onuId);
      excludedOnuIds.push(onuId);
      const history = await readSampleHistory(sample);
      const comparison = sampleOpticalComparison(sample, history);
      const usable = { sample: clone(sample), history: clone(history), comparison };
      if (Number.isFinite(comparison.current) && Number.isFinite(comparison.historical)) {
        compared.push(usable);
      } else if (Number.isFinite(comparison.current) || Number.isFinite(comparison.historical)) {
        if (!lastUsable || (Number.isFinite(comparison.current) && !Number.isFinite(lastUsable.comparison.current))) lastUsable = usable;
      }
    }
    if (compared.length) {
      const judged = judgePonSamples(compared.map((item) => item.comparison.rawDifference));
      // 代表样本：光路问题取最差的一户，其余取变化居中的一户。
      const ordered = [...compared].sort((left, right) => left.comparison.rawDifference - right.comparison.rawDifference);
      const representative = judged.judgement === "pon-degraded" || judged.judgement === "single-degraded"
        ? ordered[0]
        : ordered[Math.floor(ordered.length / 2)];
      return {
        status: "complete",
        sample: representative.sample,
        history: representative.history,
        comparison: representative.comparison,
        ponStatus: lastPonStatus,
        judgement: judged.judgement,
        comparedCount: judged.compared,
        degradedCount: judged.degraded,
        samples: compared.map((item) => ({
          name: String(item.sample.candidate?.name || ""),
          address: String(item.sample.candidate?.address || ""),
          onu: clone(item.sample.candidate?.onu || null),
          current: item.comparison.current,
          historical: item.comparison.historical,
          diff: item.comparison.rawDifference,
          historicalMethod: item.comparison.historicalMethod
        })),
        message: ""
      };
    }
    if (lastUsable) {
      return {
        status: Number.isFinite(lastUsable.comparison.current) ? "no-history" : "no-current",
        sample: lastUsable.sample,
        history: lastUsable.history,
        comparison: lastUsable.comparison,
        ponStatus: lastPonStatus,
        message: Number.isFinite(lastUsable.comparison.current)
          ? "已尝试同一 PON 口的其它在线用户，但均没有可用历史 ONU RX；当前实时光功率仍可单独参考。"
          : "当前 ONU RX 光功率不可用，无法完成对比。"
      };
    }
    return {
      status: "no-online",
      sample: null,
      comparison: null,
      ponStatus: lastPonStatus,
      message: "该 PON 当前没有可抽样的在线村级用户。"
    };
  }

  async function villageScopeStillEnabled(pending) {
    const olts = await gateway.listOlts();
    const active = new Set(olts.filter((olt) => olt.enabled).map((olt) => olt.oltId));
    return pending.oltIds.every((oltId) => active.has(oltId));
  }

  async function processVillagePage({ event, state, pending }) {
    const pageKey = String(Number(pending.offset || 0));
    pending.processingPages ??= new Set();
    pending.completedPages ??= new Set();
    if (pending.completedPages.has(pageKey)) {
      return { kind: "duplicate-callback", message: "该村级 PON 页面已处理，请重新发起查询" };
    }
    if (pending.processingPages.has(pageKey)) {
      return { kind: "duplicate-callback", message: "该村级 PON 页面正在处理，请稍候" };
    }
    pending.processingPages.add(pageKey);
    try {
      let scopeEnabled = false;
      try {
        scopeEnabled = await villageScopeStillEnabled(pending);
      } catch {
        const reply = { kind: "retry-later", message: "只读数据服务暂时不可用，请稍后重试" };
        await appendAudit(state, event, "denied", { reason: reply.message });
        await send(event.chatId, reply);
        return reply;
      }
      if (!scopeEnabled) {
        const reply = { kind: "denied", message: "查询所绑定的 OLT 已停用，请重新发起村级查询" };
        await appendAudit(state, event, "denied", { reason: reply.message });
        await send(event.chatId, reply);
        return reply;
      }
      const candidates = await Promise.all((pending.candidates ?? []).map(async (candidate) => {
        try {
          const sampling = await readVillagePonComparison(pending, candidate);
          return { ...candidate, sampling };
        } catch {
          return {
            ...candidate,
            sampling: {
              status: "failed",
              sample: null,
              comparison: null,
              message: "该 PON 的在线样本或历史光功率读取失败，不影响同页其它 PON。"
            }
          };
        }
      }));
      pending.candidates = clone(candidates);
      pending.completedPages.add(pageKey);
      const reply = candidateSetReply(pending);
      await appendAudit(state, event, "allowed", {
        queryType: "village_pon_page_auto_optical_comparison",
        offset: pending.offset,
        resultCount: candidates.length
      });
      await send(event.chatId, reply);
      return reply;
    } finally {
      pending.processingPages.delete(pageKey);
    }
  }

  async function villagePageReply({ event, state, value, scope, result, token, expiresAt }) {
    const pending = {
      type: "village-pon-page",
      token,
      chatId: event.chatId,
      queryValue: value,
      oltIds: [...scope],
      total: Number(result.total ?? result.authorizedCount ?? 0),
      offset: Number(result.offset ?? 0),
      hasMore: result.hasMore === true,
      candidates: clone((result.candidates ?? []).slice(0, CANDIDATE_PAGE_SIZE)),
      expiresAt,
      usedIndexes: new Set(),
      processingIndexes: new Set(),
      processingPages: new Set(),
      completedPages: new Set()
    };
    pendingBindings.set(token, pending);
    await appendAudit(state, event, "allowed", {
      queryType: "find_pons_by_village",
      resultCount: pending.total
    });
    const reply = candidateSetReply(pending);
    await send(event.chatId, reply);
    return processVillagePage({ event, state, pending });
  }

  // 需要复测的口：光路异常、整口离线、对比未完成；用户侧个别变差不需要复测主干。
  function retestCandidates(pending) {
    return (pending.findings ?? [])
      .filter((item) => ["abnormal", "outage", "incomplete"].includes(item.classification))
      .map((item) => clone(item.candidate));
  }

  function fixedVillagePage(pending, offset) {
    return {
      offset,
      total: pending.total,
      candidates: clone(pending.fixedCandidates.slice(offset, offset + CANDIDATE_PAGE_SIZE))
    };
  }

  function villageSummaryReply(pending, page = 1, view = "overview") {
    const findings = pending.findings ?? [];
    const pageCount = Math.max(1, Math.ceil(findings.length / CANDIDATE_PAGE_SIZE));
    const currentPage = Math.min(Math.max(1, page), pageCount);
    return {
      kind: "village-pon-summary",
      view: ["overview", "people", "pons"].includes(view) ? view : "overview",
      village: pending.queryValue,
      total: pending.total,
      abnormalCount: pending.abnormalCount,
      incompleteCount: pending.incompleteCount,
      outageCount: pending.outageCount,
      normal: pending.normal === true,
      message: pending.message || "",
      repairVerdict: pending.repairVerdict || (pending.normal ? "pass" : "warning"),
      repairVerdictText: pending.repairVerdictText || "",
      degradedSamples: clone(pending.degradedSamples || []),
      topWorstSamples: clone(pending.topWorstSamples || []),
      ...(pending.repairSummary ? {
        repairSummary: clone(pending.repairSummary),
        repairDegraded: clone(pending.repairDegraded || []),
        repairNotRecovered: clone(pending.repairNotRecovered || [])
      } : {}),
      userSideCount: Number(pending.userSideCount || 0),
      ponScope: pending.ponScope || "all",
      sparseCount: Number(pending.sparseCount || 0),
      retest: pending.retest === true,
      retestCount: retestCandidates(pending).length,
      findings: clone(findings.slice((currentPage - 1) * CANDIDATE_PAGE_SIZE,
        currentPage * CANDIDATE_PAGE_SIZE)),
      page: currentPage,
      pageSize: CANDIDATE_PAGE_SIZE,
      pageCount,
      selection: { token: pending.token, expiresAt: pending.expiresAt },
      ...(pending.interpretationSource ? { interpretationSource: clone(pending.interpretationSource) } : {})
    };
  }

  async function processVillageSummary({ event, state, pending, firstResult }) {
    try {
      let result = firstResult;
      let offset = 0;
      const findings = [];
      const validSamples = [];
      const repairResults = [];
      const seenCandidates = new Set();
      while (offset < pending.total) {
        if (Number(result?.offset) !== offset || Number(result?.total) !== pending.total) {
          throw new Error("Village PON page changed during summary");
        }
        if (!await villageScopeStillEnabled(pending)) {
          throw new Error("Village PON scope is no longer enabled");
        }
        const candidates = Array.isArray(result.candidates)
          ? result.candidates.slice(0, CANDIDATE_PAGE_SIZE) : [];
        const expectedCount = Math.min(CANDIDATE_PAGE_SIZE, pending.total - offset);
        if (candidates.length !== expectedCount) throw new Error("Village PON page is incomplete");
        for (const candidate of candidates) {
          const candidateId = String(candidate?.candidateId || "");
          if (!candidateId || seenCandidates.has(candidateId)) {
            throw new Error("Village PON page contains a duplicate candidate");
          }
          seenCandidates.add(candidateId);
        }
        const pageResults = await Promise.all(candidates.map(async (candidate) => {
          const repair = await readVillagePonRepair(pending, candidate);
          if (repair) {
            repairResults.push({ candidate: clone(candidate), repair });
            const compact = compactRepair(repair);
            if (repair.status === "all-offline") {
              const configuredCount = Number(repair.counts?.total) || 0;
              return {
                candidate: clone(candidate),
                sampling: {
                  status: "all-offline", sample: null, comparison: null,
                  ponStatus: { status: "all-offline", configuredCount, onlineCount: 0, offlineCount: configuredCount, unknownCount: 0 },
                  message: `该 PON 下 ${configuredCount || "全部"} 个用户全部离线，按整口断纤风险处理。`
                },
                classification: "outage",
                repair: compact
              };
            }
            if (repair.status === "no-configured-data") {
              return {
                candidate: clone(candidate),
                sampling: { status: "state-incomplete", sample: null, comparison: null, message: "设备未返回可核验的 ONU 状态数据，无法完成逐户对比。" },
                classification: "incomplete",
                repair: compact
              };
            }
            const abnormal = Number(repair.counts?.degraded) > 0 || Number(repair.counts?.notRecovered) > 0;
            return abnormal ? {
              candidate: clone(candidate),
              sampling: { status: "repair-compared", sample: null, comparison: null, message: "" },
              classification: "abnormal",
              repair: compact
            } : null;
          }
          try {
            const sampling = await readVillagePonComparison(pending, candidate);
            if (sampling.status === "all-offline") {
              return {
                candidate: clone(candidate),
                sampling: clone(sampling),
                classification: "outage"
              };
            }
            const comparison = sampling.comparison;
            const currentVal = comparison?.current;
            const hasCurrent = Number.isFinite(currentVal);
            if (sampling.status === "complete") {
              const lightIssue = sampling.judgement === "pon-degraded" || sampling.judgement === "single-degraded";
              for (const item of sampling.samples || []) {
                validSamples.push({
                  candidate: clone(candidate),
                  sample: { candidate: { name: item.name, onu: clone(item.onu) } },
                  current: item.current,
                  historical: item.historical,
                  diff: item.diff,
                  judgement: sampling.judgement,
                  lightIssue
                });
              }
              if (sampling.judgement === "normal") return null;
              return {
                candidate: clone(candidate),
                sampling: clone(sampling),
                // 少数用户变差：用户侧原因，不算该口光路异常。
                classification: sampling.judgement === "user-side" ? "user" : "abnormal"
              };
            }
            // 没有历史可对比，但实时光功率在合格门限内（≥ -27 dBm）时按正常处理。
            if (sampling.status === "no-history" && hasCurrent && currentVal >= -27.0) return null;
            return {
              candidate: clone(candidate),
              sampling: clone(sampling),
              classification: hasCurrent ? "abnormal" : "incomplete"
            };
          } catch {
            return {
              candidate: clone(candidate),
              sampling: {
                status: "failed", sample: null, comparison: null,
                message: "该 PON 的在线样本或实时光功率读取失败。"
              },
              classification: "incomplete"
            };
          }
        }));
        findings.push(...pageResults.filter(Boolean));
        offset += CANDIDATE_PAGE_SIZE;
        if (offset < pending.total) {
          result = pending.fixedCandidates
            ? fixedVillagePage(pending, offset)
            : await queryVillagePons(pending.queryValue, pending.oltIds, offset, pending.ponScope);
        }
      }
      if (repairResults.length) {
        const summary = summarizeRepairResults(repairResults.map((item) => item.repair));
        const froms = repairResults.map((item) => item.repair.baselineFrom).filter(Boolean).sort();
        const tos = repairResults.map((item) => item.repair.baselineTo).filter(Boolean).sort();
        pending.repairSummary = { ...summary, baselineFrom: froms[0] || "", baselineTo: tos.at(-1) || "" };
        const withPon = (item, person) => ({
          ...clone(person),
          oltName: item.candidate.oltName || "",
          pon: clone(item.candidate.pon),
          ponAddress: item.candidate.address || ""
        });
        pending.repairDegraded = repairResults
          .flatMap((item) => (item.repair.degraded || []).map((person) => withPon(item, person)))
          .sort((left, right) => left.delta - right.delta)
          .slice(0, REPAIR_LIST_LIMIT);
        pending.repairNotRecovered = repairResults
          .flatMap((item) => (item.repair.notRecovered || []).map((person) => withPon(item, person)))
          .slice(0, REPAIR_LIST_LIMIT);
      }
      pending.findings = findings;
      pending.expiresAt = new Date(Date.parse(now()) + CANDIDATE_TTL_MS).toISOString();
      pending.abnormalCount = findings.filter((item) => item.classification === "abnormal").length;
      pending.incompleteCount = findings.filter((item) => item.classification === "incomplete").length;
      pending.outageCount = findings.filter((item) => item.classification === "outage").length;
      pending.normal = pending.total > 0 && findings.length === 0;

      pending.userSideCount = findings.filter((item) => item.classification === "user").length;
      // 只有被判为该口光路问题（多数抽测用户变差，或仅 1 户可对比且变差）的样本才进入熔接预警；
      // 少数用户变差属于用户侧原因，不据此要求重熔。
      const degradedSamples = validSamples.filter((s) => s.lightIssue && Number.isFinite(s.diff) && s.diff <= -SAMPLE_DEGRADED_DB)
        .sort((a, b) => a.diff - b.diff);
      pending.degradedSamples = degradedSamples;

      // 仅当确实存在抢修导致的光衰突增劣化时，才展示预警样本；全村正常时不展示常年老弱光，避免误导现场！
      if (degradedSamples.length > 0) {
        pending.topWorstSamples = degradedSamples.slice(0, 3);
      } else {
        pending.topWorstSamples = [];
      }

      const repairTotals = pending.repairSummary?.totals;
      const repairPatterns = pending.repairSummary?.patterns || {};
      const dominantPattern = ["trunk", "branch", "drop"].find((pattern) => repairPatterns[pattern] > 0) || "none";
      // 抢修后熔接质量现场定界判定
      if (pending.outageCount > 0) {
        pending.repairVerdict = "outage";
        pending.repairVerdictText = `${pending.outageCount} 个 PON 口全部用户离线，按整口断纤风险处理：优先检查主干光缆、分光器和 OLT 端口告警。`;
        pending.message = "";
      } else if (repairTotals?.degraded > 0) {
        pending.repairVerdict = "warning";
        const ponWithDegraded = repairPatterns.trunk + repairPatterns.branch + repairPatterns.drop;
        pending.repairVerdictText = `${repairTotals.degraded} 户比断纤前差 2 dB 以上（涉及 ${ponWithDegraded} 个 PON 口），${REPAIR_PATTERN_TEXT[dominantPattern] || "请复核熔接"}。确认后再封盒。`;
        pending.message = "";
      } else if (repairTotals?.notRecovered > 0 && !degradedSamples.length) {
        pending.repairVerdict = "isolated";
        pending.repairVerdictText = `已恢复用户的光功率与断纤前相当，但还有 ${repairTotals.notRecovered} 户断纤前在线、现在未恢复，请逐户排查。`;
        pending.message = "";
      } else if (pending.normal && repairTotals) {
        pending.repairVerdict = "pass";
        pending.repairVerdictText = `已恢复 ${repairTotals.recovered}/${repairTotals.total} 户，光功率与断纤前相当，熔接质量良好，可以封盒。`;
        pending.message = "🎉 恭喜你，所有 PON 都正常！";
      } else if (pending.normal) {
        pending.repairVerdict = "pass";
        pending.repairVerdictText = "各 PON 口抽测光功率平稳，主干熔接质量优秀，可以封盒。";
        pending.message = "🎉 恭喜你，所有 PON 都正常！";
      } else if (degradedSamples.length > 0) {
        pending.repairVerdict = "warning";
        const lightFindings = findings.filter((item) => item.classification === "abnormal" && item.sampling?.status === "complete");
        const multi = lightFindings.filter((item) => item.sampling.judgement === "pon-degraded");
        const single = lightFindings.filter((item) => item.sampling.judgement === "single-degraded");
        const parts = [];
        if (multi.length) parts.push(`${multi.length} 个 PON 口多数抽测用户同时比之前差 2 dB 以上，疑似对应纤芯熔接不良，请开盒复核后再封盒`);
        if (single.length) parts.push(`${single.length} 个 PON 口只有 1 户可对比且变差，样本不足，建议人工复核`);
        pending.repairVerdictText = `${parts.join("；")}。`;
        pending.message = "";
      } else if (pending.userSideCount > 0 && pending.abnormalCount === 0) {
        pending.repairVerdict = "isolated";
        pending.repairVerdictText = `主干光路正常；${pending.userSideCount} 个 PON 口有个别用户比之前差 2 dB 以上，同口其他抽测用户正常，多半是用户侧原因（入户皮线、接头或终端），无需重熔主干。`;
        pending.message = "";
      } else if (pending.incompleteCount > 0 && pending.abnormalCount === 0) {
        pending.repairVerdict = "isolated";
        const noOnlineSampleCount = findings.filter((item) => item.sampling?.status === "no-online").length;
        const stateIncompleteCount = findings.filter((item) => item.sampling?.status === "state-incomplete").length;
        const opticalReadIncompleteCount = Math.max(0, pending.incompleteCount - noOnlineSampleCount - stateIncompleteCount);
        const reasons = [
          noOnlineSampleCount ? `${noOnlineSampleCount} 个 PON 口未获取到在线样本` : "",
          stateIncompleteCount ? `${stateIncompleteCount} 个 PON 口的 ONU 状态数据不完整，不能判定整口离线` : "",
          opticalReadIncompleteCount ? `${opticalReadIncompleteCount} 个 PON 口的抽样 RX/历史数据不足或读取失败` : ""
        ].filter(Boolean);
        pending.repairVerdictText = `部分 PON 口对比未完成：${reasons.join("；")}。这不代表整口断纤。`;
        pending.message = "";
      } else {
        pending.repairVerdict = "isolated";
        pending.repairVerdictText = "未发现主干群障，只有个别老弱光用户维持原状，无需重熔主干。";
        pending.message = "";
      }
      pending.completed = true;
      const reply = villageSummaryReply(pending);
      await appendAudit(state, event, "allowed", {
        queryType: "village_pon_summary",
        resultCount: pending.total,
        abnormalCount: pending.abnormalCount,
        incompleteCount: pending.incompleteCount,
        outageCount: pending.outageCount
      });
      await send(event.chatId, reply);
      return reply;
    } catch {
      const reply = {
        kind: "village-pon-summary-failed",
        village: pending.queryValue,
        message: "村级 PON 汇总读取失败，请稍后重试。"
      };
      await appendAudit(state, event, "denied", { reason: reply.message });
      await send(event.chatId, reply);
      return reply;
    }
  }

  function villageRegionMenuReply(pending, page = 1) {
    const pageCount = Math.max(1, Math.ceil(pending.regions.length / VILLAGE_REGION_PAGE_SIZE));
    const currentPage = Math.min(Math.max(1, page), pageCount);
    const start = (currentPage - 1) * VILLAGE_REGION_PAGE_SIZE;
    return {
      kind: "village-region-menu",
      village: pending.village,
      total: pending.total,
      sparseCount: pending.sparseCount,
      discovered: pending.discovered === true,
      regions: clone(pending.regions.slice(start, start + VILLAGE_REGION_PAGE_SIZE).map((region, offset) => ({ ...region, index: start + offset }))),
      page: currentPage,
      pageCount,
      selection: { token: pending.token, expiresAt: pending.expiresAt }
    };
  }

  /**
   * 村级抢修查询入口：默认只检查主要 PON 口（零星沾边口折叠）；
   * 村范围过大且没有指定小组时，先回复小组菜单让现场人员选择。
   */
  async function startVillageInspection({ event, state, value, scope, result, interpretationSource = { type: "rule" } }) {
    let mainResult = null;
    try {
      mainResult = await queryVillagePons(value, scope, 0, "main");
    } catch {
      mainResult = null;
    }
    const mainTotal = Number(mainResult?.total ?? 0);
    const sparseCount = Number(mainResult?.sparseCount ?? 0);
    if (mainResult && !mainResult.region && mainTotal > VILLAGE_MENU_PON_THRESHOLD &&
        typeof gateway.villageRegionMenu === "function") {
      let menu = null;
      try {
        menu = await gateway.villageRegionMenu({ value, oltIds: scope });
      } catch {
        menu = null;
      }
      if (menu?.regions?.length) {
        prunePendingCandidateSets();
        const token = randomBytes(24).toString("base64url");
        const pending = {
          type: "village-region-menu",
          token,
          chatId: event.chatId,
          village: menu.village || value,
          queryValue: value,
          oltIds: [...scope],
          regions: clone(menu.regions),
          total: mainTotal,
          sparseCount,
          discovered: menu.discovered === true,
          expiresAt: new Date(Date.parse(now()) + CANDIDATE_TTL_MS).toISOString(),
          interpretationSource: clone(interpretationSource)
        };
        pendingBindings.set(token, pending);
        await appendAudit(state, event, "allowed", { queryType: "village_region_menu", resultCount: menu.regions.length });
        const reply = villageRegionMenuReply(pending);
        await send(event.chatId, reply);
        return reply;
      }
    }
    const useMain = mainTotal > 0;
    return villageSummaryStart({
      event,
      state,
      value,
      scope,
      result: useMain ? mainResult : result,
      ponScope: useMain ? "main" : "",
      sparseCount: useMain ? sparseCount : 0,
      interpretationSource
    });
  }

  async function villageSummaryStart({ event, state, value, scope, result, ponScope = "", sparseCount = 0, fixedCandidates = null, interpretationSource = { type: "rule" } }) {
    prunePendingCandidateSets();
    const token = randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.parse(now()) + CANDIDATE_TTL_MS).toISOString();
    const pending = {
      type: "village-pon-summary",
      token,
      chatId: event.chatId,
      queryValue: value,
      oltIds: [...scope],
      total: fixedCandidates ? fixedCandidates.length : Number(result.total ?? result.authorizedCount ?? 0),
      ponScope,
      sparseCount: fixedCandidates ? 0 : sparseCount,
      findings: [],
      expiresAt,
      completed: false,
      interpretationSource: clone(interpretationSource),
      // 复测：只重新检查上一次有问题的口，不再分页查询整村。
      ...(fixedCandidates ? { retest: true, fixedCandidates: clone(fixedCandidates) } : {})
    };
    if (fixedCandidates) result = fixedVillagePage(pending, 0);
    pendingBindings.set(token, pending);
    await appendAudit(state, event, "allowed", {
      queryType: fixedCandidates ? "village_pon_retest" : "find_pons_by_village",
      resultCount: pending.total
    });
    const scopeText = fixedCandidates ? "有问题的 PON 口" : ponScope === "sparse" ? "零星相关 PON 口" : ponScope === "main" ? "主要 PON 口" : "全部 PON 口";
    await send(event.chatId, {
      kind: "village-pon-summary-loading",
      village: value,
      total: pending.total,
      retest: Boolean(fixedCandidates),
      message: `正在查询${value}的${scopeText}，并按每页 5 口读取光功率。`
    });
    void processVillageSummary({ event, state, pending, firstResult: result }).catch(async () => {
      const reply = { kind: "village-pon-summary-failed", village: value,
        message: "村级 PON 汇总读取失败，请稍后重试。" };
      try { await send(event.chatId, reply); } catch { /* send failure is isolated */ }
    });
    return {
      kind: "village-pon-summary-loading",
      village: value,
      total: pending.total,
      message: `正在查询${value}的${scopeText}，并按每页 5 口读取光功率。`,
      selection: { token, expiresAt }
    };
  }

  async function readCandidateDetail(queryKind, candidate) {
    if (queryKind === "onu") {
      if (typeof gateway.readOnuDetail !== "function") throw new Error("ONU detail unavailable");
      return gateway.readOnuDetail({ oltId: candidate.oltId, coordinate: clone(candidate.onu) });
    }
    if (typeof gateway.readPonStatuses !== "function") throw new Error("PON detail unavailable");
    return gateway.readPonStatuses({ oltId: candidate.oltId, coordinate: clone(candidate.pon) });
  }

  function canReadCandidateDetail(queryKind) {
    return queryKind === "onu"
      ? typeof gateway.readOnuDetail === "function" || typeof gateway.readOnuStatus === "function"
      : typeof gateway.readPonStatuses === "function";
  }

  function canTryPonAddressFallback(intent, value) {
    return PON_FALLBACK_INTENTS.has(intent) &&
      /^[\u4e00-\u9fff·]{2,64}$/u.test(String(value ?? "").trim());
  }

  async function readCandidateLiveStatus(candidate) {
    if (typeof gateway.readOnuStatus !== "function") throw new Error("ONU live status unavailable");
    return gateway.readOnuStatus({ oltId: candidate.oltId, coordinate: clone(candidate.onu) });
  }

  async function degradedOnuDetailReply(candidate, detailError, chatId) {
    try {
      const reply = detailReply("onu", candidate, await readCandidateLiveStatus(candidate), { chatId });
      reply.degraded = true;
      return reply;
    } catch {
      const reply = detailReply("onu", candidate, {
        oltId: candidate.oltId,
        onu: clone(candidate.onu),
        observedAt: now(),
        status: {
          phase: "unknown",
          rxPower: "unknown",
          distance: "unknown",
          serial: candidate.serialNumber || "unknown",
          name: candidate.name || ""
        },
        detail: {}
      }, { chatId });
      reply.degraded = true;
      reply.degradedReason = detailError?.statusCode === 404
        ? "本地用户资料已匹配，但 OLT 当前未返回该 ONU 的实时数据。"
        : "本地用户资料已匹配，但实时状态暂不可用。";
      return reply;
    }
  }

  function candidateSetReply(pending, page = 1) {
    if (pending.type === "village-pon-page") {
      const currentPage = Math.max(1, Math.floor(Number(pending.offset || 0) / CANDIDATE_PAGE_SIZE) + 1);
      return {
        kind: "village-pon-set",
        authorizedCount: pending.total,
        total: pending.total,
        offset: pending.offset,
        hasMore: pending.hasMore,
        candidates: clone(pending.candidates),
        page: currentPage,
        pageSize: CANDIDATE_PAGE_SIZE,
        selection: { token: pending.token, expiresAt: pending.expiresAt },
        ...(pending.interpretationSource ? { interpretationSource: clone(pending.interpretationSource) } : {})
      };
    }
    const pageCount = Math.max(1, Math.ceil(pending.candidates.length / CANDIDATE_PAGE_SIZE));
    return {
      kind: pending.queryKind === "pon" ? "pon-candidate-set" : "candidate-set",
      authorizedCount: pending.authorizedCount,
      candidates: clone(pending.candidates),
      page: Math.min(Math.max(1, page), pageCount),
      pageSize: CANDIDATE_PAGE_SIZE,
      selection: { token: pending.token, expiresAt: pending.expiresAt },
      ...(pending.interpretationSource ? { interpretationSource: clone(pending.interpretationSource) } : {})
    };
  }

  function createPonSortBinding(chatId, candidate, detail, currentSort = "power") {
    prunePendingCandidateSets();
    const token = randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.parse(now()) + CANDIDATE_TTL_MS).toISOString();
    pendingBindings.set(token, {
      type: "pon-detail-sort",
      token,
      chatId,
      candidate: clone(candidate),
      detail: clone(detail),
      expiresAt
    });
    return { token, expiresAt, current: currentSort };
  }

  function createOnuPrimaryAddressBinding(chatId, candidate, detail) {
    const coordinate = detail?.onu ?? candidate?.onu;
    if (!chatId || !candidate?.primaryAddress ||
        !coordinate || !["chassis", "board", "pon"].every((field) => String(coordinate[field] ?? "").trim())) {
      return null;
    }
    prunePendingCandidateSets();
    const token = randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.parse(now()) + CANDIDATE_TTL_MS).toISOString();
    const ponCandidate = {
      candidateId: `${candidate.candidateId}:primary-address`,
      oltId: candidate.oltId,
      oltName: candidate.oltName || "已启用 OLT",
      address: candidate.primaryAddress,
      pon: {
        chassis: String(coordinate.chassis),
        board: String(coordinate.board ?? coordinate.slot),
        pon: String(coordinate.pon)
      }
    };
    pendingBindings.set(token, {
      type: "onu-primary-address-pon",
      token,
      chatId,
      candidate: ponCandidate,
      expiresAt
    });
    return { token, expiresAt };
  }

  function createOnuActionBinding(type, chatId, candidate) {
    const coordinate = candidate?.onu;
    if (!chatId || !candidate?.oltId ||
        !coordinate || !["chassis", "board", "pon", "onuId"].every(
          (field) => String(coordinate[field] ?? "").trim())) return null;
    prunePendingCandidateSets();
    const token = randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.parse(now()) + CANDIDATE_TTL_MS).toISOString();
    pendingBindings.set(token, {
      type,
      token,
      chatId,
      candidate: clone(candidate),
      expiresAt,
      processing: false,
      used: false
    });
    return { token, expiresAt };
  }

  function detailReply(queryKind, candidate, detail, options = {}) {
    if (queryKind === "onu") {
      const reply = {
        kind: "onu-detail",
        candidate: clone(candidate),
        detail: clone(detail),
        ...(options.interpretationSource ? { interpretationSource: clone(options.interpretationSource) } : {})
      };
      if (options.chatId) {
        const copyLoidQuery = createOnuActionBinding("onu-copy-loid", options.chatId, candidate);
        if (copyLoidQuery) reply.copyLoidQuery = copyLoidQuery;
        const historyQuery = createOnuActionBinding("onu-history", options.chatId, candidate);
        if (historyQuery) reply.historyQuery = historyQuery;
        const primaryAddressQuery = createOnuPrimaryAddressBinding(options.chatId, candidate, detail);
        if (primaryAddressQuery) reply.primaryAddressQuery = primaryAddressQuery;
        if (editRequests) {
          const editQuery = createOnuActionBinding("onu-edit", options.chatId, candidate);
          if (editQuery) reply.editQuery = editQuery;
        }
      }
      return reply;
    }
    const reply = {
      kind: "pon-detail",
      candidate: clone(candidate),
      detail: clone(detail),
      ...(options.interpretationSource ? { interpretationSource: clone(options.interpretationSource) } : {})
    };
    if (options.chatId) {
      reply.sorting = createPonSortBinding(options.chatId, candidate, detail, options.sort ?? "power");
    } else if (options.sort) {
      reply.sorting = { current: options.sort };
    }
    return reply;
  }

  const application = {
    async handleMessage(event) {
      if (!validEvent(event)) throw new TypeError("Invalid Feishu message event.");
      if (seenEvents.has(event.eventId)) return { duplicate: true };
      seenEvents.add(event.eventId);
      const state = await readState();
      if (!state.enabled) return reject(state, event, "disabled", "Feishu 查询子系统未启用");
      // 群聊只响应 @机器人 的消息；没有 @ 的群消息不回复、不记审计。
      if (event.kind === "group" && event.mentioned !== true) return { ignored: true };
      if (!rateAllowed(event)) return reject(state, event, "rate-limited", "请求过于频繁，请稍后重试");

      // 定额模式：说“定额模式”进入；进入后这个会话里的话都按定额 / 材料 / 管道理解，直到说“退出”。
      if (quotaMode && (isQuotaEntry(event.text) || quotaMode.isActive(event))) {
        const reply = isQuotaEntry(event.text) ? await quotaMode.enter(event) : await quotaMode.handleText(event);
        await appendAudit(state, event, "allowed", { queryType: "quota" });
        return reply;
      }

      const helpTopic = feishuHelpTopic(event.text);
      if (helpTopic) {
        return sendHelp(state, event, helpTopic);
      }

      if (recentInstalls && typeof recentInstalls.listToday === "function" && isRecentInstallListRequest(event.text)) {
        return listRecentInstalls(state, event);
      }

      const ledgerEdit = editRequests ? parseLedgerEditRequest(event.text) : null;
      if (ledgerEdit) {
        const opened = await openPonEditForm(state, event, ledgerEdit);
        if (opened) return opened;
      }

      if (isNegativeFeedback(event.text)) {
        // “不对 / 没用”：把上一轮问题记为未解决，供管理员补答；本轮照常交给后续流程处理。
        const previous = agentHistory(event).filter((message) => message.role === "user").at(-1);
        if (previous?.content) recordQuestion(previous.content, "negative-feedback");
        if (typeof queryLearning?.markNegative === "function") {
          void Promise.resolve().then(() => queryLearning.markNegative({ openId: event.openId, chatId: event.chatId })).catch(() => {});
        }
      }

      let olts;
      try {
        olts = await gateway.listOlts();
      } catch {
        return reject(state, event, "retry-later", "只读数据服务暂不可用");
      }
      const activeOltIds = new Set(olts.filter((olt) => olt.enabled).map((olt) => olt.oltId));
      const scope = [...activeOltIds];
      if (scope.length === 0) return reject(state, event, "retry-later", "当前没有启用的 OLT 可供查询");

      if (state.language.provider === "synthetic") {
        let status;
        try {
          if (typeof gateway.status !== "function") throw new Error("Gateway status unavailable");
          status = await gateway.status();
        } catch {
          return reject(state, event, "attestation-required", "Synthetic Dataset Attestation 尚未确认");
        }
        const attestation = state.language.syntheticDatasetAttestation;
        if (status?.datasetRevision !== attestation?.datasetRevision ||
            !attestation || (attestation.state !== undefined && attestation.state !== "confirmed")) {
          return reject(state, event, "attestation-required", "Synthetic Dataset Attestation 已失效，请重新确认数据集");
        }
      }

      const directPon = localPonIpQuery(event.text);
      if (directPon) {
        if (directPon.invalid) return reject(state, event, "invalid-query", "OLT 管理 IP 必须是严格的 IPv4 地址");
        const configuredOlt = olts.find((olt) => String(olt.ip || "") === directPon.oltIp);
        if (!configuredOlt) return reject(state, event, "denied", "未找到该管理 IP 对应的 OLT");
        if (!configuredOlt.enabled || !scope.includes(configuredOlt.oltId)) {
          return reject(state, event, "denied", "该管理 IP 对应的 OLT 当前未启用或不在查询范围内");
        }
        if (typeof gateway.readPonStatusesByIp !== "function") {
          return reject(state, event, "rejected-intent", "按 OLT 管理 IP 查询 PON 的只读能力尚未接入");
        }
        let detail;
        try {
          detail = await gateway.readPonStatusesByIp({
            oltIp: directPon.oltIp,
            board: directPon.board,
            pon: directPon.pon,
            oltIds: scope
          });
        } catch (error) {
          const message = error?.statusCode === 409
            ? "该板卡/PON 对应多个槽位，请提供完整的槽位/板卡/PON 坐标"
            : error?.message?.includes("完整")
              ? error.message
              : "按管理 IP 查询 PON 光功率失败，请提供完整坐标或稍后重试";
          return reject(state, event, "retry-later", message);
        }
        const candidate = {
          candidateId: `${configuredOlt.oltId}:${detail.pon.chassis}/${detail.pon.board}/${detail.pon.pon}`,
          oltId: configuredOlt.oltId,
          oltName: configuredOlt.name,
          address: detail.address || "",
          pon: clone(detail.pon)
        };
        await appendAudit(state, event, "allowed", {
          queryType: "read_pon_statuses_by_management_ip"
        });
        const reply = detailReply("pon", candidate, detail, { chatId: event.chatId, interpretationSource: { type: "rule" } });
        await send(event.chatId, reply);
        return reply;
      }

      const weakLightValue = localWeakLightValue(event.text);
      // 地名查不到时（例如“张三光衰”）不在这里作答，继续按普通查询处理。
      if (weakLightValue) {
        const answered = await answerWeakLight(state, event, weakLightValue, scope);
        if (answered) return answered;
      }

      const localVillage = localVillagePonValue(event.text);
      if (localVillage) {
        let villageResult;
        try {
          villageResult = await queryVillagePons(localVillage, scope, 0);
        } catch {
          return reject(state, event, "retry-later", "村级 PON 查询暂时不可用，请稍后重试");
        }
        if (!villageResult || Number(villageResult.total ?? villageResult.authorizedCount ?? 0) === 0) {
          return sendVillageNoMatch(state, event, localVillage);
        }
        return startVillageInspection({
          event,
          state,
          value: localVillage,
          scope,
          result: villageResult,
          interpretationSource: { type: "rule" }
        });
      }

      let interpretationSource = { type: "rule" };
      let interpreted;
      let useSearchOrder = false;
      const explicitLoid = localExplicitLoidQuery(event.text);
      const learned = explicitLoid.explicit ? null : await matchLearnedPhrase(event.text);
      if (explicitLoid.explicit) {
        if (!explicitLoid.value) return sendLoidNoMatch(state, event, "");
        interpreted = {
          type: "query",
          version: LANGUAGE_CONTRACT_VERSION,
          intent: "find_by_loid",
          value: explicitLoid.value
        };
        interpretationSource = { type: "rule" };
      } else if (learned) {
        // 管理员确认过的常用说法：不再等大模型解析。
        interpreted = { type: "query", version: LANGUAGE_CONTRACT_VERSION, intent: learned.intent, value: learned.value };
        interpretationSource = { type: "learned-rule" };
        noteEvent(event, { intent: learned.intent, value: learned.value, source: "learned" });
      } else {
        try {
          interpreted = await interpret({
            contractVersion: LANGUAGE_CONTRACT_VERSION,
            currentText: event.text,
            allowedIntents: [...ALLOWED_INTENTS]
          });
          if (interpreted?.type === "query" && validQuery(interpreted)) {
            interpretationSource = {
              type: "llm",
              model: state.language?.model || null
            };
            noteEvent(event, { intent: interpreted.intent, value: interpreted.value, source: "llm" });
          } else {
            interpretationSource = { type: "rule" };
          }
        } catch (error) {
          if (error?.code === SYNTHETIC_DATASET_ATTESTATION_REQUIRED) {
            return reject(state, event, "attestation-required", "Synthetic Dataset Attestation 尚未确认");
          }
          useSearchOrder = true;
          interpretationSource = { type: "rule" };
        }
      }
      if (interpreted?.type === "clarification" && interpreted.version === LANGUAGE_CONTRACT_VERSION) {
        useSearchOrder = true;
        interpretationSource = { type: "rule" };
      }
      if (!useSearchOrder && !validQuery(interpreted)) {
        useSearchOrder = true;
        interpretationSource = { type: "rule" };
      }

      let result;
      let resolvedIntent = interpreted?.intent || "";
      const runQuery = async () => {
          if (useSearchOrder) {
            const ordered = await queryBySearchOrder(event.text, scope);
            result = ordered.result;
            resolvedIntent = ordered.intent;
            interpretationSource = { type: "rule" };
          } else if (interpreted.intent === "find_by_device_number") {
            if (typeof gateway.queryUsersByDeviceNumber !== "function") {
              useSearchOrder = true;
              const ordered = await queryBySearchOrder(event.text, scope);
              result = ordered.result;
              resolvedIntent = ordered.intent;
              interpretationSource = { type: "rule" };
            } else {
              result = await gateway.queryUsersByDeviceNumber({
                value: interpreted.value, oltIds: scope, limit: CANDIDATE_MAX
              });
            }
          } else {
            result = USER_INTENTS.has(interpreted.intent)
              ? await gateway.queryUsers({ intent: interpreted.intent, value: interpreted.value, oltIds: scope, limit: CANDIDATE_MAX })
              : interpreted.intent === "find_pons_by_village"
                ? await queryVillagePons(interpreted.value, scope, 0)
              : interpreted.intent === "find_pon_by_address"
                ? await gateway.queryPons({ value: interpreted.value, oltIds: scope, limit: CANDIDATE_MAX })
                : null;
          }
      };
      try {
        await runQuery();
      } catch {
        return reject(state, event, "retry-later", "查询暂时失败，请稍后重试");
      }
      if (!result) return reject(state, event, "rejected-intent", "该查询类型尚未接入只读数据服务");
      // 刚装好的用户还没同步进台账：其它查法都查不到时，从一期网管拉当天的装机工单再查一次（ADR-090）。
      let recentInstallTried = false;
      const retryWithRecentInstalls = async () => {
        if (recentInstallTried || result.authorizedCount !== 0 || !USER_INTENTS.has(resolvedIntent) || !recentInstalls?.canFetch?.() ||
            !shouldSyncRecentInstalls({ text: event.text, intent: resolvedIntent, value: interpreted?.value, useSearchOrder })) return;
        recentInstallTried = true;
        const synced = await syncRecentInstalls(state, event);
        if (Number(synced?.newCount) > 0) {
          try {
            await runQuery();
          } catch {
            // 重查失败按原来的“没查到”处理。
          }
        }
      };
      if (resolvedIntent === "find_by_loid") await retryWithRecentInstalls();
      if (resolvedIntent === "find_by_loid" && result.authorizedCount === 0 && !useSearchOrder) {
        return sendLoidNoMatch(state, event, interpreted.value);
      }
      if (resolvedIntent === "find_pons_by_village") {
        if (Number(result.total ?? result.authorizedCount ?? 0) === 0) {
          return sendVillageNoMatch(state, event, interpreted.value);
        }
        return startVillageInspection({
          event,
          state,
          value: interpreted.value,
          scope,
          result,
          interpretationSource
        });
      }
      if (result.authorizedCount === 0 && !useSearchOrder && canTryPonAddressFallback(interpreted.intent, interpreted.value)) {
        try {
          const ponResult = await gateway.queryPons({
            value: interpreted.value,
            oltIds: scope,
            limit: CANDIDATE_MAX
          });
          if (ponResult.authorizedCount > 0) {
            result = ponResult;
            resolvedIntent = "find_pon_by_address";
          }
        } catch {
          // A failed fallback must not turn a normal user no-match into a service error.
        }
      }
      if (!useSearchOrder && result.authorizedCount === 0) {
        try {
          const ordered = await queryBySearchOrder(event.text, scope);
          if (ordered.result.authorizedCount > 0) {
            result = ordered.result;
            resolvedIntent = ordered.intent;
            interpretationSource = { type: "rule" };
          }
        } catch {
          return reject(state, event, "retry-later", "查询暂时失败，请稍后重试");
        }
      }
      await retryWithRecentInstalls();
      if (result.authorizedCount === 0) {
        if (piAgentEngine && typeof piAgentEngine.chat === "function" && !isFeishuHelpRequest(event.text)) {
          try {
            const answer = await piAgentEngine.chat({
              messages: [...agentHistory(event), { role: "user", content: event.text }],
              context: {
                piSdk: true,
                channel: "feishu",
                // Pi Durable 按“会话|用户”保存永久对话；同一事件重投时用 requestId 去重。
                conversationKey: `feishu:${event.chatId}|${event.openId}`,
                requestId: event.eventId ? `feishu:${event.eventId}` : "",
                readonlyScope: { oltIds: [...scope] }
              }
            });
            if (answer?.source === "pi-sdk-error") recordQuestion(event.text, "agent-error");
            if (answer && answer.reply) {
              rememberAgentTurn(event, event.text, answer.reply);
              const reply = {
                kind: "pi-agent-answer",
                message: answer.reply,
                interpretationSource: { type: "pi-agent" }
              };
              await appendAudit(state, event, "allowed", { queryType: "pi_agent_answer" });
              await send(event.chatId, reply);
              return reply;
            }
          } catch {
            // 发生异常时优雅回退到帮助卡片
          }
        }
        recordQuestion(event.text, "no-answer");
        return sendHelp(state, event, "no-result");
      }
      await appendAudit(state, event, "allowed", {
        queryType: resolvedIntent,
        resultCount: result.authorizedCount
      });
      const queryKind = resolvedIntent === "find_pon_by_address" ? "pon" : "onu";
      const candidates = enrichCandidates(result.candidates, olts);
      if (result.authorizedCount === 1 && candidates.length === 1 && canReadCandidateDetail(queryKind)) {
        let detail;
        try {
          detail = await readCandidateDetail(queryKind, candidates[0]);
        } catch (detailError) {
          if (queryKind === "onu") {
            const reply = await degradedOnuDetailReply(candidates[0], detailError, event.chatId);
            reply.interpretationSource = clone(interpretationSource);
            await send(event.chatId, reply);
            return reply;
          }
          return reject(state, event, "retry-later", "只读详情服务暂不可用");
        }
        const reply = detailReply(queryKind, candidates[0], detail, {
          chatId: event.chatId,
          interpretationSource
        });
        await send(event.chatId, reply);
        return reply;
      }
      const reply = (() => {
            prunePendingCandidateSets();
            const token = randomBytes(24).toString("base64url");
            const expiresAt = new Date(Date.parse(now()) + CANDIDATE_TTL_MS).toISOString();
            const pending = {
              type: "candidate-set",
              token,
              chatId: event.chatId,
              queryKind,
              authorizedCount: result.authorizedCount,
              candidates: clone(candidates),
              expiresAt,
              usedIndexes: new Set(),
              processingIndexes: new Set(),
              interpretationSource: clone(interpretationSource)
            };
            pendingBindings.set(token, pending);
            return candidateSetReply(pending);
          })();
      await send(event.chatId, reply);
      return reply;
    },

    async handleCallback(event) {
      if (!validCallbackEvent(event)) throw new TypeError("Invalid Feishu callback event.");
      if (seenEvents.has(event.eventId)) return { duplicate: true };
      seenEvents.add(event.eventId);
      const state = await readState();
      if (event.verifiedByTransport !== true) {
        return reject(state, event, "invalid-callback", "回调未通过飞书传输校验");
      }
      if (!state.enabled) return reject(state, event, "disabled", "Feishu 查询子系统未启用");
      if (!rateAllowed(event)) return reject(state, event, "rate-limited", "请求过于频繁，请稍后重试");

      // 资料修改审批卡片的令牌保存在数据库里，可以隔天处理；只认指定的审批人。
      if (EDIT_DECISION_ACTIONS.has(event.binding.action)) return decideEditRequest(state, event);
      // 定额模式的卡片按钮由定额模式自己校验令牌、发起人和有效期。
      if (quotaMode && String(event.binding.action || "").startsWith("quota-")) {
        const reply = await quotaMode.handleCallback(event);
        await appendAudit(state, event, "allowed", { queryType: "quota" });
        return reply;
      }

      const pending = pendingBindings.get(event.binding.token);
      if (!pending) return reject(state, event, "invalid-callback", "候选绑定不存在或已失效");
      if (event.binding.expiresAt !== undefined && event.binding.expiresAt !== pending.expiresAt) {
        return reject(state, event, "invalid-callback", "候选绑定已被篡改");
      }
      if (pending.chatId !== event.chatId) {
        return reject(state, event, "denied", "该候选不属于当前聊天");
      }
      if (Date.parse(pending.expiresAt) <= Date.parse(now())) {
        return reject(state, event, "expired-callback", "候选已过期，请重新发起查询");
      }

      if (editRequests && pending.type === "onu-edit" && event.binding.action === "onu-edit-open") {
        return openOnuEditForm(state, event, pending);
      }
      if (editRequests && (pending.type === "onu-edit-form" || pending.type === "pon-edit-form") && event.binding.action === "onu-edit-submit") {
        return submitEditForm(state, event, pending);
      }

      if (pending.type === "village-region-menu") {
        const action = event.binding.action;
        if (action === "village-region-page") {
          const pageCount = Math.max(1, Math.ceil(pending.regions.length / VILLAGE_REGION_PAGE_SIZE));
          const page = event.binding.page;
          if (!Number.isInteger(page) || page < 1 || page > pageCount) {
            return reject(state, event, "invalid-callback", "小组菜单分页已失效，请重新发起查询");
          }
          const reply = villageRegionMenuReply(pending, page);
          await send(event.chatId, reply, replaceCallbackCardOptions(event));
          return reply;
        }
        if (action !== "village-region-select" && action !== "village-region-all") {
          return reject(state, event, "invalid-callback", "小组菜单操作无效");
        }
        if (!await villageScopeStillEnabled(pending)) {
          return reject(state, event, "denied", "查询所绑定的 OLT 已停用，请重新发起村级查询");
        }
        const region = action === "village-region-select" ? pending.regions[event.binding.index] : null;
        if (action === "village-region-select" && !region) {
          return reject(state, event, "invalid-callback", "所选小组不存在，请重新发起查询");
        }
        const value = region ? `${region.village}${region.name}` : pending.queryValue;
        let first;
        try {
          first = await queryVillagePons(value, pending.oltIds, 0, "main");
          if (Number(first?.total ?? 0) === 0) first = { ...(await queryVillagePons(value, pending.oltIds, 0)), _all: true };
        } catch {
          return reject(state, event, "retry-later", "村级 PON 查询暂时不可用，请稍后重试");
        }
        if (Number(first?.total ?? 0) === 0) return sendVillageNoMatch(state, event, value);
        return villageSummaryStart({
          event,
          state,
          value,
          scope: pending.oltIds,
          result: first,
          ponScope: first._all ? "" : "main",
          sparseCount: first._all ? 0 : Number(first.sparseCount || 0),
          interpretationSource: pending.interpretationSource
        });
      }

      if (pending.type === "village-pon-summary" && event.binding.action === "village-sparse-check") {
        if (!pending.completed || pending.ponScope !== "main" || !(pending.sparseCount > 0)) {
          return reject(state, event, "invalid-callback", "零星口检查尚未就绪或已失效");
        }
        if (!await villageScopeStillEnabled(pending)) {
          return reject(state, event, "denied", "查询所绑定的 OLT 已停用，请重新发起村级查询");
        }
        let first;
        try {
          first = await queryVillagePons(pending.queryValue, pending.oltIds, 0, "sparse");
        } catch {
          return reject(state, event, "retry-later", "村级 PON 查询暂时不可用，请稍后重试");
        }
        if (Number(first?.total ?? 0) === 0) return sendVillageNoMatch(state, event, pending.queryValue);
        return villageSummaryStart({
          event,
          state,
          value: pending.queryValue,
          scope: pending.oltIds,
          result: first,
          ponScope: "sparse",
          interpretationSource: pending.interpretationSource
        });
      }

      if (pending.type === "village-pon-summary" && event.binding.action === "village-retest") {
        const candidates = pending.completed ? retestCandidates(pending) : [];
        if (!candidates.length) return reject(state, event, "invalid-callback", "没有需要复测的口，或结果已失效");
        if (!await villageScopeStillEnabled(pending)) {
          return reject(state, event, "denied", "查询所绑定的 OLT 已停用，请重新发起村级查询");
        }
        return villageSummaryStart({
          event,
          state,
          value: pending.queryValue,
          scope: pending.oltIds,
          result: null,
          ponScope: pending.ponScope,
          fixedCandidates: candidates,
          interpretationSource: pending.interpretationSource
        });
      }

      if (pending.type === "village-pon-summary" &&
          (event.binding.action === "village-summary-overview" || event.binding.action === "village-summary-people")) {
        if (!pending.completed) return reject(state, event, "invalid-callback", "村级 PON 汇总尚未就绪或已失效");
        // 在同一张卡片里切换“概览 / 名单”，不再刷出新消息。
        const reply = villageSummaryReply(pending, 1, event.binding.action === "village-summary-people" ? "people" : "overview");
        await send(event.chatId, reply, replaceCallbackCardOptions(event));
        return reply;
      }

      if (pending.type === "village-pon-summary") {
        if (event.binding.action !== "village-pon-summary-page" || !pending.completed) {
          return reject(state, event, "invalid-callback", "村级 PON 汇总分页尚未就绪或已失效");
        }
        const page = event.binding.page;
        const pageCount = Math.max(1, Math.ceil((pending.findings?.length || 0) / CANDIDATE_PAGE_SIZE));
        if (!Number.isInteger(page) || page < 1 || page > pageCount) {
          return reject(state, event, "invalid-callback", "村级 PON 汇总分页已失效，请重新发起查询");
        }
        const reply = villageSummaryReply(pending, page, "pons");
        await send(event.chatId, reply, replaceCallbackCardOptions(event));
        return reply;
      }

      const opticalQueryPending =
        (pending.type === "onu-history" && event.binding.action === "onu-history") ||
        (pending.type === "onu-primary-address-pon" && event.binding.action === "onu-primary-address-power") ||
        (pending.type === "village-pon-page" && event.binding.action === VILLAGE_PON_ACTION);
      if (opticalQueryPending && event.messageId) {
        const loadingCandidate = pending.type === "village-pon-page"
          ? pending.candidates?.[event.binding.index]
          : null;
        const replaceLoading = pending.type === "village-pon-page" ? undefined : replaceCallbackCardOptions(event);
        await send(event.chatId, opticalQueryLoadingReply(pending, loadingCandidate), replaceLoading);
      }

      let olts;
      try {
        olts = await gateway.listOlts();
      } catch {
        const reply = { kind: "retry-later", message: "只读数据服务暂不可用" };
        await appendAudit(state, event, "denied", { reason: reply.message });
        if (opticalQueryPending) await send(event.chatId, reply,
          pending.type === "village-pon-page" ? undefined : replaceCallbackCardOptions(event));
        else await send(event.chatId, reply);
        return reply;
      }
      const activeOltIds = new Set(olts.filter((olt) => olt.enabled).map((olt) => olt.oltId));
      const scope = [...activeOltIds];
      if (scope.length === 0) {
        const reply = pending.type === "village-pon-page"
          ? { kind: "denied", message: "查询所绑定的 OLT 已停用，请重新发起村级查询" }
          : { kind: "retry-later", message: "当前没有启用的 OLT 可供查询" };
        await appendAudit(state, event, "denied", { reason: reply.message });
        if (opticalQueryPending) await send(event.chatId, reply,
          pending.type === "village-pon-page" ? undefined : replaceCallbackCardOptions(event));
        else await send(event.chatId, reply);
        return reply;
      }
      if (pending.type === "village-pon-page" && pending.oltIds?.some((oltId) => !scope.includes(oltId))) {
        return reject(state, event, "denied", "查询所绑定的 OLT 已停用，请重新发起村级查询");
      }
      if (pending.type === "village-pon-page") {
        if (event.binding.action === "candidate-page" || event.binding.action === "village-pon-page") {
          const page = event.binding.page;
          const pageCount = Math.max(1, Math.ceil(pending.total / CANDIDATE_PAGE_SIZE));
          if (!Number.isInteger(page) || page < 1 || page > pageCount) {
            return reject(state, event, "invalid-callback", "村级 PON 分页已失效，请重新发起查询");
          }
          const pageOffset = (page - 1) * CANDIDATE_PAGE_SIZE;
          pending.processingPages ??= new Set();
          pending.completedPages ??= new Set();
          const pageKey = String(pageOffset);
          if (pending.completedPages.has(pageKey)) {
            return reject(state, event, "duplicate-callback", "该村级 PON 页面已处理，请重新发起查询");
          }
          if (pending.processingPages.has(pageKey)) {
            return reject(state, event, "duplicate-callback", "该村级 PON 页面正在处理，请稍候");
          }
          pending.processingPages.add(pageKey);
          try {
            const result = await queryVillagePons(
              pending.queryValue, pending.oltIds, pageOffset
            );
            await appendAudit(state, event, "allowed", {
              queryType: "find_pons_by_village_page",
              page,
              pageCount
            });
            const token = randomBytes(24).toString("base64url");
            const pagePending = {
              ...pending,
              token,
              offset: Number(result.offset ?? (page - 1) * CANDIDATE_PAGE_SIZE),
              total: Number(result.total ?? result.authorizedCount ?? pending.total),
              hasMore: result.hasMore === true,
              candidates: clone((result.candidates ?? []).slice(0, CANDIDATE_PAGE_SIZE)),
              usedIndexes: new Set(),
              processingIndexes: new Set(),
              processingPages: new Set(),
              completedPages: new Set()
            };
            pendingBindings.set(token, pagePending);
            const listReply = candidateSetReply(pagePending);
            await send(event.chatId, listReply);
            pending.processingPages.delete(pageKey);
            pending.completedPages.add(pageKey);
            return processVillagePage({ event, state, pending: pagePending });
          } catch {
            pending.processingPages.delete(pageKey);
            return reject(state, event, "retry-later", "村级 PON 分页暂时不可用，请稍后重试");
          }
        }
        if (event.binding.action !== VILLAGE_PON_ACTION) {
          return reject(state, event, "invalid-callback", "村级 PON 操作无效");
        }
        const candidateIndex = event.binding.index;
        const candidate = pending.candidates?.[candidateIndex];
        if (!candidate) return reject(state, event, "invalid-callback", "村级 PON 候选已失效，请重新发起查询");
        const candidateKey = String(candidate.candidateId || `${pending.offset}:${candidateIndex}`);
        pending.usedIndexes ??= new Set();
        pending.processingIndexes ??= new Set();
        if (pending.usedIndexes.has(candidateKey) || pending.processingIndexes.has(candidateKey)) {
          return reject(state, event, "duplicate-callback", "该随机抽样正在处理或已完成，请重新发起查询");
        }
        pending.processingIndexes.add(candidateKey);
        try {
          const sampling = await readVillagePonComparison(pending, candidate);
          pending.usedIndexes.add(candidateKey);
          pending.processingIndexes.delete(candidateKey);
          const reply = {
            kind: "village-pon-optical-comparison",
            candidate: clone(candidate),
            sample: sampling.sample,
            history: sampling.history,
            comparison: sampling.comparison,
            message: sampling.message
          };
          await appendAudit(state, event, "allowed", {
            queryType: "village_pon_random_optical_comparison",
            candidateId: sampling.sample?.candidate?.candidateId || candidate.candidateId,
            status: sampling.status
          });
          await send(event.chatId, reply);
          return reply;
        } catch {
          pending.processingIndexes.delete(candidateKey);
          const reply = { kind: "retry-later", message: "随机在线样本光功率暂时读取失败，请稍后重试" };
          await appendAudit(state, event, "denied", { reason: reply.message });
          await send(event.chatId, reply);
          return reply;
        }
      }
      if (pending.type === "onu-copy-loid" || pending.type === "onu-history") {
        const expectedAction = pending.type === "onu-copy-loid" ? "onu-copy-loid" : "onu-history";
        if (event.binding.action !== expectedAction) {
          return reject(state, event, "invalid-callback", "ONU 详情操作无效");
        }
        if (!scope.includes(pending.candidate?.oltId)) {
          return reject(state, event, "denied", "候选不属于当前启用的 OLT");
        }
        if (pending.used || pending.processing) {
          return reject(state, event, "duplicate-callback", "该操作已处理，请重新发起查询");
        }
        pending.processing = true;
        if (pending.type === "onu-copy-loid") {
          pending.used = true;
          pending.processing = false;
          const loid = String(pending.candidate?.loid || "").trim();
          await appendAudit(state, event, "allowed", {
            queryType: "copy_onu_loid",
            candidateId: pending.candidate?.candidateId
          });
          const reply = {
            kind: "onu-loid-copy",
            message: loid || "该 ONU 未提供 LOID"
          };
          await send(event.chatId, reply);
          return reply;
        }
        try {
          let history;
          if (typeof gateway.readOnuHistoricalOptical === "function") {
            const end = new Date();
            const start = new Date(end.getTime() - (6 * 24 * 60 * 60 * 1000));
            try {
              history = await gateway.readOnuHistoricalOptical({
                oltId: pending.candidate.oltId,
                coordinate: clone(pending.candidate.onu),
                startDate: start.toISOString().slice(0, 10),
                endDate: end.toISOString().slice(0, 10),
                limit: 48
              });
            } catch (remoteError) {
              if (typeof gateway.readOnuHistory !== "function") throw remoteError;
              history = await gateway.readOnuHistory({
                oltId: pending.candidate.oltId,
                coordinate: clone(pending.candidate.onu),
                days: 7,
                limit: 48
              });
            }
          } else {
            if (typeof gateway.readOnuHistory !== "function") throw new Error("ONU history unavailable");
            history = await gateway.readOnuHistory({
              oltId: pending.candidate.oltId,
              coordinate: clone(pending.candidate.onu),
              days: 7,
              limit: 48
            });
          }
          pending.used = true;
          pending.processing = false;
          await appendAudit(state, event, "allowed", {
            queryType: history.source === "oss-ngb" ? "read_onu_historical_optical" : "read_onu_history",
            candidateId: pending.candidate?.candidateId
          });
          const reply = {
            kind: "onu-history",
            candidate: clone(pending.candidate),
            history: clone(history)
          };
          await send(event.chatId, reply, replaceCallbackCardOptions(event));
          return reply;
        } catch {
          pending.processing = false;
          const reply = { kind: "retry-later", message: "ONU 历史光功率暂时不可用，请稍后重试" };
          await appendAudit(state, event, "denied", { reason: reply.message });
          await send(event.chatId, reply, replaceCallbackCardOptions(event));
          return reply;
        }
      }
      if (pending.type === "pon-detail-sort") {
        if (!PON_SORT_ACTIONS.has(event.binding.action)) {
          return reject(state, event, "invalid-callback", "排序动作不受支持");
        }
        if (!scope.includes(pending.candidate?.oltId)) {
          return reject(state, event, "denied", "候选不属于当前启用的 OLT");
        }
        const sort = event.binding.action === "pon-sort-onu" ? "onu" : "power";
        await appendAudit(state, event, "allowed", {
          queryType: "sort_pon_statuses",
          candidateId: pending.candidate?.candidateId,
          sort
        });
        const reply = detailReply("pon", pending.candidate, pending.detail, {
          chatId: event.chatId,
          sort
        });
        await send(event.chatId, reply);
        return reply;
      }
      if (pending.type === "onu-primary-address-pon") {
        if (event.binding.action !== "onu-primary-address-power") {
          return reject(state, event, "invalid-callback", "一级地址光功率查询操作无效");
        }
        if (!scope.includes(pending.candidate?.oltId)) {
          return reject(state, event, "denied", "候选不属于当前启用的 OLT");
        }
        let detail;
        try {
          detail = await readCandidateDetail("pon", pending.candidate);
        } catch {
          const reply = { kind: "retry-later", message: "一级地址光功率暂时读取失败，请稍后重试" };
          await appendAudit(state, event, "denied", { reason: reply.message });
          await send(event.chatId, reply, replaceCallbackCardOptions(event));
          return reply;
        }
        await appendAudit(state, event, "allowed", {
          queryType: "read_pon_statuses_from_primary_address",
          candidateId: pending.candidate.candidateId
        });
        const reply = detailReply("pon", pending.candidate, detail, { chatId: event.chatId });
        await send(event.chatId, reply, replaceCallbackCardOptions(event));
        return reply;
      }
      if (pending.type === "candidate-set" && event.binding.action === "candidate-page") {
        const pageCount = Math.max(1, Math.ceil(pending.candidates.length / CANDIDATE_PAGE_SIZE));
        const page = event.binding.page;
        if (!Number.isInteger(page) || page < 1 || page > pageCount) {
          return reject(state, event, "invalid-callback", "候选分页已失效，请重新发起查询");
        }
        await appendAudit(state, event, "allowed", {
          queryType: "candidate_page",
          page,
          pageCount
        });
        const reply = candidateSetReply(pending, page);
        await send(event.chatId, reply);
        return reply;
      }
      const candidateIndex = event.binding.index;
      if (pending.usedIndexes?.has(candidateIndex)) {
        return reject(state, event, "duplicate-callback", "该候选已处理，请重新发起查询");
      }
      if (pending.processingIndexes?.has(candidateIndex)) {
        return reject(state, event, "duplicate-callback", "该候选正在处理，请稍候");
      }

      const candidate = pending.candidates[candidateIndex];
      if (!candidate || !scope.includes(candidate.oltId)) {
        return reject(state, event, "denied", "候选不属于当前启用的 OLT");
      }

      pending.processingIndexes ??= new Set();
      pending.usedIndexes ??= new Set();
      pending.processingIndexes.add(candidateIndex);
      let detail;
      try {
        detail = await readCandidateDetail(pending.queryKind, candidate);
      } catch (detailError) {
        if (pending.queryKind === "onu") {
          const reply = await degradedOnuDetailReply(candidate, detailError, event.chatId);
          reply.interpretationSource = clone(pending.interpretationSource || { type: "rule" });
          pending.usedIndexes.add(candidateIndex);
          pending.processingIndexes.delete(candidateIndex);
          await appendAudit(state, event, "allowed", {
            queryType: "read_onu_detail_snapshot",
            candidateId: candidate.candidateId
          });
          await send(event.chatId, reply);
          return reply;
        }
        pending.processingIndexes.delete(candidateIndex);
        return reject(state, event, "retry-later", "只读详情服务暂不可用");
      }
      pending.usedIndexes.add(candidateIndex);
      pending.processingIndexes.delete(candidateIndex);
      await appendAudit(state, event, "allowed", {
        queryType: pending.queryKind === "onu" ? "read_onu_detail" : "read_pon_statuses",
        candidateId: candidate.candidateId
      });
      const reply = detailReply(pending.queryKind, candidate, detail, {
        chatId: event.chatId,
        interpretationSource: pending.interpretationSource || { type: "rule" }
      });
      await send(event.chatId, reply);
      return reply;
    }
  };

  function phraseRegex(template) {
    const parts = String(template).split("{value}");
    if (parts.length !== 2) return null;
    const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`^${escape(parts[0])}(.{1,32}?)${escape(parts[1])}$`, "u");
  }

  async function matchLearnedPhrase(text) {
    if (typeof queryLearning?.activePhraseRules !== "function") return null;
    try {
      const normalized = String(text || "").trim();
      for (const rule of await queryLearning.activePhraseRules() ?? []) {
        if (!ALLOWED_INTENTS.includes(rule?.intent)) continue;
        const match = phraseRegex(rule.template)?.exec(normalized);
        const value = match?.[1]?.trim();
        if (value) return { intent: rule.intent, value };
      }
    } catch {
      return null;
    }
    return null;
  }

  // 按已生效的别名改写提问（例如常见错字村名），在任何规则匹配之前进行。
  async function applyAliases(event) {
    if (typeof queryLearning?.activeAliases !== "function") return event;
    try {
      let text = event.text;
      for (const alias of await queryLearning.activeAliases() ?? []) {
        if (alias?.from && alias?.to && text.includes(alias.from) && !text.includes(alias.to)) text = text.split(alias.from).join(alias.to);
      }
      if (text !== event.text) noteEvent(event, { rewrittenText: text });
      return text === event.text ? event : { ...event, text };
    } catch {
      return event;
    }
  }

  /** 机器人菜单：按菜单项发对应的说明卡片到用户单聊。 */
  application.handleMenu = async (event) => {
    if (!event || typeof event.openId !== "string" || !event.openId || typeof event.eventKey !== "string") {
      throw new TypeError("Invalid Feishu menu event.");
    }
    if (event.eventId && seenEvents.has(event.eventId)) return { duplicate: true };
    if (event.eventId) seenEvents.add(event.eventId);
    const state = await readState();
    if (!state.enabled) return { ignored: true };
    // 菜单“今天新装”（事件 ID：recent-installs）：列出今天的装机工单，发到用户单聊。
    if (event.eventKey === RECENT_INSTALL_MENU_KEY && typeof recentInstalls?.listToday === "function") {
      const menuEvent = { ...event, chatId: event.openId, kind: "direct" };
      const reply = await logScope.run({ chatId: event.openId, replies: [] }, () => listRecentInstalls(state, menuEvent, { receiveIdType: "open_id" }));
      if (typeof queryLearning?.record === "function") {
        void Promise.resolve().then(() => queryLearning.record({
          occurredAt: now(), openId: event.openId, chatId: event.openId, chatType: "direct",
          text: "菜单：今天新装", replyKind: reply?.kind || "", queryType: "recent_install_list", decision: "allowed", durationMs: 0
        })).catch(() => {});
      }
      return reply;
    }
    // 菜单“定额模式”（事件 ID：quota-mode）：进入定额模式，卡片发到用户单聊。
    if (event.eventKey === QUOTA_MENU_KEY && quotaMode) {
      const menuEvent = { ...event, chatId: event.openId, kind: "direct" };
      const reply = await logScope.run({ chatId: event.openId, replies: [] }, () => quotaMode.enter(menuEvent, { receiveIdType: "open_id" }));
      await appendAudit(state, menuEvent, "allowed", { queryType: "quota" });
      return reply;
    }
    const topic = FEISHU_MENU_TOPICS[event.eventKey];
    if (!topic) return { ignored: true };
    const content = FEISHU_HELP_TOPICS[topic];
    const reply = { kind: "help", topic, title: content.title, template: content.template, sections: content.sections, footer: content.footer, message: feishuHelpText(topic) };
    await appendAudit(state, { ...event, chatId: event.openId }, "allowed", { queryType: "menu", topic });
    await send(event.openId, reply, { receiveIdType: "open_id" });
    if (typeof queryLearning?.record === "function") {
      void Promise.resolve().then(() => queryLearning.record({
        occurredAt: now(), openId: event.openId, chatId: event.openId, chatType: "direct",
        text: `菜单：${content.title}`, replyKind: "help", replyTopic: topic, queryType: "menu", decision: "allowed", durationMs: 0
      })).catch(() => {});
    }
    return reply;
  };

  function writeConversationLog(entry) {
    if (typeof conversationLog !== "function") return;
    void Promise.resolve().then(() => conversationLog(entry)).catch(() => {});
  }

  function repliesText(replies) {
    return replies.map((item, index) => `【回复 ${index + 1}${item.kind ? ` · ${item.kind}` : ""}${item.replace ? " · 替换原卡片" : ""}${item.to ? ` · 发往${item.to}` : ""}】\n${item.text}`).join("\n\n");
  }

  const handleCallbackInner = application.handleCallback;
  application.handleCallback = async (event) => {
    const startedAt = Date.now();
    const scope = { chatId: event?.chatId, replies: [] };
    let result;
    let failed = null;
    try {
      result = await logScope.run(scope, () => handleCallbackInner(event));
      return result;
    } catch (error) {
      failed = error;
      throw error;
    } finally {
      if (!result?.duplicate && event?.binding) {
        const form = event.formValue && Object.keys(event.formValue).length ? ` 表单：${JSON.stringify(event.formValue)}` : "";
        writeConversationLog({
          occurredAt: now(), channel: "feishu-callback", requestId: `feishu:${event.eventId || ""}`,
          openId: event.openId, userName: String(event.senderName || ""), chatId: event.chatId,
          input: `按钮：${event.binding.action || "选择候选"}${Number.isInteger(event.binding.index) ? ` #${event.binding.index}` : ""}${Number.isInteger(event.binding.page) ? ` 第 ${event.binding.page} 页` : ""}${form}`,
          replyKind: failed ? "error" : String(result?.kind || ""),
          replyText: repliesText(scope.replies) || (result ? replyLogText(result) : ""),
          error: failed ? String(failed?.message || failed) : "",
          durationMs: Date.now() - startedAt
        });
      }
    }
  };

  const handleMessageInner = application.handleMessage;
  application.handleMessage = async (event) => {
    const startedAt = Date.now();
    let result;
    let failed = null;
    const owned = validEvent(event) && !eventMeta.has(event.eventId);
    if (owned) eventMeta.set(event.eventId, {});
    const scope = { chatId: event?.chatId, replies: [] };
    try {
      result = await logScope.run(scope, async () => handleMessageInner(validEvent(event) ? await applyAliases(event) : event));
      return result;
    } catch (error) {
      failed = error;
      throw error;
    } finally {
      const meta = owned ? eventMeta.get(event.eventId) || {} : {};
      if (owned && !result?.duplicate && !result?.ignored) {
        writeConversationLog({
          occurredAt: now(), channel: "feishu", requestId: `feishu:${event.eventId}`,
          openId: event.openId, userName: String(event.senderName || ""), chatId: event.chatId,
          chatType: event.kind === "group" ? `group${event.chatName ? `:${event.chatName}` : ""}` : "direct",
          input: event.text,
          interpretation: [
            meta.rewrittenText ? `别名改写为：${meta.rewrittenText}` : "",
            meta.intent ? `识别：${meta.intent}=${meta.value || ""}（${meta.source || "本地规则"}）` : "",
            meta.queryType ? `查询类型：${meta.queryType}` : "",
            Number.isFinite(meta.resultCount) ? `结果数：${meta.resultCount}` : ""
          ].filter(Boolean).join("；"),
          replyKind: failed ? "error" : String(result?.kind || ""),
          replyText: repliesText(scope.replies) || (result ? replyLogText(result) : ""),
          source: meta.source || "",
          error: failed ? String(failed?.message || failed) : "",
          durationMs: Date.now() - startedAt
        });
      }
      if (owned) eventMeta.delete(event.eventId);
      if (owned && typeof queryLearning?.record === "function" && !result?.duplicate && !result?.ignored) {
        const entry = {
          occurredAt: now(),
          openId: event.openId,
          userName: String(event.senderName || ""),
          chatId: event.chatId,
          chatType: event.kind === "group" ? "group" : "direct",
          chatName: String(event.chatName || ""),
          text: event.text,
          rewrittenText: meta.rewrittenText || "",
          replyKind: failed ? "error" : String(result?.kind || ""),
          replyTopic: String(result?.topic || ""),
          queryType: meta.queryType || "",
          resultCount: Number.isFinite(meta.resultCount) ? meta.resultCount : null,
          decision: failed ? "error" : meta.decision || "",
          intent: meta.intent || "",
          value: meta.value || "",
          source: meta.source || "",
          durationMs: Date.now() - startedAt
        };
        void Promise.resolve().then(() => queryLearning.record(entry)).catch(() => {});
      }
    }
  };

  return Object.freeze(application);
}
