import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DYNAMIC_MODULES, verifyPackageLayout } from "../scripts/verify-package-layout.mjs";

async function writeFile(root, relativePath, contents = "fixture") {
  const target = path.join(root, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, contents);
}

async function createAsarFalseFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "olt-layout-app-"));
  const resources = await fs.mkdtemp(path.join(os.tmpdir(), "olt-layout-resources-"));
  await writeFile(root, "package.json", "{}");
  await writeFile(root, "electron/main.cjs");
  await writeFile(root, "electron/preload.cjs");
  await writeFile(root, "src/feishu/production-runtime.cjs");
  await writeFile(root, "assets/generated/olt-manager-16.png");
  await writeFile(root, "assets/generated/olt-manager.ico");
  await writeFile(root, "dist/index.html", '<script type="module" src="/assets/index.js"></script><link rel="stylesheet" href="/assets/index.css">');
  await writeFile(root, "dist/assets/index.js");
  await writeFile(root, "dist/assets/index.css");
  for (const relativePath of DYNAMIC_MODULES) await writeFile(root, relativePath);
  await writeFile(resources, "feishu-runtime/node_modules/@larksuiteoapi/node-sdk/package.json", '{"name":"@larksuiteoapi/node-sdk"}');
  await writeFile(root, "bin/win32/sqlite3.exe", "fixture");
  return { root, resources, appRoot: root, resourcesPath: resources };
}

test("current asar:false-style app root satisfies the package layout contract", async () => {
  const fixture = await createAsarFalseFixture();
  const report = verifyPackageLayout({ ...fixture, platform: "win32" });
  assert.equal(report.ok, true, JSON.stringify(report.failures, null, 2));
  assert.equal(report.contract, "olt-manager/package-layout/v1");
  assert.equal(report.failures.length, 0);
  assert.ok(report.checks.some((check) => check.id === "resource:feishu-runtime" && check.ok));
  assert.ok(report.checks.some((check) => check.id === "resource:win32-sqlite" && check.ok));
});

test("missing dynamic or runtime resources fail closed without loading package code", async () => {
  const fixture = await createAsarFalseFixture();
  await fs.rm(path.join(fixture.root, "src", "server.mjs"));
  await fs.rm(path.join(fixture.resources, "feishu-runtime"), { recursive: true });
  const report = verifyPackageLayout({ ...fixture, platform: "win32" });
  assert.equal(report.ok, false);
  assert.ok(report.failures.some((failure) => failure.id === "dynamic:src/server.mjs"));
  assert.ok(report.failures.some((failure) => failure.id === "resource:feishu-runtime"));
});

test("when appRoot is app.asar, dynamic modules must be unpacked", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "olt-layout-asar-"));
  const appRoot = path.join(base, "app.asar");
  const resourcesPath = base;
  const unpacked = path.join(base, "app.asar.unpacked");
  const fixture = await createAsarFalseFixture();
  await fs.cp(fixture.root, appRoot, { recursive: true });
  await fs.cp(fixture.resources, path.join(base, "resource-fixture"), { recursive: true });
  await writeFile(unpacked, "src/server.mjs");
  for (const relativePath of DYNAMIC_MODULES.slice(1)) await writeFile(unpacked, relativePath);
  await writeFile(base, "feishu-runtime/node_modules/@larksuiteoapi/node-sdk/package.json", '{"name":"@larksuiteoapi/node-sdk"}');
  await writeFile(base, "bin/win32/sqlite3.exe", "fixture");
  const report = verifyPackageLayout({ appRoot, resourcesPath, platform: "win32" });
  assert.equal(report.ok, true, JSON.stringify(report.failures, null, 2));
  assert.ok(report.dynamicRoots.includes(unpacked));
});
