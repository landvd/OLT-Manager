import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("embedded terminal captures tab before browser focus navigation", async () => {
  const source = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(source, /function attachTerminalKeydownGuard/);
  assert.match(source, /addEventListener\("keydown", terminalKeydownHandler, true\)/);
  assert.match(source, /event\.key === "Tab"/);
  assert.match(source, /event\.preventDefault\(\)/);
  assert.match(source, /event\.stopPropagation\(\)/);
  assert.match(source, /sendTerminalInput\("\\t"\)/);
  assert.match(source, /function detachTerminalKeydownGuard/);
  assert.match(source, /removeEventListener\("keydown", terminalKeydownHandler, true\)/);
});
