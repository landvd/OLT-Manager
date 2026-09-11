import test from "node:test";
import assert from "node:assert/strict";
import { createMergedOnuSyncRuntime } from "../src/merged-onu-sync-runtime.mjs";
import { createSourceManifest } from "../src/merged-onu-manifest.mjs";

function createFixture(overrides = {}) {
  const state = { running: false, status: "idle", phase: "idle" };
  const recoveryState = { inspectedAt: "", runs: [] };
  const calls = [];
  const beginInputs = [];
  const timers = { scheduled: [], cleared: [] };
  let run = null;
  const runtime = createMergedOnuSyncRuntime({
    state,
    recoveryState,
    workerId: "test-worker",
    leaseMs: 60_000,
    leaseHeartbeatMs: 20_000,
    setIntervalFn(callback, delay) {
      const handle = { callback, delay };
      timers.scheduled.push(handle);
      return handle;
    },
    clearIntervalFn(handle) { timers.cleared.push(handle); },
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
    runNmseBossIncremental: async ({ onProgress } = {}) => {
      const pageProgress = { phase: "boss-pages", total: 3, pages: 2, completedPages: 1, received: 2, workers: 2 };
      const detailProgress = { phase: "boss-details", total: 3, pages: 2, completedPages: 2, received: 3, details: 3, workers: 3 };
      onProgress?.(pageProgress);
      calls.push(["page-state", state.nmseTotal, state.nmsePages, state.nmseCompletedPages, state.nmseRows]);
      onProgress?.(detailProgress);
      calls.push(["detail-state", state.nmseTotal, state.nmsePages, state.nmseCompletedPages, state.nmseRows]);
    },
    loginNmseSession: async () => ({ client: {}, auth: {} }),
    resourceGridRank: () => "1",
    backupDatabaseBeforeSync: async () => ({ path: "/safe/backup.sqlite", bytes: 10, sha256: "sha256" }),
    replaceResourceUsersBatch: async () => {},
    listRecoverableMergedOnuSyncRuns: async () => (run && !["success", "failed"].includes(run.status) ? [run] : []),
    beginMergedOnuSyncRun: async (input) => {
      beginInputs.push(input);
      run = { ...input, status: "running", phase: input.phase, leaseUntil: "2099-01-01T00:00:00.000Z", checkpoint: { status: "running" } };
      calls.push(["begin", input.operation]);
      return { duplicate: false, run };
    },
    claimMergedOnuSyncLease: async () => ({ claimed: false, run }),
    renewMergedOnuSyncLease: async () => ({ renewed: true, run }),
    updateMergedOnuSyncRuntime: async (input) => {
      run = { ...run, ...input, checkpoint: input.checkpoint };
      calls.push(["runtime", input.status, input.phase]);
      return { updated: true, run };
    },
    getLatestMergedOnuSourceManifest: async () => null,
    getMergedOnuSourceStatus: async () => ({ network: {}, nmse: {} }),
    getMergedOnuDatasetStatus: async () => ({ revision: "dataset:fixture", sources: { network: { revision: "" }, nmse: { revision: "" } } }),
    getMergedOnuSyncRuns: async () => [],
    getMergedOnuNetworkSource: async () => [],
    getMergedOnuNmseSource: async () => [],
    replaceMergedOnuNetworkSource: async () => ({ source: { revision: "network-revision" }, rows: [] }),
    replaceMergedOnuNmseSource: async () => ({ source: { revision: "nmse-revision" }, rows: [] }),
    persistMergedOnuManifest: async () => {},
    recordMergedOnuSourceSyncSuccess: async () => {},
    recordMergedOnuSyncFailure: async () => {},
    syncMergedOnuDataset: async () => ({})
    , ...overrides
  });
  return { runtime, state, recoveryState, calls, beginInputs, timers };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function fireHeartbeat(timers, index = 0) {
  assert.ok(timers.scheduled[index], "expected a scheduled lease heartbeat");
  await timers.scheduled[index].callback();
  await Promise.resolve();
}

test("merged ONU runtime requires an explicit lease renewal dependency", () => {
  assert.throws(
    () => createFixture({ renewMergedOnuSyncLease: null }),
    /renewMergedOnuSyncLease/
  );
});

test("new runs pass the lease duration, renew on the injected heartbeat, and clear it on success", async () => {
  const backupEntered = deferred();
  const releaseBackup = deferred();
  const renewals = [];
  const fixture = createFixture({
    leaseHeartbeatMs: 1_234,
    backupDatabaseBeforeSync: async () => {
      backupEntered.resolve();
      await releaseBackup.promise;
      return { path: "/safe/backup.sqlite", bytes: 10, sha256: "sha256" };
    },
    renewMergedOnuSyncLease: async (input) => {
      renewals.push(input);
      return { renewed: true, run: { runId: input.runId, workerId: input.workerId, status: "running" } };
    }
  });

  const pending = fixture.runtime.runSourceSync("network", { idempotencyKey: "heartbeat-success" });
  await backupEntered.promise;
  assert.equal(fixture.beginInputs[0].leaseMs, 60_000);
  assert.equal(fixture.timers.scheduled.length, 1);
  assert.equal(fixture.timers.scheduled[0].delay, 1_234);
  await fireHeartbeat(fixture.timers);
  assert.equal(renewals.length, 1);
  assert.equal(renewals[0].runId, fixture.beginInputs[0].runId);
  assert.equal(renewals[0].workerId, "test-worker");
  assert.equal(renewals[0].leaseMs, 60_000);
  releaseBackup.resolve();
  await pending;
  assert.deepEqual(fixture.timers.cleared, [fixture.timers.scheduled[0]]);
});

test("recovered runs also start a heartbeat after claiming the expired lease", async () => {
  const expiredRun = {
    runId: "expired-network-run",
    operation: "network",
    status: "running",
    phase: "collecting-network",
    workerId: "old-worker",
    leaseUntil: "2000-01-01T00:00:00.000Z",
    startedAt: "2026-09-10T00:00:00.000Z",
    checkpoint: { status: "running" }
  };
  const claims = [];
  const fixture = createFixture({
    listRecoverableMergedOnuSyncRuns: async () => [expiredRun],
    claimMergedOnuSyncLease: async (input) => {
      claims.push(input);
      return { claimed: true, run: { ...expiredRun, workerId: input.workerId, leaseUntil: "2099-01-01T00:00:00.000Z" } };
    }
  });

  const result = await fixture.runtime.runSourceSync("network", { idempotencyKey: "recover-heartbeat" });
  assert.equal(result.recovered, true);
  assert.equal(claims.length, 1);
  assert.equal(claims[0].leaseMs, 60_000);
  assert.equal(fixture.timers.scheduled.length, 1);
  assert.deepEqual(fixture.timers.cleared, [fixture.timers.scheduled[0]]);
});

test("failed runs clear the lease heartbeat timer", async () => {
  const fixture = createFixture({
    backupDatabaseBeforeSync: async () => { throw new Error("backup failed"); }
  });
  await assert.rejects(fixture.runtime.runSourceSync("network"), /backup failed/);
  assert.equal(fixture.timers.scheduled.length, 1);
  assert.deepEqual(fixture.timers.cleared, [fixture.timers.scheduled[0]]);
});

test("lost heartbeat ownership blocks network source commits", async () => {
  const backupEntered = deferred();
  const releaseBackup = deferred();
  let sourceCommits = 0;
  const fixture = createFixture({
    backupDatabaseBeforeSync: async () => {
      backupEntered.resolve();
      await releaseBackup.promise;
      return { path: "/safe/backup.sqlite", bytes: 10, sha256: "sha256" };
    },
    renewMergedOnuSyncLease: async (input) => ({
      renewed: false,
      run: { runId: input.runId, workerId: "another-worker", status: "running" }
    }),
    replaceMergedOnuNetworkSource: async () => {
      sourceCommits += 1;
      return { source: { revision: "must-not-commit" }, rows: [] };
    }
  });

  const pending = fixture.runtime.runSourceSync("network", { idempotencyKey: "lease-lost-network" });
  await backupEntered.promise;
  await fireHeartbeat(fixture.timers);
  releaseBackup.resolve();
  await assert.rejects(pending, (error) => {
    assert.equal(error.status, 409);
    assert.match(error.message, /租约/);
    return true;
  });
  assert.equal(sourceCommits, 0);
});

test("lost heartbeat ownership blocks BOSS name-history or incremental commits", async () => {
  const backupEntered = deferred();
  const releaseBackup = deferred();
  let nameCommits = 0;
  const fixture = createFixture({
    backupDatabaseBeforeSync: async () => {
      backupEntered.resolve();
      await releaseBackup.promise;
      return { path: "/safe/backup.sqlite", bytes: 10, sha256: "sha256" };
    },
    renewMergedOnuSyncLease: async (input) => ({
      renewed: false,
      run: { runId: input.runId, workerId: "another-worker", status: "running" }
    }),
    runNmseBossIncremental: async ({ beforeCommit }) => {
      assert.equal(typeof beforeCommit, "function");
      await beforeCommit();
      nameCommits += 1;
    }
  });

  const pending = fixture.runtime.runSourceSync("nmse", { idempotencyKey: "lease-lost-name" });
  await backupEntered.promise;
  await fireHeartbeat(fixture.timers);
  releaseBackup.resolve();
  await assert.rejects(pending, /租约/);
  assert.equal(nameCommits, 0);
});

test("lost heartbeat ownership blocks unified dataset commits", async () => {
  const backupEntered = deferred();
  const releaseBackup = deferred();
  let datasetCommits = 0;
  const networkManifest = createSourceManifest({
    source: "network", sourceKind: "network-full-snapshot", scope: { kind: "target-olts" },
    collectionStartedAt: "2026-09-10T01:00:00.000Z", collectionCompletedAt: "2026-09-10T01:01:00.000Z",
    windowStart: "2026-09-10T00:00:00.000Z", windowEnd: "2026-09-10T23:59:59.999Z",
    sourceRevision: "source:network-1", targetOltIds: ["olt-1"], rowCount: 0, status: "complete"
  });
  const nmseManifest = createSourceManifest({
    source: "nmse", sourceKind: "nmse-boss-incremental-overlay",
    scope: { kind: "boss-query", processStatus: "成功", operationStatus: "全部", content: "厚街镇" },
    collectionStartedAt: "2026-09-10T01:00:00.000Z", collectionCompletedAt: "2026-09-10T01:01:00.000Z",
    windowStart: "2026-09-08T16:00:00.000Z", windowEnd: "2026-09-09T16:00:00.000Z",
    sourceRevision: "source:nmse-1", targetOltIds: ["olt-1"], rowCount: 0, status: "complete",
    exclusiveWatermark: "2026-09-09T16:00:00.000Z", coverageThrough: "2026-09-09"
  });
  const fixture = createFixture({
    backupDatabaseBeforeSync: async () => {
      backupEntered.resolve();
      await releaseBackup.promise;
      return { path: "/safe/backup.sqlite", bytes: 10, sha256: "sha256" };
    },
    renewMergedOnuSyncLease: async (input) => ({
      renewed: false,
      run: { runId: input.runId, workerId: "another-worker", status: "running" }
    }),
    getMergedOnuSourceStatus: async () => ({
      network: { synced: true, revision: "source:network-1" },
      nmse: { synced: true, revision: "source:nmse-1" }
    }),
    getLatestMergedOnuSourceManifest: async (source) => source === "network" ? networkManifest : nmseManifest,
    syncMergedOnuDataset: async () => {
      datasetCommits += 1;
      return { networkCount: 0, nmseCount: 0, mergedCount: 0, conflictCount: 0, conflicts: [], revision: "must-not-commit" };
    }
  });

  const pending = fixture.runtime.runManualMerge({ idempotencyKey: "lease-lost-dataset" });
  await backupEntered.promise;
  await fireHeartbeat(fixture.timers);
  releaseBackup.resolve();
  await assert.rejects(pending, /租约/);
  assert.equal(datasetCommits, 0);
});

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

test("network source sync relogs once when the OSS session expires mid-read", async () => {
  let sessionNumber = 0;
  const { runtime, calls } = createFixture({
    ensureOssNgbSession: async () => {
      sessionNumber += 1;
      return {
        olts: [{ resourceIp: "resource-1", cuid: `cuid-${sessionNumber}` }],
        client: { readOnuInventory: async () => {
          if (sessionNumber === 1) throw Object.assign(new Error("expired"), { status: 401 });
          return [{ onuIndex: "1/1/1:1", loid: "L-1" }];
        } }
      };
    }
  });
  const result = await runtime.runSourceSync("network");
  assert.equal(result.source.revision, "network-revision");
  assert.equal(sessionNumber, 2);
  assert.equal(calls.filter((item) => item === "clear-oss").length, 1);
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

test("runtime closes the cross-process begin race when the database reports an active lease", async () => {
  const active = {
    runId: "other-process-run", operation: "nmse", status: "running", phase: "collecting",
    checkpoint: { status: "running", cursor: null }, leaseUntil: "2099-01-01T00:00:00.000Z",
    workerId: "other-process-worker"
  };
  const { runtime } = createFixture({
    listRecoverableMergedOnuSyncRuns: async () => [],
    beginMergedOnuSyncRun: async () => ({ accepted: false, duplicate: false, reason: "active_lease", run: active })
  });
  await assert.rejects(() => runtime.runSourceSync("network"), (error) => {
    assert.equal(error.status, 409);
    assert.equal(error.code, "MERGED_ONU_SYNC_LEASE_ACTIVE");
    assert.equal(error.recovery.runId, active.runId);
    return true;
  });
});

test("BOSS progress maps page/detail counts to live NMSE progress state", async () => {
  const { runtime, calls } = createFixture();
  await runtime.runSourceSync("nmse");
  assert.deepEqual(calls.find(([name]) => name === "page-state"), ["page-state", 3, 2, 1, 2]);
  assert.deepEqual(calls.find(([name]) => name === "detail-state"), ["detail-state", 3, 2, 2, 3]);
});

test("completed idempotent run replays a stable public success result", async () => {
  const { runtime } = createFixture({
    beginMergedOnuSyncRun: async () => ({ duplicate: true, runId: "run-done", existingRun: { runId: "run-done", operation: "network", status: "success" } }),
    getMergedOnuSyncRuns: async () => [{ id: "run-done", operation: "network", status: "success", networkCount: 4, nmseCount: 0, backupPath: "/private/backup.sqlite", backupBytes: 12, backupSha256: "sha256" }],
    getMergedOnuDatasetStatus: async () => ({ sources: { network: { revision: "source:network-1" } } })
  });
  const result = await runtime.runSourceSync("network", { idempotencyKey: "replay-key" });
  assert.deepEqual(result, {
    duplicate: true, replayed: true, operation: "network", runId: "run-done", recovered: false, recovery: null,
    count: 4, source: { revision: "source:network-1" }, backup: { name: "backup.sqlite", bytes: 12, sha256: "sha256" }
  });
});

for (const status of ["running", "failed"]) {
test(`duplicate ${status} run is rejected instead of reported as success`, async () => {
    const { runtime } = createFixture({
      beginMergedOnuSyncRun: async () => ({ duplicate: true, runId: `run-${status}`, existingRun: { runId: `run-${status}`, operation: "network", status } })
    });
    await assert.rejects(() => runtime.runSourceSync("network", { idempotencyKey: `duplicate-${status}` }), (error) => {
      assert.equal(error.status, 409);
      assert.equal(error.code, "MERGED_ONU_SYNC_DUPLICATE_NOT_REPLAYABLE");
      return true;
    });
  });
}

test("full staged retry keeps network and merged data untouched until BOSS succeeds", async () => {
  const calls = [];
  const durableStatuses = [];
  let bossAttempts = 0;
  const networkManifest = createSourceManifest({
    source: "network", sourceKind: "network-full-snapshot", scope: { kind: "target-olts" },
    collectionStartedAt: "2026-09-10T01:00:00.000Z", collectionCompletedAt: "2026-09-10T01:01:00.000Z",
    windowStart: "2026-09-10T00:00:00.000Z", windowEnd: "2026-09-10T23:59:59.999Z",
    sourceRevision: "source:network-1", targetOltIds: ["olt-1"], rowCount: 1, status: "complete"
  });
  const nmseManifest = createSourceManifest({
    source: "nmse", sourceKind: "nmse-boss-incremental-overlay",
    scope: { kind: "boss-query", processStatus: "成功", operationStatus: "全部", content: "厚街镇" },
    collectionStartedAt: "2026-09-10T01:00:00.000Z", collectionCompletedAt: "2026-09-10T01:01:00.000Z",
    windowStart: "2026-09-08T16:00:00.000Z", windowEnd: "2026-09-09T16:00:00.000Z",
    sourceRevision: "source:nmse-1", targetOltIds: ["olt-1"], rowCount: 0, status: "complete",
    exclusiveWatermark: "2026-09-09T16:00:00.000Z", coverageThrough: "2026-09-09"
  });
  const { runtime } = createFixture({
    beginMergedOnuSyncRun: async (input) => ({ duplicate: false, run: { runId: input.runId, operation: input.operation, status: "running", checkpoint: { status: "running" } } }),
    updateMergedOnuSyncRuntime: async (input) => { durableStatuses.push(input.status); return { updated: true, run: { runId: input.runId, operation: input.runId, status: input.status, checkpoint: input.checkpoint } }; },
    getLatestMergedOnuSourceManifest: async (source) => source === "network" ? networkManifest : nmseManifest,
    getMergedOnuSourceStatus: async () => ({ network: { revision: "source:network-1" }, nmse: { revision: "source:nmse-1" } }),
    runNmseBossIncremental: async () => { bossAttempts += 1; if (bossAttempts === 1) throw Object.assign(new Error("BOSS 分页失败"), { status: 502 }); },
    replaceMergedOnuNetworkSource: async ({ rows }) => { calls.push(["network-source", rows.length]); return { source: { revision: "source:network-1" } }; },
    persistMergedOnuManifest: async () => { calls.push("network-manifest"); },
    syncMergedOnuDataset: async () => { calls.push("merge"); return { networkCount: 1, nmseCount: 0, mergedCount: 1, conflictCount: 0, conflicts: [], revision: "dataset:1" }; }
  });
  await assert.rejects(() => runtime.runFullSync({ idempotencyKey: "full-fail" }), /BOSS 分页失败/);
  assert.deepEqual(calls, []);
  assert.deepEqual(durableStatuses, ["failed"]);
  const success = await runtime.runFullSync({ idempotencyKey: "full-retry" });
  assert.equal(success.mergedCount, 1);
  assert.deepEqual(calls, [["network-source", 1], "network-manifest", "merge"]);
  assert.deepEqual(durableStatuses, ["failed", "running", "success"]);
});

for (const failurePoint of ["network-manifest", "merge"]) {
  test(`full sync keeps the committed BOSS stage and old merged dataset when ${failurePoint} fails`, async () => {
    let runSequence = 0;
    let bossCommits = 0;
    let networkReplacements = 0;
    let manifestWrites = 0;
    let mergeAttempts = 0;
    let unifiedRevision = "dataset:old";
    const calls = [];
    const networkManifest = createSourceManifest({
      source: "network", sourceKind: "network-full-snapshot", scope: { kind: "target-olts" },
      collectionStartedAt: "2026-09-10T01:00:00.000Z", collectionCompletedAt: "2026-09-10T01:01:00.000Z",
      windowStart: "2026-09-10T00:00:00.000Z", windowEnd: "2026-09-10T23:59:59.999Z",
      sourceRevision: "source:network-1", targetOltIds: ["olt-1"], rowCount: 1, status: "complete"
    });
    const nmseManifest = createSourceManifest({
      source: "nmse", sourceKind: "nmse-boss-incremental-overlay",
      scope: { kind: "boss-query", processStatus: "成功", operationStatus: "全部", content: "厚街镇" },
      collectionStartedAt: "2026-09-10T01:00:00.000Z", collectionCompletedAt: "2026-09-10T01:01:00.000Z",
      windowStart: "2026-09-08T16:00:00.000Z", windowEnd: "2026-09-09T16:00:00.000Z",
      sourceRevision: "source:nmse-1", targetOltIds: ["olt-1"], rowCount: 0, status: "complete",
      exclusiveWatermark: "2026-09-09T16:00:00.000Z", coverageThrough: "2026-09-09"
    });
    const { runtime } = createFixture({
      beginMergedOnuSyncRun: async (input) => ({
        duplicate: false,
        run: { runId: `run-${++runSequence}`, operation: input.operation, status: "running", checkpoint: { status: "running" } }
      }),
      getMergedOnuDatasetStatus: async () => ({ revision: unifiedRevision, sources: { network: { revision: "source:network-1" }, nmse: { revision: "source:nmse-1" } } }),
      getLatestMergedOnuSourceManifest: async (source) => source === "network" ? networkManifest : nmseManifest,
      getMergedOnuSourceStatus: async () => ({ network: { revision: "source:network-1" }, nmse: { revision: "source:nmse-1" } }),
      runNmseBossIncremental: async () => { bossCommits += 1; calls.push("boss-commit"); },
      replaceMergedOnuNetworkSource: async ({ rows }) => {
        networkReplacements += 1;
        calls.push(["network-source", rows.length]);
        return { source: { revision: "source:network-1" } };
      },
      persistMergedOnuManifest: async () => {
        manifestWrites += 1;
        if (failurePoint === "network-manifest" && manifestWrites === 1) throw new Error("network manifest 写入失败");
        calls.push("network-manifest");
      },
      syncMergedOnuDataset: async () => {
        mergeAttempts += 1;
        if (failurePoint === "merge" && mergeAttempts === 1) throw new Error("merge 写入失败");
        unifiedRevision = "dataset:new";
        calls.push("merge");
        return { networkCount: 1, nmseCount: 0, mergedCount: 1, conflictCount: 0, conflicts: [], revision: unifiedRevision };
      }
    });

    const expectedFailure = failurePoint === "network-manifest" ? "network manifest 写入失败" : "merge 写入失败";
    await assert.rejects(() => runtime.runFullSync({ idempotencyKey: `${failurePoint}-first` }), new RegExp(expectedFailure));
    assert.equal(bossCommits, 1, "BOSS 一期本地原子提交应在后续阶段失败后保留");
    assert.equal(unifiedRevision, "dataset:old", "后续阶段失败不得改写旧统一数据集");
    assert.equal(calls.includes("merge"), false, "network manifest 失败时不得进入统一数据集写入");

    const retried = await runtime.runFullSync({ idempotencyKey: `${failurePoint}-retry` });
    assert.equal(retried.revision, "dataset:new");
    assert.equal(bossCommits, 2);
    assert.equal(networkReplacements, 2);
    assert.equal(unifiedRevision, "dataset:new");
    assert.equal(mergeAttempts, failurePoint === "merge" ? 2 : 1);
    assert.equal(manifestWrites, failurePoint === "network-manifest" ? 2 : 2);
  });
}
