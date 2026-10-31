import assert from "node:assert/strict";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  CHANNEL_FORMAT,
  UPDATE_FORMAT,
  applyAndSuperviseRestart,
  applyStagedUpdate,
  checkRemoteUpdate,
  downloadAndStageUpdate,
  normalizeBaseUrl,
  readUpdateSettings,
  signChannel,
  stageLocalUpdate,
  compareVersions,
  safeRelativePath
} = require("../electron/update-manager.cjs");
const { buildChannel } = await import("../scripts/publish-update.mjs");

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

test("手动增量包直接支持 .zip 压缩包自动解压与暂存校验", async () => {
  const { execFile } = require("node:child_process");
  const { promisify } = require("node:util");
  const execFileAsync = promisify(execFile);

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "olt-zip-update-test-"));
  const packageRoot = path.join(root, "package");
  const userDataPath = path.join(root, "user-data");
  await fs.mkdir(path.join(packageRoot, "src"), { recursive: true });
  const bytes = Buffer.from("zip-based update content");
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

  // 打包为 zip
  const zipPath = path.join(root, "update-package.zip");
  if (process.platform === "win32") {
    await execFileAsync("tar.exe", ["-cf", zipPath, "-C", packageRoot, "."]);
  } else {
    await execFileAsync("zip", ["-r", "-q", zipPath, "."], { cwd: packageRoot });
  }

  // 直接将 zip 路径传给 stageLocalUpdate
  const staged = await stageLocalUpdate({
    manifestPath: zipPath,
    currentVersion: "1.2.0",
    userDataPath
  });

  assert.equal(staged.available, true);
  assert.equal(staged.mode, "incremental");
  assert.equal(await fs.readFile(path.join(staged.stageRoot, "files", "src", "marker.txt"), "utf8"), "zip-based update content");
  await fs.rm(root, { recursive: true, force: true });
});


// ---------------- 启动自动更新（ADR-093） ----------------

function autoUpdateKeys() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  return { privateKey: privateKey.export({ type: "pkcs8", format: "pem" }), publicKey: publicKey.export({ type: "spki", format: "pem" }) };
}

const channelOf = (overrides = {}) => ({
  format: CHANNEL_FORMAT, version: "1.3.26", file: "pkg.zip", size: 10, sha256: "a".repeat(64), bases: ["1.3.25", "1.3.24"], targets: ["win32-x64"], ...overrides
});

const serving = (body, status = 200) => async () => new Response(body, { status });

test("自动更新：只认签名正确的版本清单", async () => {
  const { privateKey, publicKey } = autoUpdateKeys();
  const check = (body, extra = {}) => checkRemoteUpdate({ baseUrl: "http://server:8089/", currentVersion: "1.3.25", publicKey, platform: "win32", arch: "x64", fetchImpl: serving(body), ...extra });
  const signed = JSON.stringify(signChannel(channelOf(), privateKey));

  const found = await check(signed);
  assert.equal(found.available, true);
  assert.equal(found.version, "1.3.26");

  // 改了内容、别的私钥签的，都拒绝
  const tampered = JSON.parse(signed);
  tampered.payload = tampered.payload.replace("1.3.26", "9.9.9");
  await assert.rejects(check(JSON.stringify(tampered)), /签名校验失败/);
  await assert.rejects(check(JSON.stringify(signChannel(channelOf(), autoUpdateKeys().privateKey))), /签名校验失败/);
  await assert.rejects(check("不是 JSON"), /不是有效 JSON/);
  await assert.rejects(checkRemoteUpdate({ baseUrl: "http://server", currentVersion: "1.3.25", publicKey, fetchImpl: serving("x", 500) }), /HTTP 500/);
  assert.equal((await checkRemoteUpdate({ baseUrl: "http://server", currentVersion: "1.3.25", publicKey, fetchImpl: serving("x", 404) })).available, false);
});

test("自动更新：只有服务器版本更高才更新；跳过失败版本；基线和平台不符不更新", async () => {
  const { privateKey, publicKey } = autoUpdateKeys();
  const check = (channel, extra = {}) => checkRemoteUpdate({ baseUrl: "http://server", currentVersion: "1.3.25", publicKey, platform: "win32", arch: "x64", fetchImpl: serving(JSON.stringify(signChannel(channel, privateKey))), ...extra });
  assert.equal((await check(channelOf({ version: "1.3.25" }))).available, false);
  assert.equal((await check(channelOf({ version: "1.3.24" }))).available, false);
  const skipped = await check(channelOf(), { skipVersion: "1.3.26" });
  assert.equal(skipped.available, false);
  assert.match(skipped.reason, /已跳过/);
  assert.equal((await check(channelOf({ version: "1.3.27" }), { skipVersion: "1.3.26" })).available, true);
  assert.match((await check(channelOf({ bases: ["1.3.20"] }))).reason, /需要整体包/);
  assert.match((await check(channelOf(), { arch: "arm64" })).reason, /不支持/);
});

test("自动更新：服务器地址只接受 http / https", () => {
  assert.equal(normalizeBaseUrl(" http://192.168.1.10:8089/ "), "http://192.168.1.10:8089");
  assert.equal(normalizeBaseUrl(""), "");
  assert.throws(() => normalizeBaseUrl("file:///etc"), /只支持/);
  assert.throws(() => normalizeBaseUrl("http://a:b@host"), /不能带账号/);
  assert.throws(() => normalizeBaseUrl("随便写"), /地址无效/);
});

