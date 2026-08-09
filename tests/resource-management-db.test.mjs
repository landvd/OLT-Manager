import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.OLT_MANAGER_DATA_DIR = await mkdtemp(join(tmpdir(), "olt-manager-resource-"));
const db = await import("../src/db.mjs");

test("resource installation address cleanup removes duplicated administrative prefixes", () => {
  assert.equal(
    db.normalizeResourceInstallationAddress("广东省东莞市厚街镇4河田片河田村东莞市厚街镇河田村白石坑45号#"),
    "广东省东莞市厚街镇河田村白石坑45号"
  );
  assert.equal(
    db.normalizeResourceInstallationAddress("广东省东莞市厚街镇4河田片海逸豪庭东莞市厚街镇环岗村海逸豪庭尚都尚都91栋3单元2104"),
    "广东省东莞市厚街镇环岗村海逸豪庭尚都尚都91栋3单元2104"
  );
  assert.equal(
    db.normalizeResourceInstallationAddress("广东省东莞市厚街镇陈屋大道陈屋村官路大道国伟药店6号"),
    "广东省东莞市厚街镇陈屋村官路大道国伟药店6号"
  );
  assert.equal(
    db.normalizeResourceInstallationAddress("广东省东莞市厚街镇21溪头片溪头村东莞市厚街镇三屯村环城路88号#"),
    "广东省东莞市厚街镇三屯村环城路88号"
  );
  assert.equal(
    db.normalizeResourceInstallationAddress("广东省佛山市南海区大沥镇2盐步片河东村佛山市南海区大沥镇河东路88号#"),
    "广东省佛山市南海区大沥镇河东路88号"
  );
  assert.equal(
    db.normalizeResourceInstallationAddress("广东省东莞市厚街镇4河田片河田村东莞市厚街镇5三屯片三屯村东莞市厚街镇白石坑45号#"),
    "广东省东莞市厚街镇白石坑45号"
  );
  assert.equal(
    db.normalizeResourceInstallationAddress("广东省东莞市厚街镇山仔村18号#"),
    "广东省东莞市厚街镇山仔村18号"
  );
});

test("resource installation address cleanup keeps normal addresses and is idempotent", () => {
  const normalAddress = "广东省东莞市厚街镇4河田片河田村白石坑45号";
  assert.equal(db.normalizeResourceInstallationAddress(normalAddress), normalAddress);
  const normalEstateAddress = "广东省东莞市厚街镇4河田片海逸豪庭尚都91栋3单元2104";
  assert.equal(db.normalizeResourceInstallationAddress(normalEstateAddress), normalEstateAddress);
  const normalRoadAddress = "广东省东莞市厚街镇陈屋大道国伟药店6号";
  assert.equal(db.normalizeResourceInstallationAddress(normalRoadAddress), normalRoadAddress);
  const cleaned = db.normalizeResourceInstallationAddress("广东省东莞市厚街镇4河田片河田村东莞市厚街镇河田村白石坑45号#");
  assert.equal(db.normalizeResourceInstallationAddress(cleaned), cleaned);
});

test("resource management config never returns its password by default", async () => {
  await db.initDb();
  await db.saveResourceManagementConfig({ serverUrl: "http://nmse.example:9000", username: "operator", password: "secret" });
  const publicConfig = await db.getResourceManagementConfig();
  assert.equal(publicConfig.serverUrl, "http://nmse.example:9000");
  assert.equal(publicConfig.username, "operator");
  assert.equal(Object.hasOwn(publicConfig, "password"), false);
  assert.equal((await db.getResourceManagementConfig({ includeSecret: true })).password, "secret");
});

test("resource VLAN snapshot updates matching local PON rows and retains prior value", async () => {
  await db.replaceOlts([{ id: "resource-zte", name: "Resource ZTE", vendor: "zte", model: "C300", version: "V2.1", host: "192.0.2.98", readCommunity: "public" }], "test");
  await db.replacePonPorts([{ oltIp: "192.0.2.98", ponPort: "1/1/2", outerVlan: "1000", address: "test" }], "test");
  const result = await db.replaceResourceVlans({
    oltIp: "192.0.2.98", gridRank: "rank-1", ponVlans: [{ board: "1", pon: "2", svlan: "1062" }],
    cvlan: { begin: "3301", end: "4000", distributionType: "1" }
  });
  assert.equal(result.count, 1);
  assert.equal((await db.getPonPorts())[0].outerVlan, "1062");
  const snapshot = await db.getResourceVlanSnapshot("192.0.2.98");
  assert.equal(snapshot.olt.beginCvlan, "3301");
  assert.equal(snapshot.ports[0].previousOuterVlan, "1000");
  assert.equal(snapshot.ports[0].outerVlan, "1062");
});

test("resource user replacement removes stale rows only after a complete replacement call", async () => {
  await db.replaceResourceUsers({ oltIp: "192.0.2.98", gridRank: "rank-1", rows: [
    { onuIndexName: "1/1/2:1", username: "旧用户" },
    { onuIndexName: "1/1/2:2", username: "待移除" }
  ] });
  await db.replaceResourceUsers({ oltIp: "192.0.2.98", gridRank: "rank-1", rows: [
    { onuIndexName: "1/1/2:1", username: "新用户" }
  ] });
  const rows = await db.getResourceUsers({ oltIp: "192.0.2.98" });
  assert.deepEqual(rows.map((row) => [row.onuIndex, row.username]), [["1/1/2:1", "新用户"]]);
});

test("resource user replacement cleans installation addresses before saving", async () => {
  await db.replaceResourceUsers({ oltIp: "192.0.2.97", gridRank: "rank-clean", rows: [
    {
      onuIndexName: "1/1/2:1",
      useraddr: "广东省东莞市厚街镇4河田片河田村东莞市厚街镇河田村白石坑45号#"
    }
  ] });
  const rows = await db.getResourceUsers({ oltIp: "192.0.2.97" });
  assert.equal(rows[0].installationAddress, "广东省东莞市厚街镇河田村白石坑45号");
});

test("resource installation address cleanup reports both local snapshot stores", async () => {
  assert.deepEqual(await db.cleanResourceInstallationAddresses(), { count: 0, snapshots: 0, checkpoints: 0 });
});

test("resource users sort ONU indexes by numeric chassis board PON and ONU ID", async () => {
  await db.replaceResourceUsers({ oltIp: "192.0.2.99", gridRank: "rank-2", rows: [
    { onuIndexName: "1/8/9:58", username: "58" },
    { onuIndexName: "1/8/9:9", username: "9" },
    { onuIndexName: "1/8/10:1", username: "next-pon" },
    { onuIndexName: "1/7/16:128", username: "previous-board" }
  ] });
  const rows = await db.getResourceUsers({ oltIp: "192.0.2.99" });
  assert.deepEqual(rows.map((row) => row.onuIndex), ["1/7/16:128", "1/8/9:9", "1/8/9:58", "1/8/10:1"]);
});
