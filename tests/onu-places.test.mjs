import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

process.env.OLT_MANAGER_DATA_DIR = await mkdtemp(join(tmpdir(), "olt-manager-onu-places-"));

const places = await import("../src/onu-places.mjs");
const db = await import("../src/db.mjs");
const { createOltDataGateway } = await import("../src/olt-data-gateway.mjs");
const require = createRequire(import.meta.url);
const { renderReply } = require("../src/feishu/production-runtime.cjs");

const filler = (village, count) => Array.from({ length: count }, (_, index) => `广东省东莞市厚街镇${village}${index + 1}号`);

test("地址自动识别村：取最后一段门牌、去掉片区编码，“X社区”等同“X村”", () => {
  assert.equal(places.addressTail("广东省东莞市厚街镇5桥头片冲口村东莞市厚街镇涌口村北社圣俞巷4号#"), "涌口村北社圣俞巷4号#");
  assert.equal(places.addressTail("广东省东莞市厚街镇3赤岭片阳明山花园16栋"), "阳明山花园16栋");
  const villages = places.knownVillages([...filler("涌口村", 20), ...filler("冲口村", 20), ...filler("双岗村", 20), "广东省东莞市厚街镇新村路1号"]);
  assert.deepEqual(villages.sort(), ["冲口村", "双岗村", "涌口村"]);
  assert.equal(places.villageFromAddress("广东省东莞市厚街镇5桥头片冲口村东莞市厚街镇涌口村北社圣俞巷4号#", villages), "涌口村");
  assert.equal(places.villageFromAddress("广东省东莞市厚街镇双岗社区下环路3号", villages), "双岗村");
  assert.equal(places.villageFromAddress("广东省东莞市厚街镇万达广场5栋1712", villages), "");
  assert.equal(places.villageFromAddress("", villages), "");
});

test("归属优先级：单户修正 > 批量规则 > 字典改归属 > 地址；小组取本村已通过的小组；小区独立", () => {
  const row = (onuId, address, loid = "") => ({ oltIp: "10.0.0.1", chassis: "1", board: "2", pon: "3", onuId: String(onuId), loid, installationAddress: address });
  const rows = [
    ...filler("厚街村向北路", 20).map((address, index) => row(100 + index, address)),
    ...filler("赤岭村", 20).map((address, index) => row(200 + index, address)),
    row(1, "广东省东莞市厚街镇3赤岭片阳明山花园16栋"),
    row(2, "广东省东莞市厚街镇厚街村万达广场2栋"),
    row(3, "广东省东莞市厚街镇三屯工业大道90号"),
    row(4, "广东省东莞市厚街镇厚街村向北路8号", "LOID-4"),
    row(5, "广东省东莞市厚街镇赤岭村某路1号")
  ];
  const regions = [
    { id: 1, village: "厚街村", name: "向北", includeKeywords: ["厚街村向北"], excludeKeywords: [], status: "active", transfer: false },
    { id: 2, village: "厚街村", name: "待审核组", includeKeywords: ["厚街村万达"], excludeKeywords: [], status: "candidate", transfer: false },
    { id: 3, village: "三屯村", name: "工业大道", includeKeywords: ["三屯工业大道"], excludeKeywords: [], status: "active", transfer: true }
  ];
  const rules = [
    { kind: "village", target: "赤岭村", includeKeywords: ["阳明山花园"], excludeKeywords: [] },
    { kind: "community", target: "万达广场", includeKeywords: ["万达广场"], excludeKeywords: [] }
  ];
  const overrides = [
    { loid: "LOID-4", village: "厚街村", villageGroup: "榄树厦", community: "" },
    { loid: "", oltIp: "10.0.0.1", chassis: "1", board: "2", pon: "3", onuId: "5", village: "", villageGroup: "", community: "赤岭花园" }
  ];
  const result = places.computePlaceAssignments(rows, { regions, rules, overrides });
  const byId = (id) => result.find((item) => item.onuId === String(id));
  assert.deepEqual([byId(1).village, byId(1).placeSource], ["赤岭村", "rule"]);
  // 小区与村互不影响；候选状态的小组不参与。
  assert.deepEqual([byId(2).village, byId(2).villageGroup, byId(2).community, byId(2).placeSource], ["厚街村", "", "万达广场", "address"]);
  assert.deepEqual([byId(3).village, byId(3).placeSource], ["三屯村", "dictionary"]);
  assert.deepEqual([byId(4).village, byId(4).villageGroup, byId(4).placeSource], ["厚街村", "榄树厦", "manual"]);
  assert.deepEqual([byId(5).village, byId(5).community], ["赤岭村", "赤岭花园"]);
  assert.equal(byId(100).villageGroup, "向北");
  // 单户修正按 LOID 匹配：坐标变了照样生效；没有 LOID 的修正按坐标匹配。
  const moved = places.computePlaceAssignments([{ ...rows.find((item) => item.loid === "LOID-4"), board: "9" }], { regions, rules, overrides });
  assert.equal(moved[0].villageGroup, "榄树厦");
  assert.equal(places.placeLabel(byId(2)), "厚街村/万达广场小区");
  assert.equal(places.placeLabel({ community: "万达广场" }), "万达广场小区");
  assert.equal(places.placeLabel({ village: "厚街村", villageGroup: "向北" }), "厚街村/向北小组");
  assert.equal(places.placeLabel({ village: "厚街村", community: "万科城市广场小区" }), "厚街村/万科城市广场小区");
  assert.equal(places.placeLabel({ village: "厚街村" }), "厚街村");
  assert.throws(() => places.normalizePlaceRule({ kind: "group", target: "x", includeKeywords: ["ab"] }), /村或小区/);
});

