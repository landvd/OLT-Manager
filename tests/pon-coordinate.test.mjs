import test from "node:test";
import assert from "node:assert/strict";
import { compareOnuCoordinates } from "../src/pon-coordinate.mjs";

test("ONU coordinates sort numerically by chassis board PON and ID", () => {
  const rows = [
    { chassis: "1", board: "10", pon: "1", onuId: "2" },
    { chassis: "1", board: "2", pon: "10", onuId: "1" },
    { chassis: "1", board: "2", pon: "3", onuId: "10" },
    { chassis: "1", board: "2", pon: "3", onuId: "2" }
  ];

  assert.deepEqual([...rows].sort(compareOnuCoordinates), [rows[3], rows[2], rows[1], rows[0]]);
});

test("ONU coordinate sorting accepts the legacy slot alias", () => {
  const rows = [
    { chassis: "1", slot: "3", pon: "1", onuId: "1" },
    { chassis: "1", board: "2", pon: "1", onuId: "1" }
  ];

  assert.deepEqual([...rows].sort(compareOnuCoordinates), [rows[1], rows[0]]);
});
