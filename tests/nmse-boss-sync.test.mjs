import test from "node:test";
import assert from "node:assert/strict";
import { BOSS_READ_ONLY_QUERY, applyBossChangesToRows, buildBossQuery, canonicalizeBossWallDate, computeBossIncrementalWindow, deduplicateBossChanges, filterBossChanges, normalizeBossChange } from "../src/nmse-boss-sync.mjs";
import { formatBossConversionDate, NmseClient } from "../src/nmse-client.mjs";
import { createNmseBossIncrementalRuntime } from "../src/nmse-boss-runtime.mjs";

test("BOSS window overlaps watermark by one day and ends at yesterday midnight", () => {
  assert.deepEqual(computeBossIncrementalWindow({ watermark: "2026-09-07 00:00:00", now: new Date("2026-09-09T12:00:00") }), {
    start: "2026-09-06 00:00:00", end: "2026-09-08 00:00:00", eligibleEnd: "2026-09-08 00:00:00", overlapDays: 1
  });
});

test("BOSS window fails closed without a confirmed watermark", () => {
  assert.throws(() => computeBossIncrementalWindow({ now: new Date("2026-09-09T12:00:00Z") }), /缺少已确认水位/);
});

test("BOSS window uses Shanghai calendar boundaries and rejects future watermarks", () => {
  assert.deepEqual(computeBossIncrementalWindow({ watermark: "2026-09-30 00:00:00", now: new Date("2026-09-30T16:30:00Z") }), {
    start: "2026-09-29 00:00:00", end: "2026-09-30 00:00:00", eligibleEnd: "2026-09-30 00:00:00", overlapDays: 1
  });
  assert.throws(() => computeBossIncrementalWindow({ watermark: "2026-10-01 00:00:00", now: new Date("2026-09-30T16:30:00Z") }), /晚于可同步范围/);
});

test("BOSS receive times canonicalize real one-digit wall-clock dates", () => {
  assert.equal(canonicalizeBossWallDate("2026-2-3 1:2:3"), "2026-02-03 01:02:03");
  assert.throws(() => canonicalizeBossWallDate("2026-2-30 1:2:3"), /无效/);
  assert.equal(canonicalizeBossWallDate("2026-02-03T00:00:00Z"), "2026-02-03 08:00:00");
});

test("BOSS filters successful supported operations and thick-street address", () => {
  assert.throws(() => filterBossChanges([
    { operation: "报装", processStatus: "成功", receivedAt: "2026-09-07 10:00:00", installationAddress: "东莞市厚街镇一号", workOrderNo: "w1", LOID: " l-1 ", oltIp: "192.0.2.1", onuIndex: "1/1/1:1" },
    { operation: "移机", processStatus: "处理中", receivedAt: "2026-09-07 10:00:00", installationAddress: "厚街镇二号", workOrderNo: "w2", LOID: "l-2" }
  ], { window: { start: "2026-09-07 00:00:00", end: "2026-09-08 00:00:00" } }), /拒绝推进水位/);
});

test("BOSS successful cancellation without address remains in the fixed query scope", () => {
  const rows = filterBossChanges([{
    operation: "销户", processStatus: "成功", receivedAt: "2026-09-07 10:00:00", workOrderNo: "cancel-no-address", LOID: "cancel-loid"
  }], { window: { start: "2026-09-07 00:00:00", end: "2026-09-08 00:00:00" } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].operation, "cancel");
});

test("BOSS change key is work order, LOID and receive time", () => {
  const row = normalizeBossChange({ operation: "销户", processStatus: "成功", workOrder: "w", LOID: "x", receivedAt: "2026-09-07 1:2:3" });
  assert.equal(row.receivedAt, "2026-09-07 01:02:03");
  assert.equal(row.idempotencyKey, "w|X|2026-09-07 01:02:03");
  assert.equal(deduplicateBossChanges([row, { ...row }]).length, 1);
});

test("BOSS projection moves coordinates, deletes only successful cancellations, and ignores stale events", () => {
  const original = [{ oltIp: "192.0.2.1", onuIndex: "1/1/1:1", loid: "L", username: "旧" }];
  const moved = applyBossChangesToRows(original, [
    normalizeBossChange({ operation: "移机", processStatus: "成功", workOrder: "new", LOID: "L", receivedAt: "2026-09-07 02:00:00", oltIp: "192.0.2.1", onuIndex: "1/1/2:1", username: "新" }),
    normalizeBossChange({ operation: "销户", processStatus: "成功", workOrder: "old", LOID: "L", receivedAt: "2026-09-07 01:00:00" })
  ]);
  assert.equal(moved.length, 1);
  assert.equal(moved[0].onuIndex, "1/1/2:1");
  assert.equal(moved[0].username, "新");
});

