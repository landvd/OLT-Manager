import test from "node:test";
import assert from "node:assert/strict";
import { createMergedOnuSyncRuntime } from "../src/merged-onu-sync-runtime.mjs";

function createFixture() {
  const state = { running: false, status: "idle", phase: "idle" };
  const recoveryState = { inspectedAt: "", runs: [] };
  const calls = [];
  let run = null;
  const runtime = createMergedOnuSyncRuntime({
    state,
    recoveryState,
    workerId: "test-worker",
    leaseMs: 60_000,
    remoteSessionState: {
      clearNmseSession() { calls.push("clear-nmse"); },
      clearOssNgbSession() { calls.push("clear-oss"); }
    },
    mergedOnuService: {
      selectMergedOnuTargets(olts, mappings) {
        const mapping = mappings.find((item) => item.oltIp === olts[0].host);
        return [{ target: olts[0], mapping }];
      },
      selectMergedNmseTargets(olts) { return olts.map((target) => ({ target })); },
      readLocalUsersAsMergeRows: async () => []
    },
    resourceUserSync: { readComplete: async () => [] },
    getOlts: async () => [{ id: "olt-1", host: "10.0.0.1", enabled: true }],
    getResourceOltIpMappings: async () => [{ oltIp: "10.0.0.1", resourceIp: "resource-1" }],
    activeOssNgbSession: () => ({
      olts: [{ resourceIp: "resource-1", cuid: "cuid-1" }],
      client: { readOnuInventory: async () => [{ onuIndex: "1", loid: "L-1" }] }
    }),
    loginNmseSession: async () => ({ client: {}, auth: {} }),
    resourceGridRank: () => "1",
    backupDatabaseBeforeSync: async () => ({ path: "/safe/backup.sqlite", bytes: 10, sha256: "sha256" }),
    replaceResourceUsersBatch: async () => {},
    listRecoverableMergedOnuSyncRuns: async () => (run && !["success", "failed"].includes(run.status) ? [run] : []),
    beginMergedOnuSyncRun: async (input) => {
      run = { ...input, status: "running", phase: input.phase, leaseUntil: "2099-01-01T00:00:00.000Z", checkpoint: { status: "running" } };
      calls.push(["begin", input.operation]);
      return { duplicate: false, run };
    },
    claimMergedOnuSyncLease: async () => ({ claimed: false, run }),
    updateMergedOnuSyncRuntime: async (input) => {
      run = { ...run, ...input, checkpoint: input.checkpoint };
      calls.push(["runtime", input.status, input.phase]);
      return { updated: true, run };
    },
    getLatestMergedOnuSourceManifest: async () => null,
    getMergedOnuSourceStatus: async () => ({ network: {}, nmse: {} }),
    getMergedOnuNetworkSource: async () => [],
    getMergedOnuNmseSource: async () => [],
    replaceMergedOnuNetworkSource: async () => ({ source: { revision: "network-revision" }, rows: [] }),
    replaceMergedOnuNmseSource: async () => ({ source: { revision: "nmse-revision" }, rows: [] }),
    persistMergedOnuManifest: async () => {},
    recordMergedOnuSourceSyncSuccess: async () => {},
    recordMergedOnuSyncFailure: async () => {},
    syncMergedOnuDataset: async () => ({})
  });
  return { runtime, state, recoveryState, calls };
}

test("network source sync keeps backup, source replacement and sanitized public state", async () => {
  const { runtime, state, recoveryState, calls } = createFixture();
  const result = await runtime.runSourceSync("network", { idempotencyKey: "idem-1" });

  assert.equal(result.source.revision, "network-revision");
  assert.equal(result.backup.name, "backup.sqlite");
  assert.equal(state.running, false);
  assert.equal(state.status, "success");
  assert.equal(state.networkRows, 1);
  assert.equal(runtime.publicSyncState().recovery.runs.length, 0);
  assert.deepEqual(calls.slice(0, 2), [["begin", "network"], ["runtime", "running", "collecting-network"]]);
  assert.equal(Object.hasOwn(runtime.publicSyncState(), "password"), false);
  assert.equal(recoveryState.runs.length, 0);
});

test("runtime refuses a second operation while one is already running", async () => {
  const { runtime, state } = createFixture();
  state.running = true;
  await assert.rejects(() => runtime.runSourceSync("network"), (error) => {
    assert.equal(error.status, 409);
    assert.equal(error.message, "合并 ONU 同步正在执行。");
    return true;
  });
});
