import test from "node:test";
import assert from "node:assert/strict";
import {
  WIZARD_STEPS,
  deriveManagementHostFromResourceIp,
  inferOltVendorAndProfile,
  buildOltsFromOssSelection,
  validateOltListCredentials,
  canProceedToNextStep,
  isSystemFullyConfigured
} from "../src/setup-wizard.mjs";

test("WIZARD_STEPS defines 7 standard configuration phases", () => {
  assert.equal(WIZARD_STEPS.length, 7);
  assert.equal(WIZARD_STEPS[0].title, "网管登录配置");
  assert.equal(WIZARD_STEPS[1].title, "发现与选择 OLT");
  assert.equal(WIZARD_STEPS[2].title, "填写 OLT 连接凭据");
  assert.equal(WIZARD_STEPS[3].title, "ONU 台账管理");
  assert.equal(WIZARD_STEPS[4].title, "网管数据同步");
  assert.equal(WIZARD_STEPS[5].title, "同步外层 VLAN");
  assert.equal(WIZARD_STEPS[6].title, "智能能力配置");
});

test("deriveManagementHostFromResourceIp maps 22.0.6.x and 22.0.4.x correctly", () => {
  assert.equal(deriveManagementHostFromResourceIp("22.0.6.50"), "10.106.0.50");
  assert.equal(deriveManagementHostFromResourceIp("22.0.4.98"), "10.104.0.98");
  assert.equal(deriveManagementHostFromResourceIp("192.168.1.1"), "192.168.1.1");
});

test("inferOltVendorAndProfile infers C600, MA5800, and C300 correctly", () => {
  const c600 = inferOltVendorAndProfile("厚街_C600_TITAN_01");
  assert.equal(c600.vendor, "zte");
  assert.equal(c600.deviceProfile, "zte-c600");

  const hw = inferOltVendorAndProfile("华为_MA5800_X7");
  assert.equal(hw.vendor, "huawei");
  assert.equal(hw.deviceProfile, "huawei-ma5800");

  const def = inferOltVendorAndProfile("中心机房_OLT_01");
  assert.equal(def.vendor, "zte");
  assert.equal(def.deviceProfile, "zte-c300");
});

test("buildOltsFromOssSelection merges OSS selections with batch credentials", () => {
  const selected = [
    { resourceIp: "22.0.6.50", roomName: "机房A", name: "C600-01" },
    { resourceIp: "192.168.10.2", roomName: "机房B", name: "华为MA5800" }
  ];
  const batch = {
    readCommunity: "custom-comm",
    telnetPort: 23,
    telnetUsername: "admin",
    telnetPassword: "password123"
  };

  const olts = buildOltsFromOssSelection(selected, batch);
  assert.equal(olts.length, 2);

  assert.equal(olts[0].host, "10.106.0.50");
  assert.equal(olts[0].vendor, "zte");
  assert.equal(olts[0].readCommunity, "custom-comm");
  assert.equal(olts[0].telnetUsername, "admin");
  assert.equal(olts[0].telnetPassword, "password123");

  assert.equal(olts[1].host, "192.168.10.2");
  assert.equal(olts[1].vendor, "huawei");
  assert.equal(olts[1].readCommunity, "custom-comm");
});

test("validateOltListCredentials enforces non-empty host and community", () => {
  const invalidEmpty = validateOltListCredentials([]);
  assert.equal(invalidEmpty.valid, false);

  const missingHost = validateOltListCredentials([
    { id: "olt-1", name: "测试", host: "", readCommunity: "public" }
  ]);
  assert.equal(missingHost.valid, false);
  assert.match(missingHost.error, /缺少管理 IP/);

  const valid = validateOltListCredentials([
    { id: "olt-1", name: "测试", host: "10.10.10.1", readCommunity: "public" }
  ]);
  assert.equal(valid.valid, true);
});

test("canProceedToNextStep enforces prerequisites for each wizard phase", () => {
  // 步骤 1：两端网管均未登录时禁止直接推进；二期登录（能发现 OLT）或一期登录后允许推进
  assert.equal(canProceedToNextStep(1, { resource: { loggedIn: false }, oss: { loggedIn: false } }), false);
  assert.equal(canProceedToNextStep(1, { resource: { loggedIn: true }, oss: { loggedIn: false } }), true);
  assert.equal(canProceedToNextStep(1, { resource: { loggedIn: false }, oss: { loggedIn: true } }), true);
  assert.equal(canProceedToNextStep(1, { resource: { loggedIn: true }, oss: { loggedIn: true } }), true);

  // 步骤 2：未勾选任何 OLT 时禁止进入第 3 步
  assert.equal(canProceedToNextStep(2, { wizard: { selectedOssOlts: [] } }), false);
  assert.equal(canProceedToNextStep(2, { wizard: { selectedOssOlts: [{ resourceIp: "1.1.1.1" }] } }), true);

  // 步骤 3：未保存任何 OLT 时禁止进入第 4 步
  assert.equal(canProceedToNextStep(3, { adminOlts: [] }), false);
  assert.equal(canProceedToNextStep(3, { adminOlts: [{ id: "olt-1" }] }), true);

  // 步骤 4：台账步骤允许进入第 5 步
  assert.equal(canProceedToNextStep(4, {}), true);

  // 步骤 5：数据未同步时禁止进入第 6 步
  assert.equal(canProceedToNextStep(5, { mergedOnu: { dataset: { synced: false } } }), false);
  assert.equal(canProceedToNextStep(5, { mergedOnu: { dataset: { synced: true } } }), true);

  // 步骤 6、7 允许完成
  assert.equal(canProceedToNextStep(6, {}), true);
  assert.equal(canProceedToNextStep(7, {}), true);
});

test("isSystemFullyConfigured returns true only when olts, login, and sync exist", () => {
  assert.equal(isSystemFullyConfigured({}), false);
  assert.equal(isSystemFullyConfigured({
    adminOlts: [{ id: "olt-1" }],
    oss: { loggedIn: true },
    mergedOnu: { dataset: { synced: true } }
  }), true);
});

test("isSystemFullyConfigured treats configured credentials as configured even after the session expires", () => {
  const olts = [{ id: "olt-1" }];
  assert.equal(isSystemFullyConfigured({
    adminOlts: olts,
    oss: { loggedIn: false, credentialConfigured: true },
    mergedOnu: { dataset: { synced: true } }
  }), true);
  assert.equal(isSystemFullyConfigured({
    adminOlts: olts,
    setupStatus: { resourceConfigured: true, dataSynced: true }
  }), true);
  assert.equal(isSystemFullyConfigured({
    adminOlts: olts,
    setupStatus: { ossConfigured: true, dataSynced: false }
  }), false);
  assert.equal(isSystemFullyConfigured({
    adminOlts: [],
    setupStatus: { ossConfigured: true, dataSynced: true }
  }), false);
});