test("BOSS query contract is fixed", () => {
  assert.deepEqual(buildBossQuery({ window: { start: "a", end: "b" } }).operationStatus, "全部");
  assert.equal(formatBossConversionDate("2026-09-06 00:00:00"), "2026-9-6 0:0:0");
  assert.equal(formatBossConversionDate("2026-09-08 12:34:56"), "2026-9-8 12:34:56");
});

test("BOSS runtime advances watermark only after local transaction succeeds", async () => {
  let applyCalls = 0;
  const runtime = createNmseBossIncrementalRuntime({
    getState: async () => ({ watermark: "2026-09-07 00:00:00" }),
    getSession: async () => ({ client: { getBossOperations: async () => [] }, auth: {} }),
    applyChanges: async () => { applyCalls += 1; throw new Error("事务失败"); },
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ data: { list: [] } }) }),
    now: () => new Date("2026-09-09T12:00:00")
  });
  await assert.rejects(runtime.run(), /事务失败/);
  assert.equal(applyCalls, 1);
  assert.equal(runtime.state().watermark, "");
  assert.equal(runtime.state().status, "failed");
});

test("BOSS runtime stamps the manifest with the actual collection completion time", async () => {
  let appliedContext;
  let appliedCoverageThrough;
  const completedAt = new Date("2026-09-09T12:34:56.000Z");
  const runtime = createNmseBossIncrementalRuntime({
    getState: async () => ({ watermark: "2026-09-07 00:00:00" }),
    getSession: async () => ({ client: { getBossOperations: async () => [] }, auth: {} }),
    applyChanges: async (input) => { appliedContext = input.manifestContext; appliedCoverageThrough = input.coverageThrough; return { watermark: input.watermark }; },
    now: () => completedAt
  });
  await runtime.run({ manifestContext: { runId: "run-completion-time", startedAt: "2026-09-09T12:00:00.000Z", targetOltIds: ["olt-1"] } });
  assert.equal(appliedContext.completedAt, completedAt.toISOString());
  assert.equal(appliedContext.coverageThrough, "2026-09-07");
  assert.equal(appliedCoverageThrough, "2026-09-07");
  assert.equal(appliedContext.windowStart, "2026-09-05T16:00:00.000Z");
  assert.equal(appliedContext.windowEnd, "2026-09-07T16:00:00.000Z");
});

test("BOSS runtime reports and recovers one expired session", async () => {
  let sessionNumber = 1;
  let cleared = 0;
  let relogins = 0;
  const progress = [];
  const runtime = createNmseBossIncrementalRuntime({
    getState: async () => ({ watermark: "2026-09-07 00:00:00" }),
    getSession: async () => ({
      client: { getBossOperations: async () => {
        if (sessionNumber === 1) throw Object.assign(new Error("expired"), { status: 401 });
        return [];
      } },
      auth: {}
    }),
    applyChanges: async ({ watermark }) => ({ watermark }),
    clearSession: () => { cleared += 1; },
    relogin: async () => { relogins += 1; sessionNumber = 2; },
    now: () => new Date("2026-09-09T12:00:00.000Z")
  });
  const result = await runtime.run({ onProgress: (item) => progress.push(item) });
  assert.equal(result.status, "success");
  assert.equal(cleared, 1);
  assert.equal(relogins, 1);
  assert.deepEqual(progress[0], { phase: "boss-session-recovery", attempt: 1, maxAttempts: 1 });
});

test("BOSS runtime exposes a specific alert when automatic relogin fails", async () => {
  const runtime = createNmseBossIncrementalRuntime({
    getState: async () => ({ watermark: "2026-09-07 00:00:00" }),
    getSession: async () => ({ client: { getBossOperations: async () => { throw Object.assign(new Error("expired"), { status: 401 }); } }, auth: {} }),
    applyChanges: async () => ({ watermark: "" }),
    relogin: async () => { throw Object.assign(new Error("凭据不可用"), { status: 428 }); },
    now: () => new Date("2026-09-09T12:00:00.000Z")
  });
  await assert.rejects(runtime.run(), (error) => {
    assert.equal(error.code, "NMSE_SESSION_RECOVERY_FAILED");
    assert.match(error.message, /自动重新登录失败.*凭据不可用/);
    return true;
  });
});

