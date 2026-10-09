import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOnuBaselines,
  comparePonRepair,
  localDateKey,
  nightlySampleRows,
  parseRxDbm,
  selectBaselineNights,
  shiftDateKey,
  summarizeRepairResults
} from "../src/optical-baseline.mjs";
import { needsCatchUp, nextBaselineRunAt, createOpticalBaselineScheduler } from "../src/optical-baseline-scheduler.mjs";

function nightly(onuId, dates, { rx = -20, phase = "online" } = {}) {
  return dates.map((sampleDate) => ({ onuId, sampleDate, phase, rxDbm: phase === "online" ? rx : null }));
}

const WEEK = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"];

test("parseRxDbm 只接受合理的 dBm 数值", () => {
  assert.equal(parseRxDbm("-21.50 dBm"), -21.5);
  assert.equal(parseRxDbm(-19), -19);
  assert.equal(parseRxDbm("unknown"), null);
  assert.equal(parseRxDbm("65535"), null);
  assert.equal(parseRxDbm(""), null);
});

test("日期工具按日历日偏移", () => {
  assert.equal(shiftDateKey("2026-03-01", -1), "2026-02-28");
  assert.equal(localDateKey(new Date(2026, 9, 9, 23, 30)), "2026-10-09");
});

test("夜间采样只保留坐标、状态和在线收光", () => {
  const rows = nightlySampleRows([
    { chassis: "1", board: "2", pon: "3", onuId: "4", phase: "working", rxPower: "-22.10 dBm", serial: "SECRET" },
    { chassis: "1", board: "2", pon: "3", onuId: "4", phase: "working", rxPower: "-22.10 dBm" },
    { chassis: "1", slot: "2", pon: "3", onuId: "5", phase: "LOS", rxPower: "-40" },
    { chassis: "1", board: "", pon: "3", onuId: "6", phase: "online" }
  ]);
  assert.deepEqual(rows, [
    { chassis: "1", board: "2", pon: "3", onuId: "4", phase: "online", rxDbm: -22.1 },
    { chassis: "1", board: "2", pon: "3", onuId: "5", phase: "offline", rxDbm: null }
  ]);
});

test("基线取断纤当晚之前的最近 7 晚，跳过整口离线的夜晚和今天", () => {
  const dates = [...WEEK, "2026-10-08", "2026-10-09"];
  const samples = [
    ...nightly("1", WEEK, { rx: -20 }),
    ...nightly("2", WEEK, { rx: -22 }),
    ...nightly("1", ["2026-10-08"], { phase: "offline" }),
    ...nightly("2", ["2026-10-08"], { phase: "offline" }),
    ...nightly("1", ["2026-10-09"], { rx: -25 }),
    ...nightly("2", ["2026-10-09"], { rx: -26 })
  ];
  assert.equal(dates.length, 9);
  const window = selectBaselineNights(samples, { today: "2026-10-10" });
  assert.equal(window.outageNight, "2026-10-08");
  assert.deepEqual(window.nights, WEEK);
  const { baselines } = buildOnuBaselines(samples, { today: "2026-10-10" });
  assert.equal(baselines.get("1").rxDbm, -20);
  assert.equal(baselines.get("2").rxDbm, -22);
});

