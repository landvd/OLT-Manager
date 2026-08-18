import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const electronMain = await readFile(new URL("../electron/main.cjs", import.meta.url), "utf8");
const rendererMain = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
const preload = await readFile(new URL("../electron/preload.cjs", import.meta.url), "utf8");
const feishuRuntimeScript = await readFile(new URL("../scripts/prepare-feishu-runtime.mjs", import.meta.url), "utf8");
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
  assert.match(packageJson.scripts["dist:win"], /prepare:feishu-runtime/);
  assert.equal(packageJson.build.extraResources[0].to, "feishu-runtime");
  assert.match(feishuRuntimeScript, /@larksuiteoapi\/node-sdk/);
  assert.match(electronMain, /app\.getPath\("userData"\)/);
  assert.match(electronMain, /process\.env\.OLT_MANAGER_DATA_DIR = path\.join\(userData, "data"\)/);
  assert.match(electronMain, /Feishu subsystem unavailable; local OLT functions remain available/);
  assert.doesNotMatch(electronMain, /const feishuSdk = require\("@larksuiteoapi\/node-sdk"\)/);
  assert.match(electronMain, /feishuSdk \?\?= require\("@larksuiteoapi\/node-sdk"\)/);
  assert.match(electronMain, /let languageProvider;/);
  assert.match(electronMain, /languageProvider \?\?= languageProviderModule/);
  assert.match(electronMain, /await feishuSubsystem\.enable\(/);
  assert.match(electronMain, /publicFeishuSettings\(feishuSubsystem\.status\(\)\)/);
  assert.match(electronMain, /configureFeishuCredentials/);
  assert.match(electronMain, /configureFeishuLanguageProvider/);
  assert.match(electronMain, /feishu:configure-credentials/);
  assert.match(electronMain, /feishu:configure-language-provider/);
  assert.match(electronMain, /if \(feishuInitialized\) return;/);
  assert.match(electronMain, /configureFeishuRuntimeDependencies/);
  assert.match(electronMain, /Module\._initPaths\(\)/);
  assert.match(electronMain, /Tray/);
  assert.match(electronMain, /Menu\.buildFromTemplate/);
  assert.match(electronMain, /mainWindow\.on\("minimize"/);
  assert.match(electronMain, /event\.preventDefault\(\);\s+mainWindow\.hide\(\);/);
  assert.match(electronMain, /label: "退出"/);
  assert.match(electronMain, /log: \(message, detail\) => appendDiagnostics\(message, detail\)/);
  assert.match(electronMain, /productionFeishuProviderConfigured\(state\)/);
  assert.match(electronMain, /请先保存完整的生产语言 provider 配置/);
  assert.match(rendererMain, /飞书机器人已启用并连接/);
  assert.match(rendererMain, /飞书机器人已启用，但尚未连接/);
  assert.match(rendererMain, /飞书APP ID/);
  assert.match(rendererMain, /APP SECRET/);
  assert.match(rendererMain, /API KEY/);
  assert.match(rendererMain, /保存飞书APP ID和APP SECRET/);
  assert.match(rendererMain, /保存大模型配置/);
  assert.match(rendererMain, /index="resourceSchedule">定时任务/);
  assert.match(rendererMain, /合并 ONU 数据同步/);
  assert.match(rendererMain, /同步网管二期/);
  assert.match(rendererMain, /同步 NMSE-PON/);
  assert.match(rendererMain, /手动合并/);
  assert.match(rendererMain, /全量同步/);
  assert.doesNotMatch(rendererMain, /当前 OLT 同步/);
  assert.doesNotMatch(rendererMain, /同步用户信息/);
  assert.doesNotMatch(rendererMain, /syncResourceUsers/);
  assert.match(rendererMain, /尚未同步/);
  assert.match(rendererMain, /api\/admin\/merged-onu\/sync/);
  assert.match(rendererMain, /api\/admin\/merged-onu\/sync\/network/);
  assert.match(rendererMain, /api\/admin\/merged-onu\/sync\/nmse/);
  assert.match(rendererMain, /api\/admin\/merged-onu\/merge/);
  assert.match(rendererMain, /api\/admin\/merged-onu\/status/);
  assert.match(rendererMain, /merged-onu\/sync\/progress/);
  assert.match(rendererMain, /正在读取网管二期全量 ONU/);
  assert.match(rendererMain, /正在读取 NMSE-PON 用户姓名/);
  assert.match(rendererMain, /每次操作前自动备份本机 SQLite/);
  assert.match(rendererMain, /body: JSON\.stringify\(\{\}\)/);
  assert.doesNotMatch(rendererMain, /index="adminHistory">数据采集记录/);
  assert.doesNotMatch(rendererMain, /警告通知/);
  assert.doesNotMatch(rendererMain, /alertRows/);
  assert.match(rendererMain, /formatUptime\(state\.status\.uptime\)/);
  assert.match(rendererMain, /api\/admin\/resource-sync-tasks/);
  assert.match(rendererMain, /repeatEnabled/);
  assert.match(rendererMain, /repeatDays/);
  assert.match(rendererMain, /每 \$\{task\.repeatDays\} 天/);
  assert.match(rendererMain, /deleteResourceSchedule/);
  assert.match(rendererMain, /resource-sync-tasks\/.*\/delete/);
  assert.doesNotMatch(rendererMain, /运行边界/);
  assert.doesNotMatch(rendererMain, /查询范围/);
  assert.doesNotMatch(rendererMain, /读取 CC Switch 配置/);
  assert.doesNotMatch(rendererMain, /语言 provider（仅发送查询意图，不发送 ONU 数据）/);
  assert.match(rendererMain, /state.feishu.enabled && state.feishu.connection.state !== 'connected'/);
  assert.match(rendererMain, /settings = await window\.oltManagerDesktop\.feishu\.read\(\)/);
  assert.match(rendererMain, /function applyFeishuSettings\(settings, \{ syncForm = false/);
  assert.match(rendererMain, /await refreshFeishuConnection\(\{ syncForm: true \}\)/);
  assert.match(rendererMain, /void refreshFeishuConnection\(\)/);
  assert.match(rendererMain, /feishuStatusTimer/);
  assert.match(rendererMain, /setInterval\(\(\) => \{/);
  assert.match(rendererMain, /使用长连接接收事件\/回调/);
  assert.match(preload, /configureCredentials/);
  assert.match(preload, /configureLanguageProvider/);
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
  assert.match(electronMain, /database:backup:restore/);
  assert.match(preload, /databaseBackup/);
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
