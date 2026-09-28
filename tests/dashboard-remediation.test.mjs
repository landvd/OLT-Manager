import test from "node:test";
import assert from "node:assert/strict";
import {
  parseRxPowerValue,
  isSevereWeakOptical,
  createDashboardRemediationService
} from "../src/dashboard-remediation-service.mjs";

test("parseRxPowerValue and isSevereWeakOptical correctly identify weak optical power", () => {
  assert.equal(parseRxPowerValue("-28.50 dBm"), -28.5);
  assert.equal(parseRxPowerValue("-24.11"), -24.11);
  assert.equal(parseRxPowerValue(null), null);
  assert.equal(parseRxPowerValue("no signal"), null);
  assert.equal(parseRxPowerValue(""), null);

  assert.equal(isSevereWeakOptical("-28.50 dBm"), true);
  assert.equal(isSevereWeakOptical("-27.10"), true);
  assert.equal(isSevereWeakOptical("-26.90"), false);
  assert.equal(isSevereWeakOptical("-19.50"), false);
  assert.equal(isSevereWeakOptical(null), false);
});

test("createDashboardRemediationService filters by room and aggregates 4 major remediations", async () => {
  const fakeOlts = [
    { id: 1, name: "厚街-OLT-1", host: "172.19.104.98", vendor: "zte", roomName: "厚街机房", enabled: 1 },
    { id: 2, name: "茶山-OLT-2", host: "172.19.104.99", vendor: "huawei", roomName: "茶山机房", enabled: 1 }
  ];

  const fakeSnapshots = [
    // 厚街机房记录
    {
      oltIp: "172.19.104.98",
      chassis: "1", board: "1", pon: "1", onuId: "1",
      onuIndexDisplay: "1/1/1:1",
      username: "张三",
      loid: "DG10001",
      installationAddress: "厚街康乐南路1号",
      rxPower: "-28.90 dBm",
      phase: "在线"
    },
    {
      oltIp: "172.19.104.98",
      chassis: "1", board: "1", pon: "1", onuId: "2",
      onuIndexDisplay: "1/1/1:2",
      username: "李四",
      loid: "DG10001", // 重复 LOID!
      installationAddress: "厚街康乐南路2号",
      rxPower: "-19.20 dBm",
      phase: "在线"
    },
    {
      oltIp: "172.19.104.98",
      chassis: "1", board: "1", pon: "1", onuId: "3",
      onuIndexDisplay: "1/1/1:3",
      username: "王五",
      loid: "DG10003",
      installationAddress: "厚街康乐南路3号",
      rxPower: "-10.00 dBm", // 与 -28.9 极差 18.9 dB -> 离散度超标!
      phase: "在线"
    },
    // 茶山机房记录
    {
      oltIp: "172.19.104.99",
      chassis: "0", board: "1", pon: "1", onuId: "1",
      onuIndexDisplay: "0/1/1:1",
      username: "赵六",
      loid: "CS99999",
      rxPower: "-31.00 dBm",
      phase: "在线"
    }
  ];

  const fakeConflicts = [
    {
      runId: "run-01",
      reason: "network_coordinate_duplicate",
      oltIp: "172.19.104.98",
      onuIndexDisplay: "1/1/1:1",
      loid: "DG10001",
      detail: "网管二期多台设备占用同一物理坐标"
    }
  ];

  const service = createDashboardRemediationService({
    getOssResourceConfig: async () => ({ roomName: "厚街机房", organizationName: "东莞分公司" }),
    getOlts: async () => fakeOlts,
    getMergedOnuSnapshots: async () => fakeSnapshots,
    getMergedOnuConflicts: async () => fakeConflicts
  });

  const res = await service.getRemediationWorkdesk({ roomName: "厚街机房" });

  assert.equal(res.ok, true);
  assert.equal(res.roomName, "厚街机房");
  assert.equal(res.summary.totalOlts, 1); // 仅厚街-OLT-1
  assert.equal(res.summary.totalOnus, 3); // 3 户厚街用户
  assert.equal(res.summary.weakCount, 1); // 张三 -28.9 dBm

  // 验证 3 大圆饼图数据
  assert.ok(res.donutCharts);
  assert.equal(res.donutCharts.deviceStatus.total, 1);
  assert.equal(res.donutCharts.deviceStatus.percent, 100);
  assert.equal(res.donutCharts.userOnline.total, 3);
  assert.equal(res.donutCharts.opticalHealth.total, 3);

  // 验证 OLT 设备矩阵
  assert.ok(Array.isArray(res.oltMatrix));
  assert.equal(res.oltMatrix.length, 1);
  assert.equal(res.oltMatrix[0].host, "172.19.104.98");
  assert.equal(res.oltMatrix[0].totalOnus, 3);
  assert.equal(res.oltMatrix[0].onlineOnus, 3);
  assert.equal(res.oltMatrix[0].weakOnuCount, 1);

  // 验证重点预警端口
  assert.ok(Array.isArray(res.topAlertPorts));
  assert.ok(res.topAlertPorts.length >= 1);
  const dispPort = res.topAlertPorts.find((p) => p.issueType === "high_dispersion");
  assert.ok(dispPort);
  assert.equal(dispPort.oltIp, "172.19.104.98");
  assert.equal(dispPort.ponPort, "1/1/1");
});

