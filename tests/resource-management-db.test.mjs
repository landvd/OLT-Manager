import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.OLT_MANAGER_DATA_DIR = await mkdtemp(join(tmpdir(), "olt-manager-resource-"));
const db = await import("../src/db.mjs");
const { createSecretProvider } = await import("../src/secret-provider.mjs");

test("resource installation address cleanup removes duplicated administrative prefixes", () => {
  assert.equal(
    db.normalizeResourceInstallationAddress("广东省东莞市厚街镇4测试片测试村东莞市厚街镇测试村示例路1号#"),
    "广东省东莞市厚街镇测试村示例路1号"
  );
  assert.equal(
    db.normalizeResourceInstallationAddress("广东省东莞市厚街镇4测试片示例小区东莞市厚街镇示例村示例小区一栋1单元101"),
    "广东省东莞市厚街镇示例村示例小区一栋1单元101"
  );
  assert.equal(
    db.normalizeResourceInstallationAddress("广东省东莞市厚街镇测试大道测试村示例路1号"),
    "广东省东莞市厚街镇测试村示例路1号"
  );
  assert.equal(
    db.normalizeResourceInstallationAddress("广东省东莞市厚街镇21甲片甲村东莞市厚街镇乙村示例路2号#"),
    "广东省东莞市厚街镇乙村示例路2号"
  );
  assert.equal(
    db.normalizeResourceInstallationAddress("广东省佛山市南海区大沥镇2甲片甲村佛山市南海区大沥镇示例路3号#"),
    "广东省佛山市南海区大沥镇示例路3号"
  );
  assert.equal(
    db.normalizeResourceInstallationAddress("广东省东莞市厚街镇4甲片甲村东莞市厚街镇5乙片乙村东莞市厚街镇示例路4号#"),
    "广东省东莞市厚街镇示例路4号"
  );
  assert.equal(
    db.normalizeResourceInstallationAddress("广东省东莞市厚街镇示例村18号#"),
    "广东省东莞市厚街镇示例村18号"
  );
});

test("resource installation address cleanup keeps normal addresses and is idempotent", () => {
  const normalAddress = "广东省东莞市厚街镇4测试片测试村示例路1号";
  assert.equal(db.normalizeResourceInstallationAddress(normalAddress), normalAddress);
  const normalEstateAddress = "广东省东莞市厚街镇4测试片示例小区一栋1单元101";
  assert.equal(db.normalizeResourceInstallationAddress(normalEstateAddress), normalEstateAddress);
  const normalRoadAddress = "广东省东莞市厚街镇测试大道示例路1号";
  assert.equal(db.normalizeResourceInstallationAddress(normalRoadAddress), normalRoadAddress);
  const cleaned = db.normalizeResourceInstallationAddress("广东省东莞市厚街镇4测试片测试村东莞市厚街镇测试村示例路1号#");
  assert.equal(db.normalizeResourceInstallationAddress(cleaned), cleaned);
});

test("resource management config returns its saved password for seamless operation", async () => {
  await db.initDb();
  await db.saveResourceManagementConfig({ serverUrl: "http://nmse.example:9000", username: "operator", password: "secret", migrationMasterPassword: "test-master-password" });
  const publicConfig = await db.getResourceManagementConfig();
  assert.equal(publicConfig.serverUrl, "http://nmse.example:9000");
  assert.equal(publicConfig.username, "operator");
  assert.equal(publicConfig.password, "secret");
  assert.equal(publicConfig.backend, "masterPassword");
  assert.equal(publicConfig.needsMigration, false);
  await assert.rejects(() => db.getResourceManagementPassword({ masterPassword: "wrong-password" }), /迁移主密码错误/);
  assert.equal(await db.getResourceManagementPassword({ masterPassword: "test-master-password" }), "secret");
});

test("resource management config can save and retrieve password directly without migration master password", async () => {
  await db.initDb();
  await db.saveResourceManagementConfig({ serverUrl: "http://nmse.direct:9000", username: "admin", password: "plain-secret" });
  const publicConfig = await db.getResourceManagementConfig();
  assert.equal(publicConfig.serverUrl, "http://nmse.direct:9000");
  assert.equal(publicConfig.username, "admin");
  assert.equal(publicConfig.password, "plain-secret");
  assert.equal(publicConfig.credentialConfigured, true);
  assert.equal(publicConfig.needsMigration, false);
  assert.equal(await db.getResourceManagementPassword(), "plain-secret");
});

test("resource management prefers OS encryption when available without a migration password", async () => {
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`encrypted:${value}`, "utf8"),
    decryptString: (value) => Buffer.from(value).toString("utf8").replace(/^encrypted:/, "")
  };
  const provider = createSecretProvider({ safeStorage });
  db.configureResourceManagementSecretProvider(provider);
  try {
    await db.saveResourceManagementConfig({ serverUrl: "http://nmse.secure:9000", username: "admin", password: "os-secret" });
    const publicConfig = await db.getResourceManagementConfig();
    assert.equal(publicConfig.backend, "safeStorage");
    assert.equal(publicConfig.password, "os-secret");
    assert.equal(await db.getResourceManagementPassword(), "os-secret");
  } finally {
    db.configureResourceManagementSecretProvider(createSecretProvider());
  }
});

test("resource management does not silently downgrade when advertised OS encryption fails", async () => {
  const provider = createSecretProvider({
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: () => { throw new Error("system encryption failed"); },
      decryptString: () => ""
    }
  });
  db.configureResourceManagementSecretProvider(provider);
  try {
    await assert.rejects(
      db.saveResourceManagementConfig({ serverUrl: "http://nmse.fail-closed:9000", username: "admin", password: "must-not-downgrade" }),
      /system encryption failed/
    );
  } finally {
    db.configureResourceManagementSecretProvider(createSecretProvider());
  }
});

test("OSS resource config can save and retrieve password directly without master password", async () => {
  await db.initDb();
  await db.saveOssResourceConfig({
    authBaseUrl: "http://auth.direct:8080",
    ngbBaseUrl: "http://ngb.direct:8080",
    username: "oss-admin",
    password: "oss-secret-password",
    organizationName: "TestOrg",
    roomName: "TestRoom"
  });
  const publicConfig = await db.getOssResourceConfig();
  assert.equal(publicConfig.username, "oss-admin");
  assert.equal(publicConfig.configured, true);
  assert.equal(publicConfig.credentialConfigured, true);
  assert.equal(publicConfig.password, "oss-secret-password");
  assert.equal(await db.getOssResourcePassword(), "oss-secret-password");
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
      useraddr: "广东省东莞市厚街镇4测试片测试村东莞市厚街镇测试村示例路1号#"
    }
  ] });
  const rows = await db.getResourceUsers({ oltIp: "192.0.2.97" });
  assert.equal(rows[0].installationAddress, "广东省东莞市厚街镇测试村示例路1号");
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
