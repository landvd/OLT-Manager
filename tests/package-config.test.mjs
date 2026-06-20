import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("desktop package includes bundled Windows sqlite tools", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.ok(
    pkg.build.files.includes("bin/win32/**/*"),
    "package build.files must include bin/win32/**/* so Win7 packages can ship sqlite3.exe"
  );
});
