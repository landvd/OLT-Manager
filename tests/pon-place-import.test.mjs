import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.OLT_MANAGER_DATA_DIR = await mkdtemp(join(tmpdir(), "olt-manager-pon-place-import-"));

const { inspectPonExcelImport, ponRowsForExport } = await import("../src/main-view-state.mjs");
const { importPortPlaces } = await import("../src/place-routes.mjs");
const { parsePlaceInput } = await import("../src/edit-request-service.mjs");
const db = await import("../src/db.mjs");

const PLACES = {
  "10.0.0.9|7|8": { text: "厚街村", rows: { 君汇: { label: "新塘村/君汇小区" } } },
  "10.0.0.9|7|9": { text: "陈屋村、寮厦村" }
};
const excelRow = (pon, address, place) => ({ "OLT IP": "10.0.0.9", "槽": "1", "板卡": "7", "PON": String(pon), "地址": address, "村 / 小组 / 小区": place });

test("Excel 导入的归属列：只有改动过的行算改动，多个名称跳过，“自动”恢复自动", () => {
  const exported = ponRowsForExport([{ oltIp: "10.0.0.9", chassis: "1", board: "7", pon: "8", address: "君汇" }, { oltIp: "10.0.0.9", chassis: "1", board: "7", pon: "9", address: "陈屋" }], PLACES);
  assert.deepEqual(exported.map((row) => row["村 / 小组 / 小区"]), ["新塘村/君汇小区", "陈屋村、寮厦村"]);
  // 原样导出再导入：没有任何归属改动。
  const roundTrip = inspectPonExcelImport(exported, [], PLACES);
  assert.equal(roundTrip.validCount, 2);
  assert.deepEqual([roundTrip.placeChanges, roundTrip.placeSkipped], [[], []]);

  const edited = inspectPonExcelImport([
    excelRow(8, "君汇", "新塘村/顺景大厦"),
    excelRow(9, "陈屋", "陈屋村、厚街村"),
    excelRow(10, "新口", "自动"),
    excelRow(11, "另一口", "")
  ], [], PLACES);
  assert.deepEqual(edited.placeChanges.map((item) => [item.line, item.board, item.pon, item.address, item.text]), [
    [2, "7", "8", "君汇", "新塘村/顺景大厦"],
    [4, "7", "10", "新口", ""]
  ]);
  assert.deepEqual(edited.placeSkipped.map((item) => item.line), [3]);
  // 没有归属列：不比对。
  assert.deepEqual(inspectPonExcelImport([{ "OLT IP": "10.0.0.9", "板卡": "7", "PON": "8", "地址": "君汇" }], [], PLACES).placeChanges, []);
});

test("归属导入接口：按写法解析后按行指定，空值恢复自动，解析失败的行单独报错", async () => {
  await db.initDb();
  await db.savePortPlaceAssignment({ oltIp: "10.0.0.9", board: "7", pon: "10", address: "新口", village: "厚街村" });
  const result = await importPortPlaces({ items: [
    { line: 2, oltIp: "10.0.0.9", board: "7", pon: "8", address: "君汇", text: "新塘村/顺景大厦" },
    { line: 3, oltIp: "10.0.0.9", board: "7", pon: "9", address: "陈屋", text: "新塘村/顺景大厦小区" },
    { line: 4, oltIp: "10.0.0.9", board: "7", pon: "10", address: "新口", text: "" },
    { line: 5, oltIp: "10.0.0.9", board: "7", pon: "11", address: "另一口", text: "厚街村/向北" }
  ] }, { parsePlaceInput, getKnownPlaces: async () => [{ village: "厚街村", villageGroup: "下栅", community: "" }], savePortPlaceAssignments: db.savePortPlaceAssignments });
  assert.deepEqual([result.saved, result.cleared], [2, 1]);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].line, 5);
  assert.match(result.errors[0].error, /小组还是小区/);
  const rows = (await db.getPortPlaceAssignments()).map((item) => [item.pon, item.address, item.label]);
  assert.deepEqual(rows, [["8", "君汇", "新塘村/顺景大厦小区"], ["9", "陈屋", "新塘村/顺景大厦小区"]]);
});