test("口归属：低于单户修正、高于批量规则和地址；写法可以解析回村 / 小组 / 小区", () => {
  const row = (onuId, address, loid = "", board = "2") => ({ oltIp: "10.0.0.1", chassis: "1", board, pon: "11", onuId: String(onuId), loid, installationAddress: address });
  const rows = [
    row(1, "广东省东莞市厚街镇厚街村上栅新村高坡3号"),
    row(2, "广东省东莞市厚街镇32米路厚街大道西50号"),
    row(3, "广东省东莞市厚街镇厚街村东宝路107号", "LOID-3"),
    row(4, "广东省东莞市厚街镇厚街村东宝路9号", "", "3")
  ];
  const ports = [{ oltIp: "10.0.0.1", board: "2", pon: "11", village: "厚街村", villageGroup: "下栅", community: "" }];
  const rules = [{ kind: "village", target: "赤岭村", includeKeywords: ["厚街大道西"], excludeKeywords: [] }];
  const overrides = [{ loid: "LOID-3", village: "厚街村", villageGroup: "东宝", community: "" }];
  const result = places.computePlaceAssignments(rows, { rules, overrides, ports });
  assert.deepEqual(result.map((item) => [item.village, item.villageGroup, item.placeSource]), [
    ["厚街村", "下栅", "port"],
    ["厚街村", "下栅", "port"],
    ["厚街村", "东宝", "manual"],
    ["", "", ""]
  ]);
  assert.deepEqual(places.parsePlaceLabel("厚街村/下栅小组"), { village: "厚街村", villageGroup: "下栅", community: "" });
  assert.deepEqual(places.parsePlaceLabel("厚街村/万科城市广场小区"), { village: "厚街村", villageGroup: "", community: "万科城市广场" });
  assert.deepEqual(places.parsePlaceLabel("万达广场小区"), { village: "", villageGroup: "", community: "万达广场" });
  assert.equal(places.placeLabel(places.parsePlaceLabel("厚街村/下栅小组/万科城市广场小区")), "厚街村/下栅小组/万科城市广场小区");
});

