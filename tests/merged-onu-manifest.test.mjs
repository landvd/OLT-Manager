import test from "node:test";
import assert from "node:assert/strict";
import {
  createManifestRegistry,
  createMergedInputManifest,
  createSourceManifest,
  parseManifest,
  serializeManifest,
  validateSourceManifest,
  checkMergedInputCompatibility
} from "../src/merged-onu-manifest.mjs";

const windowStart = "2026-08-19T00:00:00.000Z";
const windowEnd = "2026-08-19T01:00:00.000Z";

function source(sourceName, overrides = {}) {
  return createSourceManifest({
    source: sourceName,
    sourceKind: sourceName === "network" ? "network-full-snapshot" : "nmse-boss-incremental-overlay",
    scope: sourceName === "network"
      ? { kind: "target-olts" }
      : { kind: "boss-query", processStatus: "成功", operationStatus: "全部", content: "厚街镇" },
    collectionStartedAt: "2026-08-19T01:01:00.000Z",
    collectionCompletedAt: "2026-08-19T01:05:00.000Z",
    windowStart,
    windowEnd,
    sourceRevision: `${sourceName}:revision-1`,
    targetOltIds: ["olt-1", "olt-2"],
    rowCount: sourceName === "network" ? 2 : 3,
    coverageThrough: sourceName === "nmse" ? "2026-08-18" : null,
    exclusiveWatermark: sourceName === "nmse" ? windowEnd : null,
    status: "complete",
    ...overrides
  });
}

test("creates a valid source manifest with reserved recovery fields", () => {
  const manifest = source("network", { runId: "run-1", idempotencyKey: "idem-1" });
  assert.equal(manifest.manifestType, "source");
  assert.equal(manifest.manifestVersion, 2);
  assert.equal(manifest.sourceKind, "network-full-snapshot");
  assert.deepEqual(manifest.scope, { kind: "target-olts" });
  assert.deepEqual(manifest.targetOltIds, ["olt-1", "olt-2"]);
  assert.deepEqual(manifest.checkpoint, { status: "not_started", cursor: null, updatedAt: null });
  assert.equal(validateSourceManifest(manifest).valid, true);
});

test("v2 NMSE source records BOSS query scope and exclusive watermark", () => {
  const manifest = source("nmse", { exclusiveWatermark: windowEnd, coverageThrough: "2026-08-18" });
  assert.equal(manifest.sourceKind, "nmse-boss-incremental-overlay");
  assert.deepEqual(manifest.scope, { kind: "boss-query", processStatus: "成功", operationStatus: "全部", content: "厚街镇" });
  assert.equal(manifest.exclusiveWatermark, windowEnd);
  assert.equal(manifest.coverageThrough, "2026-08-18");
});

test("v2 source manifests require explicit source kind, scope, and NMSE watermark", () => {
  const network = { ...source("network") };
  delete network.sourceKind;
  delete network.scope;
  const networkResult = validateSourceManifest(network);
  assert.equal(networkResult.valid, false);
  assert.ok(networkResult.errors.some((error) => error.path === "sourceKind"));
  assert.ok(networkResult.errors.some((error) => error.path === "scope"));

  const nmse = { ...source("nmse") };
  delete nmse.exclusiveWatermark;
  const nmseResult = validateSourceManifest(nmse);
  assert.equal(nmseResult.valid, false);
  assert.ok(nmseResult.errors.some((error) => error.path === "exclusiveWatermark"));
});

test("v2 scope is an exact fixed allowlist and coverage is a real preceding Shanghai business date", () => {
  const extraScope = validateSourceManifest({ ...source("network"), scope: { kind: "target-olts", targetOltIds: ["olt-1"] } });
  assert.equal(extraScope.valid, false);
  const tamperedScope = validateSourceManifest({ ...source("nmse"), scope: { kind: "boss-query", processStatus: "成功", operationStatus: "待处理", content: "厚街镇" } });
  assert.equal(tamperedScope.valid, false);
  const invalidDate = validateSourceManifest({ ...source("nmse"), coverageThrough: "2026-02-30" });
  assert.equal(invalidDate.valid, false);
  const wrongBusinessDate = validateSourceManifest({ ...source("nmse"), coverageThrough: "2026-08-17" });
  assert.equal(wrongBusinessDate.valid, false);
  const weekendWatermark = source("nmse", {
    windowEnd: "2026-08-24T00:00:00.000Z",
    exclusiveWatermark: "2026-08-24T00:00:00.000Z",
    coverageThrough: "2026-08-23"
  });
  assert.equal(validateSourceManifest(weekendWatermark).valid, true);
});

