import test from "node:test";
import assert from "node:assert/strict";
import { createOnuListState, findPonAddressMatch, sortOnuRows } from "../src/onu-list-state.mjs";

test("creates the existing ONU filter and sort state", () => {
  assert.deepEqual(createOnuListState(), {
    filters: { search: "", chassis: "", slot: "", pon: "" },
    sort: { field: "", direction: "asc" }
  });
});

test("finds the shortest matching address without mutating the source", () => {
  const ports = [
    { address: "东莞市厚街镇河田村 12 号" },
    { address: "河田村 12 号" },
    { address: "桥头村 3 号" }
  ];
  assert.deepEqual(findPonAddressMatch(ports, "河田村"), ports[1]);
  assert.deepEqual(ports.map((port) => port.address), ["东莞市厚街镇河田村 12 号", "河田村 12 号", "桥头村 3 号"]);
  assert.equal(findPonAddressMatch(ports, ""), undefined);
});

test("preserves ONU sorting semantics and leaves unsorted rows untouched", () => {
  const rows = [
    { onuId: "10", chassis: "1", board: "1", pon: "2", phase: "offline", rxPower: "-30" },
    { onuId: "2", chassis: "1", board: "1", pon: "1", phase: "working", rxPower: "-20" },
    { onuId: "1", chassis: "1", board: "1", pon: "1", phase: "online", rxPower: "N/A" }
  ];
  assert.strictEqual(sortOnuRows(rows), rows);
  assert.deepEqual(sortOnuRows(rows, { field: "coordinate", direction: "ascending" }).map((row) => row.onuId), ["1", "2", "10"]);
  assert.deepEqual(sortOnuRows(rows, { field: "phase", direction: "ascending" }).map((row) => row.onuId), ["1", "2", "10"]);
  assert.deepEqual(sortOnuRows(rows, { field: "rxPower", direction: "descending" }).map((row) => row.onuId), ["1", "2", "10"]);
});
