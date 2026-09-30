import test from "node:test";
import assert from "node:assert/strict";
import { createOnuApi } from "../src/onu-api.mjs";

test("ONU API unregistered endpoint supports optional query string", async () => {
  let requestedUrl = "";
  const api = createOnuApi({
    request: async (url) => {
      requestedUrl = url;
      return { ok: true, rows: [] };
    }
  });

  await api.unregistered();
  assert.equal(requestedUrl, "/api/unregistered-onus");

  await api.unregistered({ oltId: "olt-102" });
  assert.equal(requestedUrl, "/api/unregistered-onus?oltId=olt-102");
});

test("Aggregated unregistered ONU data model enrichment and fault tolerance simulation", async () => {
  const mockOlts = [
    { id: "olt-1", name: "机房 1 号", host: "172.19.104.101", vendor: "zte", model: "ZXA10 C300", enabled: 1 },
    { id: "olt-2", name: "机房 2 号", host: "172.19.104.102", vendor: "huawei", model: "MA5800-X7", enabled: true },
    { id: "olt-3", name: "机房 3 号 (已停用)", host: "172.19.104.103", vendor: "zte", model: "ZXA10 C600", enabled: 0 }
  ];

  async function simulateListAll(olts, fetcher) {
    const activeOlts = olts.filter((item) => item.enabled !== false && item.enabled !== 0);
    const results = await Promise.allSettled(
      activeOlts.map(async (olt) => {
        try {
          const res = await fetcher(olt);
          return {
            ok: true,
            oltId: olt.id,
            rows: (res.rows || []).map((row) => ({
              ...row,
              oltId: olt.id,
              oltName: olt.name,
              oltHost: olt.host,
              oltVendor: olt.vendor,
              oltModel: olt.model
            }))
          };
        } catch (err) {
          return {
            ok: false,
            oltId: olt.id,
            rows: [],
            error: err.message
          };
        }
      })
    );

    const allRows = [];
    let successCount = 0;
    for (const r of results) {
      if (r.status === "fulfilled" && r.value.ok) {
        successCount++;
        allRows.push(...r.value.rows);
      }
    }
    return {
      all: true,
      totalOlts: activeOlts.length,
      scannedOlts: successCount,
      rows: allRows,
      message: allRows.length === 0 ? "全网所有已启用 OLT 暂未发现未注册 ONU 数据" : ""
    };
  }

  const result1 = await simulateListAll(mockOlts, async (olt) => {
    if (olt.id === "olt-1") {
      return {
        rows: [
          { chassis: "1", slot: "2", pon: "3", serial: "ZTEG12345678", state: "unregistered" }
        ]
      };
    }
    return { rows: [] };
  });

  assert.equal(result1.totalOlts, 2);
  assert.equal(result1.scannedOlts, 2);
  assert.equal(result1.rows.length, 1);
  assert.equal(result1.rows[0].oltHost, "172.19.104.101");
  assert.equal(result1.rows[0].oltVendor, "zte");
  assert.equal(result1.rows[0].oltModel, "ZXA10 C300");

  const result2 = await simulateListAll(mockOlts, async (olt) => {
    if (olt.id === "olt-1") {
      throw new Error("SNMP request timeout");
    }
    return {
      rows: [
        { chassis: "0", slot: "1", pon: "4", serial: "485754431234", state: "未注册" }
      ]
    };
  });

  assert.equal(result2.totalOlts, 2);
  assert.equal(result2.scannedOlts, 1);
  assert.equal(result2.rows.length, 1);
  assert.equal(result2.rows[0].oltHost, "172.19.104.102");
  assert.equal(result2.rows[0].oltVendor, "huawei");

  const result3 = await simulateListAll(mockOlts, async () => ({ rows: [] }));
  assert.equal(result3.rows.length, 0);
  assert.equal(result3.message, "全网所有已启用 OLT 暂未发现未注册 ONU 数据");
});