test("createDashboardRemediationService maps primaryBoxAddress correctly from pon_ports 台账", async () => {
  const fakeOlts = [
    { id: 1, name: "华为-MA5800", host: "172.19.104.102", vendor: "huawei", roomName: "厚街机房", enabled: 1 }
  ];

  const fakePonPorts = [
    { oltIp: "172.19.104.102", chassis: "0", board: "1", pon: "0", ponPort: "0/1/0", address: "企山头优一家" },
    { oltIp: "172.19.104.102", chassis: "0", board: "1", pon: "1", ponPort: "0/1/1", address: "尚都三期A栋" },
    { oltIp: "172.19.104.102", chassis: "0", board: "1", pon: "1", ponPort: "0/1/1", address: "尚都三期B栋" }
  ];

  const fakeSnapshots = [
    { oltIp: "172.19.104.102", chassis: "0", board: "1", pon: "0", onuId: "1", rxPower: "-28.5 dBm", phase: "在线", installationAddress: "厚街企山头1号" },
    { oltIp: "172.19.104.102", chassis: "0", board: "1", pon: "0", onuId: "2", rxPower: "-29.0 dBm", phase: "在线", installationAddress: "厚街企山头2号" },
    { oltIp: "172.19.104.102", chassis: "0", board: "1", pon: "0", onuId: "3", rxPower: "-27.8 dBm", phase: "在线", installationAddress: "厚街企山头3号" },
    { oltIp: "172.19.104.102", chassis: "0", board: "1", pon: "1", onuId: "1", rxPower: "-10.0 dBm", phase: "在线" },
    { oltIp: "172.19.104.102", chassis: "0", board: "1", pon: "1", onuId: "2", rxPower: "-20.0 dBm", phase: "在线" },
    { oltIp: "172.19.104.102", chassis: "0", board: "1", pon: "1", onuId: "3", rxPower: "-25.0 dBm", phase: "在线" }
  ];

  const service = createDashboardRemediationService({
    getOlts: async () => fakeOlts,
    getPonPorts: async () => fakePonPorts,
    getMergedOnuSnapshots: async () => fakeSnapshots
  });

  const res = await service.getRemediationWorkdesk({ roomName: "厚街机房" });
  assert.equal(res.ok, true);

  const hwOlt = res.oltMatrix.find((o) => o.host === "172.19.104.102");
  assert.ok(hwOlt);
  assert.equal(hwOlt.alertPorts.length, 2);

  const port010 = hwOlt.alertPorts.find((p) => p.ponPort === "0/1/0");
  assert.ok(port010);
  assert.equal(port010.fullPortDisplay, "172.19.104.102/0/1/0");
  assert.equal(port010.primaryBoxAddress, "企山头优一家");

  const port011 = hwOlt.alertPorts.find((p) => p.ponPort === "0/1/1");
  assert.ok(port011);
  assert.equal(port011.primaryBoxAddress, "尚都三期A栋、尚都三期B栋");
});