test("台账行归属折算到口：各行相同整口套用，不同则为分路", () => {
  const row = (pon, address, village, villageGroup = "") => ({ oltIp: "10.0.0.1", board: "2", pon, address, village, villageGroup, community: "" });
  const { ports, splitKeys } = places.effectivePortAssignments([
    row("10", "卓越维港77号楼一单元8F", "寮厦村"),
    row("10", "卓越维港77号楼一单元20F", "寮厦村"),
    row("11", "东宝路67号", "厚街村", "下栅"),
    row("11", "丰泰凌峰5-8栋光纤", "寮厦村")
  ]);
  assert.deepEqual(ports.map((port) => `${port.pon}:${places.placeLabel(port)}`), ["10:寮厦村"]);
  assert.deepEqual([...splitKeys], ["10.0.0.1|2|11"]);
  assert.equal(places.ponRowPlaceKey({ oltIp: "10.0.0.1", slot: "2", pon: "11", address: " 东宝路 67号 " }), "10.0.0.1|2|11|东宝路67号");
});

test("按口汇总与未归村建议", () => {
  const rows = [
    { oltIp: "10.0.0.1", board: "2", pon: "1", village: "双岗村" },
    { oltIp: "10.0.0.1", board: "2", pon: "1", village: "双岗村" },
    { oltIp: "10.0.0.1", board: "2", pon: "1", village: "", community: "万达广场" },
    { oltIp: "10.0.0.1", board: "2", pon: "1" }
  ];
  const summary = places.summarizePonPlaces(rows);
  assert.equal(summary["10.0.0.1|2|1"].text, "双岗村、万达广场小区、未归村");
  assert.equal(summary["10.0.0.1|2|1"].places.find((item) => item.label === "双岗村").count, 2);
  const many = places.summarizePonPlaces(["甲村", "甲村", "乙村", "丙村", "丁村", ""].map((village) => ({ oltIp: "10.0.0.1", board: "2", pon: "2", village })));
  assert.equal(many["10.0.0.1|2|2"].text, "甲村、丙村、丁村 等 5 处");
  assert.equal(places.ponPlaceKey({ oltIp: "10.0.0.1", chassis: "0", slot: "2", pon: "1" }), "10.0.0.1|2|1");
  const suggestions = places.suggestUnassignedKeywords([
    ...Array.from({ length: 4 }, (_, index) => ({ installationAddress: `广东省东莞市厚街镇万达广场${index}栋` })),
    { installationAddress: "广东省东莞市厚街镇万达广场9栋", village: "厚街村" }
  ]);
  assert.equal(suggestions[0].keyword, "万达广场");
  assert.equal(suggestions[0].count, 4);
});

test("按所在 PON 口推荐村：至少 3 户且占已归村户 60% 以上", () => {
  const rec = places.portVillageRecommendations([
    { oltIp: "10.0.0.1", board: "2", pon: "1", village: "陈屋村", users: 15 },
    { oltIp: "10.0.0.1", board: "2", pon: "2", village: "陈屋村", users: 3 },
    { oltIp: "10.0.0.1", board: "2", pon: "2", village: "寮厦村", users: 3 },
    { oltIp: "10.0.0.1", board: "2", pon: "3", village: "寮厦村", users: 2 }
  ]);
  assert.deepEqual(rec.get("10.0.0.1|2|1"), { village: "陈屋村", count: 15, assigned: 15 });
  assert.equal(rec.has("10.0.0.1|2|2"), false);
  assert.equal(rec.has("10.0.0.1|2|3"), false);
});

