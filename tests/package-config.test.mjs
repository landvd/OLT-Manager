import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  SQLITE_LEGACY_TOOLS_URL,
  SQLITE_LEGACY_TOOLS_SHA3_256
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
  assert.match(workflow, /pnpm run prepare:win-sqlite/);
  assert.doesNotMatch(workflow, /choco install sqlite/);
});
