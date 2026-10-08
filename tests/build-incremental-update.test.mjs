import test from "node:test";
import assert from "node:assert/strict";
import {
  compareVersions,
  exactTagBaseAllowed,
  isManagedPath,
  planBaseArtifact,
  runtimeFingerprint
} from "../scripts/build-incremental-update.mjs";

test("incremental update only manages app files shipped in resources/app", () => {
  assert.equal(isManagedPath("package.json"), true);
  assert.equal(isManagedPath("src/server.mjs"), true);
  assert.equal(isManagedPath("electron/main.cjs"), true);
  assert.equal(isManagedPath("bin/win32/sqlite3.exe"), true);
  assert.equal(isManagedPath("data/olts.example.json"), true);
  assert.equal(isManagedPath("data/olts.json"), false);
  assert.equal(isManagedPath("data/olt-manager.sqlite"), false);
  assert.equal(isManagedPath("tests/db.test.mjs"), false);
  assert.equal(isManagedPath("src/.DS_Store"), false);
  assert.equal(isManagedPath("dist/index.html"), false);
});

test("exact base gets only changed files plus full dist, and stale files are removed", () => {
  const targetTree = new Map([["package.json", "p2"], ["src/a.mjs", "a"], ["src/b.mjs", "b2"], ["src/new.mjs", "n"]]);
  const baseTree = new Map([["package.json", "p1"], ["src/a.mjs", "a"], ["src/b.mjs", "b1"], ["electron/old.cjs", "o"]]);
  const plan = planBaseArtifact({ targetTree, baseTree, distPaths: ["dist/index.html"], knownHistoricalPaths: new Set() });
  assert.deepEqual(plan.files, ["dist/index.html", "package.json", "src/b.mjs", "src/new.mjs"]);
  assert.deepEqual(plan.remove, ["electron/old.cjs"]);
  assert.equal(plan.exact, true);
});

test("an older base still receives files changed in intermediate versions", () => {
  // 回归：旧脚本只下发“最近一次”改动，从更早基线升级会缺少中间版本改动的文件。
  const targetTree = new Map([["src/x.mjs", "x3"], ["src/y.mjs", "y2"]]);
  const v16 = new Map([["src/x.mjs", "x2"], ["src/y.mjs", "y2"]]);
  const v9 = new Map([["src/x.mjs", "x1"], ["src/y.mjs", "y1"]]);
  const common = { targetTree, distPaths: [], knownHistoricalPaths: new Set() };
  assert.deepEqual(planBaseArtifact({ ...common, baseTree: v16 }).files, ["src/x.mjs"]);
  assert.deepEqual(planBaseArtifact({ ...common, baseTree: v9 }).files, ["src/x.mjs", "src/y.mjs"]);
});

test("unknown base tree ships every managed file and cleans known historical files", () => {
  const targetTree = new Map([["package.json", "p"], ["src/a.mjs", "a"]]);
  const plan = planBaseArtifact({
    targetTree,
    baseTree: null,
    distPaths: ["dist/index.html"],
    knownHistoricalPaths: new Set(["src/a.mjs", "src/gone.mjs", "data/olts.json"])
  });
  assert.deepEqual(plan.files, ["dist/index.html", "package.json", "src/a.mjs"]);
  assert.deepEqual(plan.remove, ["src/gone.mjs"]);
  assert.equal(plan.exact, false);
});

test("runtime fingerprint rejects bases with different dependencies or Electron", () => {
  const base = { dependencies: { vue: "^3.5.24", xlsx: "^0.18.5" }, devDependencies: { electron: "44.4.2", "electron-builder": "26.15.3" } };
  const reordered = { dependencies: { xlsx: "^0.18.5", vue: "^3.5.24" }, devDependencies: { electron: "44.4.2", "electron-builder": "26.15.3", vite: "^7" } };
  assert.equal(runtimeFingerprint(base), runtimeFingerprint(reordered));
  assert.notEqual(runtimeFingerprint(base), runtimeFingerprint({ ...base, devDependencies: { electron: "22.3.27" } }));
  assert.notEqual(runtimeFingerprint(base), runtimeFingerprint({ ...base, dependencies: { vue: "^3.5.24" } }));
});

test("version comparison is numeric", () => {
  assert.equal(compareVersions("1.2.10", "1.2.9"), 1);
  assert.equal(compareVersions("1.2.18", "1.2.18"), 0);
  assert.equal(compareVersions("1.2.6", "1.2.17"), -1);
});

test("事后补打 tag 的历史增量包版本不按 tag 精确差异", () => {
  for (const version of ["1.2.13", "1.2.14", "1.2.15", "1.2.16", "1.2.17"]) {
    assert.equal(exactTagBaseAllowed(version), false, version);
  }
  assert.equal(exactTagBaseAllowed("1.2.12"), true);
  assert.equal(exactTagBaseAllowed("1.2.18"), true);
});
