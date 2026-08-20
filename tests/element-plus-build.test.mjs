import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import config, { manualChunks } from "../vite.config.mjs";

const mainSource = await readFile(new URL("../src/main.js", import.meta.url), "utf8");

const expectedGlobalComponents = [
  "alert",
  "aside",
  "autocomplete",
  "button",
  "card",
  "checkbox",
  "checkbox-button",
  "checkbox-group",
  "col",
  "container",
  "date-picker",
  "descriptions",
  "descriptions-item",
  "dialog",
  "empty",
  "form",
  "form-item",
  "header",
  "input",
  "input-number",
  "main",
  "menu",
  "menu-item",
  "option",
  "pagination",
  "progress",
  "row",
  "select",
  "switch",
  "table",
  "table-column",
  "tag"
];

test("Element Plus remains globally registered for the existing template contract", () => {
  assert.match(mainSource, /element-plus\/es\/components\/loading\/index\.mjs/);
  assert.match(mainSource, /app\.component\(name, component\)/);
  assert.match(mainSource, /app\.directive\("loading", ElLoading\.directive\);/);
  assert.match(mainSource, /app\.mount\("#app"\);/);
  assert.match(mainSource, /import "element-plus\/dist\/index\.css";/);

  for (const component of expectedGlobalComponents) {
    assert.match(mainSource, new RegExp(`<el-${component}(?:\\s|>)`), `missing <el-${component}>`);
  }

  assert.match(mainSource, /v-loading=/);
  assert.match(mainSource, /ElMessage\.success/);
  assert.match(mainSource, /ElMessageBox\.confirm/);
});

test("the current Vite split keeps the entry contract", () => {
  assert.equal(config.build.outDir, "dist");
  assert.equal(config.publicDir, false);
  assert.equal(manualChunks("/workspace/node_modules/element-plus/es/index.mjs"), "vendor-element-plus");
  assert.equal(manualChunks("/workspace/node_modules/@element-plus/icons-vue/dist/index.mjs"), "vendor-element-plus");
  assert.equal(manualChunks("/workspace/src/main.js"), undefined);
});
