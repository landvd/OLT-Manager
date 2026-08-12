import test from "node:test";
import assert from "node:assert/strict";
import { formatUptime } from "../src/formatters.mjs";

test("formatUptime converts SNMP day/hour/minute/second text to a readable value", () => {
  assert.equal(formatUptime("119:14:15:13.00"), "119天 14小时 15分钟 13秒");
  assert.equal(formatUptime("04:05:06.00"), "4小时 5分钟 6秒");
  assert.equal(formatUptime(""), "-");
});

test("formatUptime supports numeric hundredths of seconds and preserves unknown values", () => {
  assert.equal(formatUptime("366100"), "1小时 1分钟 1秒");
  assert.equal(formatUptime("SNMP unavailable"), "SNMP unavailable");
});
