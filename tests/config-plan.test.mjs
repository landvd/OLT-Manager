import test from "node:test";
import assert from "node:assert/strict";
import {
  buildConfigPlanFromTemplate,
  configTemplates,
  extractMduOttVlans,
  huaweiSnAuthSerial,
  suggestNextOnuId
} from "../src/config-plan.mjs";

test("suggestNextOnuId uses max ONU ID plus one and ignores gaps", () => {
  assert.deepEqual(
    suggestNextOnuId([{ onuId: 1 }, { onuId: 23 }, { onuId: 25 }, { onuId: 37 }]),
    { blocked: false, onuId: 38, lastOnuId: 37, warning: "" }
  );
});

test("suggestNextOnuId blocks when a ZTE PON already reached 128", () => {
  assert.deepEqual(
    suggestNextOnuId([{ onuId: 1 }, { onuId: 128 }]),
    { blocked: true, onuId: "", lastOnuId: 128, warning: "PON 口 ONU ID 已达到 128，不能自动生成新 ONU ID。" }
  );
});

test("extractMduOttVlans reads dynamic VLANs from service-port rows", () => {
  const result = extractMduOttVlans([
    { servicePort: 1, vport: "1", userVlan: "3609", cVlan: "3609", sVlan: "1065" },
    { servicePort: 2, vport: "1", userVlan: "3176", cVlan: "3176", sVlan: "" },
    { servicePort: 3, vport: "1", userVlan: "86", cVlan: "86", sVlan: "" },
    { servicePort: 4, vport: "1", userVlan: "100", cVlan: "100", sVlan: "" }
  ]);

  assert.equal(result.ok, true);
  assert.deepEqual(result.vlans, {
    innerVlan: "3609",
    outerVlan: "1065",
    ottVlan: "3176",
    liveVlan: "86",
    defaultVlan: "90",
    intranetVlan: "100"
  });
});

test("self-operated template renders copy-only commands with selected ports", () => {
  const plan = buildConfigPlanFromTemplate({
    templateId: "zte-self-operated-internet",
    slot: 9,
    pon: 13,
    serial: "YHDZE2EACAE3",
    onuId: 38,
    outerVlan: "1068",
    ethPorts: ["eth_0/1", "eth_0/2"]
  });

  assert.equal(plan.blocked, false);
  assert.equal(plan.name, configTemplates[0].name);
  assert.doesNotMatch(plan.commands, /configure terminal/);
  assert.match(plan.commands, /onu 38 type GPON-SFU sn YHDZE2EACAE3/);
  assert.match(plan.commands, /service-port 1 vport 1 user-vlan 3301 vlan 3301 svlan 1068/);
  assert.match(plan.commands, /Vlan port eth_0\/1 mode hybrid def-vlan 3301/);
  assert.match(plan.commands, /Vlan port eth_0\/2 mode hybrid def-vlan 3301/);
  assert.match(plan.commands, /show running-config interface gpon-onu_1\/9\/13:38/);
  assert.match(plan.commands, /show onu running config gpon-onu_1\/9\/13:38/);
});

test("MDU+OTT template renders dynamic VLANs and fixed 86/90/100 rules", () => {
  const plan = buildConfigPlanFromTemplate({
    templateId: "zte-mdu-ott",
    slot: 7,
    pon: 13,
    serial: "ZTEG030C054F",
    onuId: 25,
    dynamicVlans: {
      innerVlan: "3609",
      outerVlan: "1065",
      ottVlan: "3176",
      liveVlan: "86",
      defaultVlan: "90",
      intranetVlan: "100"
    }
  });

  assert.equal(plan.blocked, false);
  assert.doesNotMatch(plan.commands, /configure terminal/);
  assert.match(plan.commands, /service-port 1 vport 1 user-vlan 3609 vlan 3609 svlan 1065/);
  assert.match(plan.commands, /service-port 2 vport 1 user-vlan 3176 vlan 3176/);
  assert.match(plan.commands, /service-port 3 vport 1 user-vlan 86 vlan 86/);
  assert.match(plan.commands, /service-port 4 vport 1 user-vlan 100 vlan 100/);
  assert.match(plan.commands, /service 1 gemport 1 vlan 3609,86,3176,100/);
  assert.match(plan.commands, /show running-config interface gpon-onu_1\/7\/13:25/);
  assert.match(plan.commands, /show onu running config gpon-onu_1\/7\/13:25/);
});

