import { randomBytes } from "node:crypto";
import { normalizeFeishuState } from "./state.mjs";
import { clone as cloneJson } from "./clone.mjs";
import {
  LANGUAGE_INTERPRETATION_CONTRACT_VERSION,
  SYNTHETIC_DATASET_ATTESTATION_REQUIRED
} from "./language-interpretation.mjs";

export const LANGUAGE_CONTRACT_VERSION = LANGUAGE_INTERPRETATION_CONTRACT_VERSION;
export const ALLOWED_INTENTS = Object.freeze([
  "find_by_name",
  "find_by_phone",
  "find_by_address",
  "find_by_sn",
  "find_by_loid",
  "find_by_mac",
  "find_by_onu_coordinate",
  "find_pon_by_address",
  "read_live_status"
]);

const CANDIDATE_TTL_MS = 5 * 60 * 1000;
const CANDIDATE_MAX = 100;
const CANDIDATE_PAGE_SIZE = 5;
const PON_SORT_ACTIONS = new Set(["pon-sort-power", "pon-sort-onu"]);

const USER_INTENTS = new Set([
  "find_by_name",
  "find_by_phone",
  "find_by_address",
  "find_by_sn",
  "find_by_loid",
  "find_by_mac",
  "find_by_onu_coordinate"
]);

const PON_FALLBACK_INTENTS = new Set(["find_by_name", "find_by_address"]);

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

export function createFeishuQueryApplication({
  stateStore,
  gateway,
  interpret,
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
        ...candidate,
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

  async function reject(state, event, kind, reason, extra = {}) {
    await appendAudit(state, event, "denied", { reason, ...extra });
    const reply = { kind, message: reason };
    await send(event.chatId, reply);
    return reply;
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

      let interpreted;
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
        return reject(state, event, "retry-later", "语言服务暂不可用");
      }
      if (interpreted?.type === "clarification" && interpreted.version === LANGUAGE_CONTRACT_VERSION) {
        const reply = { kind: "clarification", message: String(interpreted.question || "请补充查询条件") };
        await send(event.chatId, reply);
        return reply;
      }
      if (!validQuery(interpreted)) {
        return reject(state, event, "rejected-intent", "无法将请求转换为受支持的查询");
      }

      let result;
      let resolvedIntent = interpreted.intent;
      try {
        result = USER_INTENTS.has(interpreted.intent)
          ? await gateway.queryUsers({ intent: interpreted.intent, value: interpreted.value, oltIds: scope, limit: CANDIDATE_MAX })
          : interpreted.intent === "find_pon_by_address"
            ? await gateway.queryPons({ value: interpreted.value, oltIds: scope, limit: CANDIDATE_MAX })
            : null;
      } catch {
        return reject(state, event, "retry-later", "查询暂时失败，请稍后重试");
      }
      if (!result) return reject(state, event, "rejected-intent", "该查询类型尚未接入只读数据服务");
      if (result.authorizedCount === 0 && canTryPonAddressFallback(interpreted.intent, interpreted.value)) {
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
      const reply = result.authorizedCount === 0
        ? { kind: "no-match", message: "没有找到匹配项" }
        : (() => {
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

      let olts;
      try {
        olts = await gateway.listOlts();
      } catch {
        return reject(state, event, "retry-later", "只读数据服务暂不可用");
      }
      const activeOltIds = new Set(olts.filter((olt) => olt.enabled).map((olt) => olt.oltId));
      const scope = [...activeOltIds];
      if (scope.length === 0) return reject(state, event, "retry-later", "当前没有启用的 OLT 可供查询");
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
          if (typeof gateway.readOnuHistory !== "function") throw new Error("ONU history unavailable");
          const history = await gateway.readOnuHistory({
            oltId: pending.candidate.oltId,
            coordinate: clone(pending.candidate.onu),
            days: 7,
            limit: 48
          });
          pending.used = true;
          pending.processing = false;
          await appendAudit(state, event, "allowed", {
            queryType: "read_onu_history",
            candidateId: pending.candidate?.candidateId
          });
          const reply = {
            kind: "onu-history",
            candidate: clone(pending.candidate),
            history: clone(history)
          };
          await send(event.chatId, reply);
          return reply;
        } catch {
          pending.processing = false;
          return reject(state, event, "retry-later", "ONU 历史光功率暂时不可用，请稍后重试");
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
          return reject(state, event, "retry-later", "一级地址光功率暂时读取失败，请稍后重试");
        }
        await appendAudit(state, event, "allowed", {
          queryType: "read_pon_statuses_from_primary_address",
          candidateId: pending.candidate.candidateId
        });
        const reply = detailReply("pon", pending.candidate, detail, { chatId: event.chatId });
        await send(event.chatId, reply);
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
