import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.OLT_MANAGER_DATA_DIR = await mkdtemp(join(tmpdir(), "olt-config-template-inputs-"));

import {
  BUILTIN_CONFIG_TEMPLATES,
  checkConfigTemplate,
  renderConfigPlan,
  resolveTemplateInputs
} from "../src/config-plan-engine.mjs";
const { getConfigTemplate, initDb, listConfigTemplates, rawExec, saveConfigTemplate, seedConfigTemplates, sqlQuote } = await import("../src/db.mjs");

const hguTemplate = {
  id: "custom-hgu",
  name: "HGU 双网口",
  vendor: "zte",
  deviceProfiles: ["zte-c300"],
  defaultParams: { innerVlan: "200", defaultPort: "eth_0/1" },
  inputParams: [
    { name: "onuType", label: "ONU 型号", type: "select", options: ["HGU", "SFU"], defaultValue: "HGU", required: true },
    { name: "iptvVlan", label: "IPTV VLAN", type: "vlan", defaultValue: "", required: true }
  ],
  commandTemplate: `interface gpon-olt_{{chassis}}/{{board}}/{{pon}}
onu {{onuId}} type {{onuType}} sn {{serial}}
exit
service-port 1 vport 1 user-vlan {{innerVlan}} vlan {{innerVlan}} svlan {{outerVlan}}
service-port 2 vport 2 user-vlan {{iptvVlan}} vlan {{iptvVlan}}
show running-config interface gpon-onu_{{chassis}}/{{board}}/{{pon}}:{{onuId}}`
};

const sampleInput = { chassis: "1", board: "3", pon: "8", onuId: "12", serial: "ZTEG99887766", outerVlan: "1050", ethPort: "eth_0/1" };

test("内置方案全部能通过模板检查", () => {
  for (const template of BUILTIN_CONFIG_TEMPLATES) {
    const result = checkConfigTemplate(template);
    assert.deepEqual(result.errors, [], template.id);
  }
});

test("模板检查：拼错的变量给出建议，未闭合的 {{ 和参数声明问题会报错", () => {
  const typo = checkConfigTemplate({ vendor: "zte", commandTemplate: "onu {{onuId}} sn {{serial}}\nsvlan {{outerVLan}}\nshow run" });
  assert.equal(typo.ok, false);
  assert.equal(typo.errors[0].line, 2);
  assert.equal(typo.errors[0].suggestion, "outerVlan");

  const unclosed = checkConfigTemplate({ vendor: "zte", commandTemplate: "onu {{onuId}} sn {{serial}\nshow run" });
  assert.ok(unclosed.errors.some((item) => item.line === 1 && /不成对/.test(item.message)));

  const params = checkConfigTemplate({
    vendor: "zte",
    commandTemplate: "onu {{onuId}} sn {{serial}}",
    inputParams: [
      { name: "outerVlan", type: "text" },
      { name: "1bad", type: "text" },
      { name: "mode", type: "select", options: [] },
      { name: "extra", type: "vlan", defaultValue: "5000" }
    ]
  });
  const messages = params.errors.map((item) => item.message).join("\n");
  assert.match(messages, /outerVlan 是系统自动取值的变量/);
  assert.match(messages, /只能用英文字母开头/);
  assert.match(messages, /没有填写选项/);
  assert.match(messages, /5000 不是 1–4094/);
  assert.ok(params.warnings.some((item) => /mode 已声明，但模板里没有用到/.test(item.message)));
});

test("模板检查：声明的参数可在模板中引用，ZTE 缺 show 核查命令给出提示", () => {
  const result = checkConfigTemplate(hguTemplate);
  assert.deepEqual(result.errors, []);
  const noShow = checkConfigTemplate({ ...hguTemplate, commandTemplate: hguTemplate.commandTemplate.replace(/\nshow.*$/, "") });
  assert.ok(noShow.hints.some((item) => /show 核查命令/.test(item.message)));
});

