import test from "node:test";
import assert from "node:assert/strict";
import {
  matchMaterials, matchQuotaItems, mergePipeInput, normalizeNumbers, parseItemUtterance, parsePipeUtterance, parseQuotaCommand, splitUtterance, unitFactor
} from "../src/quota/quota-parser.mjs";
import { quotaItemMap } from "./fixtures/quota-fixtures.mjs";

const items = [...quotaItemMap().values()];
const materials = [
  { code: "14010162", name: "光缆", spec: "GYTS-24B1#, 24芯", attr: "", unit: "米", maxPrice: 2.7837, common: true },
  { code: "14010025", name: "光缆", spec: "GYTA-24B1#, 24芯", attr: "", unit: "米", maxPrice: 2.8137, common: false },
  { code: "14050009", name: "光缆接头盒", spec: "24芯, 束状#", attr: "", unit: "个", maxPrice: 57.14, common: true },
  { code: "15039746", name: "光分路器", spec: "PLC#", attr: "1分8, 插片式", unit: "个", maxPrice: 18.94, common: true },
  { code: "15039665", name: "光分路器", spec: "PLC#", attr: "1分64, 插片式", unit: "个", maxPrice: 155.4, common: false },
  { code: "20030066", name: "钢绞线", spec: "1.4mmX3#", attr: "热镀锌", unit: "千克", maxPrice: 11.3, common: false }
];

test("中文数字与单位词", () => {
  assert.equal(normalizeNumbers("三个光缆端开缆"), "3个光缆端开缆");
  assert.equal(normalizeNumbers("二百五十米"), "250米");
  assert.equal(normalizeNumbers("100千克"), "100千克");
  assert.equal(normalizeNumbers("两千米"), "2千米");
  assert.equal(unitFactor("米", "千米"), 0.001);
  assert.equal(unitFactor("米", "百米"), 0.01);
  assert.equal(unitFactor("个", "端"), null);
});

test("定额模式指令", () => {
  assert.deepEqual(parseQuotaCommand("退出"), { command: "exit" });
  assert.deepEqual(parseQuotaCommand("生成预算书"), { command: "export" });
  assert.deepEqual(parseQuotaCommand("删除第3项"), { command: "delete", index: 3, section: null });
  assert.deepEqual(parseQuotaCommand("第2项改成5"), { command: "quantity", index: 2, section: null, quantity: 5, unit: "" });
  assert.deepEqual(parseQuotaCommand("地区类别改成三类"), { command: "setInfo", key: "regionClass", label: "地区类别", value: "三类地区" });
  assert.deepEqual(parseQuotaCommand("施工单位增值税税率改成9%"), { command: "setInfo", key: "contractorTaxRate", label: "施工单位增值税税率", value: 0.09 });
  assert.match(parseQuotaCommand("工程编号改成123").invalid, /规建部门/);
  assert.match(parseQuotaCommand("地区类别改成五类").invalid, /一类、二类/);
  assert.deepEqual(parseQuotaCommand("清空管道"), { command: "clearPipe" });
  assert.equal(parseQuotaCommand("3个光缆端开缆"), null);
  assert.deepEqual(parseQuotaCommand("删除材料2"), { command: "delete", index: 2, section: "material" });
  assert.deepEqual(parseQuotaCommand("人工2改成5"), { command: "quantity", index: 2, section: "quota", quantity: 5, unit: "" });
  assert.deepEqual(parseQuotaCommand("上一步"), { command: "undo" });
  assert.deepEqual(parseQuotaCommand("刚才那条不要了"), { command: "undo" });
  assert.deepEqual(parseQuotaCommand("材料是多少？"), { command: "list", section: "material" });
  assert.deepEqual(parseQuotaCommand("说一说人工和材料"), { command: "list", section: null });
  assert.equal(parseQuotaCommand("你怎么傻傻的"), null);
});

test("纠正数量：是 X 不是 Y、不是 Y 是 X、改成 X", () => {
  assert.deepEqual(parseQuotaCommand("是架空光缆敷设300米，不是4千米"), { command: "correct", quantity: 300, unit: "米", section: null, keywords: "架空光缆敷设" });
  assert.deepEqual(parseQuotaCommand("定额光缆是0.3千米，不是2千米"), { command: "correct", quantity: 0.3, unit: "千米", section: "quota", keywords: "光缆" });
  assert.deepEqual(parseQuotaCommand("300米，不是2千米"), { command: "correct", quantity: 300, unit: "米", section: null, keywords: "" });
  assert.deepEqual(parseQuotaCommand("不是4千米是300米"), { command: "correct", quantity: 300, unit: "米", section: null, keywords: "" });
  assert.deepEqual(parseQuotaCommand("改成300米"), { command: "correct", quantity: 300, unit: "米", section: null, keywords: "" });
});