test("custom VLAN template renders ZTE internal-network style commands with selected VLAN", () => {
  const plan = buildConfigPlanFromTemplate({
    templateId: "zte-custom-vlan",
    slot: 2,
    pon: 8,
    serial: "ZTEG030C0914",
    onuId: 17,
    customVlan: "3609",
    ethPorts: ["eth_0/1", "eth_0/4"]
  });

  assert.equal(plan.blocked, false);
  assert.equal(plan.name, "ZTE 自定义 VLAN");
  assert.equal(plan.variables.innerVlan, "3609");
  assert.match(plan.commands, /service-port 1 vport 1 user-vlan 3609 vlan 3609/);
  assert.match(plan.commands, /vlan port eth_0\/1 mode hybrid def-vlan 3609/);
  assert.match(plan.commands, /vlan port eth_0\/4 mode hybrid def-vlan 3609/);
  assert.match(plan.commands, /show running-config interface gpon-onu_1\/2\/8:17/);
  assert.match(plan.commands, /show onu running config gpon-onu_1\/2\/8:17/);
});

test("custom VLAN template blocks when VLAN is missing", () => {
  const plan = buildConfigPlanFromTemplate({
    templateId: "zte-custom-vlan",
    slot: 2,
    pon: 8,
    serial: "ZTEG030C0914",
    onuId: 17,
    ethPorts: ["eth_0/1"]
  });

  assert.equal(plan.blocked, true);
  assert.deepEqual(plan.warnings, ["缺少自定义 VLAN，不能生成 ZTE 自定义 VLAN 配置方案。"]);
  assert.equal(plan.commands, "");
});

test("Huawei self-operated internet template generates documented preview commands", () => {
  const template = configTemplates.find((item) => item.id === "huawei-self-operated-internet");
  assert.equal(template?.vendor, "huawei");

  const result = buildConfigPlanFromTemplate({
    templateId: "huawei-self-operated-internet",
    slot: 10,
    pon: 7,
    actualOntId: 16,
    serial: "ZTEG-030C0914",
    outerVlan: "1064"
  });

  assert.equal(result.blocked, false);
  assert.match(result.commands, /interface gpon 0\/10/);
  assert.match(result.commands, /ont add 7 sn-auth 5A544547030C0914 omci ont-lineprofile-id 300 ont-srvprofile-id 300/);
  assert.match(result.commands, /ont port native-vlan 7 16 eth1 vlan 3301/);
  assert.match(result.commands, /service-port vlan 1064 gpon 0\/10\/7 ont 16 gemport 0 multi-service user-vlan 3301 tag-transform translate-and-add inner-vlan 3301 inner-priority 0/);
  assert.equal(result.variables.snAuthSerial, "5A544547030C0914");
  assert.equal(result.variables.actualOntId, "16");
  assert.deepEqual(result.variables.ethPorts, ["eth1"]);
});

test("Huawei template waits for OLT-assigned ONT ID before rendering dependent commands", () => {
  const result = buildConfigPlanFromTemplate({
    templateId: "huawei-link-booth",
    slot: 10,
    pon: 7,
    serial: "ZTEG-030C0914"
  });

  assert.equal(result.blocked, false);
  assert.match(result.commands, /ont add 7 sn-auth 5A544547030C0914 omci ont-lineprofile-id 300 ont-srvprofile-id 300/);
  assert.doesNotMatch(result.commands, /ont port native-vlan/);
  assert.doesNotMatch(result.commands, /service-port vlan/);
  assert.match(result.warnings.join("\n"), /ONT ID 由 OLT 自动分配/);
});

