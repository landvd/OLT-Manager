import { normalizeFeishuState } from "./state.mjs";
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

const USER_INTENTS = new Set([
  "find_by_name",
  "find_by_phone",
  "find_by_address",
  "find_by_sn",
  "find_by_loid",
  "find_by_mac",
  "find_by_onu_coordinate"
]);

function clone(value) {
  return structuredClone(value);
}

function auditRecord(event, decision, extra = {}) {
  return {
    occurredAt: new Date().toISOString(),
    eventType: "query",
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

function validQuery(value) {
  if (!value || typeof value !== "object") return false;
  const keys = Object.keys(value).sort();
  return keys.length === 4 &&
    keys.join(",") === "intent,type,value,version" &&
    value.type === "query" && value.version === LANGUAGE_CONTRACT_VERSION &&
    ALLOWED_INTENTS.includes(value.intent) &&
    typeof value.value === "string" && value.value.trim().length > 0;
}

function operatorScope(state, openId, activeOltIds) {
  const operator = state.operators.find((item) => item.openId === openId);
  if (!operator) return null;
  return operator.oltIds.filter((oltId) => activeOltIds.has(oltId));
}

function chatAuthorized(state, chatId) {
  return state.authorizedChats.some((chat) => chat.chatId === chatId);
}

function intersect(scopes) {
  if (scopes.length === 0) return [];
  return scopes.slice(1).reduce(
    (current, scope) => current.filter((oltId) => scope.includes(oltId)),
    [...scopes[0]]
  );
}

export function createFeishuQueryApplication({
  stateStore,
  gateway,
  interpret,
  readGroupMembers = async () => [],
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

  async function effectiveScope(state, event, activeOltIds) {
    if (!chatAuthorized(state, event.chatId)) return null;
    const ownScope = operatorScope(state, event.openId, activeOltIds);
    if (!ownScope) return null;
    const chat = state.authorizedChats.find((item) => item.chatId === event.chatId);
    if (chat?.type !== "group") return ownScope;
    const members = await readGroupMembers(event.chatId);
    if (!Array.isArray(members) || members.length === 0) return null;
    const memberIds = members.map((member) =>
      typeof member === "string" ? member : member?.openId
    );
    const scopes = memberIds.map((openId) => operatorScope(state, openId, activeOltIds));
    if (scopes.some((scope) => !scope)) return null;
    return intersect(scopes);
  }

  async function reject(state, event, kind, reason) {
    await appendAudit(state, event, "denied", { reason });
    const reply = { kind, message: reason };
    await send(event.chatId, reply);
    return reply;
  }

  return Object.freeze({
    async handleMessage(event) {
      if (!validEvent(event)) throw new TypeError("Invalid Feishu message event.");
      if (seenEvents.has(event.eventId)) return { duplicate: true };
      seenEvents.add(event.eventId);
      const state = await readState();
      if (!state.enabled) return reject(state, event, "disabled", "Feishu 查询子系统未启用");
      if (!rateAllowed(event)) return reject(state, event, "rate-limited", "请求过于频繁，请稍后重试");

      let olts;
      try {
        olts = await gateway.listOlts();
      } catch {
        return reject(state, event, "retry-later", "只读数据服务暂不可用");
      }
      const activeOltIds = new Set(olts.filter((olt) => olt.enabled).map((olt) => olt.oltId));
      const scope = await effectiveScope(state, event, activeOltIds);
      if (!scope || scope.length === 0) {
        return reject(state, event, "denied", "当前聊天没有可查询的 OLT 范围");
      }

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
      try {
        result = USER_INTENTS.has(interpreted.intent)
          ? await gateway.queryUsers({ intent: interpreted.intent, value: interpreted.value, oltIds: scope, limit: 10 })
          : interpreted.intent === "find_pon_by_address"
            ? await gateway.queryPons({ value: interpreted.value, oltIds: scope, limit: 10 })
            : null;
      } catch {
        return reject(state, event, "retry-later", "查询暂时失败，请稍后重试");
      }
      if (!result) return reject(state, event, "rejected-intent", "该查询类型尚未接入只读数据服务");
      await appendAudit(state, event, "allowed", {
        queryType: interpreted.intent,
        resultCount: result.authorizedCount
      });
      const reply = result.authorizedCount === 0
        ? { kind: "no-match", message: "没有找到匹配项" }
        : { kind: interpreted.intent === "find_pon_by_address" ? "pon-candidate-set" : "candidate-set",
            authorizedCount: result.authorizedCount, candidates: clone(result.candidates) };
      await send(event.chatId, reply);
      return reply;
    }
  });
}
