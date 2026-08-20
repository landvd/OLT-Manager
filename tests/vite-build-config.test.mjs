import test from "node:test";
import assert from "node:assert/strict";
import config, { manualChunks } from "../vite.config.mjs";

test("manualChunks assigns large dependency families to stable named chunks", () => {
  assert.equal(manualChunks("/workspace/node_modules/@xterm/xterm/lib/xterm.js"), "vendor-xterm");
  assert.equal(manualChunks("/workspace/node_modules/xlsx/xlsx.mjs"), "vendor-xlsx");
  assert.equal(manualChunks("/workspace/node_modules/element-plus/es/index.mjs"), "vendor-element-plus");
  assert.equal(manualChunks("/workspace/node_modules/@element-plus/icons-vue/dist/index.mjs"), "vendor-element-plus");
  assert.equal(manualChunks("/workspace/node_modules/vue/dist/vue.runtime.esm-bundler.js"), "vendor-vue");
  assert.equal(manualChunks("/workspace/node_modules/@vueuse/core/index.js"), "vendor-vue");
  assert.equal(manualChunks("/workspace/node_modules/axios/index.js"), "vendor-common");
});

test("manualChunks is path-separator independent and does not split application modules", () => {
  assert.equal(manualChunks("C:\\workspace\\node_modules\\xlsx\\xlsx.js"), "vendor-xlsx");
  assert.equal(manualChunks("/workspace/src/local-auth-client.mjs"), undefined);
  assert.equal(manualChunks("/workspace/src/main.js"), undefined);
  assert.equal(manualChunks("/workspace/index.html"), undefined);
});

test("Vite keeps the existing Vue entry and dist output contract", () => {
  assert.equal(config.build.outDir, "dist");
  assert.equal(config.build.emptyOutDir, true);
  assert.equal(config.publicDir, false);
  assert.equal(config.plugins.length, 1);
  assert.equal(typeof config.build.rollupOptions.output.manualChunks, "function");
});
