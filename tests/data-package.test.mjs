import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.OLT_MANAGER_DATA_DIR = await mkdtemp(join(tmpdir(), "olt-manager-data-package-"));

const db = await import("../src/db.mjs");
const { handleDataPackageRoutes } = await import("../src/data-package-routes.mjs");

const backup = { path: "/b.sqlite", bytes: 1, sha256: "s" };
const row = (onuId, loid, address) => ({
  oltIp: "10.0.0.9", chassis: "1", board: "1", pon: "1", onuId: String(onuId), onuIndexDisplay: `1/1/1:${onuId}`,
  loid, loidDisplay: loid, username: `用户${onuId}`, usernameSource: "nmse", userPhone: "13800000000", installationAddress: address,
  deviceType: "", ponType: "", phase: "", rxPower: "", distance: "", nmseOltIp: "", nmseOnuIndex: ""
});

test("资料包：导出所选资料，导入时只整类替换所选类别，其余数据不动，导入前自动备份", async () => {
  await db.initDb();
  await db.replaceMergedOnuDataset({
    runId: `pkg-${Date.now()}`, operation: "merge", backup, conflicts: [], networkCount: 2, nmseCount: 0,
    rows: [row(1, "LA", "广东省东莞市厚街镇万达广场5栋"), row(2, "LB", "广东省东莞市厚街镇榄树厦10巷1号")]
  });
  await db.replacePonPorts([{ oltIp: "10.0.0.9", chassis: "1", board: "1", pon: "1", ponPort: "1/1/1", outerVlan: "1061", address: "东宝路67号" }]);
  await db.createPlaceRule({ kind: "community", target: "万达广场", includeKeywords: ["万达广场"] });
  await db.savePortPlaceAssignment({ oltIp: "10.0.0.9", board: "1", pon: "1", village: "厚街村", villageGroup: "下栅" });
  await db.createVillageRegion({ village: "厚街村", name: "下栅", includeKeywords: ["厚街村下栅"], status: "active" });
  const correction = await db.saveUserCorrection({ field: "userPhone", value: "13900000002", username: "用户2", source: "feishu" });
  await db.reviewUserCorrection(correction.id, { status: "active", loid: "LB" });

  // “Mac”上导出：用户归属、区域字典、PON 台账、Pi 知识。
  const pkg = await db.exportDataPackage({ appVersion: "1.3.5", platform: "darwin" });
  assert.equal(pkg.format, "olt-manager/data-package/v1");
  assert.deepEqual(Object.keys(pkg.categories).sort(), ["agentKnowledge", "places", "ponLedger", "regions"]);
  assert.equal(pkg.categories.places.tables.place_rules.rows.length, 1);
  const onlyPlaces = await db.exportDataPackage({ categories: ["places"] });
  assert.deepEqual(Object.keys(onlyPlaces.categories), ["places"]);

  // “Windows”上本来的资料与之不同；另外有一条不属于资料包的数据（OLT），导入后必须保持不变。
  await db.replaceOlts([{ id: "olt-keep", name: "保留", vendor: "zte", model: "C300", version: "V2", host: "10.0.0.9", snmpPort: 161, readCommunity: "public", enabled: true }]);
  const rules = await db.getPlaceRules();
  await db.deletePlaceRule(rules[0].id);
  await db.createPlaceRule({ kind: "village", target: "赤岭村", includeKeywords: ["阳明山"] });
  await db.savePortPlaceAssignment({ oltIp: "10.0.0.9", board: "1", pon: "1" });
  await db.replacePonPorts([{ oltIp: "10.0.0.9", chassis: "1", board: "1", pon: "2", ponPort: "1/1/2", outerVlan: "9", address: "别处" }]);

  const info = await db.inspectDataPackage(pkg);
  assert.equal(info.platform, "darwin");
  const placesInfo = info.categories.find((item) => item.key === "places");
  assert.deepEqual(placesInfo.tables.find((item) => item.table === "place_rules"), { table: "place_rules", packageRows: 1, localRows: 1 });

  await assert.rejects(() => db.importDataPackage(pkg, { categories: ["places"] }), /明确确认/);
  const backupCount = async () => (await readdir(join(process.env.OLT_MANAGER_DATA_DIR, "backups")).catch(() => [])).length;
  const before = await backupCount();
  const result = await db.importDataPackage(pkg, { categories: ["places", "ponLedger"], confirmed: true });
  assert.equal(result.ok, true);
  assert.equal(await backupCount(), before + 1);
  assert.deepEqual((await db.getPlaceRules()).map((rule) => rule.target), ["万达广场"]);
  assert.equal((await db.getPortPlaceAssignments())[0].label, "厚街村/下栅小组");
  assert.deepEqual((await db.getPonPorts()).map((port) => port.address), ["东宝路67号"]);
  assert.ok((await db.getOlts()).some((item) => item.id === "olt-keep"));
  const users = await db.getMergedOnuSnapshots();
  assert.ok(users.every((user) => user.village === "厚街村"));

  // Pi 知识：资料修正导入后，已通过的电话立即写回合并台账。
  await db.replaceMergedOnuDataset({
    runId: `pkg-again-${Date.now()}`, operation: "merge", backup, conflicts: [], networkCount: 2, nmseCount: 0,
    rows: [row(1, "LA", "广东省东莞市厚街镇万达广场5栋"), row(2, "LB", "广东省东莞市厚街镇榄树厦10巷1号")]
  });
  assert.equal((await db.getMergedOnuSnapshots()).find((user) => user.loid === "LB").userPhone, "13800000000");
  await db.importDataPackage(pkg, { categories: ["agentKnowledge"], confirmed: true });
  assert.equal((await db.getMergedOnuSnapshots()).find((user) => user.loid === "LB").userPhone, "13900000002");

  await assert.rejects(() => db.inspectDataPackage({ format: "other" }), /不是 OLT Manager 资料包/);
  await assert.rejects(() => db.importDataPackage(onlyPlaces, { categories: ["regions"], confirmed: true }), /资料包里没有区域字典/);
  await assert.rejects(() => db.exportDataPackage({ categories: ["unknown"] }), /未知的资料类别/);
});

test("资料包接口：导出、预览、导入", async () => {
  const calls = [];
  const responses = [];
  const json = async (_res, status, body) => responses.push({ status, body });
  const deps = {
    exportDataPackage: async (options) => { calls.push(["export", options]); return { format: "x" }; },
    inspectDataPackage: async (pkg) => { calls.push(["inspect", pkg]); return { platform: "darwin" }; },
    importDataPackage: async (pkg, options) => { calls.push(["import", pkg, options]); return { ok: true }; },
    appVersion: "1.3.5",
    readBody: async (req) => req.body,
    json
  };
  assert.equal(await handleDataPackageRoutes({ method: "GET" }, {}, new URL("http://x/api/data-package/export?categories=places,regions"), deps), true);
  assert.deepEqual(calls[0], ["export", { categories: ["places", "regions"], appVersion: "1.3.5" }]);
  await handleDataPackageRoutes({ method: "POST", body: { format: "p" } }, {}, new URL("http://x/api/data-package/inspect"), deps);
  await handleDataPackageRoutes({ method: "POST", body: { package: { format: "p" }, categories: ["places"], confirmed: true } }, {}, new URL("http://x/api/data-package/import"), deps);
  assert.deepEqual(calls[2], ["import", { format: "p" }, { categories: ["places"], confirmed: true }]);
  assert.equal(responses[1].body.platform, "darwin");
  assert.equal(await handleDataPackageRoutes({ method: "GET" }, {}, new URL("http://x/api/other"), deps), false);
});