test("Huawei self-operated internet template supports selected eth ports with one service-port", () => {
  const result = buildConfigPlanFromTemplate({
    templateId: "huawei-self-operated-internet",
    slot: 10,
    pon: 7,
    actualOntId: 16,
    serial: "ZTEG-030C0914",
    outerVlan: "1064",
    ethPorts: ["eth1", "eth2"]
  });

  assert.equal(result.blocked, false);
  assert.match(result.commands, /ont port native-vlan 7 16 eth1 vlan 3301/);
  assert.match(result.commands, /ont port native-vlan 7 16 eth2 vlan 3301/);
  assert.doesNotMatch(result.commands, /ont port native-vlan 7 16 eth3 vlan 3301/);
  assert.equal(result.commands.match(/service-port vlan 1064/g)?.length, 1);
  assert.deepEqual(result.variables.ethPorts, ["eth1", "eth2"]);
});

test("Huawei internal network template generates VLAN 100 commands for eth1-eth4", () => {
  const template = configTemplates.find((item) => item.id === "huawei-link-booth");
  assert.equal(template?.vendor, "huawei");
  assert.equal(template?.name, "Huawei 内部网络");

  const result = buildConfigPlanFromTemplate({
    templateId: "huawei-link-booth",
    slot: 10,
    pon: 14,
    actualOntId: 127,
    serial: "ZTEG-030C0914"
  });

  assert.equal(result.blocked, false);
  assert.match(result.commands, /interface gpon 0\/10/);
  assert.match(result.commands, /ont add 14 sn-auth 5A544547030C0914 omci ont-lineprofile-id 300 ont-srvprofile-id 300/);
  assert.match(result.commands, /ont port native-vlan 14 127 eth1 vlan 100 priority 0/);
  assert.match(result.commands, /ont port native-vlan 14 127 eth2 vlan 100 priority 0/);
  assert.match(result.commands, /ont port native-vlan 14 127 eth3 vlan 100 priority 0/);
  assert.match(result.commands, /ont port native-vlan 14 127 eth4 vlan 100 priority 0/);
  assert.match(result.commands, /service-port vlan 100 gpon 0\/10\/14 ont 127 gemport 0 multi-service user-vlan 100 tag-transform translate/);
  assert.equal(result.variables.innerVlan, "100");
  assert.deepEqual(result.variables.ethPorts, ["eth1", "eth2", "eth3", "eth4"]);
});

test("Huawei internal network template supports partial selected eth ports", () => {
  const result = buildConfigPlanFromTemplate({
    templateId: "huawei-link-booth",
    slot: 10,
    pon: 14,
    actualOntId: 127,
    serial: "ZTEG-030C0914",
    ethPorts: ["eth2", "eth4"]
  });

  assert.equal(result.blocked, false);
  assert.doesNotMatch(result.commands, /ont port native-vlan 14 127 eth1 vlan 100 priority 0/);
  assert.match(result.commands, /ont port native-vlan 14 127 eth2 vlan 100 priority 0/);
  assert.doesNotMatch(result.commands, /ont port native-vlan 14 127 eth3 vlan 100 priority 0/);
  assert.match(result.commands, /ont port native-vlan 14 127 eth4 vlan 100 priority 0/);
  assert.equal(result.commands.match(/service-port vlan 100/g)?.length, 1);
  assert.deepEqual(result.variables.ethPorts, ["eth2", "eth4"]);
});

