import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { guardNetworkSourceRows, networkGuardWarningText } from "../src/network-source-guard.mjs";
import { summarizeMergedChanges } from "../src/merged-onu-change-summary.mjs";
import { createMergedOnuSyncRuntime } from "../src/merged-onu-sync-runtime.mjs";
import { createNmseBossIncrementalRuntime } from "../src/nmse-boss-runtime.mjs";
import { createFeishuQueryApplication } from "../src/feishu/application.mjs";
import { emptyFeishuState } from "../src/feishu/state.mjs";

process.env.OLT_MANAGER_DATA_DIR = await mkdtemp(join(tmpdir(), "olt-user-data-sync-"));
const db = await import("../src/db.mjs");
const require = createRequire(import.meta.url);
const { renderReply } = require("../src/feishu/production-runtime.cjs");

function rows(oltIp, count, start = 1) {
  return Array.from({ length: count }, (_, index) => ({ oltIp, chassis: "1", board: "1", pon: "1", onuId: String(start + index), loid: `${oltIp}-L${start + index}` }));
}

test("二期单台 OLT 保护：匹配不到、返回 0 条、骤减时保留上次快照，其它 OLT 照常更新", () => {
  const previousRows = [...rows("10.0.0.1", 50), ...rows("10.0.0.2", 40), ...rows("10.0.0.3", 30), ...rows("10.0.0.4", 25)];
  const fresh = new Map([
    ["10.0.0.1", { rows: rows("10.0.0.1", 52) }],
    ["10.0.0.2", { rows: null }],
    ["10.0.0.3", { rows: [] }],
    ["10.0.0.4", { rows: rows("10.0.0.4", 10) }]
  ]);
  const targets = ["1", "2", "3", "4"].map((n) => ({ oltIp: `10.0.0.${n}`, name: `OLT-${n}` }));
  const guarded = guardNetworkSourceRows({ targets, fresh, previousRows });
  assert.equal(guarded.rows.length, 52 + 40 + 30 + 25);
  assert.deepEqual(guarded.warnings.map((item) => [item.oltIp, item.reason, item.kept]), [
    ["10.0.0.2", "unmatched", true],
    ["10.0.0.3", "empty", true],
    ["10.0.0.4", "dropped", true]
  ]);
  assert.match(networkGuardWarningText(guarded.warnings[2]), /OLT-4：网管二期返回 10 条，比上次 25 条减少超过 30%，已保留上次的 25 条数据/);

  const accepted = guardNetworkSourceRows({ targets, fresh, previousRows, acceptDrops: true });
  assert.equal(accepted.rows.length, 52 + 10);
  assert.ok(accepted.warnings.every((item) => item.kept === false));
});

test("二期单台 OLT 保护：首次同步或小幅减少不触发保护", () => {
  const targets = [{ oltIp: "10.0.0.1", name: "A" }];
  const first = guardNetworkSourceRows({ targets, fresh: new Map([["10.0.0.1", { rows: rows("10.0.0.1", 5) }]]), previousRows: [] });
  assert.equal(first.rows.length, 5);
  assert.deepEqual(first.warnings, []);
  const small = guardNetworkSourceRows({ targets, fresh: new Map([["10.0.0.1", { rows: rows("10.0.0.1", 15) }]]), previousRows: rows("10.0.0.1", 18) });
  assert.equal(small.rows.length, 15);
  assert.deepEqual(small.warnings, []);
});

test("合并变化摘要：按 LOID 识别新增、消失、换坐标、改名和联系方式变化", () => {
  const before = [
    { oltIp: "10.0.0.1", chassis: "1", board: "1", pon: "1", onuId: "1", loid: "A", username: "张三", userPhone: "1" },
    { oltIp: "10.0.0.1", chassis: "1", board: "1", pon: "1", onuId: "2", loid: "B", username: "李四" },
    { oltIp: "10.0.0.1", chassis: "1", board: "1", pon: "1", onuId: "3", loid: "C", username: "王五" }
  ];
  const after = [
    { oltIp: "10.0.0.1", chassis: "1", board: "1", pon: "1", onuId: "1", loid: "A", username: "张三丰", userPhone: "2" },
    { oltIp: "10.0.0.2", chassis: "1", board: "2", pon: "3", onuId: "4", loid: "B", username: "李四" },
    { oltIp: "10.0.0.1", chassis: "1", board: "1", pon: "1", onuId: "5", loid: "D", username: "赵六" }
  ];
  const summary = summarizeMergedChanges(before, after);
  assert.deepEqual([summary.added, summary.removed, summary.moved, summary.renamed, summary.contactChanged], [1, 1, 1, 1, 1]);
  assert.deepEqual(summary.samples.moved[0], { loid: "B", name: "李四", oltIp: "10.0.0.2", onuIndex: "1/2/3:4", from: "1/1/1:2", fromOltIp: "10.0.0.1" });
  assert.equal(summary.samples.renamed[0].before, "张三");
  assert.deepEqual(summary.byOlt, { "10.0.0.1": { added: 1, removed: 1 } });
  assert.equal(summarizeMergedChanges([], after), null);
});

