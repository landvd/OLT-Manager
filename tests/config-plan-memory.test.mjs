import test from "node:test";
import assert from "node:assert/strict";
import { configPlanSummary, groupConfigTemplates, initialTemplateId, rememberTemplateId, rememberedTemplateId } from "../src/config-plan-memory.mjs";

function memoryStorage() {
  const map = new Map();
  return { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)) };
}

test("生成方案弹窗记住每台 OLT 上次用的模板，模板不在可用列表时退回第一个", () => {
  const storage = memoryStorage();
  const templates = [{ id: "a" }, { id: "b" }];
  assert.equal(initialTemplateId(templates, rememberedTemplateId("olt-1", storage)), "a");
  rememberTemplateId("olt-1", "b", storage);
  assert.equal(rememberedTemplateId("olt-1", storage), "b");
  assert.equal(rememberedTemplateId("olt-2", storage), "");
  assert.equal(initialTemplateId(templates, "b"), "b");
  assert.equal(initialTemplateId(templates, "gone"), "a");
  assert.equal(rememberedTemplateId("olt-1", { getItem: () => { throw new Error("blocked"); } }), "");
});

test("模板下拉分组：我的方案、专线项目、内置方案，空组不显示", () => {
  const groups = groupConfigTemplates([
    { id: "builtin", isBuiltin: true },
    { id: "mine" },
    { id: "project", projectId: "p1" }
  ]);
  assert.deepEqual(groups.map((group) => [group.label, group.options.map((item) => item.id)]), [["我的方案", ["mine"]], ["专线项目", ["project"]], ["内置方案", ["builtin"]]]);
  assert.deepEqual(groupConfigTemplates([{ id: "builtin", isBuiltin: true }]).map((group) => group.label), ["内置方案"]);
});

test("变量来源摘要：ONU ID、VLAN、网口各取一项，按常核对的顺序", () => {
  const summary = configPlanSummary({ actualOntId: 5, onuId: 5, ledgerOuterVlan: 2048, outerVlan: 2048, innerVlan: 100, ethPorts: ["eth_0/1", "eth_0/2"], address: "x" });
  assert.equal(summary, "ONU ID 5 · 外层 VLAN 2048 · 内层 VLAN 100 · 网口 eth_0/1, eth_0/2");
  assert.equal(configPlanSummary({}), "");
});
