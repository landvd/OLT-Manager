import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  SQLITE_LEGACY_TOOLS_URL,
  SQLITE_LEGACY_TOOLS_SHA3_256,
  SQLITE_LEGACY_SQLITE3_SHA3_256,
  prepareWinSqlite
} from "../scripts/prepare-win-sqlite.mjs";

test("desktop package includes bundled Windows sqlite tools", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.ok(
    pkg.build.files.includes("bin/win32/**/*"),
    "package build.files must include bin/win32/**/* so Win7 packages can ship sqlite3.exe"
  );
});

test("release workflow uses fixed legacy sqlite tools for Win7", async () => {
  const workflow = await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
  assert.match(SQLITE_LEGACY_TOOLS_URL, /sqlite-tools-win32-x86-3410000\.zip$/);
  assert.equal(SQLITE_LEGACY_TOOLS_SHA3_256.length, 64);
  assert.equal(SQLITE_LEGACY_SQLITE3_SHA3_256.length, 64);
  assert.match(workflow, /pnpm run prepare:win-sqlite/);
  assert.doesNotMatch(workflow, /choco install sqlite/);
});

test("release workflow uses cross-platform CI env and disables electron-builder publish", async () => {
  const workflow = await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.doesNotMatch(workflow, /CI=true pnpm test/);
  assert.match(workflow, /CI:\s+"true"/);
  assert.ok(workflow.indexOf("pnpm run prepare:win-sqlite") < workflow.indexOf("pnpm test"));
  assert.match(workflow, /GITHUB_PATH/);
  assert.match(workflow, /OLT_MANAGER_SQLITE_BIN/);
  assert.match(workflow, /Verify sqlite3 for Windows/);
  assert.match(workflow, /& "\$env:OLT_MANAGER_SQLITE_BIN" --version/);
  assert.match(pkg.scripts["dist:mac"], /--publish never/);
  assert.match(pkg.scripts["dist:win"], /--publish never/);
  assert.match(pkg.scripts["dist:win:zip"], /--publish never/);
});

test("prepare win sqlite reuses an existing verified sqlite3.exe without downloading", async () => {
  const root = await mkdtemp(join(tmpdir(), "olt-sqlite-"));
  const outDir = join(root, "bin", "win32");
  const cacheDir = join(root, ".cache");
  const sqlitePath = join(outDir, "sqlite3.exe");
  await mkdir(outDir, { recursive: true });
  await writeFile(sqlitePath, "dummy sqlite");
  const sha3 = createHash("sha3-256").update("dummy sqlite").digest("hex");

  const result = await prepareWinSqlite({
    outDir,
    cacheDir,
    url: "https://example.invalid/sqlite-tools.zip",
    sqliteSha3: sha3
  });

  assert.equal(result.sqlitePath, sqlitePath);
  assert.equal(result.source, "existing");
  assert.equal(result.sha3, sha3);
});
