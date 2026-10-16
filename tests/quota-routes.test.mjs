import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import XLSX from "xlsx";
import { buildPriceBookWorkbook, buildTemplateWorkbook } from "./fixtures/quota-fixtures.mjs";

process.env.OLT_MANAGER_DATA_DIR = await mkdtemp(join(tmpdir(), "olt-quota-routes-"));

const db = await import("../src/db.mjs");
const { createQuotaService } = await import("../src/quota/quota-service.mjs");
const { handleQuotaRoutes } = await import("../src/quota/quota-routes.mjs");
const { json, readBody, readBinaryBody } = await import("../src/http-protocol.mjs");

await db.initDb();
const quotaService = createQuotaService({ repo: db });

async function call(method, path, { body, file, fileName } = {}) {
  const payload = file ?? (body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body)));
  const req = {
    method,
    headers: fileName ? { "x-file-name": encodeURIComponent(fileName) } : {},
    async *[Symbol.asyncIterator]() {
      if (payload.length) yield payload;
    }
  };
  const res = {
    status: 0, headers: {}, body: null,
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(data) { this.body = data; }
  };
  const handled = await handleQuotaRoutes(req, res, new URL(`http://localhost${path}`), { quotaService, json, readBody, readBinaryBody });
  const isJson = String(res.headers?.["content-type"] || "").includes("json");
  return { handled, status: res.status, headers: res.headers, data: isJson ? JSON.parse(res.body) : res.body };
}

test("定额预算接口：导入资料、建预算、录入、改基础信息、生成下载", async () => {
  assert.equal((await call("GET", "/api/admin/other")).handled, false);
  let result = await call("GET", "/api/admin/quota/status");
  assert.equal(result.data.template, null);
  assert.equal((await call("POST", "/api/admin/quota/budgets", { body: { projectName: "x" } })).status, 409);

  result = await call("POST", "/api/admin/quota/template", { file: buildTemplateWorkbook(), fileName: "预算书模板.xlsx" });
  assert.equal(result.status, 200);
  assert.equal(result.data.itemCount, 26);
  assert.equal((await call("POST", "/api/admin/quota/template", { file: Buffer.alloc(0) })).status, 400);
  result = await call("POST", "/api/admin/quota/materials/preview", { file: buildPriceBookWorkbook() });
  assert.equal(result.data.materialCount, 6);
  assert.equal(result.data.parsed, undefined);
  result = await call("POST", "/api/admin/quota/materials", { file: buildPriceBookWorkbook(), fileName: "单价.xlsx" });
  assert.equal(result.data.materialCount, 6);
  result = await call("GET", "/api/admin/quota/status");
  assert.equal(result.data.template.fileName, "预算书模板.xlsx");
  assert.equal(result.data.presets.length, 1);
  assert.equal((await call("GET", `/api/admin/quota/items?q=${encodeURIComponent("架空 36芯")}`)).data.rows[0].code, "YGWX-3-10");
  assert.equal((await call("GET", `/api/admin/quota/materials?q=${encodeURIComponent("24芯 GYTS")}`)).data.rows[0].code, "14010162");

  result = await call("POST", "/api/admin/quota/budgets", { body: { projectName: "接口测试", location: "测试", preparer: "张三", reviewer: "" } });
  assert.equal(result.status, 400);
  assert.match(result.data.error, /审核/);
  result = await call("POST", "/api/admin/quota/budgets", { body: { projectName: "接口测试", location: "测试", preparer: "张三", reviewer: "李四" } });
  const budgetId = result.data.budget.id;

  result = await call("POST", `/api/admin/quota/budgets/${budgetId}/quota-lines`, { body: { code: "YGWX-3-22", quantity: 3 } });
  assert.equal(result.data.table2.length, 1);
  result = await call("POST", `/api/admin/quota/budgets/${budgetId}/material-lines`, { body: { code: "14010162", quantity: 800, remark: "架空用" } });
  assert.equal(result.data.totals.table4Amount, 1970.8);
  result = await call("PUT", `/api/admin/quota/budgets/${budgetId}/pipe`, { body: { trench: { 混凝土路面150mm以下: 20 } } });
  assert.equal(result.data.pipeLines.length, 7);
  const lineId = result.data.quotaLines[0].id;
  result = await call("PUT", `/api/admin/quota/budgets/${budgetId}/quota-lines/${lineId}`, { body: { quantity: 4 } });
  assert.equal(result.data.table2[0].quantity, 4);
  result = await call("PUT", `/api/admin/quota/budgets/${budgetId}`, { body: { info: { regionClass: "一类地区" } } });
  assert.equal(result.data.table2[0].unitPrice, 62.79);
  result = await call("POST", `/api/admin/quota/budgets/${budgetId}/preset`, { body: { name: "接口另存" } });
  assert.equal(result.data.preset.name, "接口另存");

  result = await call("GET", `/api/admin/quota/budgets/${budgetId}/export`);
  assert.equal(result.status, 200);
  assert.match(result.headers["content-disposition"], /filename\*=UTF-8''/);
  assert.match(decodeURIComponent(result.headers["content-disposition"]), /接口测试-预算书-\d{8}\.xlsx/);
  const workbook = XLSX.read(result.data);
  assert.equal(workbook.Sheets["项目基础信息表"].D4.v, "接口测试");

  const materialLineId = (await call("GET", `/api/admin/quota/budgets/${budgetId}`)).data.materialLines[0].id;
  result = await call("DELETE", `/api/admin/quota/budgets/${budgetId}/material-lines/${materialLineId}`);
  assert.equal(result.data.materialLines.length, 0);
  await quotaService.learnPhrase({ text: "做3个光缆头", kind: "quota", code: "YGWX-3-22" });
  result = await call("GET", "/api/admin/quota/learned");
  assert.equal(result.data.rows[0].phrase, "做光缆头");
  result = await call("DELETE", `/api/admin/quota/learned/${result.data.rows[0].id}`);
  assert.equal(result.data.rows.length, 0);

  assert.equal((await call("DELETE", `/api/admin/quota/budgets/${budgetId}`)).status, 200);
  assert.equal((await call("GET", `/api/admin/quota/budgets/${budgetId}`)).status, 404);
});
