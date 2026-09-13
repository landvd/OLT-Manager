import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.OLT_MANAGER_DATA_DIR = await mkdtemp(join(tmpdir(), "olt-manager-boss-sync-integrity-"));
const db = await import("../src/db.mjs");
const { NmseClient } = await import("../src/nmse-client.mjs");
const { normalizeBossChange, projectBossNameHistory } = await import("../src/nmse-boss-sync.mjs");
const { createNmseBossIncrementalRuntime } = await import("../src/nmse-boss-runtime.mjs");

test("NMSE client recognizes uppercase LOID and merges detail fields with priority over list fields", async () => {
  const fetchImpl = async (url) => {
    const request = new URL(url);
    if (request.pathname === "/BOSS/BOSSInstruction") {
      return { ok: true, headers: { get: () => null }, text: async () => "ok" };
    }
    if (request.pathname.includes("/onu/getOnuAuthorizePercentByIdentity")) {
      return {
        ok: true,
        headers: { get: () => null },
        json: async () => ({
          header: { opCode: "1" },
          body: {
            data: {
              serialNo: "WO-001",
              loid: "TEST-LOID-UPPER",
              username: "张三丰",
              userPhone: "13800138000",
              installationAddress: "广东省东莞市厚街镇康乐南路88号",
              shelfNo: "1",
              slotNo: "2",
              ponNo: "3",
              onuNo: "4",
              oltIp: "192.0.2.10"
            }
          }
        })
      };
    }
    if (request.pathname.includes("/boss/getBossOperation")) {
      return {
        ok: true,
        headers: { get: () => null },
        json: async () => ({
          header: { opCode: "1" },
          body: {
            data: {
              TotalCount: 1,
              list: [{
                // Upper-case LOID from NMSE response
                LOID: "TEST-LOID-UPPER",
                serialNo: "WO-001",
                serviceName: "装机",
                opResult: "成功",
                recTime: "2026-09-10 10:00:00",
                // Truncated / empty in list
                username: "张",
                userPhone: "",
                installationAddress: ""
              }]
            }
          }
        })
      };
    }
    throw new Error(`Unexpected path: ${request.pathname}`);
  };

  const client = new NmseClient({ serverUrl: "http://nmse.test", fetchImpl });
  const result = await client.getBossOperations(
    { phone: "tester", token: "tok", userId: "u1", userType: "False" },
    { windowStart: "2026-09-10 00:00:00", windowEnd: "2026-09-10 23:59:59" }
  );

  assert.equal(result.length, 1);
  const row = result[0];
  assert.equal(row.loid, "TEST-LOID-UPPER");
  // Detail full name preserved over list's single character "张"
  assert.equal(row.username, "张三丰");
  // Detail phone and address preserved over list's empty values
  assert.equal(row.userPhone, "13800138000");
  assert.equal(row.installationAddress, "广东省东莞市厚街镇康乐南路88号");
  assert.equal(row.slotNo, "2");
  assert.equal(row.ponNo, "3");
});

test("NMSE client rejects non-numeric coordinate parts in work order detail", async () => {
  const fetchImpl = async (url) => {
    const request = new URL(url);
    if (request.pathname === "/BOSS/BOSSInstruction") {
      return { ok: true, headers: { get: () => null }, text: async () => "ok" };
    }
    if (request.pathname.includes("/onu/getOnuAuthorizePercentByIdentity")) {
      return {
        ok: true,
        headers: { get: () => null },
        json: async () => ({
          header: { opCode: "1" },
          body: {
            data: {
              serialNo: "WO-CORRUPT",
              loid: "LOID-CORRUPT",
              username: "李四",
              shelfNo: "1",
              slotNo: "1-1-5", // Non-numeric slot
              ponNo: "3",
              onuNo: "4",
              oltIp: "192.0.2.10"
            }
          }
        })
      };
    }
    if (request.pathname.includes("/boss/getBossOperation")) {
      return {
        ok: true,
        headers: { get: () => null },
        json: async () => ({
          header: { opCode: "1" },
          body: {
            data: {
              TotalCount: 1,
              list: [{
                serialNo: "WO-CORRUPT",
                loid: "LOID-CORRUPT",
                serviceName: "装机",
                opResult: "成功",
                recTime: "2026-09-10 10:00:00"
              }]
            }
          }
        })
      };
    }
    throw new Error(`Unexpected path: ${request.pathname}`);
  };

  const client = new NmseClient({ serverUrl: "http://nmse.test", fetchImpl });
  await assert.rejects(
    client.getBossOperations(
      { phone: "tester", token: "tok", userId: "u1", userType: "False" },
      { windowStart: "2026-09-10 00:00:00", windowEnd: "2026-09-10 23:59:59" }
    ),
    /缺少完整 ONU 坐标/
  );
});

