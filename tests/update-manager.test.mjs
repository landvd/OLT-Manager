import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  UPDATE_FORMAT,
  applyStagedUpdate,
  stageLocalUpdate,
  compareVersions,
  safeRelativePath
} = require("../electron/update-manager.cjs");

test("版本和文件路径按安全边界规范化", () => {
  assert.throws(() => safeRelativePath("../package.json"), /越界/);
  assert.throws(() => safeRelativePath("C:/Windows/file"), /越界/);
  assert.equal(compareVersions("1.2.0", "1.1.9"), 1);
  assert.equal(compareVersions("1.1.9", "1.1.9"), 0);
});

test("手动增量包从本地 latest.json 校验并暂存文件", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "olt-local-update-test-"));
  const packageRoot = path.join(root, "package");
  const userDataPath = path.join(root, "user-data");
  await fs.mkdir(path.join(packageRoot, "src"), { recursive: true });
  const bytes = Buffer.from("manual update");
  await fs.writeFile(path.join(packageRoot, "src", "marker.txt"), bytes);
  await fs.writeFile(path.join(packageRoot, "latest.json"), JSON.stringify({
    format: UPDATE_FORMAT,
    artifacts: [{
      platform: process.platform,
      arch: process.arch,
      mode: "incremental",
      baseVersion: "1.2.0",
      version: "1.2.1",
      files: [{
        path: "src/marker.txt",
        size: bytes.length,
        sha256: crypto.createHash("sha256").update(bytes).digest("hex")
      }]
    }]
  }));

  const staged = await stageLocalUpdate({
    manifestPath: path.join(packageRoot, "latest.json"),
    currentVersion: "1.2.0",
    userDataPath
  });
  assert.equal(staged.available, true);
  assert.equal(staged.mode, "incremental");
  assert.equal(await fs.readFile(path.join(staged.stageRoot, "files", "src", "marker.txt"), "utf8"), "manual update");
  await fs.rm(root, { recursive: true, force: true });
});

test("暂存更新只替换清单文件并支持删除文件", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "olt-update-test-"));
  const targetRoot = path.join(root, "app");
  const stageRoot = path.join(root, "stage");
  await fs.mkdir(path.join(targetRoot, "src"), { recursive: true });
  await fs.mkdir(path.join(stageRoot, "files", "src"), { recursive: true });
  await fs.writeFile(path.join(targetRoot, "src", "server.mjs"), "old");
  await fs.writeFile(path.join(targetRoot, "src", "removed.mjs"), "remove");
  const bytes = Buffer.from("new");
  await fs.writeFile(path.join(stageRoot, "files", "src", "server.mjs"), bytes);
  await fs.writeFile(path.join(stageRoot, "manifest.json"), JSON.stringify({
    format: UPDATE_FORMAT,
    version: "1.1.9",
    files: [{
      path: "src/server.mjs",
      size: bytes.length,
      sha256: crypto.createHash("sha256").update(bytes).digest("hex")
    }],
    remove: ["src/removed.mjs"]
  }));

  const result = await applyStagedUpdate({ stageRoot, targetRoot, parentPid: 999999 });
  assert.equal(result.ok, true);
  assert.equal(await fs.readFile(path.join(targetRoot, "src", "server.mjs"), "utf8"), "new");
  await assert.rejects(fs.access(path.join(targetRoot, "src", "removed.mjs")));
  await fs.rm(root, { recursive: true, force: true });
});
