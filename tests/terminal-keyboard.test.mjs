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

test("embedded terminal exposes manual paste and appends verification commands for config paste", async () => {
  const source = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(source, /粘贴剪贴板/);
  assert.match(source, /function pasteClipboardToTerminal/);
  assert.match(source, /function prepareTerminalInput/);
  assert.match(source, /function zteVerificationCommandsForCurrentPlan/);
  assert.match(source, /show running-config interface/);
  assert.match(source, /show onu running config/);
});
