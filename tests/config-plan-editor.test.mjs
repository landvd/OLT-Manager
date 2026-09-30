import test from "node:test";
import assert from "node:assert/strict";
import {
  BUILTIN_CONFIG_TEMPLATES,
  SUPPORTED_TEMPLATE_VARIABLES,
  buildRenderVariables,
  renderConfigPlan,
  renderTemplateString
} from "../src/config-plan-engine.mjs";
import {
  deleteConfigTemplate,
  getConfigTemplate,
  initDb,
  listConfigTemplates,
  resetBuiltinConfigTemplate,
  saveConfigTemplate
} from "../src/db.mjs";

test("SUPPORTED_TEMPLATE_VARIABLES 包含坐标、设备、SN、内外层VLAN及物理网口核心变量", () => {
  const names = new Set(SUPPORTED_TEMPLATE_VARIABLES.map((v) => v.name));
  assert.ok(names.has("chassis"));
  assert.ok(names.has("board"));
  assert.ok(names.has("pon"));
  assert.ok(names.has("onuId"));
  assert.ok(names.has("actualOntId"));
  assert.ok(names.has("serial"));
  assert.ok(names.has("snAuthSerial"));
  assert.ok(names.has("address"));
  assert.ok(names.has("outerVlan"));
  assert.ok(names.has("innerVlan"));
  assert.ok(names.has("ethPort"));
});

test("BUILTIN_CONFIG_TEMPLATES 覆盖 ZTE C300、ZTE C600 与 Huawei MA5800 且不包含未经验证的酒店四口方案", () => {
  const profiles = BUILTIN_CONFIG_TEMPLATES.flatMap((t) => t.deviceProfiles);
  assert.ok(profiles.includes("zte-c300"), "需支持 ZTE C300");
  assert.ok(profiles.includes("zte-c600"), "需支持 ZTE C600");
  assert.ok(profiles.includes("huawei-ma5800"), "需支持 Huawei MA5800");

  const hotelTemplates = BUILTIN_CONFIG_TEMPLATES.filter((t) => t.id.includes("hotel-quad-play"));
  assert.equal(hotelTemplates.length, 0, "未经验证的酒店四口复合方案必须被删除");
});

test("renderTemplateString 正确替换占位符并宽容保留未知变量", () => {
  const template = "interface gpon-olt_{{chassis}}/{{board}}/{{pon}}\nonu {{onuId}} sn {{serial}}\nservice vlan {{innerVlan}} {{unknown_var}}";
  const vars = { chassis: "1", board: "2", pon: "3", onuId: "4", serial: "ZTEG12345678", innerVlan: "3301" };
  const rendered = renderTemplateString(template, vars);

  assert.ok(rendered.includes("interface gpon-olt_1/2/3"));
  assert.ok(rendered.includes("onu 4 sn ZTEG12345678"));
  assert.ok(rendered.includes("service vlan 3301 {{unknown_var}}"));
});

test("renderConfigPlan - ZTE C300 单口自营宽带命令生成", () => {
  const tpl = BUILTIN_CONFIG_TEMPLATES.find((t) => t.id === "zte-self-operated-internet");
  const result = renderConfigPlan(tpl, {
    chassis: "1",
    board: "3",
    pon: "8",
    onuId: "12",
    serial: "ZTEG99887766",
    outerVlan: "1050",
    innerVlan: "3301",
    ethPort: "eth_0/1"
  });

  assert.equal(result.blocked, false);
  assert.ok(result.commands.includes("interface gpon-olt_1/3/8"));
  assert.ok(result.commands.includes("onu 12 type GPON-SFU sn ZTEG99887766"));
  assert.ok(result.commands.includes("service-port 1 vport 1 user-vlan 3301 vlan 3301 svlan 1050"));
  assert.ok(result.commands.includes("vlan port eth_0/1 mode hybrid def-vlan 3301"));
  assert.ok(result.commands.includes("show running-config interface gpon-onu_1/3/8:12"));
});