test("数据库：台账写入后按需重算归属，规则和单户修正保存后生效，台账同步后修正仍在", async () => {
  await db.initDb();
  const backup = { path: "/b.sqlite", bytes: 1, sha256: "s" };
  const row = (onuId, loid, address) => ({
    oltIp: "10.0.0.9", chassis: "1", board: "1", pon: "1", onuId: String(onuId), onuIndexDisplay: `1/1/1:${onuId}`,
    loid, loidDisplay: loid, username: `用户${onuId}`, usernameSource: "nmse", userPhone: "", installationAddress: address,
    deviceType: "", ponType: "", phase: "", rxPower: "", distance: "", nmseOltIp: "", nmseOnuIndex: ""
  });
  const dataset = [
    ...filler("双岗村上环路", 20).map((address, index) => row(index + 10, `L${index + 10}`, address)),
    row(1, "LA", "广东省东莞市厚街镇万达广场5栋"),
    row(2, "LB", "广东省东莞市厚街镇榄树厦10巷1号"),
    row(3, "", "广东省东莞市厚街镇伦品涌工业区8号")
  ];
  await db.replaceMergedOnuDataset({ runId: `places-${Date.now()}`, operation: "merge", backup, conflicts: [], networkCount: dataset.length, nmseCount: 0, rows: dataset });
  let summary = await db.getPlaceSummary();
  assert.equal(summary.totalUsers, 23);
  assert.equal(summary.unassigned, 3);
  assert.equal(summary.villages[0].village, "双岗村");
  assert.equal((await db.ensurePlaceAssignments()).recomputed, false);

  const preview = await db.previewPlaceRule({ includeKeywords: ["万达广场"] });
  assert.deepEqual([preview.matched, preview.unassigned], [1, 1]);
  await db.createPlaceRule({ kind: "community", target: "万达广场", includeKeywords: "万达广场" });
  await db.savePlaceOverride({ loid: "LB", village: "厚街村", villageGroup: "榄树厦" });
  await db.savePlaceOverride({ loid: "", oltIp: "10.0.0.9", chassis: "1", board: "1", pon: "1", onuId: "3", community: "伦品涌工业区" });
  summary = await db.getPlaceSummary();
  assert.equal(summary.unassigned, 0);
  assert.deepEqual(summary.communities.map((item) => item.name).sort(), ["万达广场", "伦品涌工业区"]);
  const snapshots = await db.getMergedOnuSnapshots();
  const lb = snapshots.find((item) => item.loid === "LB");
  assert.deepEqual([lb.village, lb.villageGroup, lb.placeSource], ["厚街村", "榄树厦", "manual"]);
  const users = await db.getPlaceUsers({ community: "万达广场" });
  assert.equal(users.total, 1);
  assert.equal(users.rows[0].place, "万达广场小区");

  // 台账整表重写（同步）后，修正和规则照样生效。
  await db.replaceMergedOnuDataset({ runId: `places-again-${Date.now()}`, operation: "merge", backup, conflicts: [], networkCount: dataset.length, nmseCount: 0, rows: dataset });
  const again = (await db.getMergedOnuSnapshots()).find((item) => item.loid === "LB");
  assert.equal(again.villageGroup, "榄树厦");
  const pon = await db.getPonPlaceSummary();
  assert.match(pon["10.0.0.9|1|1"].text, /^双岗村、/);
  // 按口推荐：同口 20 户双岗村，没归村的户推荐双岗村；采纳后保留已有的小区修正。
  await db.savePlaceOverride({ loid: "LB" });
  const recommended = await db.getPlaceUsers({ unassigned: true, recommendedOnly: true });
  assert.deepEqual(recommended.rows.map((item) => [item.loid, item.recommendation?.village]), [["LB", "双岗村"]]);
  const noVillage = await db.getPlaceUsers({ recommendedOnly: true });
  assert.deepEqual(noVillage.rows.map((item) => item.onuId).sort(), ["1", "2", "3"]);
  const target = noVillage.rows.find((item) => item.onuId === "3");
  assert.equal((await db.acceptPlaceRecommendations([{ ...target, village: target.recommendation.village }])).saved, 1);
  const accepted = (await db.getMergedOnuSnapshots()).find((item) => item.onuId === "3");
  assert.deepEqual([accepted.village, accepted.community, accepted.placeSource], ["双岗村", "伦品涌工业区", "manual"]);
  await db.savePlaceOverride({ loid: "LB", village: "厚街村", villageGroup: "榄树厦" });
  // 口归属：口上所有户归到指定处（单户修正除外），按口汇总带上手动值；清空恢复自动。
  const assigned = await db.savePortPlaceAssignment({ oltIp: "10.0.0.9", board: "1", pon: "1", village: "厚街村", villageGroup: "下栅" });
  assert.equal(assigned.label, "厚街村/下栅小组");
  let byPort = await db.getMergedOnuSnapshots();
  // 单户修正过的（LB、采纳过推荐的第 3 户）保持原样，其余都按口归属。
  assert.ok(byPort.filter((item) => item.placeSource !== "manual").every((item) => item.village === "厚街村" && item.villageGroup === "下栅" && item.placeSource === "port"));
  assert.equal(byPort.find((item) => item.loid === "LB").villageGroup, "榄树厦");
  assert.equal(byPort.find((item) => item.onuId === "3").village, "双岗村");
  assert.equal((await db.getPonPlaceSummary())["10.0.0.9|1|1"].rows[""].label, "厚街村/下栅小组");
  assert.equal(await db.savePortPlaceAssignment({ oltIp: "10.0.0.9", board: "1", pon: "1" }), null);
  byPort = await db.getMergedOnuSnapshots();
  assert.equal(byPort.find((item) => item.onuId === "10").village, "双岗村");
  assert.equal((await db.getPonPlaceSummary())["10.0.0.9|1|1"].rows, undefined);
  await assert.rejects(() => db.savePortPlaceAssignment({ oltIp: "10.0.0.9", village: "厚街村" }), /OLT IP、板卡和 PON/);
  // 分路：同一个口的两行（两个一级地址）设成不同归属时，整口不套用，口上用户按地址自动判断。
  await db.savePortPlaceAssignments({ ports: [{ oltIp: "10.0.0.9", board: "1", pon: "1", address: "东宝路67号" }], village: "厚街村", villageGroup: "下栅" });
  assert.equal((await db.getMergedOnuSnapshots()).find((item) => item.onuId === "10").villageGroup, "下栅");
  await db.savePortPlaceAssignments({ ports: [{ oltIp: "10.0.0.9", board: "1", pon: "1", address: "丰泰 凌峰5-8栋光纤" }], village: "寮厦村", community: "卓越维港" });
  let split = (await db.getPonPlaceSummary())["10.0.0.9|1|1"];
  assert.equal(split.split, true);
  assert.deepEqual(Object.keys(split.rows).sort(), ["丰泰凌峰5-8栋光纤", "东宝路67号"].sort());
  const auto = (await db.getMergedOnuSnapshots()).find((item) => item.onuId === "10");
  assert.deepEqual([auto.village, auto.villageGroup, auto.placeSource], ["双岗村", "", "address"]);
  // 两行改成同一归属后，整口重新套用。
  await db.savePortPlaceAssignments({ ports: [{ oltIp: "10.0.0.9", board: "1", pon: "1", address: "东宝路67号" }, { oltIp: "10.0.0.9", board: "1", pon: "1", address: "丰泰凌峰5-8栋光纤" }], village: "寮厦村", community: "卓越维港" });
  split = (await db.getPonPlaceSummary())["10.0.0.9|1|1"];
  assert.equal(split.split, false);
  assert.equal((await db.getMergedOnuSnapshots()).find((item) => item.onuId === "10").community, "卓越维港");
  await db.savePortPlaceAssignments({ ports: [{ oltIp: "10.0.0.9", board: "1", pon: "1", address: "东宝路67号" }, { oltIp: "10.0.0.9", board: "1", pon: "1", address: "丰泰凌峰5-8栋光纤" }] });
  // 批量：多个口设成同一归属（重复的口只算一次），再一起恢复自动。
  const batch = await db.savePortPlaceAssignments({
    ports: [{ oltIp: "10.0.0.9", board: "1", pon: "1" }, { oltIp: "10.0.0.9", slot: "1", pon: "1" }, { oltIp: "10.0.0.9", board: "1", pon: "2" }],
    village: "厚街村", community: "卓越维港"
  });
  assert.deepEqual([batch.saved, batch.cleared, batch.label], [2, false, "厚街村/卓越维港小区"]);
  assert.deepEqual((await db.getPortPlaceAssignments()).map((item) => `${item.pon}:${item.label}`), ["1:厚街村/卓越维港小区", "2:厚街村/卓越维港小区"]);
  assert.equal((await db.getMergedOnuSnapshots()).find((item) => item.onuId === "10").community, "卓越维港");
  const cleared = await db.savePortPlaceAssignments({ ports: [{ oltIp: "10.0.0.9", board: "1", pon: "1" }, { oltIp: "10.0.0.9", board: "1", pon: "2" }] });
  assert.deepEqual([cleared.saved, cleared.cleared], [2, true]);
  assert.deepEqual(await db.getPortPlaceAssignments(), []);
  await assert.rejects(() => db.savePortPlaceAssignments({ ports: [] }), /请先选择台账行/);
  await assert.rejects(() => db.savePortPlaceAssignments({ ports: [{ oltIp: "10.0.0.9", pon: "1" }], village: "厚街村" }), /OLT IP、板卡和 PON/);
  // 三项都清空即删除修正。
  assert.equal(await db.savePlaceOverride({ loid: "LB" }), null);
  assert.equal((await db.getPlaceOverrides()).length, 1);
  assert.equal((await db.getPlaceOverrides())[0].village, "双岗村");
});