test("同步运行时：二期匹配不到的 OLT 保留上次快照并在结果中返回告警", async () => {
  const stored = [];
  const recorded = [];
  let run = null;
  const runtime = createMergedOnuSyncRuntime({
    state: { running: false, status: "idle", phase: "idle" },
    recoveryState: { inspectedAt: "", runs: [] },
    setIntervalFn: () => ({}),
    clearIntervalFn: () => {},
    remoteSessionState: { clearNmseSession() {}, clearOssNgbSession() {} },
    mergedOnuService: {
      selectMergedOnuTargets: (olts) => olts.map((target) => ({ target, mapping: { resourceIp: `r-${target.host}` } })),
      selectMergedNmseTargets: (olts) => olts.map((target) => ({ target }))
    },
    getOlts: async () => [{ id: "a", name: "A", host: "10.0.0.1", enabled: true }, { id: "b", name: "B", host: "10.0.0.2", enabled: true }],
    getResourceOltIpMappings: async () => [],
    activeOssNgbSession: () => ({
      olts: [{ resourceIp: "r-10.0.0.1", cuid: "cuid-a" }],
      client: { readOnuInventory: async () => rows("", 3).map(({ oltIp, ...row }) => row) }
    }),
    backupDatabaseBeforeSync: async () => ({ path: "/b.sqlite", bytes: 1, sha256: "s" }),
    listRecoverableMergedOnuSyncRuns: async () => [],
    beginMergedOnuSyncRun: async (input) => { run = { ...input, status: "running" }; return { duplicate: false, run }; },
    claimMergedOnuSyncLease: async () => ({ claimed: false }),
    renewMergedOnuSyncLease: async () => ({ renewed: true, run }),
    updateMergedOnuSyncRuntime: async (input) => { run = { ...run, ...input }; return { updated: true, run }; },
    getLatestMergedOnuSourceManifest: async () => null,
    getMergedOnuSourceStatus: async () => ({ network: {}, nmse: {} }),
    getMergedOnuDatasetStatus: async () => ({ sources: {} }),
    getMergedOnuSyncRuns: async () => [],
    getMergedOnuNetworkSource: async () => rows("10.0.0.2", 30),
    getMergedOnuNmseSource: async () => [],
    replaceMergedOnuNetworkSource: async ({ rows: input }) => { stored.push(input); return { source: { revision: "r" } }; },
    runNmseBossIncremental: async () => {},
    persistMergedOnuManifest: async () => {},
    recordMergedOnuSourceSyncSuccess: async (input) => { recorded.push(input); },
    recordMergedOnuSyncFailure: async () => {},
    syncMergedOnuDataset: async () => ({})
  });
  const result = await runtime.runSourceSync("network");
  assert.equal(stored[0].length, 33);
  assert.equal(stored[0].filter((row) => row.oltIp === "10.0.0.2").length, 30);
  assert.equal(result.networkWarnings.length, 1);
  assert.equal(result.networkWarnings[0].oltIp, "10.0.0.2");
  assert.match(result.networkWarnings[0].message, /B：在网管二期中没有匹配到该 OLT/);
  assert.deepEqual(recorded[0].summary.networkWarnings, result.networkWarnings);

  const accepted = await runtime.runSourceSync("network", { acceptDrops: true });
  assert.equal(stored[1].length, 3);
  assert.equal(accepted.networkWarnings[0].kept, false);
});

test("同步记录保存摘要，数据集状态返回最近一次变化与二期告警", async () => {
  await db.initDb();
  const backup = { path: "/b.sqlite", bytes: 1, sha256: "s" };
  await db.recordMergedOnuSourceSyncSuccess({ runId: "net-1", operation: "network", networkCount: 3, backup, summary: { networkWarnings: [{ oltIp: "10.0.0.2", kept: true, message: "B：保留" }] } });
  await db.replaceMergedOnuDataset({
    runId: "merge-1", operation: "merge",
    rows: rows("10.0.0.1", 2).map((row) => ({ ...row, onuIndexDisplay: `1/1/1:${row.onuId}`, usernameSource: "network", userPhone: "", installationAddress: "", deviceType: "", ponType: "", phase: "", rxPower: "", distance: "", nmseOltIp: "", nmseOnuIndex: "" })),
    conflicts: [], networkCount: 2, nmseCount: 0, backup,
    summary: { changes: { added: 2, removed: 0, moved: 0, renamed: 0, contactChanged: 0, samples: {} } }
  });
  const status = await db.getMergedOnuDatasetStatus();
  assert.equal(status.lastChangeSummary.added, 2);
  assert.equal(status.lastNetworkWarnings[0].message, "B：保留");
  assert.equal(status.latestRun.status, "success");
  const runs = await db.getMergedOnuSyncRuns();
  assert.equal(runs.find((item) => item.id === "merge-1").summary.changes.added, 2);
});

