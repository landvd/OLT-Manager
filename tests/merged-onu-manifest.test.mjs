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
    collectionStartedAt: "2026-08-19T01:01:00.000Z",
    collectionCompletedAt: "2026-08-19T01:05:00.000Z",
    windowStart,
    windowEnd,
    sourceRevision: `${sourceName}:revision-1`,
    targetOltIds: ["olt-1", "olt-2"],
    rowCount: sourceName === "network" ? 2 : 3,
    status: "complete",
    ...overrides
  });
}

test("creates a valid source manifest with reserved recovery fields", () => {
  const manifest = source("network", { runId: "run-1", idempotencyKey: "idem-1" });
  assert.equal(manifest.manifestType, "source");
  assert.deepEqual(manifest.targetOltIds, ["olt-1", "olt-2"]);
  assert.deepEqual(manifest.checkpoint, { status: "not_started", cursor: null, updatedAt: null });
  assert.equal(validateSourceManifest(manifest).valid, true);
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
});

test("returns an explicit incompatibility for different time windows", () => {
  const result = checkMergedInputCompatibility(source("network"), source("nmse", { windowEnd: "2026-08-19T02:00:00.000Z" }));
  assert.equal(result.compatible, false);
  assert.equal(result.reason, "window_mismatch");
  assert.match(result.reasons[0].detail, /时间窗不一致/);
  assert.throws(() => createMergedInputManifest({ network: source("network"), nmse: source("nmse", { windowEnd: "2026-08-19T02:00:00.000Z" }) }), /不可合并/);
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
