import test from "node:test";
import assert from "node:assert/strict";
import { buildHuaweiReadOnlyCommands } from "../src/huawei-telnet.mjs";

test("Huawei read-only configured ONT query builds a fixed display command", () => {
  assert.deepEqual(buildHuaweiReadOnlyCommands({ chassis: 0, board: 1, pon: 0, onuId: 1 }), [
    "display current-configuration ont 0/1/0 1"
  ]);
});

test("Huawei read-only configured ONT query rejects non-numeric coordinates", () => {
  assert.throws(
    () => buildHuaweiReadOnlyCommands({ chassis: 0, board: 1, pon: "0;save", onuId: 1 }),
    /PON 格式无效/
  );
});