test("renderConfigPlan - ZTE C600 TITAN 架构命令生成", () => {
  const tpl = BUILTIN_CONFIG_TEMPLATES.find((t) => t.id === "zte-c600-self-operated-internet");
  const result = renderConfigPlan(tpl, {
    chassis: "1",
    board: "1",
    pon: "2",
    onuId: "5",
    serial: "ZTEGC6001234",
    outerVlan: "1200",
    ethPort: "veip_1"
  });

  assert.equal(result.blocked, false);
  assert.ok(result.commands.includes("interface gpon_olt-1/1/2"));
  assert.ok(result.commands.includes("interface gpon_onu-1/1/2:5"));
  assert.ok(result.commands.includes("vport-mode manual"));
  assert.ok(result.commands.includes("interface vport-1/1/2.5:1"));
  assert.ok(result.commands.includes("service-port 1 user-vlan untagged user-etype PPPOE vlan 3301 svlan 1200"));
});

test("renderConfigPlan - Huawei MA5800 自动转换16进制SN并生成QinQ命令", () => {
  const tpl = BUILTIN_CONFIG_TEMPLATES.find((t) => t.id === "huawei-self-operated-internet");
  const result = renderConfigPlan(tpl, {
    vendor: "huawei",
    board: "2",
    pon: "6",
    onuId: "3",
    actualOntId: "3",
    serial: "ZTEG030C0914",
    outerVlan: "1500",
    ethPort: "eth1"
  });

  assert.equal(result.blocked, false);
  // ZTEG 转十六进制 5A544547 + 030C0914 = 5A544547030C0914
  assert.ok(result.commands.includes("ont add 6 sn-auth 5A544547030C0914"));
  assert.ok(result.commands.includes("ont port native-vlan 6 3 eth1 vlan 3301"));
  assert.ok(result.commands.includes("service-port vlan 1500 gpon 0/2/6 ont 3 gemport 0 multi-service user-vlan 3301 tag-transform translate-and-add inner-vlan 3301 inner-priority 0"));
});

test("renderConfigPlan - 四网口均配置内网VLAN命令生成 (ZTE & Huawei)", () => {
  // 1. 中兴 C300 四网口内网模板
  const zteQuadIntranetTpl = {
    id: "custom-zte-quad-intranet",
    name: "ZTE 四口内网方案",
    vendor: "zte",
    deviceProfiles: ["zte-c300"],
    commandTemplate: `interface gpon-olt_{{chassis}}/{{board}}/{{pon}}
onu {{onuId}} type GPON-SFU sn {{serial}}
exit
pon-onu-mng gpon-onu_{{chassis}}/{{board}}/{{pon}}:{{onuId}}
service intranet gemport 1 vlan {{innerVlan}}
vlan port eth_0/1 mode hybrid def-vlan {{innerVlan}}
vlan port eth_0/2 mode hybrid def-vlan {{innerVlan}}
vlan port eth_0/3 mode hybrid def-vlan {{innerVlan}}
vlan port eth_0/4 mode hybrid def-vlan {{innerVlan}}
exit`
  };

  const zteResult = renderConfigPlan(zteQuadIntranetTpl, {
    chassis: "1",
    board: "2",
    pon: "3",
    onuId: "4",
    serial: "ZTEG12345678",
    innerVlan: "100"
  });

  assert.equal(zteResult.blocked, false);
  assert.ok(zteResult.commands.includes("vlan port eth_0/1 mode hybrid def-vlan 100"));
  assert.ok(zteResult.commands.includes("vlan port eth_0/2 mode hybrid def-vlan 100"));
  assert.ok(zteResult.commands.includes("vlan port eth_0/3 mode hybrid def-vlan 100"));
  assert.ok(zteResult.commands.includes("vlan port eth_0/4 mode hybrid def-vlan 100"));

  // 2. 华为 MA5800 四网口内网模板
  const huaweiQuadIntranetTpl = {
    id: "custom-huawei-quad-intranet",
    name: "Huawei 四口内网方案",
    vendor: "huawei",
    deviceProfiles: ["huawei-ma5800"],
    commandTemplate: `interface gpon {{chassis}}/{{board}}
ont add {{pon}} sn-auth {{snAuthSerial}} omci ont-lineprofile-id 300 ont-srvprofile-id 300
ont port native-vlan {{pon}} {{actualOntId}} eth 1 vlan {{innerVlan}} priority 0
ont port native-vlan {{pon}} {{actualOntId}} eth 2 vlan {{innerVlan}} priority 0
ont port native-vlan {{pon}} {{actualOntId}} eth 3 vlan {{innerVlan}} priority 0
ont port native-vlan {{pon}} {{actualOntId}} eth 4 vlan {{innerVlan}} priority 0
quit`
  };

  const huaweiResult = renderConfigPlan(huaweiQuadIntranetTpl, {
    board: "1",
    pon: "5",
    actualOntId: "2",
    serial: "4857544312345678",
    innerVlan: "200"
  });

  assert.equal(huaweiResult.blocked, false);
  assert.ok(huaweiResult.commands.includes("ont port native-vlan 5 2 eth 1 vlan 200 priority 0"));
  assert.ok(huaweiResult.commands.includes("ont port native-vlan 5 2 eth 2 vlan 200 priority 0"));
  assert.ok(huaweiResult.commands.includes("ont port native-vlan 5 2 eth 3 vlan 200 priority 0"));
  assert.ok(huaweiResult.commands.includes("ont port native-vlan 5 2 eth 4 vlan 200 priority 0"));
});

