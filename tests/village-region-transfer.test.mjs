import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.OLT_MANAGER_DATA_DIR = await mkdtemp(join(tmpdir(), "olt-village-transfer-"));

import { addressInVillage, discoverVillageSubgroups, resolveRegionPons, transferRegions } from "../src/village-regions.mjs";
import { createOltDataGateway } from "../src/olt-data-gateway.mjs";
const db = await import("../src/db.mjs");

// 合成数据：广场的地址写的是“甲村”，实际归属“乙村”。
const plaza = { id: 7, village: "乙村", name: "合成广场", status: "active", transfer: true, includeKeywords: ["合成广场"], excludeKeywords: [] };

function users() {
  const rows = [];
  const add = (count, address, pon) => {
    for (let index = 0; index < count; index += 1) {
      rows.push({ oltIp: "192.0.2.1", onuIndex: `1/1/${pon}:${rows.length + 1}`, username: `用户${rows.length + 1}`, installationAddress: address(index) });
    }
  };
  add(6, (index) => `合成镇甲村东坊${index}号`, 1);
  add(6, (index) => `合成镇甲村合成广场${index}栋`, 2);
  add(4, (index) => `合成镇乙村西坊${index}号`, 3);
  return rows;
}

test("地名改归属：归入的地名算本村，原村排除；未通过或未勾选的不生效", () => {
  const transfers = transferRegions([plaza, { ...plaza, id: 8, name: "未通过", status: "candidate" }, { ...plaza, id: 9, name: "未勾选", transfer: false }]);
  assert.deepEqual(transfers.map((item) => item.id), [7]);
  assert.equal(addressInVillage("合成镇甲村合成广场1栋", "乙村", transfers), true);
  assert.equal(addressInVillage("合成镇甲村合成广场1栋", "乙", transfers), true);
  assert.equal(addressInVillage("合成镇甲村合成广场1栋", "甲村", transfers), false);
  assert.equal(addressInVillage("合成镇甲村东坊1号", "甲村", transfers), true);
  assert.equal(addressInVillage("合成镇甲村合成广场1栋", "甲村", []), true);
});

test("地名改归属：原村自动识别小组时不再生成该地名", () => {
  const before = discoverVillageSubgroups(users(), "甲村");
  assert.ok(before.candidates.some((item) => item.name === "合成广场"));
  const after = discoverVillageSubgroups(users(), "甲村", { transfers: [plaza] });
  assert.ok(!after.candidates.some((item) => item.name === "合成广场"));
  assert.equal(after.matchedUsers, 6);
});

test("地名改归属：小组 PON 口按归属后的本村用户判断分光地址命中", () => {
  const ponPorts = [{ oltIp: "192.0.2.1", chassis: "1", board: "1", pon: "2", address: "合成广场一级分光" }];
  const without = resolveRegionPons(plaza, { users: users(), ponPorts });
  const withTransfer = resolveRegionPons(plaza, { users: users(), ponPorts, transfers: [plaza] });
  const pon2 = (list) => list.find((item) => item.pon === "2");
  assert.equal(pon2(without).villageUsers, 0);
  assert.equal(pon2(withTransfer).villageUsers, 6);
  assert.equal(pon2(withTransfer).ledgerMatch, true);
  assert.equal(pon2(withTransfer).included, true);
});

test("网关：整村查询按改归属带上或排除该地名的用户", async () => {
  const rows = users();
  const gateway = createOltDataGateway({
    getOlts: async () => [{ id: "olt-a", name: "A", vendor: "zte", model: "C300", host: "192.0.2.1", enabled: true }],
    getUsers: async () => rows,
    getPonPorts: async () => [],
    getDatasetRevision: async () => "rev",
    listOnus: async () => [],
    getVillageRegions: async () => [plaza]
  });
  const yi = await gateway.queryVillagePons({ value: "乙村", oltIds: ["olt-a"] });
  assert.deepEqual(yi.candidates.map((item) => [item.pon.pon, item.matchedUserCount]).sort(), [["2", 6], ["3", 4]]);
  const jia = await gateway.queryVillagePons({ value: "甲村", oltIds: ["olt-a"] });
  assert.deepEqual(jia.candidates.map((item) => [item.pon.pon, item.matchedUserCount]), [["1", 6]]);
});

test("区域字典持久化：保存和修改改归属标记", async () => {
  await db.initDb();
  const created = await db.createVillageRegion({ village: "乙村", name: "合成广场", includeKeywords: ["合成广场"], transfer: true });
  assert.equal(created.transfer, true);
  const updated = await db.updateVillageRegion(created.id, { transfer: false });
  assert.equal(updated.transfer, false);
  const renamed = await db.updateVillageRegion(created.id, { name: "合成广场二" });
  assert.equal(renamed.transfer, false);
  const [candidate] = await db.saveVillageRegionCandidates("甲村", [{ name: "东坊", includeKeywords: ["甲村东坊"] }]);
  assert.equal(candidate.transfer, false);
});
