import { randomBytes } from "node:crypto";
import { normalizeFeishuState } from "./state.mjs";
import { clone as cloneJson } from "./clone.mjs";
import {
  LANGUAGE_INTERPRETATION_CONTRACT_VERSION,
  SYNTHETIC_DATASET_ATTESTATION_REQUIRED,
  FEISHU_HELP_MESSAGE,
  isFeishuHelpRequest
} from "./language-interpretation.mjs";

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

function localVillagePonValue(text) {
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

export function createFeishuQueryApplication({
  stateStore,
  gateway,
  interpret,
  piAgentEngine = null,
  send = async () => {},
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

  async function appendAudit(state, event, decision, extra) {
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

  async function sendHelp(state, event) {
    const reply = { kind: "help", message: FEISHU_HELP_MESSAGE };
    await appendAudit(state, event, "allowed", { queryType: "help" });
    await send(event.chatId, reply);
    return reply;
  }

  async function sendVillageNoMatch(state, event, value) {
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

  async function queryVillagePons(value, oltIds, offset = 0) {
    if (typeof gateway.queryVillagePons !== "function") {
      throw new Error("Village PON query unavailable");
    }
    return gateway.queryVillagePons({
      value,
      oltIds,
      offset,
      limit: CANDIDATE_PAGE_SIZE
    });
  }

  async function readVillagePonComparison(pending, candidate) {
    if (typeof gateway.sampleVillagePonOnlineUser !== "function") {
      throw new Error("Village PON sample unavailable");
    }
    const excludedOnuIds = [];
    const triedOnuIds = new Set();
    let lastUsable = null;
    let lastPonStatus = null;
    const lastUsableResult = () => {
      if (!lastUsable) return null;
      return {
        ...lastUsable,
        message: lastUsable.status === "no-history"
          ? "已尝试同一 PON 口的其它在线用户，但均没有可用历史 ONU RX；当前实时光功率仍可单独参考。"
          : lastUsable.message
      };
    };
    for (let attempt = 0; attempt < MAX_VILLAGE_SAMPLE_ATTEMPTS; attempt += 1) {
      const sample = await gateway.sampleVillagePonOnlineUser({
        value: pending.queryValue,
        oltIds: pending.oltIds,
        oltId: candidate.oltId,
        pon: clone(candidate.pon),
        ...(excludedOnuIds.length > 0 ? { excludeOnuIds: [...excludedOnuIds] } : {})
      });
      lastPonStatus = sample?.ponStatus ? clone(sample.ponStatus) : lastPonStatus;
      if (sample?.ponStatus?.status === "all-offline") {
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
      if (["state-incomplete", "no-configured-data"].includes(sample?.ponStatus?.status)) {
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
      if (!sample?.candidate || !sample?.liveStatus) {
        return lastUsableResult() || {
          status: "no-online",
          sample: null,
          comparison: null,
          ponStatus: lastPonStatus,
          message: "该 PON 当前没有可抽样的在线村级用户。"
        };
      }
      const onuId = String(sample.candidate.onu?.onuId || "");
      if (!onuId || triedOnuIds.has(onuId)) return lastUsableResult() || {
        status: "no-online",
        sample: null,
        comparison: null,
        ponStatus: lastPonStatus,
        message: "该 PON 当前没有可抽样的其它在线用户。"
      };
      triedOnuIds.add(onuId);
      excludedOnuIds.push(onuId);

      let history;
      if (typeof gateway.readOnuHistoricalOptical === "function") {
        const observed = Date.parse(sample.liveStatus.observedAt || now());
        const end = new Date(Number.isFinite(observed) ? observed : Date.now());
        const start = new Date(end.getTime() - (6 * 24 * 60 * 60 * 1000));
        try {
          history = await gateway.readOnuHistoricalOptical({
            oltId: sample.candidate.oltId,
            coordinate: clone(sample.candidate.onu),
            startDate: start.toISOString().slice(0, 10),
            endDate: end.toISOString().slice(0, 10),
            limit: 48
          });
        } catch (remoteError) {
          if (typeof gateway.readOnuHistory !== "function") throw remoteError;
          history = await gateway.readOnuHistory({
            oltId: sample.candidate.oltId,
            coordinate: clone(sample.candidate.onu),
            days: 7,
            limit: 48
          });
        }
      } else if (typeof gateway.readOnuHistory === "function") {
        history = await gateway.readOnuHistory({
          oltId: sample.candidate.oltId,
          coordinate: clone(sample.candidate.onu),
          days: 7,
          limit: 48
        });
      } else {
        history = { rows: [] };
      }
      const comparison = opticalComparison(sample, history);
      const result = {
        status: comparison.current === null
          ? "no-current"
          : comparison.historical === null ? "no-history" : "complete",
        sample: clone(sample),
        history: clone(history),
        comparison,
        ponStatus: lastPonStatus,
        message: comparison.current === null
          ? "当前 ONU RX 光功率不可用，无法完成对比。"
          : comparison.historical === null
            ? "该在线样本没有历史 ONU RX 光功率记录，正在尝试同一 PON 口的其它在线用户。"
            : ""
      };
      if (result.status === "complete") return result;
      if (comparison.current !== null || comparison.historical !== null) {
        const previousHasCurrent = Number.isFinite(lastUsable?.comparison?.current);
        const currentIsBetter = Number.isFinite(comparison.current) && !previousHasCurrent;
        if (!lastUsable || currentIsBetter ||
            (Number.isFinite(comparison.current) && previousHasCurrent)) {
          lastUsable = result;
        }
      }
    }
    return lastUsableResult() || {
      status: "no-online",
      sample: null,
      comparison: null,
      ponStatus: lastPonStatus,
      message: "该 PON 当前没有可抽样的其它在线用户。"
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

  function villageSummaryReply(pending, page = 1) {
    const findings = pending.findings ?? [];
    const pageCount = Math.max(1, Math.ceil(findings.length / CANDIDATE_PAGE_SIZE));
    const currentPage = Math.min(Math.max(1, page), pageCount);
    return {
      kind: "village-pon-summary",
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
      findings: clone(findings.slice((currentPage - 1) * CANDIDATE_PAGE_SIZE,
        currentPage * CANDIDATE_PAGE_SIZE)),
      page: currentPage,
      pageSize: CANDIDATE_PAGE_SIZE,
      pageCount,
      selection: { token: pending.token, expiresAt: pending.expiresAt }
    };
  }

  async function processVillageSummary({ event, state, pending, firstResult }) {
    try {
      let result = firstResult;
      let offset = 0;
      const findings = [];
      const validSamples = [];
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
            const historicalVal = comparison?.historical;
            const hasCurrent = Number.isFinite(currentVal);
            const hasHistory = Number.isFinite(historicalVal);
            const diff = hasCurrent && hasHistory ? comparison.rawDifference : null;

            const complete = sampling.status === "complete" &&
              hasCurrent && hasHistory &&
              Number.isFinite(comparison?.difference) && Number.isFinite(comparison?.rawDifference);

            if (hasCurrent) {
              validSamples.push({
                candidate: clone(candidate),
                sample: clone(sampling.sample),
                current: currentVal,
                historical: historicalVal,
                diff: diff
              });
            }

            // 判定是否正常：
            // 1. 若历史对比完整：波动在 1.0 dB 以内算正常（符合旧规范与回归测试）
            // 2. 若无历史对比（如新装用户或未入库），但当前读到了实时光功率且在合格门限内（>-27.0 dBm），同样判定为正常！
            const isNoHistoryNormal = sampling.status === "no-history" && hasCurrent && currentVal >= -27.0;
            const normal = (complete && Math.abs(comparison.rawDifference) < 1) || isNoHistoryNormal;

            return normal ? null : {
              candidate: clone(candidate),
              sampling: clone(sampling),
              classification: (complete || hasCurrent) ? "abnormal" : "incomplete"
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
          result = await queryVillagePons(pending.queryValue, pending.oltIds, offset);
        }
      }
      pending.findings = findings;
      pending.expiresAt = new Date(Date.parse(now()) + CANDIDATE_TTL_MS).toISOString();
      pending.abnormalCount = findings.filter((item) => item.classification === "abnormal").length;
      pending.incompleteCount = findings.filter((item) => item.classification === "incomplete").length;
      pending.outageCount = findings.filter((item) => item.classification === "outage").length;
      pending.normal = pending.total > 0 && findings.length === 0;

      // 提取真正抢修导致光衰突增恶化的样本（diff <= -2.0 dB，即损耗增加 2dB 以上）
      const degradedSamples = validSamples.filter((s) => Number.isFinite(s.diff) && s.diff <= -2.0)
        .sort((a, b) => a.diff - b.diff);
      pending.degradedSamples = degradedSamples;

      // 仅当确实存在抢修导致的光衰突增劣化时，才展示预警样本；全村正常时不展示常年老弱光，避免误导现场！
      if (degradedSamples.length > 0) {
        pending.topWorstSamples = degradedSamples.slice(0, 3);
      } else {
        pending.topWorstSamples = [];
      }

      // 抢修后熔接质量现场定界判定
      if (pending.outageCount > 0) {
        pending.repairVerdict = "outage";
        pending.repairVerdictText = `🔴 检测到 ${pending.outageCount} 个 PON 口全部用户离线，按整口断纤风险处理；请优先检查主干光缆、分光器、上联端口及 OLT 端口告警。`;
        pending.message = "";
      } else if (pending.normal) {
        pending.repairVerdict = "pass";
        pending.repairVerdictText = "🟢 主干熔接质量优秀！全村各 PON 口抽测光衰均保持平稳（未检测到抢修后光衰突变恶化），主干接头盒可放心封盒收工！";
        pending.message = "🎉 恭喜你，所有 PON 都正常！";
      } else if (degradedSamples.length > 0) {
        pending.repairVerdict = "warning";
        const worst = degradedSamples[0];
        const addrText = worst.candidate?.address ? `【${worst.candidate.address}】` : `PON ${worst.candidate?.pon?.chassis}/${worst.candidate?.pon?.board}/${worst.candidate?.pon?.pon}`;
        pending.repairVerdictText = `🔴 警告：检测到个别 PON 口 ${addrText} 抢修后光衰出现明显突增恶化（损耗增加 ${Math.abs(worst.diff).toFixed(2)} dB）！判定为主干接头盒对应纤芯熔接不良，请勿急于封盒，立即开盒检查重熔该芯！`;
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
        pending.repairVerdictText = `🟡 抽样光功率对比未完成：${reasons.join("；")}。这不等同于无在线 ONU 或整口断纤；只有设备确认该口全部已配置 ONU 离线时，才单独标记为整口断纤风险。`;
        pending.message = "";
      } else {
        pending.repairVerdict = "isolated";
        pending.repairVerdictText = "🟡 主干光缆熔接整体正常，未发现主干群障，仅个别历史老弱光用户维持原状，无需重熔主干接头盒。";
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

  async function villageSummaryStart({ event, state, value, scope, result }) {
    prunePendingCandidateSets();
    const token = randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.parse(now()) + CANDIDATE_TTL_MS).toISOString();
    const pending = {
      type: "village-pon-summary",
      token,
      chatId: event.chatId,
      queryValue: value,
      oltIds: [...scope],
      total: Number(result.total ?? result.authorizedCount ?? 0),
      findings: [],
      expiresAt,
      completed: false
    };
    pendingBindings.set(token, pending);
    await appendAudit(state, event, "allowed", {
      queryType: "find_pons_by_village",
      resultCount: pending.total
    });
    await send(event.chatId, {
      kind: "village-pon-summary-loading",
      village: value,
      total: pending.total,
      message: `正在查询${value}的全部 PON 口，并按每页 5 口读取抽样光功率。`
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
      message: `正在查询${value}的全部 PON 口，并按每页 5 口读取抽样光功率。`,
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
        selection: { token: pending.token, expiresAt: pending.expiresAt }
      };
    }
    const pageCount = Math.max(1, Math.ceil(pending.candidates.length / CANDIDATE_PAGE_SIZE));
    return {
      kind: pending.queryKind === "pon" ? "pon-candidate-set" : "candidate-set",
      authorizedCount: pending.authorizedCount,
      candidates: clone(pending.candidates),
      page: Math.min(Math.max(1, page), pageCount),
      pageSize: CANDIDATE_PAGE_SIZE,
      selection: { token: pending.token, expiresAt: pending.expiresAt }
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
      const reply = { kind: "onu-detail", candidate: clone(candidate), detail: clone(detail) };
      if (options.chatId) {
        const copyLoidQuery = createOnuActionBinding("onu-copy-loid", options.chatId, candidate);
        if (copyLoidQuery) reply.copyLoidQuery = copyLoidQuery;
        const historyQuery = createOnuActionBinding("onu-history", options.chatId, candidate);
        if (historyQuery) reply.historyQuery = historyQuery;
        const primaryAddressQuery = createOnuPrimaryAddressBinding(options.chatId, candidate, detail);
        if (primaryAddressQuery) reply.primaryAddressQuery = primaryAddressQuery;
      }
      return reply;
    }
    const reply = { kind: "pon-detail", candidate: clone(candidate), detail: clone(detail) };
    if (options.chatId) {
      reply.sorting = createPonSortBinding(options.chatId, candidate, detail, options.sort ?? "power");
    } else if (options.sort) {
      reply.sorting = { current: options.sort };
    }
    return reply;
  }

  return Object.freeze({
    async handleMessage(event) {
      if (!validEvent(event)) throw new TypeError("Invalid Feishu message event.");
      if (seenEvents.has(event.eventId)) return { duplicate: true };
      seenEvents.add(event.eventId);
      const state = await readState();
      if (!state.enabled) return reject(state, event, "disabled", "Feishu 查询子系统未启用");
      if (event.kind === "group") return reject(state, event, "denied", "当前仅支持飞书单聊，不支持群聊查询");
      if (!rateAllowed(event)) return reject(state, event, "rate-limited", "请求过于频繁，请稍后重试");

      if (isFeishuHelpRequest(event.text)) {
        return sendHelp(state, event);
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
        const reply = detailReply("pon", candidate, detail, { chatId: event.chatId });
        await send(event.chatId, reply);
        return reply;
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
        return villageSummaryStart({
          event,
          state,
          value: localVillage,
          scope,
          result: villageResult
        });
      }

      let interpreted;
      let useSearchOrder = false;
      const explicitLoid = localExplicitLoidQuery(event.text);
      if (explicitLoid.explicit) {
        if (!explicitLoid.value) return sendLoidNoMatch(state, event, "");
        interpreted = {
          type: "query",
          version: LANGUAGE_CONTRACT_VERSION,
          intent: "find_by_loid",
          value: explicitLoid.value
        };
      } else {
        try {
          interpreted = await interpret({
            contractVersion: LANGUAGE_CONTRACT_VERSION,
            currentText: event.text,
            allowedIntents: [...ALLOWED_INTENTS]
          });
        } catch (error) {
          if (error?.code === SYNTHETIC_DATASET_ATTESTATION_REQUIRED) {
            return reject(state, event, "attestation-required", "Synthetic Dataset Attestation 尚未确认");
          }
          useSearchOrder = true;
        }
      }
      if (interpreted?.type === "clarification" && interpreted.version === LANGUAGE_CONTRACT_VERSION) {
        useSearchOrder = true;
      }
      if (!useSearchOrder && !validQuery(interpreted)) useSearchOrder = true;

      let result;
      let resolvedIntent = interpreted?.intent || "";
      try {
        if (useSearchOrder) {
          const ordered = await queryBySearchOrder(event.text, scope);
          result = ordered.result;
          resolvedIntent = ordered.intent;
        } else if (interpreted.intent === "find_by_device_number") {
          if (typeof gateway.queryUsersByDeviceNumber !== "function") {
            useSearchOrder = true;
            const ordered = await queryBySearchOrder(event.text, scope);
            result = ordered.result;
            resolvedIntent = ordered.intent;
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
      } catch {
        return reject(state, event, "retry-later", "查询暂时失败，请稍后重试");
      }
      if (!result) return reject(state, event, "rejected-intent", "该查询类型尚未接入只读数据服务");
      if (resolvedIntent === "find_by_loid" && result.authorizedCount === 0 && !useSearchOrder) {
        return sendLoidNoMatch(state, event, interpreted.value);
      }
      if (resolvedIntent === "find_pons_by_village") {
        if (Number(result.total ?? result.authorizedCount ?? 0) === 0) {
          return sendVillageNoMatch(state, event, interpreted.value);
        }
        return villageSummaryStart({
          event,
          state,
          value: interpreted.value,
          scope,
          result
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
          }
        } catch {
          return reject(state, event, "retry-later", "查询暂时失败，请稍后重试");
        }
      }
      if (result.authorizedCount === 0) {
        if (piAgentEngine && typeof piAgentEngine.chat === "function" && !isFeishuHelpRequest(event.text)) {
          try {
            const answer = await piAgentEngine.chat({
              messages: [{ role: "user", content: event.text }],
              context: {
                piSdk: true,
                readonlyScope: { oltIds: [...scope] }
              }
            });
            if (answer && answer.reply) {
              const reply = { kind: "pi-agent-answer", message: answer.reply };
              await appendAudit(state, event, "allowed", { queryType: "pi_agent_answer" });
              await send(event.chatId, reply);
              return reply;
            }
          } catch {
            // 发生异常时优雅回退到帮助卡片
          }
        }
        return sendHelp(state, event);
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
            await send(event.chatId, reply);
            return reply;
          }
          return reject(state, event, "retry-later", "只读详情服务暂不可用");
        }
        const reply = detailReply(queryKind, candidates[0], detail, { chatId: event.chatId });
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
              processingIndexes: new Set()
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

      if (pending.type === "village-pon-summary") {
        if (event.binding.action !== "village-pon-summary-page" || !pending.completed) {
          return reject(state, event, "invalid-callback", "村级 PON 汇总分页尚未就绪或已失效");
        }
        const page = event.binding.page;
        const pageCount = Math.max(1, Math.ceil((pending.findings?.length || 0) / CANDIDATE_PAGE_SIZE));
        if (!Number.isInteger(page) || page < 1 || page > pageCount) {
          return reject(state, event, "invalid-callback", "村级 PON 汇总分页已失效，请重新发起查询");
        }
        const reply = villageSummaryReply(pending, page);
        await send(event.chatId, reply);
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
      const reply = detailReply(pending.queryKind, candidate, detail, { chatId: event.chatId });
      await send(event.chatId, reply);
      return reply;
    }
  });
}
