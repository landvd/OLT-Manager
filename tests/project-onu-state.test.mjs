import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeProjectOnuRow,
  removeProjectOnuRow,
  replaceProjectOnuRows,
  selectProjectFromList
} from "../src/project-onu-state.mjs";

test("normalizes project ONU rows without changing business fields", () => {
  const row = normalizeProjectOnuRow({ id: 7, note: "楼道", serial: "ZTEG-1" });

  assert.deepEqual(row, {
    id: 7,
    note: "楼道",
    serial: "ZTEG-1",
    noteDraft: "楼道",
    savingNote: false,
    removing: false
  });
});

test("keeps the selected project ONU when replacing rows and defaults to the first row", () => {
  const selected = replaceProjectOnuRows([{ id: "a" }, { id: "b", note: "入口" }], "b");
  assert.deepEqual(selected.rows.map((row) => row.id), ["a", "b"]);
  assert.equal(selected.selectedOnu.id, "b");
  assert.equal(selected.selectedOnu.noteDraft, "入口");

  const fallback = replaceProjectOnuRows([{ id: "a" }, { id: "b" }], "missing");
  assert.equal(fallback.selectedOnu.id, "a");
});

test("selects the preferred project, retains the current project, or clears selection", () => {
  const projects = [{ id: "one" }, { id: "two" }];
  assert.equal(selectProjectFromList(projects, "two", "one").id, "two");
  assert.equal(selectProjectFromList(projects, "missing", "one").id, "one");
  assert.equal(selectProjectFromList(projects, "missing", "gone"), null);
});

test("removes a project ONU and only changes selection when needed", () => {
  const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const removed = removeProjectOnuRow(rows, "b", "b");
  assert.deepEqual(removed.rows.map((row) => row.id), ["a", "c"]);
  assert.equal(removed.selectedOnu.id, "a");

  const unchangedSelection = removeProjectOnuRow(rows, "c", "a");
  assert.deepEqual(unchangedSelection.rows.map((row) => row.id), ["b", "c"]);
  assert.equal(unchangedSelection.selectedOnu.id, "c");
});
