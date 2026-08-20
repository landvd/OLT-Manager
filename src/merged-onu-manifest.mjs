const MANIFEST_VERSION = 1;
const SOURCE_NAMES = new Set(["network", "nmse"]);
const SOURCE_STATUSES = new Set(["collecting", "complete", "partial", "failed", "cancelled"]);
const CHECKPOINT_STATUSES = new Set(["not_started", "running", "paused", "complete", "failed"]);
const SAFE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_OLT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function text(value) {
  return String(value ?? "").trim();
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function addError(errors, path, message) {
  errors.push({ path, message });
}

function normalizeIso(value, path, errors, { required = true } = {}) {
  const normalized = text(value);
  if (!normalized) {
    if (required) addError(errors, path, "必须是 UTC ISO 8601 时间（YYYY-MM-DDTHH:mm:ss.sssZ）。");
    return null;
  }
  if (!ISO_INSTANT.test(normalized) || Number.isNaN(Date.parse(normalized))) {
    addError(errors, path, "必须是有效的 UTC ISO 8601 时间（YYYY-MM-DDTHH:mm:ss.sssZ）。");
    return null;
  }
  return normalized;
}

function normalizeSafeToken(value, path, errors, { required = true } = {}) {
  const normalized = text(value);
  if (!normalized) {
    if (required) addError(errors, path, "不能为空。");
    return null;
  }
  if (!SAFE_TOKEN.test(normalized)) {
    addError(errors, path, "只能包含字母、数字、点、下划线、冒号、斜线和连字符，长度不超过 128。");
    return null;
  }
  return normalized;
}

function normalizeTargetOltIds(value, path, errors) {
  if (!Array.isArray(value) || value.length === 0) {
    addError(errors, path, "必须是至少包含一个 OLT ID 的数组。");
    return [];
  }
  const normalized = value.map((item, index) => {
    const itemPath = `${path}[${index}]`;
    const result = normalizeSafeToken(item, itemPath, errors);
    if (result && !SAFE_OLT_ID.test(result)) {
      addError(errors, itemPath, "OLT ID 格式不安全。");
    }
    return result;
  }).filter(Boolean);
  const unique = [...new Set(normalized)].sort();
  if (unique.length !== normalized.length) addError(errors, path, "不能包含重复的 OLT ID。");
  return unique;
}

function normalizeRowCount(value, path, errors) {
  if (!Number.isSafeInteger(value) || value < 0) {
    addError(errors, path, "必须是大于等于 0 的安全整数。");
    return null;
  }
  return value;
}

function normalizeOptionalId(value, path, errors) {
  if (value === null || value === undefined || text(value) === "") return null;
  return normalizeSafeToken(value, path, errors);
}

function normalizeCheckpoint(value, errors) {
  if (value === null || value === undefined) {
    return { status: "not_started", cursor: null, updatedAt: null };
  }
  if (!isRecord(value)) {
    addError(errors, "checkpoint", "必须是对象。");
    return { status: "not_started", cursor: null, updatedAt: null };
  }
  const status = text(value.status);
  if (!CHECKPOINT_STATUSES.has(status)) addError(errors, "checkpoint.status", "不是受支持的检查点状态。");
  const cursor = value.cursor === null || value.cursor === undefined || text(value.cursor) === ""
    ? null
    : normalizeSafeToken(value.cursor, "checkpoint.cursor", errors);
  const updatedAt = normalizeIso(value.updatedAt, "checkpoint.updatedAt", errors, { required: false });
  return { status: CHECKPOINT_STATUSES.has(status) ? status : "not_started", cursor, updatedAt };
}

function validateSourceManifestInternal(input) {
  const errors = [];
  if (!isRecord(input)) {
    return { valid: false, errors: [{ path: "manifest", message: "必须是对象。" }], value: null };
  }
  if (input.manifestVersion !== MANIFEST_VERSION) addError(errors, "manifestVersion", `必须为 ${MANIFEST_VERSION}。`);
  if (input.manifestType !== "source") addError(errors, "manifestType", "必须为 source。");

  const source = text(input.source);
  if (!SOURCE_NAMES.has(source)) addError(errors, "source", "必须为 network 或 nmse。");
  const collectionStartedAt = normalizeIso(input.collectionStartedAt, "collectionStartedAt", errors);
  const collectionCompletedAt = normalizeIso(input.collectionCompletedAt, "collectionCompletedAt", errors);
  const windowStart = normalizeIso(input.windowStart, "windowStart", errors);
  const windowEnd = normalizeIso(input.windowEnd, "windowEnd", errors);
  if (collectionStartedAt && collectionCompletedAt && Date.parse(collectionCompletedAt) < Date.parse(collectionStartedAt)) {
    addError(errors, "collectionCompletedAt", "不能早于 collectionStartedAt。");
  }
  if (windowStart && windowEnd && Date.parse(windowEnd) < Date.parse(windowStart)) {
    addError(errors, "windowEnd", "不能早于 windowStart。");
  }

  const sourceRevision = normalizeSafeToken(input.sourceRevision, "sourceRevision", errors);
  const targetOltIds = normalizeTargetOltIds(input.targetOltIds, "targetOltIds", errors);
  const rowCount = normalizeRowCount(input.rowCount, "rowCount", errors);
  const status = text(input.status);
  if (!SOURCE_STATUSES.has(status)) addError(errors, "status", "不是受支持的源状态。");
  const runId = normalizeOptionalId(input.runId, "runId", errors);
  const idempotencyKey = normalizeOptionalId(input.idempotencyKey, "idempotencyKey", errors);
  const checkpoint = normalizeCheckpoint(input.checkpoint, errors);

  if (errors.length) return { valid: false, errors, value: null };
  return {
    valid: true,
    errors: [],
    value: {
      manifestVersion: MANIFEST_VERSION,
      manifestType: "source",
      source,
      collectionStartedAt,
      collectionCompletedAt,
      windowStart,
      windowEnd,
      sourceRevision,
      targetOltIds,
      rowCount,
      status,
      runId,
      idempotencyKey,
      checkpoint
    }
  };
}

function invalidManifestError(result, message = "source manifest 校验失败。") {
  const error = new TypeError(message);
  error.code = "INVALID_MERGED_ONU_MANIFEST";
  error.errors = result.errors;
  return error;
}

export function validateSourceManifest(input) {
  return validateSourceManifestInternal(input);
}

export function createSourceManifest(input = {}) {
  const result = validateSourceManifestInternal({ ...input, manifestType: "source", manifestVersion: MANIFEST_VERSION });
  if (!result.valid) throw invalidManifestError(result);
  return result.value;
}

function invalidCompatibility(reason, detail, source = "") {
  return { reason, source, detail };
}

export function checkMergedInputCompatibility(networkInput, nmseInput) {
  const network = validateSourceManifestInternal(networkInput);
  const nmse = validateSourceManifestInternal(nmseInput);
  const reasons = [];
  if (!network.valid) reasons.push(invalidCompatibility("invalid_network_manifest", network.errors, "network"));
  if (!nmse.valid) reasons.push(invalidCompatibility("invalid_nmse_manifest", nmse.errors, "nmse"));
  if (network.valid && network.value.source !== "network") reasons.push(invalidCompatibility("source_mismatch", "network manifest 的 source 必须为 network。", "network"));
  if (nmse.valid && nmse.value.source !== "nmse") reasons.push(invalidCompatibility("source_mismatch", "nmse manifest 的 source 必须为 nmse。", "nmse"));
  if (network.valid && network.value.status !== "complete") reasons.push(invalidCompatibility("source_not_complete", `network 状态为 ${network.value.status}，不能作为完整合并输入。`, "network"));
  if (nmse.valid && nmse.value.status !== "complete") reasons.push(invalidCompatibility("source_not_complete", `nmse 状态为 ${nmse.value.status}，不能作为完整合并输入。`, "nmse"));
  if (network.valid && nmse.valid) {
    if (network.value.windowStart !== nmse.value.windowStart || network.value.windowEnd !== nmse.value.windowEnd) {
      reasons.push(invalidCompatibility("window_mismatch", "network 与 nmse 的时间窗不一致，禁止静默合并。"));
    }
    if (JSON.stringify(network.value.targetOltIds) !== JSON.stringify(nmse.value.targetOltIds)) {
      reasons.push(invalidCompatibility("target_olt_mismatch", "network 与 nmse 的目标 OLT 集合不一致。"));
    }
  }
  return {
    compatible: reasons.length === 0,
    reason: reasons[0]?.reason || null,
    reasons,
    network: network.valid ? network.value : null,
    nmse: nmse.valid ? nmse.value : null
  };
}

function mergedManifestError(compatibility) {
  const error = new TypeError(`merged input manifest 不可合并：${compatibility.reason || "invalid_manifest"}。`);
  error.code = "MERGED_INPUT_INCOMPATIBLE";
  error.reason = compatibility.reason;
  error.reasons = compatibility.reasons;
  return error;
}

export function createMergedInputManifest({ network, nmse, runId = null, idempotencyKey = null, checkpoint = null } = {}) {
  const compatibility = checkMergedInputCompatibility(network, nmse);
  if (!compatibility.compatible) throw mergedManifestError(compatibility);
  const networkManifest = compatibility.network;
  const nmseManifest = compatibility.nmse;
  const errors = [];
  const normalizedRunId = normalizeOptionalId(runId, "runId", errors);
  const normalizedIdempotencyKey = normalizeOptionalId(idempotencyKey, "idempotencyKey", errors);
  const normalizedCheckpoint = normalizeCheckpoint(checkpoint, errors);
  if (errors.length) throw invalidManifestError({ errors }, "merged input manifest 的恢复字段校验失败。");
  return {
    manifestVersion: MANIFEST_VERSION,
    manifestType: "merged-input",
    source: "merged",
    collectionStartedAt: [networkManifest.collectionStartedAt, nmseManifest.collectionStartedAt].sort()[0],
    collectionCompletedAt: [networkManifest.collectionCompletedAt, nmseManifest.collectionCompletedAt].sort().at(-1),
    windowStart: networkManifest.windowStart,
    windowEnd: networkManifest.windowEnd,
    sourceRevision: {
      network: networkManifest.sourceRevision,
      nmse: nmseManifest.sourceRevision
    },
    targetOltIds: [...networkManifest.targetOltIds],
    rowCount: networkManifest.rowCount + nmseManifest.rowCount,
    sourceRowCount: {
      network: networkManifest.rowCount,
      nmse: nmseManifest.rowCount
    },
    status: "complete",
    runId: normalizedRunId,
    idempotencyKey: normalizedIdempotencyKey,
    checkpoint: normalizedCheckpoint,
    sources: {
      network: networkManifest,
      nmse: nmseManifest
    }
  };
}

function validateMergedInputManifestInternal(input) {
  const errors = [];
  if (!isRecord(input)) return { valid: false, errors: [{ path: "manifest", message: "必须是对象。" }], value: null };
  if (input.manifestVersion !== MANIFEST_VERSION) addError(errors, "manifestVersion", `必须为 ${MANIFEST_VERSION}。`);
  if (input.manifestType !== "merged-input") addError(errors, "manifestType", "必须为 merged-input。");
  if (text(input.source) !== "merged") addError(errors, "source", "必须为 merged。");
  const compatibility = checkMergedInputCompatibility(input.sources?.network, input.sources?.nmse);
  if (!compatibility.compatible) errors.push(...compatibility.reasons.map((item) => ({ path: `sources.${item.source || "*"}`, message: item.detail })));
  const collectionStartedAt = normalizeIso(input.collectionStartedAt, "collectionStartedAt", errors);
  const collectionCompletedAt = normalizeIso(input.collectionCompletedAt, "collectionCompletedAt", errors);
  const windowStart = normalizeIso(input.windowStart, "windowStart", errors);
  const windowEnd = normalizeIso(input.windowEnd, "windowEnd", errors);
  if (collectionStartedAt && collectionCompletedAt && Date.parse(collectionCompletedAt) < Date.parse(collectionStartedAt)) addError(errors, "collectionCompletedAt", "不能早于 collectionStartedAt。");
  if (windowStart && windowEnd && Date.parse(windowEnd) < Date.parse(windowStart)) addError(errors, "windowEnd", "不能早于 windowStart。");
  const targetOltIds = normalizeTargetOltIds(input.targetOltIds, "targetOltIds", errors);
  const rowCount = normalizeRowCount(input.rowCount, "rowCount", errors);
  const status = text(input.status);
  if (status !== "complete") addError(errors, "status", "merged input manifest 必须为 complete。");
  const runId = normalizeOptionalId(input.runId, "runId", errors);
  const idempotencyKey = normalizeOptionalId(input.idempotencyKey, "idempotencyKey", errors);
  const checkpoint = normalizeCheckpoint(input.checkpoint, errors);
  const sourceRevision = isRecord(input.sourceRevision) ? {
    network: normalizeSafeToken(input.sourceRevision.network, "sourceRevision.network", errors),
    nmse: normalizeSafeToken(input.sourceRevision.nmse, "sourceRevision.nmse", errors)
  } : (addError(errors, "sourceRevision", "必须包含 network 和 nmse 两个安全 revision。"), null);
  const sourceRowCount = isRecord(input.sourceRowCount) ? {
    network: normalizeRowCount(input.sourceRowCount.network, "sourceRowCount.network", errors),
    nmse: normalizeRowCount(input.sourceRowCount.nmse, "sourceRowCount.nmse", errors)
  } : (addError(errors, "sourceRowCount", "必须包含 network 和 nmse 两个行数。"), null);
  if (compatibility.compatible) {
    const expected = createMergedInputManifest({
      network: compatibility.network,
      nmse: compatibility.nmse,
      runId,
      idempotencyKey,
      checkpoint
    });
    if (collectionStartedAt !== expected.collectionStartedAt) addError(errors, "collectionStartedAt", "必须等于两个源采集开始时间的最早值。");
    if (collectionCompletedAt !== expected.collectionCompletedAt) addError(errors, "collectionCompletedAt", "必须等于两个源采集完成时间的最晚值。");
    if (windowStart !== expected.windowStart || windowEnd !== expected.windowEnd) addError(errors, "window", "必须与两个源的时间窗一致。");
    if (JSON.stringify(targetOltIds) !== JSON.stringify(expected.targetOltIds)) addError(errors, "targetOltIds", "必须与两个源的目标 OLT 集合一致。");
    if (rowCount !== expected.rowCount) addError(errors, "rowCount", "必须等于两个源 rowCount 之和。");
    if (JSON.stringify(sourceRevision) !== JSON.stringify(expected.sourceRevision)) addError(errors, "sourceRevision", "必须与 sources 中的 revision 一致。");
    if (JSON.stringify(sourceRowCount) !== JSON.stringify(expected.sourceRowCount)) addError(errors, "sourceRowCount", "必须与 sources 中的 rowCount 一致。");
  }
  if (errors.length) return { valid: false, errors, value: null };
  return {
    valid: true,
    errors: [],
    value: {
      manifestVersion: MANIFEST_VERSION,
      manifestType: "merged-input",
      source: "merged",
      collectionStartedAt,
      collectionCompletedAt,
      windowStart,
      windowEnd,
      sourceRevision,
      targetOltIds,
      rowCount,
      sourceRowCount,
      status,
      runId,
      idempotencyKey,
      checkpoint,
      sources: {
        network: compatibility.network,
        nmse: compatibility.nmse
      }
    }
  };
}

export function validateMergedInputManifest(input) {
  return validateMergedInputManifestInternal(input);
}

export function serializeManifest(input) {
  const result = input?.manifestType === "source"
    ? validateSourceManifestInternal(input)
    : validateMergedInputManifestInternal(input);
  if (!result.valid) throw invalidManifestError(result, "manifest 序列化前校验失败。");
  return JSON.stringify(result.value);
}

export function parseManifest(serialized) {
  let parsed;
  try {
    parsed = JSON.parse(String(serialized));
  } catch (error) {
    const wrapped = new TypeError("manifest JSON 无法解析。");
    wrapped.code = "INVALID_MERGED_ONU_MANIFEST_JSON";
    wrapped.cause = error;
    throw wrapped;
  }
  const result = parsed?.manifestType === "source"
    ? validateSourceManifestInternal(parsed)
    : validateMergedInputManifestInternal(parsed);
  if (!result.valid) throw invalidManifestError(result, "manifest 反序列化后校验失败。");
  return result.value;
}

// This registry is intentionally process-local. Cross-process recovery must add a durable adapter later.
export function createManifestRegistry() {
  const claimedKeys = new Set();
  return {
    claim(idempotencyKey) {
      const key = text(idempotencyKey);
      if (!key) return { accepted: true, duplicate: false, reason: null };
      if (!SAFE_TOKEN.test(key)) throw new TypeError("idempotencyKey 格式不安全。");
      if (claimedKeys.has(key)) return { accepted: false, duplicate: true, reason: "duplicate_idempotency_key" };
      claimedKeys.add(key);
      return { accepted: true, duplicate: false, reason: null };
    },
    has(idempotencyKey) {
      return claimedKeys.has(text(idempotencyKey));
    },
    clear() {
      claimedKeys.clear();
    }
  };
}

export { MANIFEST_VERSION };
