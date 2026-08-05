import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const electronMain = await readFile(new URL("../electron/main.cjs", import.meta.url), "utf8");
const rendererMain = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
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
  assert.doesNotMatch(electronMain, /const feishuSdk = require\("@larksuiteoapi\/node-sdk"\)/);
  assert.match(electronMain, /feishuSdk \?\?= require\("@larksuiteoapi\/node-sdk"\)/);
  assert.match(electronMain, /let languageProvider;/);
  assert.match(electronMain, /languageProvider \?\?= languageProviderModule/);
  assert.match(electronMain, /await feishuSubsystem\.enable\(/);
  assert.match(electronMain, /publicFeishuSettings\(feishuSubsystem\.status\(\)\)/);
  assert.match(electronMain, /if \(feishuInitialized\) return;/);
  assert.match(electronMain, /log: \(message, detail\) => appendDiagnostics\(message, detail\)/);
  assert.match(electronMain, /productionFeishuProviderConfigured\(state\)/);
  assert.match(electronMain, /请先保存完整的生产语言 provider 配置/);
  assert.match(rendererMain, /飞书子系统已启用并连接/);
  assert.match(rendererMain, /飞书子系统已启用，但尚未连接/);
  assert.match(rendererMain, /state.feishu.enabled && state.feishu.connection.state !== 'connected'/);
  assert.match(rendererMain, /settings = await window\.oltManagerDesktop\.feishu\.read\(\)/);
  assert.match(rendererMain, /function applyFeishuSettings\(settings, \{ syncForm = false/);
  assert.match(rendererMain, /await refreshFeishuConnection\(\{ syncForm: true \}\)/);
  assert.match(rendererMain, /void refreshFeishuConnection\(\)/);
  assert.match(rendererMain, /feishuStatusTimer/);
  assert.match(rendererMain, /setInterval\(\(\) => \{/);
  assert.match(rendererMain, /使用长连接接收事件\/回调/);
  assert.doesNotMatch(electronMain, /feishu:migration:|feishu:admin:/);
  assert.doesNotMatch(electronMain, /gateway-settings/);
  assert.match(electronMain, /contextIsolation:\s*true/);
  assert.doesNotMatch(preload, /gatewaySettings/);
  assert.doesNotMatch(preload, /feishuMigration|feishuAdmin/);
  assert.match(releaseWorkflow, /macos-15/);
  assert.match(releaseWorkflow, /windows-2022/);
  assert.match(releaseWorkflow, /CI:\s+"true"/);
});

test("desktop recovery IPC keeps combined backup behind explicit confirmation", () => {
  assert.match(electronMain, /confirmed: value\.confirmed === true/);
  assert.match(preload, /feishuBackup/);
  assert.doesNotMatch(preload, /feishuMigration|feishuAdmin/);
});

test("desktop Feishu runtime keeps one query application across card callbacks", () => {
  const applicationIndex = electronMain.indexOf("const application = createFeishuQueryApplication");
  const dispatchIndex = electronMain.indexOf("const dispatch = async");
  assert.ok(applicationIndex > 0);
  assert.ok(dispatchIndex > applicationIndex);
  const runtimeFactoryBlock = electronMain.slice(
    electronMain.indexOf("runtimeFactory:"),
    electronMain.indexOf("runtime = createFeishuProductionRuntime")
  );
  assert.equal(
    [...runtimeFactoryBlock.matchAll(/createFeishuQueryApplication/g)].length,
    1
  );
});
