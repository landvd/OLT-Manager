import test from "node:test";
import assert from "node:assert/strict";
import { loadXtermRuntime } from "../src/xterm-runtime.mjs";

test("xterm runtime loads terminal dependencies lazily and reuses one promise", async () => {
  const first = loadXtermRuntime();
  assert.equal(first, loadXtermRuntime());
  globalThis.self ??= globalThis;
  await first;
});

test("xterm runtime exposes the terminal and fit addon constructors", async () => {
  const runtime = await loadXtermRuntime();
  assert.equal(typeof runtime.Terminal, "function");
  assert.equal(typeof runtime.FitAddon, "function");
});