test("legacy v1 source parses without v2 reinterpretation and requires resync", () => {
  const legacy = { ...source("network"), manifestVersion: 1 };
  assert.equal(validateSourceManifest(legacy).valid, true);
  const result = checkMergedInputCompatibility(legacy, { ...source("nmse"), manifestVersion: 1 });
  assert.equal(result.compatible, false);
  assert.equal(result.reason, "legacy_manifest_requires_resync");
});

test("legacy v1 merged-input manifests are rejected explicitly", () => {
  const manifest = createMergedInputManifest({ network: source("network"), nmse: source("nmse") });
  const legacy = { ...manifest, manifestVersion: 1 };
  assert.throws(() => parseManifest(JSON.stringify(legacy)), (error) => error.code === "INVALID_MERGED_ONU_MANIFEST");
  assert.equal(validateSourceManifest(legacy).valid, false);
});

test("rejects reversed collection and window timestamps", () => {
  const result = validateSourceManifest({
    ...source("network"),
    collectionStartedAt: "2026-08-19T02:00:00.000Z",
    collectionCompletedAt: "2026-08-19T01:00:00.000Z",
    windowStart: windowEnd,
    windowEnd: windowStart
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.path === "collectionCompletedAt"));
  assert.ok(result.errors.some((error) => error.path === "windowEnd"));
});

test("requires safe source revision and target OLT identifiers", () => {
  const result = validateSourceManifest({
    ...source("network"),
    sourceRevision: "revision with spaces",
    targetOltIds: ["olt-1", "olt-1"]
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.path === "sourceRevision"));
  assert.ok(result.errors.some((error) => error.path === "targetOltIds"));
});

test("returns an explicit incompatibility for different target OLT sets", () => {
  const result = checkMergedInputCompatibility(source("network"), source("nmse", { targetOltIds: ["olt-3"] }));
  assert.equal(result.compatible, false);
  assert.equal(result.reason, "target_olt_mismatch");
  assert.ok(result.reasons.some((item) => item.reason === "target_olt_mismatch"));
  assert.match(result.reasons[0].detail, /目标 OLT 集合不一致/);
  assert.match(result.reasons[0].detail, /网管二期独有/);
  assert.throws(
    () => createMergedInputManifest({ network: source("network"), nmse: source("nmse", { targetOltIds: ["olt-3"] }) }),
    /target_olt_mismatch（network 与 nmse 的目标 OLT 集合不一致/
  );
});

test("accepts different source windows and records the envelope span", () => {
  const result = checkMergedInputCompatibility(source("network"), source("nmse", { windowEnd: "2026-08-19T02:00:00.000Z", exclusiveWatermark: "2026-08-19T02:00:00.000Z", coverageThrough: "2026-08-18" }));
  assert.equal(result.compatible, true);
  const manifest = createMergedInputManifest({ network: source("network"), nmse: source("nmse", { windowEnd: "2026-08-19T02:00:00.000Z", exclusiveWatermark: "2026-08-19T02:00:00.000Z", coverageThrough: "2026-08-18" }) });
  assert.equal(manifest.sources.network.windowEnd, "2026-08-19T01:00:00.000Z");
  assert.equal(manifest.sources.nmse.windowEnd, "2026-08-19T02:00:00.000Z");
  assert.equal(manifest.windowEnd, "2026-08-19T02:00:00.000Z");
});

test("rejects a duplicate idempotency key in the explicit process-local registry", () => {
  const registry = createManifestRegistry();
  assert.deepEqual(registry.claim("idem-1"), { accepted: true, duplicate: false, reason: null });
  assert.deepEqual(registry.claim("idem-1"), { accepted: false, duplicate: true, reason: "duplicate_idempotency_key" });
});

test("serialized merged input manifest remains valid after parsing", () => {
  const manifest = createMergedInputManifest({
    network: source("network"),
    nmse: source("nmse"),
    runId: "run-merged-1",
    idempotencyKey: "idem-merged-1",
    checkpoint: { status: "paused", cursor: "nmse-page-2", updatedAt: "2026-08-19T01:04:00.000Z" }
  });
  const roundTrip = parseManifest(serializeManifest(manifest));
  assert.deepEqual(roundTrip, manifest);
  assert.equal(roundTrip.sourceRevision.network, "network:revision-1");
  assert.equal(roundTrip.rowCount, 5);
  assert.equal(roundTrip.checkpoint.status, "paused");
});