test("Huawei custom VLAN template renders internal-network style commands with selected VLAN", () => {
  const template = configTemplates.find((item) => item.id === "huawei-custom-vlan");
  assert.equal(template?.vendor, "huawei");
  assert.equal(template?.name, "Huawei 自定义 VLAN");
  assert.deepEqual(template?.portRules.defaults, ["eth1", "eth2", "eth3", "eth4"]);

  const result = buildConfigPlanFromTemplate({
    templateId: "huawei-custom-vlan",
    slot: 10,
    pon: 14,
    actualOntId: 127,
    serial: "ZTEG-030C0914",
    customVlan: "3609",
    ethPorts: ["eth1", "eth3"]
  });

  assert.equal(result.blocked, false);
  assert.equal(result.variables.innerVlan, "3609");
  assert.equal(result.variables.snAuthSerial, "5A544547030C0914");
  assert.deepEqual(result.variables.ethPorts, ["eth1", "eth3"]);
  assert.match(result.commands, /ont add 14 sn-auth 5A544547030C0914 omci ont-lineprofile-id 300 ont-srvprofile-id 300/);
  assert.match(result.commands, /ont port native-vlan 14 127 eth1 vlan 3609 priority 0/);
  assert.doesNotMatch(result.commands, /ont port native-vlan 14 127 eth2 vlan 3609 priority 0/);
  assert.match(result.commands, /ont port native-vlan 14 127 eth3 vlan 3609 priority 0/);
  assert.match(result.commands, /service-port vlan 3609 gpon 0\/10\/14 ont 127 gemport 0 multi-service user-vlan 3609 tag-transform translate/);
  assert.equal(result.commands.match(/service-port vlan 3609/g)?.length, 1);
});

test("Huawei custom VLAN template blocks when VLAN is missing or invalid", () => {
  const missingResult = buildConfigPlanFromTemplate({
    templateId: "huawei-custom-vlan",
    slot: 10,
    pon: 14,
    onuId: 127,
    serial: "ZTEG-030C0914"
  });

  assert.equal(missingResult.blocked, true);
  assert.deepEqual(missingResult.warnings, ["缺少自定义 VLAN，不能生成 Huawei 自定义 VLAN 配置方案。"]);
  assert.equal(missingResult.commands, "");

  const invalidResult = buildConfigPlanFromTemplate({
    templateId: "huawei-custom-vlan",
    slot: 10,
    pon: 14,
    onuId: 127,
    serial: "ZTEG-030C0914",
    customVlan: "4095"
  });

  assert.equal(invalidResult.blocked, true);
  assert.deepEqual(invalidResult.warnings, ["缺少自定义 VLAN，不能生成 Huawei 自定义 VLAN 配置方案。"]);
  assert.equal(invalidResult.commands, "");
});

test("Huawei templates block when selected eth ports are invalid", () => {
  const result = buildConfigPlanFromTemplate({
    templateId: "huawei-link-booth",
    slot: 10,
    pon: 14,
    onuId: 127,
    serial: "ZTEG-030C0914",
    ethPorts: ["eth_0/1", "eth5"]
  });

  assert.equal(result.blocked, true);
  assert.deepEqual(result.warnings, ["请至少选择一个有效的 Huawei eth 端口。"]);
  assert.equal(result.commands, "");

  const emptyResult = buildConfigPlanFromTemplate({
    templateId: "huawei-self-operated-internet",
    slot: 10,
    pon: 7,
    onuId: 16,
    serial: "ZTEG-030C0914",
    outerVlan: "1064",
    ethPorts: []
  });

  assert.equal(emptyResult.blocked, true);
  assert.deepEqual(emptyResult.warnings, ["请至少选择一个有效的 Huawei eth 端口。"]);
  assert.equal(emptyResult.commands, "");
});

test("Huawei sn-auth serial keeps raw hex and converts readable serials", () => {
  assert.equal(huaweiSnAuthSerial("5A544547030C0914"), "5A544547030C0914");
  assert.equal(huaweiSnAuthSerial("ZTEG-030C0914"), "5A544547030C0914");
  assert.equal(huaweiSnAuthSerial("ZTEG030C0914"), "5A544547030C0914");
  assert.equal(huaweiSnAuthSerial("<ONU_SN>"), "<ONU_SN>");
});