test("NMSE client reads every BOSS page and every identity detail before returning", async () => {
  const calls = [];
  const client = new NmseClient({ serverUrl: "https://nmse.example", fetchImpl: async (url) => {
    const parsed = new URL(url); calls.push(parsed);
    const ok = (data) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ header: { opCode: "1" }, body: { data } }) });
    if (parsed.pathname === "/BOSS/BOSSInstruction") return { ok: true, status: 200, headers: { get: () => "BOSSSESSION=ok; Path=/" }, json: async () => ({}) };
    if (parsed.pathname === "/boss/getBossOperation") {
      const page = parsed.searchParams.get("page");
      return ok(page === "0" ? { total: 2, list: [{ authType: "LOID", loid: "l1", serialNo: "w1", serviceName: "报装", opResult: "成功", recTime: "2026-09-07 01:00:00" }] } : { total: 2, list: [{ authType: "SN", sn: "s2", serialNo: "w2", serviceName: "移机", opResult: "成功", recTime: "2026-09-07 02:00:00" }] });
    }
    if (parsed.pathname === "/onu/getOnuAuthorizePercentByIdentity") return ok({ username: "用户", useraddr: "厚街镇一号", loid: "detail-loid", recTime: "2026-09-07 01:00:00;2026-09-07 01:02:00", ipAddress: "192.0.2.1", shelfNo: "1", slotNo: "2", ponNo: "3", onuNo: "4" });
    throw new Error(`unexpected ${parsed.pathname}`);
  } });
  const rows = await client.getBossOperations({ phone: "p", token: "tok", userType: "True", userId: "42" }, { windowStart: "2026-09-06 00:00:00", windowEnd: "2026-09-08 00:00:00", pageSize: 1 });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].recTime, "2026-09-07 01:00:00");
  assert.equal(rows[1].recTime, "2026-09-07 02:00:00");
  const pageCall = calls.find((url) => url.pathname === "/BOSS/BOSSInstruction");
  assert.ok(pageCall);
  assert.equal(pageCall.searchParams.get("accessToken"), "tok");
  assert.equal(pageCall.searchParams.get("phone"), "p");
  assert.equal(pageCall.searchParams.get("type"), "True");
  assert.equal(pageCall.searchParams.get("id"), "42");
  assert.equal(calls.findIndex((url) => url.pathname === "/BOSS/BOSSInstruction"), 0);
  await assert.rejects(client.request("/BOSS/BOSSInstruction"), /白名单/);
  assert.equal(calls.filter((url) => url.pathname === "/onu/getOnuAuthorizePercentByIdentity").length, 2);
  const listCall = calls.find((url) => url.pathname === "/boss/getBossOperation");
  assert.equal(listCall.searchParams.get("opResult"), "1");
  assert.equal(listCall.searchParams.get("serviceID"), "0");
  assert.equal(listCall.searchParams.get("queryStr"), "厚街镇");
  assert.equal(listCall.searchParams.get("sortColumn"), "recTime");
  assert.equal(listCall.searchParams.get("order"), "asc");
});

test("NMSE BOSS list retries transient upstream failures at most three attempts", async () => {
  let listAttempts = 0;
  const ok = (data) => ({ ok: true, status: 200, headers: { get: () => "application/json" }, json: async () => ({ header: { opCode: "1" }, body: { data } }) });
  const client = new NmseClient({
    serverUrl: "https://nmse.example",
    retryDelayMs: 0,
    fetchImpl: async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/BOSS/BOSSInstruction") return { ok: true, status: 200, headers: { get: () => "text/html" } };
      if (parsed.pathname === "/boss/getBossOperation") {
        listAttempts += 1;
        if (listAttempts < 3) return { ok: false, status: 503, headers: { get: () => "text/html" } };
        return ok({ TotalCount: 0, list: [] });
      }
      throw new Error(`unexpected ${parsed.pathname}`);
    }
  });
  const rows = await client.getBossOperations({ phone: "p", token: "tok", userType: "True", userId: "42" }, { windowStart: "2026-09-06 00:00:00", windowEnd: "2026-09-08 00:00:00" });
  assert.deepEqual(rows, []);
  assert.equal(listAttempts, 3);
});