test("自动更新：下载的包校验不过不会暂存", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "olt-auto-download-"));
  const channel = channelOf({ size: 3, sha256: crypto.createHash("sha256").update("abc").digest("hex") });
  await assert.rejects(downloadAndStageUpdate({ baseUrl: "http://server", channel, currentVersion: "1.3.25", userDataPath: root, fetchImpl: async () => new Response("abd") }), /校验失败/);
  await assert.rejects(downloadAndStageUpdate({ baseUrl: "http://server", channel, currentVersion: "1.3.25", userDataPath: root, fetchImpl: async () => new Response("no", { status: 404 }) }), /HTTP 404/);
  await assert.rejects(fs.access(path.join(root, "updates")));
});

async function supervisedFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "olt-auto-restart-"));
  const targetRoot = path.join(root, "app");
  const stageRoot = path.join(root, "stage");
  await fs.mkdir(path.join(targetRoot, "src"), { recursive: true });
  await fs.mkdir(path.join(stageRoot, "files/src"), { recursive: true });
  await fs.writeFile(path.join(targetRoot, "src/changed.js"), "old");
  await fs.writeFile(path.join(targetRoot, "src/removed.js"), "old-removed");
  await fs.writeFile(path.join(stageRoot, "files/src/changed.js"), "new");
  await fs.writeFile(path.join(stageRoot, "files/src/added.js"), "new-added");
  const entry = (name, body) => ({ path: `src/${name}`, size: body.length, sha256: crypto.createHash("sha256").update(body).digest("hex") });
  await fs.writeFile(path.join(stageRoot, "manifest.json"), JSON.stringify({ version: "1.3.26", files: [entry("changed.js", "new"), entry("added.js", "new-added")], remove: ["src/removed.js"] }));
  return { root, targetRoot, stageRoot, markerPath: path.join(root, "marker"), userDataPath: path.join(root, "ud") };
}

const fakeChild = () => Object.assign(new EventEmitter(), { kill() { this.killed = true; } });
const read = (file) => fs.readFile(file, "utf8");

test("自动更新：新版本确认启动成功后保留新文件、清理暂存", async () => {
  const fixture = await supervisedFixture();
  const launches = [];
  const result = await applyAndSuperviseRestart({
    ...fixture, parentPid: 0, pollMs: 5, timeoutMs: 2000,
    launch: (options) => { launches.push(options.confirm); fsSync.writeFileSync(fixture.markerPath, "ok"); return fakeChild(); }
  });
  assert.equal(result.ok, true);
  assert.deepEqual(launches, [true]);
  assert.equal(await read(path.join(fixture.targetRoot, "src/changed.js")), "new");
  await assert.rejects(fs.access(fixture.stageRoot));
  const settings = await readUpdateSettings(fixture.userDataPath);
  assert.equal(settings.lastResult.ok, true);
  assert.equal(settings.skipVersion, undefined);
});

for (const [name, launchNew] of [
  ["新版本启动就退出", (child) => setTimeout(() => child.emit("exit", 1), 5)],
  ["新版本一直没报告成功（超时）", () => {}]
]) {
  test(`自动更新：${name}时恢复旧文件、跳过该版本、拉起旧版本`, async () => {
    const fixture = await supervisedFixture();
    const launches = [];
    const children = [];
    const result = await applyAndSuperviseRestart({
      ...fixture, parentPid: 0, pollMs: 5, timeoutMs: 50,
      launch: (options) => { launches.push(options.confirm); const child = fakeChild(); children.push(child); if (options.confirm) launchNew(child); return child; }
    });
    assert.equal(result.ok, false);
    assert.deepEqual(launches, [true, false]);
    assert.equal(await read(path.join(fixture.targetRoot, "src/changed.js")), "old");
    assert.equal(await read(path.join(fixture.targetRoot, "src/removed.js")), "old-removed");
    await assert.rejects(fs.access(path.join(fixture.targetRoot, "src/added.js")));
    const settings = await readUpdateSettings(fixture.userDataPath);
    assert.equal(settings.skipVersion, "1.3.26");
    assert.equal(settings.lastResult.ok, false);
  });
}

test("发布脚本：拒绝测试包和版本、校验值不一致的包", () => {
  const zipBytes = Buffer.from("zip");
  const report = { version: "1.3.26", zipSha256: crypto.createHash("sha256").update(zipBytes).digest("hex"), targets: ["win32-x64"], bases: [{ baseVersion: "1.3.25" }] };
  const good = { zipPath: "release/OLT-Manager-1.3.26-incremental.zip", zipBytes, report, packageVersion: "1.3.26" };
  const channel = buildChannel(good);
  assert.deepEqual([channel.version, channel.file, channel.size, channel.bases], ["1.3.26", "OLT-Manager-1.3.26-incremental.zip", 3, ["1.3.25"]]);
  assert.throws(() => buildChannel({ ...good, zipPath: "release/test-builds/OLT-Manager-1.3.26-test-incremental.zip" }), /测试包/);
  assert.throws(() => buildChannel({ ...good, packageVersion: "1.3.25" }), /不一致/);
  assert.throws(() => buildChannel({ ...good, zipBytes: Buffer.from("other") }), /SHA-256/);
});
