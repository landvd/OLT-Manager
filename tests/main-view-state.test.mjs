import test from "node:test";
import assert from "node:assert/strict";
import {
  countDuplicateAddresses,
  countOnuGroups,
  excelRowsToPonRows,
  filterStorageKey,
  phaseInfo,
  ponRowsForExport,
  rxPowerInfo,
  rxPowerHint,
  uniqueSorted,
  inspectPonExcelImport,
  diagnoseOfflineCause,
  analyzeHistoricalOpticalSeries,
  buildOnuConfigTerminalCommands
} from "../src/main-view-state.mjs";

test("main view state keeps phase, power and aggregate display semantics", () => {
  assert.deepEqual(phaseInfo("LOS"), { text: "LOS", group: "los", type: "danger" });
  assert.equal(phaseInfo("unknown").type, "info");
  assert.deepEqual(rxPowerInfo("-20.5"), { text: "-20.5", className: "good" });
  assert.deepEqual(rxPowerInfo("-26"), { text: "-26", className: "warn" });
  assert.deepEqual(rxPowerInfo("-30"), { text: "-30", className: "bad" });
  assert.match(rxPowerHint("-20.5"), /光功率正常/);
  assert.match(rxPowerHint("-26.0"), /临界预警/);
  assert.match(rxPowerHint("-30.0"), /严重弱光/);
  assert.match(rxPowerHint(""), /光功率未采集/);
  assert.deepEqual(countOnuGroups([
    { phase: "working" }, { phase: "LOS" }, { phase: "dyinggasp" }, { phase: "offline" }, { phase: "other" }
  ]), { total: 5, online: 1, offline: 1, los: 1, power: 1, auth: 0, logging: 0, sync: 0 });
  assert.equal(countDuplicateAddresses([{ address: "A" }, { address: "A" }, { address: "B" }, { address: "" }]), 1);
});

test("main view state keeps filter keys, sorting, and Excel PON mapping", () => {
  assert.equal(filterStorageKey("olt-1"), "olt-manager-filters:olt-1");
  assert.deepEqual(uniqueSorted(["10", "2", "", "2"], true), ["2", "10"]);
  assert.deepEqual(uniqueSorted(["乙", "甲", "甲"]), ["甲", "乙"]);
  const rows = excelRowsToPonRows([{
    "OLT IP": "192.0.2.1", 槽: "1", 板卡: "2", PON: "3", "外层 VLAN": "100", 地址: "村一"
  }]);
  assert.deepEqual(rows[0], {
    oltIp: "192.0.2.1", chassis: "1", board: "2", slot: "2", pon: "3", ponPort: "1/2/3", outerVlan: "100", address: "村一"
  });
  assert.deepEqual(ponRowsForExport(rows), [{ "OLT IP": "192.0.2.1", "槽": "1", "板卡": "2", "PON": "3", "板槽端口": "1/2/3", "外层 VLAN": "100", "地址": "村一" }]);
});

test("inspectPonExcelImport inspects validity, skips empty lines, and tracks override counts", () => {
  const existingPorts = [
    { oltIp: "192.0.2.1", chassis: "1", board: "1", pon: "1", address: "老地址" }
  ];
  const inputRows = [
    { "OLT IP": "192.0.2.1", 槽: "1", 板卡: "1", PON: "1", 地址: "新地址1" }, // 覆盖已有
    { "OLT IP": "192.0.2.1", 槽: "1", 板卡: "1", PON: "2", 地址: "新口2" },   // 新增
    { "OLT IP": "", 槽: "", 板卡: "", PON: "", 地址: "" },                   // 空行
    { "OLT IP": "", 槽: "1", 板卡: "1", PON: "3", 地址: "无IP" },              // 异常：缺少IP
    { "OLT IP": "192.0.2.1", 槽: "1", 板卡: "", PON: "", 地址: "无端口" }       // 异常：缺少坐标
  ];

  const report = inspectPonExcelImport(inputRows, existingPorts);
  assert.equal(report.totalRaw, 5);
  assert.equal(report.validCount, 2);
  assert.equal(report.emptyCount, 1);
  assert.equal(report.invalidRows.length, 2);
  assert.equal(report.overrideCount, 1);
  assert.equal(report.newCount, 1);
  assert.match(report.invalidRows[0].reason, /缺少 OLT IP/);
  assert.match(report.invalidRows[1].reason, /无法解析有效板卡或 PON 口/);
  assert.equal(report.invalidRows[0].line, 5); // 索引3 + 2 = 5
});

test("diagnoseOfflineCause accurately classifies DyingGasp, LOS, LOF and unknown", () => {
  const dying = diagnoseOfflineCause("dying-gasp");
  assert.equal(dying.type, "success");
  assert.match(dying.badge, /DyingGasp/);
  assert.match(dying.advice, /切勿盲目上门/);

  const los = diagnoseOfflineCause("wire-down");
  assert.equal(los.type, "danger");
  assert.match(los.badge, /LOS/);
  assert.match(los.advice, /带红光笔/);

  const lof = diagnoseOfflineCause("lof");
  assert.equal(lof.type, "warning");
  assert.match(lof.badge, /LOF/);

  const empty = diagnoseOfflineCause("");
  assert.equal(empty.type, "info");
  assert.equal(empty.badge, "暂无离线记录");
});

test("analyzeHistoricalOpticalSeries computes delta, average, and alerts on degradation", () => {
  const stableRows = [
    { rxOptical: "-19.20" },
    { rxOptical: "-19.50" },
    { rxOptical: "-19.30" }
  ];
  const stable = analyzeHistoricalOpticalSeries(stableRows);
  assert.equal(stable.hasData, true);
  assert.equal(stable.sampleCount, 3);
  assert.equal(stable.delta, "0.30 dB");
  assert.equal(stable.degraded, false);
  assert.match(stable.verdict, /平稳/);

  const degradedRows = [
    { rxOptical: "-19.00" },
    { rxOptical: "-21.50" }, // 差距 2.5 dB
    { rxOptical: "-20.00" }
  ];
  const degraded = analyzeHistoricalOpticalSeries(degradedRows);
  assert.equal(degraded.hasData, true);
  assert.equal(degraded.delta, "2.50 dB");
  assert.equal(degraded.degraded, true);
  assert.match(degraded.verdict, /突变恶化/);
});

test("buildOnuConfigTerminalCommands 生成中兴双命令（接口侧配置 + 终端已配置信息）与华为配置命令", () => {
  // 1. 中兴 C300 生成双命令（包含终端侧已配置信息）
  const zteCmds = buildOnuConfigTerminalCommands({
    vendor: "zte",
    chassis: "1",
    board: "2",
    pon: "3",
    onuId: "4"
  });
  assert.equal(zteCmds.length, 2, "中兴必须生成 2 条只读命令查看接口配置与终端配置");
  assert.equal(zteCmds[0], "show running-config interface gpon-onu_1/2/3:4");
  assert.equal(zteCmds[1], "show onu running config gpon-onu_1/2/3:4");

  // 2. 缺省值容错
  const zteDefault = buildOnuConfigTerminalCommands({ vendor: "zte" });
  assert.equal(zteDefault[0], "show running-config interface gpon-onu_1/1/1:1");
  assert.equal(zteDefault[1], "show onu running config gpon-onu_1/1/1:1");

  // 3. 华为 MA5800 命令
  const hwCmds = buildOnuConfigTerminalCommands({
    vendor: "huawei",
    chassis: "0",
    board: "1",
    pon: "2",
    onuId: "3"
  });
  assert.equal(hwCmds.length, 1);
  assert.equal(hwCmds[0], "display current-configuration ont 0/1/2 3");
});