test("BOSS success status requires the fixed numeric success code", async () => {
  const response = (data) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ header: { opCode: "1" }, body: { data } }) });
  const client = new NmseClient({ serverUrl: "https://nmse.example", fetchImpl: async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/BOSS/BOSSInstruction") return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) };
    if (parsed.pathname === "/boss/getBossOperation") return response({ TotalCount: 1, list: [{ authType: "LOID", loid: "one-loid", serialNo: "one-work-order", serviceName: "报装", opResult: "0", recTime: "2026-09-07 01:00:00" }] });
    if (parsed.pathname === "/onu/getOnuAuthorizePercentByIdentity") return response({ username: "用户", ipAddress: "192.0.2.1", shelfNo: "1", slotNo: "2", ponNo: "3", onuNo: "4" });
    throw new Error(`unexpected ${parsed.pathname}`);
  } });
  const rows = await client.getBossOperations({ phone: "p", token: "tok", userType: "True", userId: "42" }, { windowStart: "2026-09-06 00:00:00", windowEnd: "2026-09-08 00:00:00" });
  assert.equal(rows[0].opResult, "0");
  const { filterBossChanges } = await import("../src/nmse-boss-sync.mjs");
  assert.throws(() => filterBossChanges(rows, { window: { start: "2026-09-06 00:00:00", end: "2026-09-08 00:00:00" } }), /拒绝推进水位/);
});

test("NMSE client rejects duplicate final keys after detail LOID resolution", async () => {
  const response = (data) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ header: { opCode: "1" }, body: { data } }) });
  const client = new NmseClient({ serverUrl: "https://nmse.example", fetchImpl: async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/BOSS/BOSSInstruction") return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) };
    if (parsed.pathname === "/boss/getBossOperation") return response({ TotalCount: 2, list: [
      { authType: "SN", sn: "sn-1", serialNo: "same-order", serviceName: "报装", opResult: "2", recTime: "2026-09-07 01:00:00" },
      { authType: "SN", sn: "sn-2", serialNo: "same-order", serviceName: "报装", opResult: "2", recTime: "2026-09-07 01:00:00" }
    ] });
    if (parsed.pathname === "/onu/getOnuAuthorizePercentByIdentity") return response({ loid: "resolved-loid", username: "用户", ipAddress: "192.0.2.1", shelfNo: "1", slotNo: "2", ponNo: "3", onuNo: "4" });
    throw new Error(`unexpected ${parsed.pathname}`);
  } });
  await assert.rejects(client.getBossOperations({ phone: "p", token: "tok", userType: "True", userId: "42" }, { windowStart: "2026-09-06 00:00:00", windowEnd: "2026-09-08 00:00:00", pageSize: 2 }), /重复最终幂等记录/);
});

test("NMSE BOSS detail validation is operation-aware for cancellations", async () => {
  const requestPaths = [];
  const response = (data) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ header: { opCode: "1" }, body: { data } }) });
  const client = new NmseClient({ serverUrl: "https://nmse.example", fetchImpl: async (url) => {
    const parsed = new URL(url);
    requestPaths.push(parsed.pathname);
    if (parsed.pathname === "/BOSS/BOSSInstruction") return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) };
    if (parsed.pathname === "/boss/getBossOperation") return response({ TotalCount: 1, list: [{ authType: "LOID", loid: "cancel-loid", serialNo: "cancel-work-order", serviceName: "销户", opResult: "2", recTime: "2026-09-07 01:00:00" }] });
    if (parsed.pathname === "/onu/getOnuAuthorizePercentByIdentity") return response({ status: "已销户" });
    throw new Error(`unexpected ${parsed.pathname}`);
  } });
  const rows = await client.getBossOperations({ phone: "p", token: "tok", userType: "True", userId: "42" }, { windowStart: "2026-09-06 00:00:00", windowEnd: "2026-09-08 00:00:00" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].serviceName, "销户");
  assert.deepEqual(requestPaths, ["/BOSS/BOSSInstruction", "/boss/getBossOperation", "/onu/getOnuAuthorizePercentByIdentity"]);
});

test("NMSE BOSS detail validation still requires coordinates for non-cancellation operations", async () => {
  const response = (data) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ header: { opCode: "1" }, body: { data } }) });
  const client = new NmseClient({ serverUrl: "https://nmse.example", fetchImpl: async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/BOSS/BOSSInstruction") return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) };
    if (parsed.pathname === "/boss/getBossOperation") return response({ TotalCount: 1, list: [{ authType: "LOID", loid: "install-loid", serialNo: "install-work-order", serviceName: "报装", opResult: "2", recTime: "2026-09-07 01:00:00" }] });
    if (parsed.pathname === "/onu/getOnuAuthorizePercentByIdentity") return response({ username: "用户" });
    throw new Error(`unexpected ${parsed.pathname}`);
  } });
  await assert.rejects(client.getBossOperations({ phone: "p", token: "tok", userType: "True", userId: "42" }, { windowStart: "2026-09-06 00:00:00", windowEnd: "2026-09-08 00:00:00" }), /缺少完整 ONU 坐标/);
});