test("renderConfigPlan - 方案仅写单条规则，选择多端口时智能逐行展开 (ZTE & Huawei)", () => {
  // 1. 中兴：模板中只写一行 vlan port {{ethPort}}，多选端口时只对此行逐行展开，公用部分保持单次
  const zteSingleRuleTpl = {
    id: "zte-smart-expand-test",
    name: "ZTE 智能展开测试方案",
    vendor: "zte",
    deviceProfiles: ["zte-c300"],
    commandTemplate: `configure terminal
interface gpon-olt_{{chassis}}/{{board}}/{{pon}}
onu {{onuId}} type GPON-SFU sn {{serial}}
exit
pon-onu-mng gpon-onu_{{chassis}}/{{board}}/{{pon}}:{{onuId}}
service intranet gemport 1 vlan {{innerVlan}}
vlan port {{ethPort}} mode hybrid def-vlan {{innerVlan}}
exit`
  };

  // 测试 A: 勾选 4 个口全开
  const zteResult4 = renderConfigPlan(zteSingleRuleTpl, {
    chassis: "1",
    board: "2",
    pon: "3",
    onuId: "8",
    serial: "ZTEG12345678",
    innerVlan: "100",
    ethPorts: ["eth_0/1", "eth_0/2", "eth_0/3", "eth_0/4"]
  });

  assert.equal(zteResult4.blocked, false);
  // 公用命令保持单次下发
  const zteServiceIntranetMatches = zteResult4.commands.match(/service intranet gemport 1 vlan 100/g) || [];
  assert.equal(zteServiceIntranetMatches.length, 1, "公用配置行只能出现一次");
  // 端口规则智能展开为 4 行
  assert.ok(zteResult4.commands.includes("vlan port eth_0/1 mode hybrid def-vlan 100"));
  assert.ok(zteResult4.commands.includes("vlan port eth_0/2 mode hybrid def-vlan 100"));
  assert.ok(zteResult4.commands.includes("vlan port eth_0/3 mode hybrid def-vlan 100"));
  assert.ok(zteResult4.commands.includes("vlan port eth_0/4 mode hybrid def-vlan 100"));

  // 测试 B: 只勾选前 2 个口
  const zteResult2 = renderConfigPlan(zteSingleRuleTpl, {
    chassis: "1",
    board: "2",
    pon: "3",
    onuId: "8",
    serial: "ZTEG12345678",
    innerVlan: "100",
    ethPorts: ["eth_0/1", "eth_0/2"]
  });
  assert.ok(zteResult2.commands.includes("vlan port eth_0/1 mode hybrid def-vlan 100"));
  assert.ok(zteResult2.commands.includes("vlan port eth_0/2 mode hybrid def-vlan 100"));
  assert.equal(zteResult2.commands.includes("eth_0/3"), false, "未选端口不得生成命令");
  assert.equal(zteResult2.commands.includes("eth_0/4"), false, "未选端口不得生成命令");

  // 测试 C: 单口模式
  const zteResult1 = renderConfigPlan(zteSingleRuleTpl, {
    chassis: "1",
    board: "2",
    pon: "3",
    onuId: "8",
    serial: "ZTEG12345678",
    innerVlan: "100",
    ethPorts: ["eth_0/1"]
  });
  const ztePortMatches1 = zteResult1.commands.match(/vlan port eth_0/g) || [];
  assert.equal(ztePortMatches1.length, 1, "单选端口只生成一行命令");

  // 2. 华为：模板写单条 ont port native-vlan {{pon}} {{actualOntId}} {{ethPort}}，多选端口时智能逐行展开
  const huaweiSingleRuleTpl = {
    id: "huawei-smart-expand-test",
    name: "Huawei 智能展开测试方案",
    vendor: "huawei",
    deviceProfiles: ["huawei-ma5800"],
    commandTemplate: `interface gpon {{chassis}}/{{board}}
ont add {{pon}} sn-auth {{snAuthSerial}} omci ont-lineprofile-id 300 ont-srvprofile-id 300
ont port native-vlan {{pon}} {{actualOntId}} {{ethPort}} vlan {{innerVlan}} priority 0
quit`
  };

  const huaweiResult4 = renderConfigPlan(huaweiSingleRuleTpl, {
    board: "1",
    pon: "5",
    actualOntId: "3",
    serial: "4857544399887766",
    innerVlan: "300",
    ethPorts: ["eth 1", "eth 2", "eth 3", "eth 4"]
  });

  assert.equal(huaweiResult4.blocked, false);
  const ontAddMatches = huaweiResult4.commands.match(/ont add 5 sn-auth/g) || [];
  assert.equal(ontAddMatches.length, 1, "注册命令保持单次下发");
  assert.ok(huaweiResult4.commands.includes("ont port native-vlan 5 3 eth 1 vlan 300 priority 0"));
  assert.ok(huaweiResult4.commands.includes("ont port native-vlan 5 3 eth 2 vlan 300 priority 0"));
  assert.ok(huaweiResult4.commands.includes("ont port native-vlan 5 3 eth 3 vlan 300 priority 0"));
  assert.ok(huaweiResult4.commands.includes("ont port native-vlan 5 3 eth 4 vlan 300 priority 0"));
});