test("一期 BOSS 增量：重叠窗口内已入库的工单跳过详情请求", async () => {
  await db.initDb();
  const calls = [];
  const runtime = createNmseBossIncrementalRuntime({
    getState: async () => ({ watermark: "2026-10-08 10:00:00" }),
    getSession: async () => ({
      auth: {},
      client: {
        async getBossOperations(_auth, options) {
          calls.push(options);
          const listRows = [
            { serialNo: "W1", loid: "L1", recTime: "2026-10-07 09:00:00" },
            { serialNo: "W2", loid: "L2", recTime: "2026-10-08 11:00:00" }
          ];
          return listRows.filter((row) => !options.skipRow?.(row));
        }
      }
    }),
    getKnownEventKeys: async ({ since }) => {
      calls.push({ since });
      return new Set(["W1|L1|2026-10-07 09:00:00"]);
    },
    applyChanges: async ({ rows: changes, watermark }) => ({ watermark, count: changes.length }),
    now: () => new Date("2026-10-09T04:00:00.000Z")
  });
  await assert.rejects(() => runtime.run(), /BOSS第 1 条记录/);
  assert.equal(calls[0].since, "2026-10-07 00:00:00");
  assert.equal(typeof calls[1].skipRow, "function");
  assert.equal(calls[1].skipRow({ serialNo: "W1", loid: "l1", recTime: "2026-10-07 09:00:00" }), true);
  assert.equal(calls[1].skipRow({ serialNo: "W2", loid: "L2", recTime: "2026-10-08 11:00:00" }), false);
  assert.equal(calls[1].skipRow({ serialNo: "W3", loid: "L3", recTime: "坏时间" }), false);

  await db.rawExec(`INSERT INTO nmse_boss_change_events (event_key, work_order, loid, operation, received_at)
VALUES ('W1|L1|2026-10-07 09:00:00', 'W1', 'L1', 'install', '2026-10-07 09:00:00'), ('W0|L0|2026-09-01 09:00:00', 'W0', 'L0', 'install', '2026-09-01 09:00:00');`);
  assert.deepEqual([...await db.getNmseBossEventKeys({ since: "2026-10-07 00:00:00" })], ["W1|L1|2026-10-07 09:00:00"]);
});

test("飞书：用户资料类回复附上资料同步时间，过旧或最近同步失败时提醒", async () => {
  const sent = [];
  let freshness = { syncedAt: "2026-10-09T03:30:00.000Z", latestRun: { status: "success", completedAt: "2026-10-09T03:30:00.000Z" } };
  const gateway = {
    async listOlts() { return [{ oltId: "olt-1", name: "OLT 1", enabled: true }]; },
    async queryUsers() {
      return { authorizedCount: 2, candidates: [1, 2].map((index) => ({ candidateId: `c${index}`, oltId: "olt-1", name: `用户${index}`, phone: "", address: "地址", loid: "", mac: "", onu: { chassis: "1", board: "1", pon: "1", onuId: String(index) } })) };
    },
    async queryPons() { return { authorizedCount: 0, candidates: [] }; },
    async datasetFreshness() { return freshness; }
  };
  let current = "2026-10-09T04:00:00.000Z";
  const app = createFeishuQueryApplication({
    stateStore: { value: { ...emptyFeishuState(), enabled: true }, async read() { return structuredClone(this.value); }, async write(next) { this.value = structuredClone(next); } },
    gateway,
    interpret: async () => ({ type: "query", version: "1", intent: "find_by_name", value: "用户" }),
    now: () => current,
    send: async (_chatId, reply) => { sent.push(reply); }
  });
  const reply = await app.handleMessage({ eventId: "f1", openId: "ou", chatId: "oc", text: "查用户" });
  assert.equal(reply.kind, "candidate-set");
  assert.deepEqual(reply.dataFreshness, { syncedAt: "2026-10-09T03:30:00.000Z", stale: false, lastSyncFailed: false });
  assert.match(JSON.stringify(renderReply(reply).content), /用户资料同步于 \d{2}-\d{2} \d{2}:\d{2}/);

  current = "2026-10-11T04:00:00.000Z";
  freshness = { syncedAt: "2026-10-09T03:30:00.000Z", latestRun: { status: "failed", completedAt: "2026-10-10T18:00:00.000Z" } };
  const stale = await app.handleMessage({ eventId: "f2", openId: "ou", chatId: "oc", text: "查用户" });
  assert.equal(stale.dataFreshness.stale, true);
  assert.equal(stale.dataFreshness.lastSyncFailed, true);
  assert.match(JSON.stringify(renderReply(stale).content), /最近一次同步失败，资料可能不是最新/);
});
