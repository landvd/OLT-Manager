import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { bundledToolCandidatesForPlatform } from "../src/runtime-paths.mjs";

test("Windows packaged app searches appRoot bin before PATH tools", () => {
  const candidates = bundledToolCandidatesForPlatform("sqlite3", {
    platform: "win32",
    appRootPath: "C:\\Program Files\\OLT Manager\\resources\\app",
    resourcesPath: "C:\\Program Files\\OLT Manager\\resources"
  });

  assert.equal(
    candidates[0],
    join("C:\\Program Files\\OLT Manager\\resources\\app", "bin", "win32", "sqlite3.exe")
  );
  assert.ok(candidates.includes(join("C:\\Program Files\\OLT Manager\\resources", "bin", "win32", "sqlite3.exe")));
  assert.equal(candidates.at(-1), "sqlite3.exe");
});