test("一句话拆成几条：逗号、分号、人工 / 材料分段，没数字的小段并到前一段", () => {
  assert.deepEqual(splitUtterance("300米24芯架空光缆，4端开缆，48芯以下熔接24芯"), ["300米24芯架空光缆", "4端开缆", "48芯以下熔接24芯"]);
  assert.deepEqual(splitUtterance("材料，300米24芯光缆，2个48芯接续盒"), ["材料 300米24芯光缆", "材料 2个48芯接续盒"]);
  assert.deepEqual(splitUtterance("定额：4个光缆开缆，48芯熔接24芯，材料：48芯300米，光缆接续盒2个"),
    ["人工 4个光缆开缆", "人工 48芯熔接24芯", "材料 48芯300米", "材料 光缆接续盒2个"]);
  assert.deepEqual(splitUtterance("24芯光缆800米，架空用"), ["24芯光缆800米，架空用"]);
  assert.deepEqual(splitUtterance("3个光缆端开缆"), ["3个光缆端开缆"]);
});

test("管道说法：开挖、顶管、做井、直埋子管", () => {
  assert.deepEqual(parsePipeUtterance("开挖混凝土路面250mm以下30米").input, { trench: { 混凝土路面250mm以下: 30 } });
  assert.deepEqual(parsePipeUtterance("人工开挖混凝土路面 250 以下 30 米").input, { trench: { 混凝土路面250mm以下: 30 } });
  const assumed = parsePipeUtterance("开挖混凝土路面150米");
  assert.deepEqual(assumed.input, { trench: { 混凝土路面150mm以下: 150 } });
  assert.ok(assumed.notes.some((note) => note.includes("厚度")));
  assert.deepEqual(parsePipeUtterance("顶管3孔200米").input, { jacking: { 3: 200 } });
  assert.deepEqual(parsePipeUtterance("单页井2个 混凝土路面250以下").input, { wells: [{ type: "单页井", road: "混凝土路面250mm以下", count: 2 }] });
  assert.deepEqual(parsePipeUtterance("直埋子管100米").input, { subduct: { length: 100, road: "普通土" } });
  assert.match(parsePipeUtterance("顶管两孔").error, /长度/);
  assert.equal(parsePipeUtterance("3个光缆端开缆"), null);
  const merged = mergePipeInput({ trench: { 混凝土路面250mm以下: 30 }, wells: [{ type: "单页井", road: "普通土", count: 1 }] },
    { trench: { 混凝土路面250mm以下: 10 }, wells: [{ type: "单页井", road: "普通土", count: 2 }], jacking: { 2: 15 } });
  assert.deepEqual(merged.trench, { 混凝土路面250mm以下: 40 });
  assert.deepEqual(merged.wells, [{ type: "单页井", road: "普通土", count: 3 }]);
  assert.deepEqual(merged.jacking, { 2: 15 });
});

test("定额说法：数量、芯数档位、同义词、利旧", () => {
  let parsed = parseItemUtterance("3个光缆开端");
  assert.equal(parsed.mode, "quota");
  assert.equal(parsed.quantity, 3);
  assert.equal(matchQuotaItems(items, parsed)[0].item.code, "YGWX-3-22");

  parsed = parseItemUtterance("架空敷设24芯光缆200米利旧");
  assert.equal(parsed.quantity, 200);
  assert.equal(parsed.unit, "米");
  assert.equal(parsed.cores, 24);
  assert.equal(parsed.reuse, true);
  assert.equal(matchQuotaItems(items, parsed)[0].item.code, "YGWX-3-10");

  parsed = parseItemUtterance("24芯以下熔接24芯");
  assert.equal(parsed.quantity, 24);
  assert.equal(parsed.unit, "芯");
  assert.equal(matchQuotaItems(items, parsed)[0].item.code, "YGWX-3-24");

  // 现场说法：“4个光缆开缆”“300米24芯架空光缆”（没说敷设也是人工）
  parsed = parseItemUtterance("4个光缆开缆");
  assert.equal(matchQuotaItems(items, parsed)[0].item.code, "YGWX-3-22");
  parsed = parseItemUtterance("300米24芯架空光缆");
  assert.equal(parsed.mode, "quota");
  assert.equal(matchQuotaItems(items, parsed)[0].item.code, "YGWX-3-10");
});

test("材料说法：芯数、分光比、常用优先、备注、重量单位", () => {
  let parsed = parseItemUtterance("24芯光缆800米 架空用");
  assert.equal(parsed.mode, "material");
  assert.equal(parsed.quantity, 800);
  assert.equal(parsed.remark, "架空用");
  assert.deepEqual(matchMaterials(materials, parsed).map((entry) => entry.material.code), ["14010162", "14010025", "14050009"]);

  parsed = parseItemUtterance("1分8光分路器6个");
  assert.equal(parsed.quantity, 6);
  assert.equal(parsed.ratio, 8);
  assert.deepEqual(matchMaterials(materials, parsed).map((entry) => entry.material.code), ["15039746"]);

  parsed = parseItemUtterance("材料 钢绞线100千克");
  assert.equal(parsed.mode, "material");
  assert.equal(parsed.quantity, 100);
  assert.equal(parsed.unit, "千克");
  assert.equal(matchMaterials(materials, parsed)[0].material.code, "20030066");

  // 接续盒就是接头盒；“材料 48芯300米”只说芯数和长度就是光缆
  parsed = parseItemUtterance("材料 2个24芯接续盒");
  assert.equal(matchMaterials(materials, parsed)[0].material.code, "14050009");
  parsed = parseItemUtterance("材料 24芯300米");
  assert.equal(matchMaterials(materials, parsed)[0].material.code, "14010162");
});