test("生成参数：默认值、必填、VLAN 范围与下拉选项校验", () => {
  assert.deepEqual(resolveTemplateInputs(hguTemplate, { iptvVlan: "45" }), { values: { onuType: "HGU", iptvVlan: "45" }, problems: [] });
  assert.deepEqual(resolveTemplateInputs(hguTemplate, {}).problems, ["请填写“IPTV VLAN”。"]);
  assert.deepEqual(resolveTemplateInputs(hguTemplate, { iptvVlan: "0" }).problems, ["“IPTV VLAN”必须是 1–4094 之间的 VLAN。"]);
  assert.deepEqual(resolveTemplateInputs(hguTemplate, { iptvVlan: "45", onuType: "MDU" }).problems, ["“ONU 型号”只能从 HGU、SFU 中选择。"]);
});

test("renderConfigPlan：生成参数进入命令，模板默认内层 VLAN 不会被空输入覆盖", () => {
  const plan = renderConfigPlan(hguTemplate, { ...sampleInput, innerVlan: undefined, customVlan: undefined, templateInputs: { iptvVlan: "45" } });
  assert.equal(plan.blocked, false);
  assert.match(plan.commands, /onu 12 type HGU sn ZTEG99887766/);
  assert.match(plan.commands, /user-vlan 200 vlan 200 svlan 1050/);
  assert.match(plan.commands, /user-vlan 45 vlan 45/);
});

test("renderConfigPlan：缺必填参数或模板含不认识的变量时阻止生成", () => {
  const missing = renderConfigPlan(hguTemplate, { ...sampleInput, templateInputs: {} });
  assert.equal(missing.blocked, true);
  assert.equal(missing.commands, "");
  assert.ok(missing.warnings.includes("请填写“IPTV VLAN”。"));

  const unknown = renderConfigPlan({ ...hguTemplate, inputParams: [], commandTemplate: "onu {{onuId}} sn {{serial}} {{mystery}}" }, sampleInput);
  assert.equal(unknown.blocked, true);
  assert.ok(unknown.warnings.some((item) => item.includes("{{mystery}}")));
});

test("自定义方案保存生成参数；不认识的变量拒绝保存", async () => {
  await initDb();
  const saved = await saveConfigTemplate({ ...hguTemplate, id: "" });
  assert.equal(saved.inputParams.length, 2);
  assert.deepEqual(saved.inputParams[0], { name: "onuType", label: "ONU 型号", type: "select", options: ["HGU", "SFU"], defaultValue: "HGU", required: true });
  const fetched = await getConfigTemplate(saved.id);
  assert.equal(fetched.inputParams[1].type, "vlan");

  await assert.rejects(
    () => saveConfigTemplate({ ...hguTemplate, id: "", commandTemplate: "onu {{onuId}} sn {{serial}} svlan {{outerVLan}}" }),
    /是否想写 \{\{outerVlan\}\}/
  );
});

test("启动时内置方案同步为出厂版本，本地改过的内容另存为自定义方案", async () => {
  await initDb();
  const builtin = BUILTIN_CONFIG_TEMPLATES[0];
  await rawExec(`UPDATE config_templates
    SET command_template = 'local edited command', updated_at = '2099-01-01 00:00:00'
    WHERE id = ${sqlQuote(builtin.id)};`);
  const second = BUILTIN_CONFIG_TEMPLATES[1];
  // 未被本机改过、只是出厂版本更新的内置方案：直接同步，不产生备份。
  await rawExec(`UPDATE config_templates SET remark = 'old remark' WHERE id = ${sqlQuote(second.id)};`);

  await seedConfigTemplates();

  const restored = await getConfigTemplate(builtin.id);
  assert.equal(restored.commandTemplate, builtin.commandTemplate);
  assert.equal(restored.isBuiltin, true);
  const backup = await getConfigTemplate(`custom-backup-${builtin.id}`);
  assert.equal(backup.commandTemplate, "local edited command");
  assert.equal(backup.isBuiltin, false);
  assert.match(backup.name, /本地修改备份/);

  assert.equal((await getConfigTemplate(second.id)).remark, second.remark);
  assert.equal(await getConfigTemplate(`custom-backup-${second.id}`), null);

  // 再次启动不会重复备份。
  await seedConfigTemplates();
  const all = await listConfigTemplates();
  assert.equal(all.filter((tpl) => tpl.id.startsWith("custom-backup-")).length, 1);
});
