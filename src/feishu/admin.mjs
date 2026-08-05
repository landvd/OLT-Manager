import { normalizeFeishuState } from "./state.mjs";
import { clone as cloneJson } from "./clone.mjs";

function requiredText(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new TypeError(`${label} is required.`);
  return normalized;
}

function clone(value) {
  return cloneJson(value);
}

function publicState(state) {
  return {
    operators: clone(state.operators),
    authorizedChats: clone(state.authorizedChats),
    accessRequests: clone(state.accessRequests),
    auditArchive: clone(state.auditArchive)
  };
}

export function createFeishuAdminService({ stateStore, gateway, now = () => new Date().toISOString() }) {
  if (!stateStore || typeof stateStore.read !== "function" || typeof stateStore.write !== "function") {
    throw new TypeError("Feishu admin requires an encrypted stateStore.");
  }
  if (!gateway || typeof gateway.listOlts !== "function") {
    throw new TypeError("Feishu admin requires an OltDataGateway.");
  }

  async function readState() {
    return normalizeFeishuState(await stateStore.read());
  }

  async function validOltIds(oltIds) {
    if (!Array.isArray(oltIds)) throw new TypeError("OLT Scope must be an array.");
    const active = new Set((await gateway.listOlts()).map((olt) => olt.oltId));
    const normalized = [...new Set(oltIds.map((oltId) => requiredText(oltId, "OLT Scope")))];
    if (normalized.some((oltId) => !active.has(oltId))) throw new Error("OLT Scope contains an unknown OLT.");
    return normalized;
  }

  async function update(mutator, operation, details = {}) {
    const state = await readState();
    const next = mutator(state);
    next.auditArchive = [
      ...next.auditArchive,
      {
        occurredAt: now(),
        eventType: "admin",
        actor: "desktop-admin",
        operation,
        decision: "allowed",
        ...details
      }
    ].slice(-1000);
    const normalized = normalizeFeishuState(next);
    await stateStore.write(normalized);
    return publicState(normalized);
  }

  function replaceBy(items, key, value, nextValue) {
    const index = items.findIndex((item) => item[key] === value);
    if (index < 0) return [...items, nextValue];
    const next = [...items];
    next[index] = nextValue;
    return next;
  }

  return Object.freeze({
    async read() {
      return publicState(await readState());
    },

    async saveOperator({ openId, remark = "", oltIds = [], enabled = true } = {}) {
      const normalizedOpenId = requiredText(openId, "Operator openId");
      const normalizedOltIds = await validOltIds(oltIds);
      return update((state) => ({
        ...state,
        operators: replaceBy(state.operators, "openId", normalizedOpenId, {
          openId: normalizedOpenId, remark: String(remark ?? ""), oltIds: normalizedOltIds, enabled: enabled !== false
        })
      }), "operator.save", { openId: normalizedOpenId });
    },

    async removeOperator(openId) {
      const normalizedOpenId = requiredText(openId, "Operator openId");
      return update((state) => ({
        ...state,
        operators: state.operators.filter((operator) => operator.openId !== normalizedOpenId)
      }), "operator.remove", { openId: normalizedOpenId });
    },

    async setOperatorEnabled({ openId, enabled } = {}) {
      const normalizedOpenId = requiredText(openId, "Operator openId");
      return update((state) => ({
        ...state,
        operators: state.operators.map((operator) => operator.openId === normalizedOpenId
          ? { ...operator, enabled: enabled === true }
          : operator)
      }), "operator.enable", { openId: normalizedOpenId, enabled: enabled === true });
    },

    async saveAuthorizedChat({ chatId, type = "direct", remark = "", enabled = true } = {}) {
      const normalizedChatId = requiredText(chatId, "Authorized chatId");
      const normalizedType = type === "group" ? "group" : "direct";
      return update((state) => ({
        ...state,
        authorizedChats: replaceBy(state.authorizedChats, "chatId", normalizedChatId, {
          chatId: normalizedChatId, type: normalizedType, remark: String(remark ?? ""), enabled: enabled !== false
        })
      }), "chat.save", { chatId: normalizedChatId, type: normalizedType });
    },

    async removeAuthorizedChat(chatId) {
      const normalizedChatId = requiredText(chatId, "Authorized chatId");
      return update((state) => ({
        ...state,
        authorizedChats: state.authorizedChats.filter((chat) => chat.chatId !== normalizedChatId)
      }), "chat.remove", { chatId: normalizedChatId });
    },

    async setAuthorizedChatEnabled({ chatId, enabled } = {}) {
      const normalizedChatId = requiredText(chatId, "Authorized chatId");
      return update((state) => ({
        ...state,
        authorizedChats: state.authorizedChats.map((chat) => chat.chatId === normalizedChatId
          ? { ...chat, enabled: enabled === true }
          : chat)
      }), "chat.enable", { chatId: normalizedChatId, enabled: enabled === true });
    },

    async approveAccessRequest({ requestId, oltIds = [], remark = "" } = {}) {
      const normalizedRequestId = requiredText(requestId, "Access requestId");
      const normalizedOltIds = await validOltIds(oltIds);
      return update((state) => {
        const request = state.accessRequests.find((item) => item.requestId === normalizedRequestId);
        if (!request) throw new Error("Access request not found.");
        if (request.status !== "pending") throw new Error("Only pending access requests can be approved.");
        return {
          ...state,
          operators: replaceBy(state.operators, "openId", request.openId, {
            openId: request.openId, remark: String(remark ?? ""), oltIds: normalizedOltIds, enabled: true
          }),
          authorizedChats: replaceBy(state.authorizedChats, "chatId", request.chatId, {
            chatId: request.chatId, type: "direct", remark: "访问申请批准", enabled: true
          }),
          accessRequests: state.accessRequests.map((item) => item.requestId === normalizedRequestId
            ? { ...item, status: "approved" }
            : item)
        };
      }, "access-request.approve", { requestId: normalizedRequestId });
    },

    async rejectAccessRequest(requestId) {
      const normalizedRequestId = requiredText(requestId, "Access requestId");
      return update((state) => ({
        ...state,
        accessRequests: state.accessRequests.map((item) => item.requestId === normalizedRequestId
          ? { ...item, status: "rejected" }
          : item)
      }), "access-request.reject", { requestId: normalizedRequestId });
    },

    async expireAccessRequest(requestId) {
      const normalizedRequestId = requiredText(requestId, "Access requestId");
      return update((state) => ({
        ...state,
        accessRequests: state.accessRequests.map((item) => item.requestId === normalizedRequestId
          ? { ...item, status: "expired" }
          : item)
      }), "access-request.expire", { requestId: normalizedRequestId });
    }
  });
}
