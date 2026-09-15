export const WECOM_STATE_FORMAT = "olt-manager/wecom-state/v1";

import { clone } from "./clone.mjs";

const FORBIDDEN_STATE_KEYS = new Set([
  "snapshot", "userSnapshot", "users", "records", "secret", "botSecret", "token",
  "modelKey", "apiKey", "password"
]);

function requiredText(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new TypeError(`${label} is required.`);
  return normalized;
}

function rejectForbiddenKeys(value, path = "state") {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_STATE_KEYS.has(key)) {
      throw new TypeError(`${path}.${key} is not allowed in WeCom state.`);
    }
    rejectForbiddenKeys(value[key], `${path}.${key}`);
  }
}

export function emptyWecomState() {
  return {
    format: WECOM_STATE_FORMAT,
    enabled: false,
    bot: {
      botId: "",
      credentialReference: ""
    },
    welcomeEnabled: true,
    gateway: { datasetRevision: null }
  };
}

export function normalizeWecomState(value) {
  const source = value ?? emptyWecomState();
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new TypeError("WeCom state must be an object.");
  }
  rejectForbiddenKeys(source);
  if (source.format !== WECOM_STATE_FORMAT) {
    throw new TypeError("Unsupported WeCom state format.");
  }
  const bot = source.bot ?? {};
  return {
    format: WECOM_STATE_FORMAT,
    enabled: source.enabled === true,
    bot: {
      botId: String(bot.botId ?? "").trim(),
      credentialReference: String(bot.credentialReference ?? "").trim()
    },
    welcomeEnabled: source.welcomeEnabled !== false,
    gateway: {
      datasetRevision: source.gateway?.datasetRevision == null
        ? null
        : requiredText(source.gateway.datasetRevision, "Gateway datasetRevision")
    }
  };
}
