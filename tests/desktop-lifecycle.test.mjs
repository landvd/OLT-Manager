import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const electronMain = await readFile(new URL("../electron/main.cjs", import.meta.url), "utf8");
const preload = await readFile(new URL("../electron/preload.cjs", import.meta.url), "utf8");
const releaseWorkflow = await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");

test("desktop lifecycle keeps platform targets, user-data paths, and no-publish release boundaries", () => {
  assert.equal(packageJson.devDependencies.electron, "22.3.27");
  assert.equal(packageJson.build.asar, false);
  assert.equal(packageJson.build.mac.identity, null);
  assert.equal(packageJson.build.mac.artifactName, "${productName}-${version}-arm64.${ext}");
  assert.equal(packageJson.build.win.target[0].target, "zip");
  assert.deepEqual(packageJson.build.win.target[0].arch, ["x64"]);
  assert.match(packageJson.scripts["dist:mac"], /--mac dmg --arm64 --publish never/);
  assert.match(packageJson.scripts["dist:win"], /--win zip --x64 --publish never/);
  assert.match(electronMain, /app\.getPath\("userData"\)/);
  assert.match(electronMain, /process\.env\.OLT_MANAGER_DATA_DIR = path\.join\(userData, "data"\)/);
  assert.match(electronMain, /Feishu subsystem unavailable; local OLT functions remain available/);
  assert.match(electronMain, /productionFeishuProviderConfigured\(\)/);
  assert.match(electronMain, /生产 Feishu provider 尚未配置/);
  assert.match(electronMain, /feishu:migration:apply/);
  assert.match(electronMain, /contextIsolation:\s*true/);
  assert.match(preload, /feishuMigration/);
  assert.match(releaseWorkflow, /macos-15/);
  assert.match(releaseWorkflow, /windows-2022/);
  assert.match(releaseWorkflow, /CI:\s+"true"/);
});

test("desktop recovery IPC keeps combined backup and migration behind explicit confirmation", () => {
  assert.match(electronMain, /confirmed: value\.confirmed === true/);
  assert.match(electronMain, /confirmed: value\.confirmed === true,\n    credentialReferenceMap/);
  assert.match(preload, /feishuBackup/);
  assert.match(preload, /feishuMigration/);
});
