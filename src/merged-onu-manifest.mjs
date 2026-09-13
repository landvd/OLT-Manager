const MANIFEST_VERSION = 2;
const LEGACY_MANIFEST_VERSION = 1;
const SOURCE_NAMES = new Set(["network", "nmse"]);
const SOURCE_STATUSES = new Set(["collecting", "complete", "partial", "failed", "cancelled"]);
const CHECKPOINT_STATUSES = new Set(["not_started", "running", "paused", "complete", "failed"]);
const SAFE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_OLT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const BUSINESS_DATE = /^\d{4}-\d{2}-\d{2}$/;

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

function normalizeBusinessDate(value, path, errors, { required = true } = {}) {
  const normalized = text(value);
  if (!normalized) {
    if (required) addError(errors, path, "必须是有效的 YYYY-MM-DD 日期。");
    return null;
  }
  if (!BUSINESS_DATE.test(normalized)) {
    addError(errors, path, "必须是有效的 YYYY-MM-DD 日期。");
    return null;
  }
  const date = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized) {
    addError(errors, path, "必须是有效的 YYYY-MM-DD 日期。");
    return null;
  }
  return normalized;
}

function previousShanghaiCalendarDate(isoInstant) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date(isoInstant)).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
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

function validateSourceManifestInternal(input, { legacy = false } = {}) {
  const errors = [];
  if (!isRecord(input)) {
    return { valid: false, errors: [{ path: "manifest", message: "必须是对象。" }], value: null };
  }
  const version = Number(input.manifestVersion);
  if (legacy ? version !== LEGACY_MANIFEST_VERSION : version !== MANIFEST_VERSION) addError(errors, "manifestVersion", `必须为 ${legacy ? LEGACY_MANIFEST_VERSION : MANIFEST_VERSION}。`);
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
  if (!legacy) {
    const sourceKind = text(input.sourceKind);
    const scope = input.scope;
    const expectedKind = source === "network" ? "network-full-snapshot" : "nmse-boss-incremental-overlay";
    if (!sourceKind || sourceKind !== expectedKind) addError(errors, "sourceKind", `必须明确为 ${expectedKind}。`);
    const expectedScope = source === "network"
      ? { kind: "target-olts" }
      : { kind: "boss-query", processStatus: "成功", operationStatus: "全部", content: "厚街镇" };
    if (!isRecord(scope)) {
      addError(errors, "scope", "必须是固定白名单对象。");
    } else {
      const expectedKeys = Object.keys(expectedScope).sort();
      const actualKeys = Object.keys(scope).sort();
      if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys) || expectedKeys.some((key) => scope[key] !== expectedScope[key])) {
        addError(errors, "scope", source === "network"
          ? "网管二期 scope 只能是 {kind:\"target-olts\"}。"
          : "BOSS scope 必须精确为成功、全部、厚街镇固定查询对象。");
      }
    }
    const exclusiveWatermark = source === "nmse" ? normalizeIso(input.exclusiveWatermark, "exclusiveWatermark", errors) : null;
    if (source === "nmse" && exclusiveWatermark && windowEnd && exclusiveWatermark !== windowEnd) addError(errors, "exclusiveWatermark", "必须等于 windowEnd。" );
    const coverageThrough = source === "nmse"
      ? normalizeBusinessDate(input.coverageThrough, "coverageThrough", errors)
      : (input.coverageThrough === null || input.coverageThrough === undefined || text(input.coverageThrough) === "" ? null : normalizeBusinessDate(input.coverageThrough, "coverageThrough", errors, { required: false }));
    if (source === "nmse" && coverageThrough && exclusiveWatermark && coverageThrough !== previousShanghaiCalendarDate(exclusiveWatermark)) {
      addError(errors, "coverageThrough", "必须等于 exclusiveWatermark 在上海日历的前一自然日。");
    }
    if (source === "network" && input.exclusiveWatermark !== null && input.exclusiveWatermark !== undefined && text(input.exclusiveWatermark) !== "") addError(errors, "exclusiveWatermark", "网管二期源不应包含一期水位。");
    if (source === "network" && input.coverageThrough !== null && input.coverageThrough !== undefined && text(input.coverageThrough) !== "") addError(errors, "coverageThrough", "网管二期源不应包含一期覆盖日期。");
    input = { ...input, sourceKind, scope, exclusiveWatermark, coverageThrough };
  }

  if (errors.length) return { valid: false, errors, value: null };
  return {
    valid: true,
    errors: [],
    value: {
      manifestVersion: legacy ? LEGACY_MANIFEST_VERSION : MANIFEST_VERSION,
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
      checkpoint,
      ...(legacy ? {} : { sourceKind: input.sourceKind, scope: input.scope, exclusiveWatermark: input.exclusiveWatermark, coverageThrough: input.coverageThrough })
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
  return validateSourceManifestInternal(input, { legacy: Number(input?.manifestVersion) === LEGACY_MANIFEST_VERSION });
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
  const network = validateSourceManifestInternal(networkInput, { legacy: Number(networkInput?.manifestVersion) === LEGACY_MANIFEST_VERSION });
  const nmse = validateSourceManifestInternal(nmseInput, { legacy: Number(nmseInput?.manifestVersion) === LEGACY_MANIFEST_VERSION });
  const reasons = [];
  if (!network.valid) reasons.push(invalidCompatibility("invalid_network_manifest", network.errors, "network"));
  if (!nmse.valid) reasons.push(invalidCompatibility("invalid_nmse_manifest", nmse.errors, "nmse"));
  if (network.valid && network.value.source !== "network") reasons.push(invalidCompatibility("source_mismatch", "network manifest 的 source 必须为 network。", "network"));
  if (nmse.valid && nmse.value.source !== "nmse") reasons.push(invalidCompatibility("source_mismatch", "nmse manifest 的 source 必须为 nmse。", "nmse"));
  if (network.valid && network.value.manifestVersion !== MANIFEST_VERSION) reasons.push(invalidCompatibility("legacy_manifest_requires_resync", "network 使用旧版 manifest，必须重新同步为 v2。", "network"));
  if (nmse.valid && nmse.value.manifestVersion !== MANIFEST_VERSION) reasons.push(invalidCompatibility("legacy_manifest_requires_resync", "nmse 使用旧版 manifest，必须重新同步为 v2。", "nmse"));
  if (network.valid && network.value.status !== "complete") reasons.push(invalidCompatibility("source_not_complete", `network 状态为 ${network.value.status}，不能作为完整合并输入。`, "network"));
  if (nmse.valid && nmse.value.status !== "complete") reasons.push(invalidCompatibility("source_not_complete", `nmse 状态为 ${nmse.value.status}，不能作为完整合并输入。`, "nmse"));
  if (network.valid && nmse.valid) {
    const netIds = [...(network.value.targetOltIds || [])].sort();
    const nmseIds = [...(nmse.value.targetOltIds || [])].sort();
    if (JSON.stringify(netIds) !== JSON.stringify(nmseIds)) {
      const netSet = new Set(netIds);
      const nmseSet = new Set(nmseIds);
      const onlyInNet = netIds.filter((id) => !nmseSet.has(id));
      const onlyInNmse = nmseIds.filter((id) => !netSet.has(id));
      const diffParts = [];
      if (onlyInNet.length) diffParts.push(`网管二期独有: [${onlyInNet.join(", ")}]`);
      if (onlyInNmse.length) diffParts.push(`一期BOSS独有: [${onlyInNmse.join(", ")}]`);
      const diffDesc = diffParts.length ? `（${diffParts.join("；")}）` : "";
      reasons.push(invalidCompatibility(
        "target_olt_mismatch",
        `network 与 nmse 的目标 OLT 集合不一致：网管二期 (${network.value.targetOltIds.length} 台) vs 一期 BOSS (${nmse.value.targetOltIds.length} 台)${diffDesc}。请重新同步使两方源的目标 OLT 对齐后再合并。`
      ));
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
  const primaryReason = compatibility.reasons?.[0];
  const detail = primaryReason?.detail ? `（${primaryReason.detail}）` : "。";
  const error = new TypeError(`merged input manifest 不可合并：${compatibility.reason || "invalid_manifest"}${detail}`);
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
    // Each source keeps its own window in `sources`; the envelope spans both
    // collections and must not reject a valid incremental NMSE window.
    windowStart: [networkManifest.windowStart, nmseManifest.windowStart].sort()[0],
    windowEnd: [networkManifest.windowEnd, nmseManifest.windowEnd].sort().at(-1),
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
    const sortedTargetOltIds = [...targetOltIds].sort();
    const sortedExpectedTargetOltIds = [...expected.targetOltIds].sort();
    if (JSON.stringify(sortedTargetOltIds) !== JSON.stringify(sortedExpectedTargetOltIds)) addError(errors, "targetOltIds", "必须与两个源的目标 OLT 集合一致。");
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
    ? validateSourceManifestInternal(input, { legacy: Number(input?.manifestVersion) === LEGACY_MANIFEST_VERSION })
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
    ? validateSourceManifestInternal(parsed, { legacy: Number(parsed?.manifestVersion) === LEGACY_MANIFEST_VERSION })
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
