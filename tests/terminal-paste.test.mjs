import test from "node:test";
import assert from "node:assert/strict";
import { terminalPasteFrames, terminalPasteLines, terminalPasteNeedsExtraEnter } from "../src/terminal-paste.mjs";

test("paste keeps the complete generated Huawei command sequence", () => {
  const lines = terminalPasteLines("config\ninterface gpon 0/2\nont add 3 sn-auth ABC omci ont-lineprofile-id 300");

  assert.deepEqual(lines, [
    "config",
    "interface gpon 0/2",
    "ont add 3 sn-auth ABC omci ont-lineprofile-id 300"
  ]);
});

test("paste preserves command spaces and sends one Telnet carriage return per line", () => {
  const frames = terminalPasteFrames("config\r\nservice-port vlan 1063 gpon 0/2/3 ont 18 gemport 0");

  assert.deepEqual(frames, [
    { line: "config", input: "config\r" },
    { line: "service-port vlan 1063 gpon 0/2/3 ont 18 gemport 0", input: "service-port vlan 1063 gpon 0/2/3 ont 18 gemport 0\r" }
  ]);
});

test("Huawei ont add receives an extra carriage return before the next command", () => {
  assert.equal(terminalPasteNeedsExtraEnter("ont add 3 sn-auth ABC", "Huawei"), true);
  assert.equal(terminalPasteNeedsExtraEnter("service-port vlan 1063 gpon 0/2/3 ont 1", "Huawei"), true);
  assert.equal(terminalPasteNeedsExtraEnter("quit", "Huawei"), false);
  assert.equal(terminalPasteNeedsExtraEnter("ont add 3 sn-auth ABC", "zte"), false);
});