test("没有断纤夜时取今天之前最近 7 晚的中位数", () => {
  const samples = [
    ...nightly("1", ["2026-10-01", "2026-10-02"], { rx: -30 }),
    ...nightly("1", ["2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"], { rx: -20 }),
    ...nightly("1", ["2026-10-10"], { rx: -10 })
  ];
  const { window, baselines } = buildOnuBaselines(samples, { today: "2026-10-10" });
  assert.deepEqual(window.nights, ["2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]);
  assert.equal(baselines.get("1").rxDbm, -20);
});

test("逐户对比：变差 2 dB 以上、未恢复、断纤前已离线分别计数并判断为主干熔接", () => {
  const samples = [
    ...nightly("1", WEEK, { rx: -20 }),
    ...nightly("2", WEEK, { rx: -21 }),
    ...nightly("3", WEEK, { rx: -19 }),
    ...nightly("4", WEEK, { rx: -22 }),
    ...nightly("5", WEEK, { phase: "offline" })
  ];
  const liveRows = [
    { onuId: "1", phase: "online", rxPower: "-23.00" },
    { onuId: "2", phase: "online", rxPower: "-23.50" },
    { onuId: "3", phase: "online", rxPower: "-22.10" },
    { onuId: "4", phase: "offline", rxPower: "unknown" },
    { onuId: "5", phase: "offline", rxPower: "unknown" },
    { onuId: "6", phase: "online", rxPower: "-18" }
  ];
  const users = [
    { onuId: "1", username: "甲", installationAddress: "示例村一巷1号", userPhone: "13800000001" },
    { onuId: "4", username: "丁", installationAddress: "示例村一巷4号", userPhone: "13800000004" }
  ];
  const result = comparePonRepair({ liveRows, samples, users, today: "2026-10-09" });
  assert.equal(result.status, "compared");
  assert.deepEqual(result.counts, { total: 6, recovered: 4, normal: 0, slight: 0, degraded: 3, offlineBefore: 1, notRecovered: 1, offlineUnknown: 0, noBaseline: 1 });
  assert.equal(result.pattern, "trunk");
  assert.deepEqual(result.degraded.map((item) => [item.onuId, item.delta]), [["3", -3.1], ["1", -3], ["2", -2.5]]);
  assert.equal(result.degraded[1].name, "甲");
  assert.deepEqual(result.notRecovered, [{ onuId: "4", name: "丁", address: "示例村一巷4号", phone: "13800000004", before: -22 }]);
  assert.equal(result.baselineFrom, "2026-10-01");
  assert.equal(result.baselineTo, "2026-10-07");
});

test("逐户对比：只有一户变差判断为入户段，两户以上但未过半判断为分支段", () => {
  const samples = ["1", "2", "3", "4", "5"].flatMap((onuId) => nightly(onuId, WEEK, { rx: -20 }));
  const live = (bad) => ["1", "2", "3", "4", "5"].map((onuId) => ({ onuId, phase: "online", rxPower: bad.includes(onuId) ? "-23" : "-20.5" }));
  assert.equal(comparePonRepair({ liveRows: live(["1"]), samples, today: "2026-10-09" }).pattern, "drop");
  assert.equal(comparePonRepair({ liveRows: live(["1", "2"]), samples, today: "2026-10-09" }).pattern, "branch");
  const fine = comparePonRepair({ liveRows: live([]), samples, today: "2026-10-09" });
  assert.equal(fine.pattern, "none");
  assert.equal(fine.counts.normal, 5);
});

test("没有夜间采样时返回 no-baseline，整口离线返回 all-offline", () => {
  assert.equal(comparePonRepair({ liveRows: [{ onuId: "1", phase: "online", rxPower: "-20" }], samples: [], today: "2026-10-09" }).status, "no-baseline");
  const samples = nightly("1", WEEK, { rx: -20 });
  assert.equal(comparePonRepair({ liveRows: [{ onuId: "1", phase: "offline" }], samples, today: "2026-10-09" }).status, "all-offline");
});

test("汇总多个 PON 口的逐户对比结果", () => {
  const summary = summarizeRepairResults([
    { counts: { total: 3, recovered: 3, degraded: 1 }, pattern: "drop" },
    { counts: { total: 2, recovered: 1, notRecovered: 1 }, pattern: "none" }
  ]);
  assert.equal(summary.ponCount, 2);
  assert.equal(summary.totals.total, 5);
  assert.equal(summary.totals.degraded, 1);
  assert.equal(summary.totals.notRecovered, 1);
  assert.deepEqual(summary.patterns, { trunk: 0, branch: 0, drop: 1 });
});

test("调度时间：下一次整点与开机补采判断", () => {
  const now = new Date(2026, 9, 9, 10, 30);
  assert.equal(nextBaselineRunAt(now, 2).getTime(), new Date(2026, 9, 10, 2, 0).getTime());
  assert.equal(nextBaselineRunAt(new Date(2026, 9, 9, 1, 0), 2).getTime(), new Date(2026, 9, 9, 2, 0).getTime());
  assert.equal(needsCatchUp({ now, runHour: 2, lastSuccessDate: "2026-10-08" }), true);
  assert.equal(needsCatchUp({ now, runHour: 2, lastSuccessDate: "2026-10-09" }), false);
  assert.equal(needsCatchUp({ now: new Date(2026, 9, 9, 1, 0), runHour: 2, lastSuccessDate: "" }), false);
});

test("采集逐台读取已启用 OLT，单台失败记为部分成功", async () => {
  const runs = [];
  const recorded = [];
  const scheduler = createOpticalBaselineScheduler({
    getSettings: async () => ({ enabled: true, runHour: 2 }),
    getOlts: async () => [
      { id: "a", name: "A", enabled: true },
      { id: "b", name: "B", enabled: true },
      { id: "c", name: "C", enabled: false }
    ],
    readOltRows: async (olt) => {
      if (olt.id === "b") throw new Error("SNMP 超时");
      return [{ chassis: "1", board: "1", pon: "1", onuId: "1", phase: "online", rxPower: "-20" }];
    },
    recordSamples: async (input) => { recorded.push(input); return { count: input.rows.length }; },
    beginRun: async (input) => { runs.push({ begin: input }); return 7; },
    finishRun: async (input) => { runs.push({ finish: input }); },
    getRuns: async () => [],
    now: () => new Date(2026, 9, 9, 2, 0),
    setTimer: () => ({ unref() {} }),
    clearTimer: () => {}
  });
  const result = await scheduler.runNow({ trigger: "manual" });
  assert.equal(result.status, "partial");
  assert.equal(result.sampleDate, "2026-10-09");
  assert.deepEqual(recorded.map((item) => item.oltId), ["a"]);
  assert.equal(runs[0].begin.trigger, "manual");
  assert.equal(runs[1].finish.status, "partial");
  assert.equal(runs[1].finish.failedOltCount, 1);
  assert.match(runs[1].finish.error, /B：SNMP 超时/);
});

test("启动时缺少当天采集会安排补采，关闭采集时不安排", async () => {
  const timers = [];
  const make = (enabled, lastDate) => createOpticalBaselineScheduler({
    getSettings: async () => ({ enabled, runHour: 2 }),
    getOlts: async () => [],
    readOltRows: async () => [],
    recordSamples: async () => ({ count: 0 }),
    beginRun: async () => 1,
    finishRun: async () => {},
    getRuns: async () => lastDate ? [{ status: "success", sampleDate: lastDate }] : [],
    now: () => new Date(2026, 9, 9, 10, 0),
    setTimer: (fn, delay) => { timers.push(delay); return { unref() {} }; },
    clearTimer: () => {}
  });
  const missing = make(true, "2026-10-08");
  await missing.start();
  assert.equal(timers.at(-1), 2 * 60 * 1000);
  missing.stop();
  const done = make(true, "2026-10-09");
  await done.start();
  assert.equal(timers.at(-1), new Date(2026, 9, 10, 2, 0).getTime() - new Date(2026, 9, 9, 10, 0).getTime());
  done.stop();
  const count = timers.length;
  const disabled = make(false, "");
  await disabled.start();
  assert.equal(timers.length, count);
  assert.equal((await disabled.status()).nextRunAt, "");
});

test("采集 PON 口清单：PON 台账与合并台账取并集，华为机框统一为 0", async () => {
  const { baselinePonsForOlt } = await import("../src/optical-baseline-scheduler.mjs");
  const zte = { host: "10.0.0.1", vendor: "zte" };
  const huawei = { host: "10.0.0.2", vendor: "huawei" };
  const ponPorts = [
    { oltIp: "10.0.0.1", chassis: "1", board: "3", pon: "1" },
    { oltIp: "10.0.0.1", ponPort: "1/3/2" },
    { oltIp: "10.0.0.2", chassis: "1", board: "1", pon: "0" },
    { oltIp: "10.0.0.1", chassis: "1", board: "", pon: "" }
  ];
  const snapshotPons = [
    { oltIp: "10.0.0.1", chassis: "1", board: "3", pon: "1" },
    { oltIp: "10.0.0.1", chassis: "1", board: "12", pon: "16" },
    { oltIp: "10.0.0.2", chassis: "0", board: "1", pon: "0" }
  ];
  assert.deepEqual(baselinePonsForOlt(zte, { ponPorts, snapshotPons }), [
    { chassis: "1", board: "3", pon: "1", hasUsers: true },
    { chassis: "1", board: "3", pon: "2", hasUsers: false },
    { chassis: "1", board: "12", pon: "16", hasUsers: true }
  ]);
  assert.deepEqual(baselinePonsForOlt(huawei, { ponPorts, snapshotPons }), [{ chassis: "0", board: "1", pon: "0", hasUsers: true }]);
});

test("逐口采集：限制并发、统计空口和失败口、只保留本口的行", async () => {
  const { collectOltRowsByPon } = await import("../src/optical-baseline-scheduler.mjs");
  let active = 0;
  let peak = 0;
  const progress = [];
  const pons = ["1", "2", "3", "4"].map((pon) => ({ chassis: "1", board: "1", pon, hasUsers: pon !== "4" }));
  const result = await collectOltRowsByPon({
    pons,
    concurrency: 2,
    onProgress: (update) => progress.push(update.ponDone),
    readPon: async (pon) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      if (pon.pon === "3") throw new Error("超时");
      if (pon.pon === "4") return [];
      return [{ board: "1", pon: pon.pon, onuId: "1" }, { board: "1", pon: "9", onuId: "2" }];
    }
  });
  assert.equal(peak, 2);
  assert.deepEqual(result.rows.map((row) => row.pon).sort(), ["1", "2"]);
  assert.deepEqual([result.ponCount, result.emptyPons, result.failedPons], [4, 1, 1]);
  // 4 号口是只在台账出现的空口，不算异常；3 号口有用户却读取失败。
  assert.deepEqual(result.missingWithUsers, ["1/1/3"]);
  assert.deepEqual(progress, [1, 2, 3, 4]);
});

test("采集记录逐口结果：部分空口记为提示，全部空口才算该 OLT 失败", async () => {
  const runs = [];
  let seenProgress = null;
  const scheduler = createOpticalBaselineScheduler({
    getSettings: async () => ({ enabled: true, runHour: 2 }),
    getOlts: async () => [{ id: "a", name: "A", enabled: true }, { id: "b", name: "B", enabled: true }],
    readOltRows: async (olt, { onProgress }) => {
      onProgress({ ponDone: 1, ponTotal: 3 });
      seenProgress = (await scheduler.status()).progress;
      return olt.id === "a"
        ? { rows: [{ chassis: "1", board: "1", pon: "1", onuId: "1", phase: "online", rxPower: "-20" }], ponCount: 3, emptyPons: 2, failedPons: 0, missingWithUsers: ["1/1/2"] }
        : { rows: [], ponCount: 5, emptyPons: 5, failedPons: 0 };
    },
    recordSamples: async ({ rows }) => ({ count: rows.length }),
    beginRun: async () => 1,
    finishRun: async (input) => { runs.push(input); },
    getRuns: async () => [],
    now: () => new Date(2026, 9, 9, 2, 0),
    setTimer: () => ({ unref() {} }),
    clearTimer: () => {}
  });
  const result = await scheduler.runNow();
  assert.equal(result.status, "partial");
  assert.deepEqual(seenProgress, { oltIndex: 2, oltCount: 2, oltName: "B", ponDone: 1, ponTotal: 3 });
  assert.match(runs[0].error, /A：1 个有用户的 PON 口未返回数据（1\/1\/2）/);
  assert.doesNotMatch(runs[0].error, /可能是空口/);
  assert.match(runs[0].error, /B：5 个 PON 口均未返回 ONU 数据/);
  assert.equal((await scheduler.status()).progress, null);
});
