export const FEISHU_STATE_FORMAT = "olt-manager/feishu-state/v1";

import { clone } from "./clone.mjs";

const FORBIDDEN_STATE_KEYS = new Set([
  "snapshot", "userSnapshot", "users", "records", "appSecret", "token",
  "modelKey", "apiKey", "password"
]);

function requiredText(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new TypeError(`${label} is required.`);
  return normalized;
}

function uniqueTexts(values, label) {
  if (!Array.isArray(values)) throw new TypeError(`${label} must be an array.`);
  return [...new Set(values.map((value) => requiredText(value, label)))];
}

function rejectForbiddenKeys(value, path = "state") {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_STATE_KEYS.has(key)) {
      throw new TypeError(`${path}.${key} is not allowed in Feishu state.`);
    }
    rejectForbiddenKeys(value[key], `${path}.${key}`);
  }
}

function normalizeOperator(value) {
  if (!value || typeof value !== "object") throw new TypeError("Invalid Feishu operator.");
  return {
    openId: requiredText(value.openId, "Operator openId"),
    remark: String(value.remark ?? ""),
    oltIds: uniqueTexts(value.oltIds ?? [], "Operator OLT scope"),
    enabled: value.enabled !== false
  };
}

function normalizeChat(value) {
  if (!value || typeof value !== "object") throw new TypeError("Invalid authorized chat.");
  const type = value.type === "group" ? "group" : "direct";
  return {
    chatId: requiredText(value.chatId, "Authorized chatId"),
    type,
    remark: String(value.remark ?? ""),
    enabled: value.enabled !== false
  };
}

function normalizeAccessRequest(value) {
  if (!value || typeof value !== "object") throw new TypeError("Invalid access request.");
  return {
    requestId: requiredText(value.requestId, "Access requestId"),
    openId: requiredText(value.openId, "Access request openId"),
    chatId: requiredText(value.chatId, "Access request chatId"),
    requestedAt: requiredText(value.requestedAt, "Access request requestedAt"),
    status: ["pending", "approved", "rejected", "expired"].includes(value.status)
      ? value.status
      : "pending"
  };
}

function normalizeAuditArchive(value) {
  if (!Array.isArray(value)) throw new TypeError("Audit archive must be an array.");
  return value.map((record) => {
    if (!record || typeof record !== "object") throw new TypeError("Invalid audit record.");
    return clone(record);
  });
}

function normalizeSyntheticDatasetAttestation(value) {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Invalid Synthetic Dataset Attestation.");
  }
  return {
    state: value.state === undefined ? "confirmed" : value.state,
    ...(value.baseUrl === undefined ? {} : { baseUrl: String(value.baseUrl) }),
    datasetRevision: requiredText(value.datasetRevision, "Synthetic datasetRevision"),
    confirmedAt: requiredText(value.confirmedAt, "Synthetic attestation confirmedAt")
  };
}

export function emptyFeishuState() {
  return {
    format: FEISHU_STATE_FORMAT,
    enabled: false,
    app: { appId: "", credentialReference: "" },
    operators: [],
    authorizedChats: [],
    accessRequests: [],
    auditArchive: [],
    gateway: { datasetRevision: null },
    language: { provider: "production", syntheticDatasetAttestation: null }
  };
}

export function normalizeFeishuState(value) {
  const source = value ?? emptyFeishuState();
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new TypeError("Feishu state must be an object.");
  }
  rejectForbiddenKeys(source);
  if (source.format !== FEISHU_STATE_FORMAT) {
    throw new TypeError("Unsupported Feishu state format.");
  }
  const app = source.app ?? {};
  const language = source.language ?? {};
  return {
    format: FEISHU_STATE_FORMAT,
    enabled: source.enabled === true,
    app: {
      appId: String(app.appId ?? ""),
      credentialReference: String(app.credentialReference ?? "")
    },
    operators: (source.operators ?? []).map(normalizeOperator),
    authorizedChats: (source.authorizedChats ?? []).map(normalizeChat),
    accessRequests: (source.accessRequests ?? []).map(normalizeAccessRequest),
    auditArchive: normalizeAuditArchive(source.auditArchive ?? []),
    gateway: {
      datasetRevision: source.gateway?.datasetRevision == null
        ? null
        : requiredText(source.gateway.datasetRevision, "Gateway datasetRevision")
    },
    language: {
      provider: language.provider === "synthetic" ? "synthetic" : "production",
      syntheticDatasetAttestation: normalizeSyntheticDatasetAttestation(language.syntheticDatasetAttestation)
    }
  };
}
