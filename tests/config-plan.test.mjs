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
  assert.match(plan.commands, /onu 38 type GPON-SFU sn YHDZE2EACAE3/);
  assert.match(plan.commands, /service-port 1 vport 1 user-vlan 3301 vlan 3301 svlan 1068/);
  assert.match(plan.commands, /Vlan port eth_0\/1 mode hybrid def-vlan 3301/);
  assert.match(plan.commands, /Vlan port eth_0\/2 mode hybrid def-vlan 3301/);
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
  assert.match(plan.commands, /service-port 1 vport 1 user-vlan 3609 vlan 3609 svlan 1065/);
  assert.match(plan.commands, /service-port 2 vport 1 user-vlan 3176 vlan 3176/);
  assert.match(plan.commands, /service-port 3 vport 1 user-vlan 86 vlan 86/);
  assert.match(plan.commands, /service-port 4 vport 1 user-vlan 100 vlan 100/);
  assert.match(plan.commands, /service 1 gemport 1 vlan 3609,86,3176,100/);
});

test("Huawei self-operated internet template generates documented preview commands", () => {
  const template = configTemplates.find((item) => item.id === "huawei-self-operated-internet");
  assert.equal(template?.vendor, "huawei");

  const result = buildConfigPlanFromTemplate({
    templateId: "huawei-self-operated-internet",
    slot: 10,
    pon: 7,
    onuId: 16,
    serial: "ZTEG-030C0914",
    outerVlan: "1064"
  });

  assert.equal(result.blocked, false);
  assert.match(result.commands, /interface gpon 0\/10/);
  assert.match(result.commands, /ont add 7 16 sn-auth 5A544547030C0914 omci ont-lineprofile-id 300 ont-srvprofile-id 300/);
  assert.match(result.commands, /ont port native-vlan 7 16 eth 1 vlan 3301/);
  assert.match(result.commands, /service-port vlan 1064 gpon 0\/10\/7 ont 16 gemport 0 multi-service user-vlan 3301 tag-transform translate-and-add inner-vlan 3301 inner-priority 0/);
  assert.equal(result.variables.snAuthSerial, "5A544547030C0914");
});

test("Huawei sn-auth serial keeps raw hex and converts readable serials", () => {
  assert.equal(huaweiSnAuthSerial("5A544547030C0914"), "5A544547030C0914");
  assert.equal(huaweiSnAuthSerial("ZTEG-030C0914"), "5A544547030C0914");
  assert.equal(huaweiSnAuthSerial("ZTEG030C0914"), "5A544547030C0914");
  assert.equal(huaweiSnAuthSerial("<ONU_SN>"), "<ONU_SN>");
});
