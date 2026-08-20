import test from "node:test";
import assert from "node:assert/strict";
import { loadXlsx } from "../src/xlsx-runtime.mjs";

test("xlsx runtime loads the heavy dependency lazily and reuses one promise", async () => {
  const first = loadXlsx();
  assert.equal(first, loadXlsx());
  const xlsx = await first;
  assert.equal(typeof xlsx.read, "function");
  assert.equal(typeof xlsx.utils.json_to_sheet, "function");
});
