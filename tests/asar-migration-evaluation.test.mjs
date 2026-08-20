import test from "node:test";
import assert from "node:assert/strict";
import packageConfig from "../package.json" with { type: "json" };
import { ASAR_EVIDENCE_KINDS, ASAR_UNPACK_PATTERNS, evaluateAsarMigration } from "../scripts/evaluate-asar-migration.mjs";

test("asar migration evaluation stays fail-closed for the current asar:false package", () => {
  const report = evaluateAsarMigration({ packageConfig, layoutReport: { ok: true }, platform: "darwin" });
  assert.equal(report.ready, false);
  assert.equal(report.asarEnabled, false);
  assert.ok(report.blockers.some((item) => item.includes("asar:false")));
  assert.ok(report.unpackPatterns.includes("bin/win32/sqlite3.exe"));
  assert.ok(report.unpackPatterns.every((item) => !item.includes("**/*/*/*")));
});

test("asar migration evaluation requires both layout evidence and Windows validation", () => {
  const report = evaluateAsarMigration({ packageConfig: { build: { asar: true } }, platform: "win32" });
  assert.equal(report.ready, false);
  assert.ok(report.blockers.some((item) => item.includes("目录包布局")));
  assert.ok(report.blockers.some((item) => item.includes("Windows 7")));
  assert.ok(ASAR_UNPACK_PATTERNS.includes("build/feishu-runtime/**/*"));
});

test("asar migration becomes ready only when every runtime evidence seam passes", () => {
  const report = evaluateAsarMigration({
    packageConfig: { build: { asar: true } },
    layoutReport: { ok: true },
    runtimeReport: { ok: true },
    windowsReport: { ok: true, platform: "win32" },
    platform: "darwin"
  });
  assert.equal(report.ready, true);
  assert.deepEqual(report.evidenceKinds, ASAR_EVIDENCE_KINDS);
  assert.deepEqual(report.blockers, []);
});

test("asar migration rejects mismatched Windows evidence on a Windows evaluation", () => {
  const report = evaluateAsarMigration({
    packageConfig: { build: { asar: true } },
    layoutReport: { ok: true },
    runtimeReport: { ok: true },
    windowsReport: { ok: true, platform: "darwin" },
    platform: "win32"
  });
  assert.equal(report.ready, false);
  assert.ok(report.blockers.some((item) => item.includes("平台标记不匹配")));
});