test("飞书用户卡片显示归属，网关候选带上 place", async () => {
  const gateway = createOltDataGateway({
    getOlts: async () => [{ id: "olt-1", name: "OLT 1", host: "10.0.0.9", vendor: "zte", enabled: true }],
    getUsers: async () => [{ onuIndex: "1/1/1:2", username: "李四", userPhone: "", installationAddress: "广东省东莞市厚街镇榄树厦10巷1号", loid: "LB", mac: "", village: "厚街村", villageGroup: "榄树厦", community: "" }],
    getPonPorts: async () => [],
    getDatasetRevision: async () => "r1",
    listOnus: async () => []
  });
  const result = await gateway.queryUsers({ intent: "find_by_name", value: "李四", oltIds: ["olt-1"] });
  assert.equal(result.candidates[0].place, "厚街村/榄树厦小组");
  const card = renderReply({
    kind: "onu-detail",
    candidate: { ...result.candidates[0], oltName: "OLT 1" },
    detail: { status: { phase: "online", rxPower: "-20", distance: "", serial: "", name: "李四" } }
  });
  assert.match(JSON.stringify(card), /所属村 \/ 小组 \/ 小区/);
  assert.match(JSON.stringify(card), /厚街村\/榄树厦小组/);
});

test("第二步：村级抢修 PON 口、小组菜单、弱光、抽样按归属字段查询；解析不到时沿用地址匹配", async () => {
  const user = (onuIndex, address, place = {}) => ({ onuIndex, username: `户${onuIndex}`, userPhone: "", installationAddress: address, loid: "", mac: "", village: "", villageGroup: "", community: "", ...place });
  const users = [
    // 2/11：地址写的是陈屋村，但已归到厚街村/下栅小组。
    user("1/2/11:1", "广东省东莞市厚街镇陈屋村东宝路67号", { village: "厚街村", villageGroup: "下栅" }),
    user("1/2/11:2", "广东省东莞市厚街镇陈屋村东宝路69号", { village: "厚街村", villageGroup: "下栅" }),
    user("1/2/12:1", "广东省东莞市厚街镇丰泰凌峰4栋", { village: "环岗村", community: "丰泰" }),
    user("1/2/12:2", "广东省东莞市厚街镇丰泰凌峰9栋", { village: "环岗村", community: "丰泰" }),
    user("1/2/13:1", "广东省东莞市厚街镇厚街村上栅新村3号", { village: "厚街村", villageGroup: "上栅" }),
    user("1/2/14:1", "广东省东莞市厚街镇万达广场5栋", {}),
    user("1/2/15:1", "广东省东莞市厚街镇陈屋村太平西一巷3号", { village: "陈屋村" })
  ];
  const assignments = [
    // 3/6 口上台账里还没有用户，但已按行指定为厚街村/下栅小组。
    { oltIp: "10.0.0.1", board: "3", pon: "6", address: "太平西四巷6号", village: "厚街村", villageGroup: "下栅", community: "" },
    { oltIp: "10.9.9.9", board: "1", pon: "1", address: "别的 OLT", village: "厚街村", villageGroup: "下栅", community: "" }
  ];
  const gateway = createOltDataGateway({
    getOlts: async () => [{ id: "olt-1", name: "OLT 1", host: "10.0.0.1", vendor: "zte", enabled: true }],
    getUsers: async () => users,
    getPonPorts: async () => [{ oltIp: "10.0.0.1", chassis: "1", board: "3", pon: "6", address: "太平西四巷6号" }],
    getDatasetRevision: async () => "r1",
    listOnus: async () => [{ chassis: "1", board: "2", pon: "12", onuId: "1", phase: "working", rxPower: "-20.5" }],
    getPortPlaceAssignments: async () => assignments,
    getLatestOpticalSamples: async () => [
      { chassis: "1", board: "2", pon: "12", onuId: "1", rxDbm: -28.4, sampleDate: "2026-10-11" },
      { chassis: "1", board: "2", pon: "12", onuId: "2", rxDbm: -20.1, sampleDate: "2026-10-11" }
    ]
  });
  const pons = (result) => result.candidates.map((item) => `${item.pon.board}/${item.pon.pon}:${item.matchedUserCount}/${item.ponUserCount}${item.sparse ? "零星" : ""}`);

  const village = await gateway.queryVillagePons({ value: "厚街村", oltIds: ["olt-1"], offset: 0, limit: 20 });
  assert.deepEqual(pons(village), ["2/11:2/2", "2/13:1/1", "3/6:0/0"]);
  assert.equal(village.region, null);
  assert.equal(village.candidates.find((item) => item.pon.pon === "6").address, "太平西四巷6号");
  const group = await gateway.queryVillagePons({ value: "厚街村下栅", oltIds: ["olt-1"], offset: 0, limit: 20 });
  assert.deepEqual(pons(group), ["2/11:2/2", "3/6:0/0"]);
  assert.deepEqual(group.region, { village: "厚街村", name: "下栅小组" });
  const community = await gateway.queryVillagePons({ value: "丰泰小区", oltIds: ["olt-1"], offset: 0, limit: 20 });
  assert.deepEqual(pons(community), ["2/12:2/2"]);
  // 地址里写着“陈屋村”的户已归到厚街村，查陈屋村不再出现；“万达广场”没设为小区，沿用地址匹配。
  const chenwu = await gateway.queryVillagePons({ value: "陈屋村", oltIds: ["olt-1"], offset: 0, limit: 20 });
  assert.deepEqual(pons(chenwu), ["2/15:1/1"]);
  const wanda = await gateway.queryVillagePons({ value: "万达广场", oltIds: ["olt-1"], offset: 0, limit: 20 });
  assert.deepEqual(pons(wanda), ["2/14:1/1"]);

  const menu = await gateway.villageRegionMenu({ value: "厚街村", oltIds: ["olt-1"] });
  assert.deepEqual(menu.regions.map((item) => `${item.name}:${item.userCount}户/${item.ponCount}口`), ["下栅小组:2户/2口", "上栅小组:1户/1口"]);
  assert.deepEqual((await gateway.villageRegionMenu({ value: "下栅小组", oltIds: ["olt-1"] })).region, { village: "厚街村", name: "下栅小组" });
  // 飞书选菜单后回传“村名 + 名称”，要能查回同一个小组。
  const picked = await gateway.queryVillagePons({ value: `${menu.regions[0].village}${menu.regions[0].name}`, oltIds: ["olt-1"], offset: 0, limit: 20 });
  assert.deepEqual(pons(picked), ["2/11:2/2", "3/6:0/0"]);

  const weak = await gateway.queryWeakLight({ value: "丰泰", oltIds: ["olt-1"] });
  assert.equal(weak.place, "丰泰小区");
  assert.deepEqual([weak.totalUsers, weak.weakCount], [2, 1]);

  const sample = await gateway.sampleVillagePonOnlineUser({ value: "丰泰小区", oltIds: ["olt-1"], oltId: "olt-1", pon: { chassis: "1", board: "2", pon: "12" }, random: () => 0 });
  assert.equal(sample.candidate.name, "户1/2/12:1");
});