test("数据库方案模板 CRUD 与内置方案重置", async () => {
  await initDb();

  const allTemplates = await listConfigTemplates();
  assert.ok(allTemplates.length >= BUILTIN_CONFIG_TEMPLATES.length, "必须初始化并返回所有内置模板");

  // 1. 创建自定义模板
  const custom = await saveConfigTemplate({
    name: "测试自定义小区方案",
    vendor: "zte",
    deviceProfiles: ["zte-c300"],
    businessType: "community",
    portMode: "single",
    commandTemplate: "interface gpon-olt_{{chassis}}/{{board}}/{{pon}}\nonu {{onuId}} custom-community-plan",
    remark: "专供自动化测试"
  });
  assert.ok(custom.id);
  assert.equal(custom.name, "测试自定义小区方案");
  assert.equal(custom.isBuiltin, false);

  // 2. 查询并验证
  const fetched = await getConfigTemplate(custom.id);
  assert.equal(fetched.name, "测试自定义小区方案");

  // 3. 修改自定义模板
  const updated = await saveConfigTemplate({
    id: custom.id,
    name: "测试自定义小区方案(改)",
    vendor: "zte",
    deviceProfiles: ["zte-c300"],
    businessType: "community",
    commandTemplate: "interface gpon-olt_{{chassis}}/{{board}}/{{pon}}\nonu {{onuId}} updated-test"
  });
  assert.equal(updated.name, "测试自定义小区方案(改)");

  // 4. 删除自定义模板
  const delResult = await deleteConfigTemplate(custom.id);
  assert.equal(delResult.ok, true);
  const deleted = await getConfigTemplate(custom.id);
  assert.equal(deleted, null);

  // 5. 验证内置模板不能删除
  const builtinTpl = allTemplates.find((t) => t.isBuiltin);
  assert.ok(builtinTpl);
  await assert.rejects(
    async () => await deleteConfigTemplate(builtinTpl.id),
    /系统内置方案不能删除/
  );

  // 6. 修改内置模板并恢复出厂默认
  await saveConfigTemplate({
    id: builtinTpl.id,
    name: "临时修改内置名称",
    vendor: builtinTpl.vendor,
    deviceProfiles: builtinTpl.deviceProfiles,
    commandTemplate: "some temporary command"
  });
  const modifiedBuiltin = await getConfigTemplate(builtinTpl.id);
  assert.equal(modifiedBuiltin.name, "临时修改内置名称");

  const resetResult = await resetBuiltinConfigTemplate(builtinTpl.id);
  assert.equal(resetResult.name, builtinTpl.name);
  assert.equal(resetResult.commandTemplate, builtinTpl.commandTemplate);
});