test("projectBossNameHistory protects existing full names from single-character downgrade", () => {
  const window = { start: "2026-01-01 00:00:00", end: "2026-01-02 00:00:00" };
  const rawEvents = [
    {
      serialNo: "WO-1",
      loid: "LOID-PROTECT",
      username: "王五六",
      opResult: "1",
      serviceName: "装机",
      recTime: "2026-01-01 10:00:00",
      oltIp: "192.0.2.10",
      onuIndex: "1/1/1:1"
    },
    {
      // Later work order has single-character name
      serialNo: "WO-2",
      loid: "LOID-PROTECT",
      username: "王",
      opResult: "1",
      serviceName: "移机",
      recTime: "2026-01-01 15:00:00",
      oltIp: "192.0.2.10",
      onuIndex: "1/1/1:1"
    }
  ];

  const projected = projectBossNameHistory(rawEvents, { window, includeEnd: true });
  assert.equal(projected.rows.length, 1);
  // Full name "王五六" is preserved rather than downgraded to "王"
  assert.equal(projected.rows[0].username, "王五六");
});

test("applyNmseBossIncrementalChanges protects existing full name in SQLite from single-char overwrite", async () => {
  await db.initDb();
  await db.initializeNmseBossSyncState({ watermark: "2026-09-01 00:00:00" });

  // Initial event with full name
  const event1 = normalizeBossChange({
    serviceName: "装机",
    opResult: "1",
    serialNo: "WO-FULL",
    loid: "LOID-UPGRADE-TEST",
    recTime: "2026-09-01 10:00:00",
    username: "赵六六",
    oltIp: "192.0.2.10",
    onuIndex: "1/1/1:5"
  });

  await db.applyNmseBossIncrementalChanges({
    rows: [event1],
    watermark: "2026-09-02 00:00:00",
    windowStart: "2026-09-01 00:00:00",
    windowEnd: "2026-09-02 00:00:00"
  });

  let nmseSource = await db.getMergedOnuNmseSource();
  assert.equal(nmseSource.find((r) => r.loid === "LOID-UPGRADE-TEST")?.username, "赵六六");

  // Subsequent event has single-character name "赵"
  const event2 = normalizeBossChange({
    serviceName: "移机",
    opResult: "1",
    serialNo: "WO-SINGLE",
    loid: "LOID-UPGRADE-TEST",
    recTime: "2026-09-02 10:00:00",
    username: "赵",
    oltIp: "192.0.2.10",
    onuIndex: "1/1/1:5"
  });

  await db.applyNmseBossIncrementalChanges({
    rows: [event2],
    watermark: "2026-09-03 00:00:00",
    windowStart: "2026-09-02 00:00:00",
    windowEnd: "2026-09-03 00:00:00"
  });

  nmseSource = await db.getMergedOnuNmseSource();
  // Name should still be "赵六六", NOT downgraded to "赵"
  assert.equal(nmseSource.find((r) => r.loid === "LOID-UPGRADE-TEST")?.username, "赵六六");
});

test("resetNmseBossNameHistory resets state and allows re-sync, and forceHistory bypasses completion guard", async () => {
  // Set up completed history state
  await db.replaceNmseBossNameHistory({
    rows: [{ loid: "LOID-H1", username: "历史用户1", workOrder: "WO-H1", receivedAt: "2025-01-01 10:00:00" }],
    watermark: "2026-09-05 00:00:00",
    windowStart: "2019-08-23 00:00:00",
    windowEnd: "2026-09-05 00:00:00",
    coverageThrough: "2026-09-04",
    eventCount: 1,
    skippedCount: 0,
    conflictCount: 0
  });

  let state = await db.getNmseBossSyncState();
  assert.ok(state.nameHistoryCompletedAt);
  assert.equal(state.nameHistoryCount, 1);

  // Normal call without force should reject
  await assert.rejects(
    db.replaceNmseBossNameHistory({
      rows: [{ loid: "LOID-H2", username: "历史用户2", workOrder: "WO-H2", receivedAt: "2025-01-02 10:00:00" }],
      watermark: "2026-09-06 00:00:00",
      windowStart: "2019-08-23 00:00:00",
      windowEnd: "2026-09-06 00:00:00"
    }),
    /已经初始化/
  );

  // force: true should allow overwriting without error
  const forced = await db.replaceNmseBossNameHistory({
    rows: [{ loid: "LOID-H2", username: "历史用户2", workOrder: "WO-H2", receivedAt: "2025-01-02 10:00:00" }],
    watermark: "2026-09-06 00:00:00",
    windowStart: "2019-08-23 00:00:00",
    windowEnd: "2026-09-06 00:00:00",
    coverageThrough: "2026-09-05",
    eventCount: 1,
    force: true
  });
  assert.equal(forced.nameCount, 1);

  // resetNmseBossNameHistory should clear completion timestamp
  const resetState = await db.resetNmseBossNameHistory();
  assert.equal(resetState.nameHistoryCompletedAt, "");
  assert.equal(resetState.nameHistoryCount, 0);

  // Now replaceNmseBossNameHistory can run again normally without force
  const normalAgain = await db.replaceNmseBossNameHistory({
    rows: [{ loid: "LOID-H3", username: "历史用户3", workOrder: "WO-H3", receivedAt: "2025-01-03 10:00:00" }],
    watermark: "2026-09-07 00:00:00",
    windowStart: "2019-08-23 00:00:00",
    windowEnd: "2026-09-07 00:00:00",
    coverageThrough: "2026-09-06",
    eventCount: 1
  });
  assert.equal(normalAgain.nameCount, 1);
});
