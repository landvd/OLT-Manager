const fs = require("node:fs");
const fsp = fs.promises;
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const execFileAsync = promisify(execFile);

const UPDATE_FORMAT = "olt-manager/update/v1";
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_FILE_BYTES = 512 * 1024 * 1024;
// 启动自动更新（ADR-093）：服务器上只放一个签名的 channel.json 和增量包 ZIP
const CHANNEL_FORMAT = "olt-manager/update-channel/v1";
const CHANNEL_FILE = "channel.json";
const SETTINGS_FILE = "update-settings.json";
const CHECK_TIMEOUT_MS = 3_000;
const DOWNLOAD_TIMEOUT_MS = 180_000;
const RESTART_CONFIRM_TIMEOUT_MS = 120_000;

function text(value) {
  return String(value ?? "").trim();
}

function safeRelativePath(value) {
  const relative = text(value).replaceAll("\\", "/");
  if (!relative || relative.startsWith("/") || relative.includes("\0")) throw new Error("更新文件路径无效。");
  const parts = relative.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || /^[A-Za-z]:$/.test(part))) {
    throw new Error("更新文件路径越界。");
  }
  return parts.join("/");
}

function safeJoin(root, relative) {
  const clean = safeRelativePath(relative);
  const rootPath = path.resolve(root);
  const target = path.resolve(rootPath, ...clean.split("/"));
  if (target !== rootPath && !target.startsWith(`${rootPath}${path.sep}`)) throw new Error("更新目标路径越界。");
  return target;
}

function compareVersions(left, right) {
  const parse = (value) => text(value).split("+")[0].split("-")[0].split(".").map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) > (b[index] || 0) ? 1 : -1;
  }
  return 0;
}

async function readManifestFile(manifestPath) {
  const bytes = await fsp.readFile(manifestPath);
  if (bytes.length > MAX_MANIFEST_BYTES) throw new Error("更新清单超过允许大小。");
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("更新清单不是有效 JSON。");
  }
}

function normalizeFileEntry(entry) {
  if (!entry || typeof entry !== "object") throw new Error("更新清单包含无效文件项。");
  const relativePath = safeRelativePath(entry.path);
  const size = Number(entry.size);
  const sha256 = text(entry.sha256).toLowerCase();
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_FILE_BYTES) throw new Error(`更新文件大小无效：${relativePath}`);
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error(`更新文件校验值无效：${relativePath}`);
  return { path: relativePath, size, sha256 };
}

function selectManifestArtifact(manifest, currentVersion, platform, arch) {
  if (!manifest || manifest.format !== UPDATE_FORMAT) throw new Error("不支持的更新清单格式。");
  const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : [manifest];
  const candidates = artifacts.filter((artifact) => {
    if (!artifact || typeof artifact !== "object") return false;
    if (artifact.platform && artifact.platform !== platform) return false;
    if (artifact.arch && artifact.arch !== arch) return false;
    if (artifact.mode === "incremental" && text(artifact.baseVersion) !== text(currentVersion)) return false;
    return true;
  });
  const artifact = candidates.find((item) => item.mode === "incremental") || candidates.find((item) => item.mode === "full") || candidates[0];
  if (!artifact) return null;
  const version = text(artifact.version || manifest.version);
  if (!version || compareVersions(version, currentVersion) <= 0) return null;
  const files = Array.isArray(artifact.files) ? artifact.files.map(normalizeFileEntry) : [];
  if (!files.length) throw new Error("更新清单没有可更新文件。");
  const remove = Array.isArray(artifact.remove) ? artifact.remove.map(safeRelativePath) : [];
  return {
    format: UPDATE_FORMAT,
    version,
    mode: artifact.mode === "incremental" ? "incremental" : "full",
    baseVersion: text(artifact.baseVersion),
    releaseNotes: text(artifact.releaseNotes || manifest.releaseNotes),
    files,
    remove
  };
}

async function checkLocalUpdate({ manifestPath, currentVersion, platform = process.platform, arch = process.arch } = {}) {
  const absoluteManifestPath = path.resolve(text(manifestPath));
  const manifest = await readManifestFile(absoluteManifestPath);
  const artifact = selectManifestArtifact(manifest, currentVersion, platform, arch);
  if (!artifact) {
    const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : [manifest];
    const targetVersion = text(manifest.version || artifacts[0]?.version);
    const supportedBases = artifacts.map((item) => text(item.baseVersion)).filter(Boolean);
    let reason = "该增量包不适用于当前版本，或已经是最新版本。";
    if (targetVersion && compareVersions(targetVersion, currentVersion) <= 0) {
      reason = `当前版本（v${currentVersion}）已是最新或高于该更新包目标版本（v${targetVersion}），无需或无法重复安装。`;
    } else if (supportedBases.length > 0 && !supportedBases.includes(text(currentVersion))) {
      reason = `当前版本（v${currentVersion}）未在该增量包支持的基线版本中（该包支持基线：${supportedBases.join("、")}）。`;
    }
    return { configured: true, available: false, currentVersion, manifestPath: absoluteManifestPath, reason };
  }
  return {
    configured: true,
    available: true,
    currentVersion,
    manifestPath: absoluteManifestPath,
    ...artifact
  };
}

async function unpackZipArchive(zipPath, outputDirectory) {
  await fsp.mkdir(outputDirectory, { recursive: true });
  if (process.platform === "win32") {
    try {
      await execFileAsync("tar.exe", ["-xf", path.resolve(zipPath), "-C", path.resolve(outputDirectory)]);
      return;
    } catch {
      await execFileAsync("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${outputDirectory.replace(/'/g, "''")}' -Force`
      ]);
      return;
    }
  }
  await execFileAsync("unzip", ["-q", "-o", path.resolve(zipPath), "-d", path.resolve(outputDirectory)]);
}

async function findManifestInDirectory(dirPath, maxDepth = 2) {
  if (maxDepth < 0) return null;
  const directPath = path.join(dirPath, "latest.json");
  try {
    const stat = await fsp.stat(directPath);
    if (stat.isFile()) return directPath;
  } catch {}

  const entries = await fsp.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const nested = await findManifestInDirectory(path.join(dirPath, entry.name), maxDepth - 1);
      if (nested) return nested;
    }
  }
  return null;
}

async function stageLocalUpdate({ manifestPath, currentVersion, userDataPath, platform = process.platform, arch = process.arch } = {}) {
  const targetPath = path.resolve(text(manifestPath));
  let resolvedManifestPath = targetPath;
  let tempUnpackedDir = null;

  if (targetPath.toLowerCase().endsWith(".zip")) {
    tempUnpackedDir = path.join(userDataPath, "updates", `unpacked-${Date.now()}`);
    await unpackZipArchive(targetPath, tempUnpackedDir);
    const foundManifest = await findManifestInDirectory(tempUnpackedDir);
    if (!foundManifest) {
      await fsp.rm(tempUnpackedDir, { recursive: true, force: true }).catch(() => {});
      throw new Error("更新压缩包中未找到 latest.json 清单文件。");
    }
    resolvedManifestPath = foundManifest;
  }

  try {
    const checked = await checkLocalUpdate({ manifestPath: resolvedManifestPath, currentVersion, platform, arch });
    if (!checked.available) return checked;
    const packageRoot = path.dirname(checked.manifestPath);
    const stageRoot = path.join(userDataPath, "updates", `${checked.version}-${Date.now()}`);
    const stageFiles = path.join(stageRoot, "files");
    await fsp.mkdir(stageFiles, { recursive: true });
    try {
      for (const file of checked.files) {
        const sourcePath = safeJoin(packageRoot, file.path);
        const bytes = await fsp.readFile(sourcePath);
        const actualHash = crypto.createHash("sha256").update(bytes).digest("hex");
        if (bytes.length !== file.size || actualHash !== file.sha256) {
          throw new Error(`更新文件校验失败：${file.path}`);
        }
        const stagedPath = safeJoin(stageFiles, file.path);
        await fsp.mkdir(path.dirname(stagedPath), { recursive: true });
        await fsp.writeFile(stagedPath, bytes);
      }
      await fsp.writeFile(path.join(stageRoot, "manifest.json"), JSON.stringify({ ...checked, packageRoot }, null, 2));
      return { ...checked, stageRoot, originalPackagePath: targetPath };
    } catch (error) {
      await fsp.rm(stageRoot, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  } finally {
    if (tempUnpackedDir) {
      await fsp.rm(tempUnpackedDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForPidExit(pid, timeoutMs = 60_000) {
  const started = Date.now();
  while (pidAlive(pid)) {
    if (Date.now() - started > timeoutMs) throw new Error("等待旧版本退出超时。");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function copyIfExists(source, target) {
  if (!fs.existsSync(source)) return false;
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.copyFile(source, target);
  return true;
}

async function applyStagedUpdate({ stageRoot, targetRoot, parentPid, keepBackup = false } = {}) {
  const manifest = JSON.parse(await fsp.readFile(path.join(stageRoot, "manifest.json"), "utf8"));
  await waitForPidExit(Number(parentPid));
  const backupRoot = path.join(stageRoot, ".backup");
  const changed = manifest.files.map(normalizeFileEntry);
  const removed = (manifest.remove || []).map(safeRelativePath);
  const touched = [...new Set([...changed.map((file) => file.path), ...removed])];
  await fsp.mkdir(backupRoot, { recursive: true });
  const backedUp = new Set();
  try {
    for (const relativePath of touched) {
      const source = safeJoin(targetRoot, relativePath);
      const backup = safeJoin(backupRoot, relativePath);
      if (await copyIfExists(source, backup)) backedUp.add(relativePath);
    }
    for (const file of changed) {
      const source = safeJoin(path.join(stageRoot, "files"), file.path);
      const target = safeJoin(targetRoot, file.path);
      if (!fs.existsSync(source)) throw new Error(`暂存更新文件缺失：${file.path}`);
      await copyIfExists(source, target);
    }
    for (const relativePath of removed) {
      await fsp.rm(safeJoin(targetRoot, relativePath), { force: true });
    }
    if (!keepBackup) await fsp.rm(backupRoot, { recursive: true, force: true });
    return { ok: true, version: manifest.version };
  } catch (error) {
    for (const relativePath of touched) {
      const target = safeJoin(targetRoot, relativePath);
      const backup = safeJoin(backupRoot, relativePath);
      if (backedUp.has(relativePath)) await copyIfExists(backup, target).catch(() => {});
      else await fsp.rm(target, { force: true }).catch(() => {});
    }
    throw error;
  }
}

/** 新版本起不来时恢复旧文件：备份里有的拷回去，备份里没有的（新版本新增的）删掉。 */
async function rollbackStagedUpdate({ stageRoot, targetRoot } = {}) {
  const manifest = JSON.parse(await fsp.readFile(path.join(stageRoot, "manifest.json"), "utf8"));
  const touched = [...new Set([...manifest.files.map((file) => file.path), ...(manifest.remove || [])])].map(safeRelativePath);
  const backupRoot = path.join(stageRoot, ".backup");
  for (const relativePath of touched) {
    const target = safeJoin(targetRoot, relativePath);
    if (!(await copyIfExists(safeJoin(backupRoot, relativePath), target))) await fsp.rm(target, { force: true });
  }
  return { version: manifest.version };
}

function signChannel(channel, privateKeyPem) {
  const payload = JSON.stringify(channel);
  return { payload, signature: crypto.sign(null, Buffer.from(payload), privateKeyPem).toString("base64") };
}

function parseSignedChannel(raw, publicKeyPem) {
  let envelope;
  try {
    envelope = JSON.parse(raw);
  } catch {
    throw new Error("服务器上的版本清单不是有效 JSON。");
  }
  const { payload, signature } = envelope || {};
  if (typeof payload !== "string" || typeof signature !== "string"
    || !crypto.verify(null, Buffer.from(payload), publicKeyPem, Buffer.from(signature, "base64"))) {
    throw new Error("服务器上的版本清单签名校验失败。");
  }
  const channel = JSON.parse(payload);
  if (channel.format !== CHANNEL_FORMAT) throw new Error("不支持的版本清单格式。");
  const sha256 = text(channel.sha256).toLowerCase();
  if (!text(channel.version) || !Array.isArray(channel.bases) || !/^[a-f0-9]{64}$/.test(sha256)) throw new Error("版本清单内容不完整。");
  if (!Number.isSafeInteger(channel.size) || channel.size <= 0 || channel.size > MAX_FILE_BYTES) throw new Error("版本清单里的更新包大小无效。");
  return { ...channel, file: safeRelativePath(channel.file), sha256 };
}

function normalizeBaseUrl(value) {
  const raw = text(value);
  if (!raw) return "";
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("更新服务器地址无效，例如 http://192.168.1.10:8089");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("更新服务器地址只支持 http / https，不能带账号密码。");
  return url.href.replace(/\/+$/, "");
}

async function readUpdateSettings(userDataPath) {
  try {
    return JSON.parse(await fsp.readFile(path.join(userDataPath, SETTINGS_FILE), "utf8"));
  } catch {
    return {};
  }
}

async function writeUpdateSettings(userDataPath, patch) {
  const next = { ...(await readUpdateSettings(userDataPath)), ...patch };
  await fsp.mkdir(userDataPath, { recursive: true });
  const target = path.join(userDataPath, SETTINGS_FILE);
  await fsp.writeFile(`${target}.tmp`, JSON.stringify(next, null, 2));
  await fsp.rename(`${target}.tmp`, target);
  return next;
}

/** 查服务器版本。连不上、验签失败时抛错，由调用方按“继续用旧版本启动”处理。 */
async function checkRemoteUpdate({ baseUrl, currentVersion, publicKey, skipVersion = "", platform = process.platform, arch = process.arch, fetchImpl = fetch, timeoutMs = CHECK_TIMEOUT_MS } = {}) {
  const response = await fetchImpl(`${normalizeBaseUrl(baseUrl)}/${CHANNEL_FILE}`, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  if (response.status === 404) return { available: false, reason: "服务器上还没有发布过版本。" };
  if (!response.ok) throw new Error(`更新服务器返回 HTTP ${response.status}`);
  const channel = parseSignedChannel(await response.text(), publicKey);
  const none = (reason) => ({ available: false, version: channel.version, reason });
  if (compareVersions(channel.version, currentVersion) <= 0) return none(`已是最新版本（服务器 v${channel.version}，本机 v${currentVersion}）。`);
  if (text(skipVersion) === channel.version) return none(`v${channel.version} 上次更新后启动失败，已跳过，等下一个版本。`);
  if (!channel.bases.includes(text(currentVersion))) return none(`服务器 v${channel.version} 不支持从 v${currentVersion} 增量升级，需要整体包。`);
  if (Array.isArray(channel.targets) && !channel.targets.includes(`${platform}-${arch}`)) return none(`服务器 v${channel.version} 不支持 ${platform}-${arch}。`);
  return { available: true, version: channel.version, channel };
}

/** 下载并校验更新包，再走和手动更新相同的暂存校验。 */
async function downloadAndStageUpdate({ baseUrl, channel, currentVersion, userDataPath, platform = process.platform, arch = process.arch, fetchImpl = fetch, timeoutMs = DOWNLOAD_TIMEOUT_MS } = {}) {
  const response = await fetchImpl(`${normalizeBaseUrl(baseUrl)}/${channel.file}`, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  if (!response.ok) throw new Error(`下载更新包失败：HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length !== channel.size || crypto.createHash("sha256").update(bytes).digest("hex") !== channel.sha256) {
    throw new Error("下载的更新包校验失败。");
  }
  const downloads = path.join(userDataPath, "updates");
  await fsp.mkdir(downloads, { recursive: true });
  const zipPath = path.join(downloads, `download-${channel.version}-${Date.now()}.zip`);
  await fsp.writeFile(zipPath, bytes);
  try {
    const staged = await stageLocalUpdate({ manifestPath: zipPath, currentVersion, userDataPath, platform, arch });
    if (!staged.available || staged.version !== channel.version) throw new Error(staged.reason || "更新包版本和版本清单不一致。");
    return staged;
  } finally {
    await fsp.rm(zipPath, { force: true }).catch(() => {});
  }
}

/**
 * 替换文件后拉起新版本并看着它：新版本窗口加载成功后写 markerPath 算成功；
 * 它提前退出或超时没写，就恢复旧文件、跳过这个版本、重新拉起旧版本。
 */
async function applyAndSuperviseRestart({ stageRoot, targetRoot, parentPid, markerPath, userDataPath, launch, timeoutMs = RESTART_CONFIRM_TIMEOUT_MS, pollMs = 500 } = {}) {
  const { version } = JSON.parse(await fsp.readFile(path.join(stageRoot, "manifest.json"), "utf8"));
  const giveUp = async (reason) => {
    await writeUpdateSettings(userDataPath, { skipVersion: version, lastResult: { at: new Date().toISOString(), ok: false, version, message: reason } });
    launch({ confirm: false });
    return { ok: false, version, reason };
  };
  try {
    await applyStagedUpdate({ stageRoot, targetRoot, parentPid, keepBackup: true });
  } catch (error) {
    return giveUp(`替换文件失败，已恢复旧版本：${error.message}`);
  }
  await fsp.rm(markerPath, { force: true });
  const child = launch({ confirm: true });
  let exited = false;
  child.once("exit", () => { exited = true; });
  child.once("error", () => { exited = true; });
  const started = Date.now();
  while (!fs.existsSync(markerPath) && !exited && Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  if (fs.existsSync(markerPath)) {
    await fsp.rm(markerPath, { force: true });
    await fsp.rm(stageRoot, { recursive: true, force: true }).catch(() => {});
    await writeUpdateSettings(userDataPath, { lastResult: { at: new Date().toISOString(), ok: true, version, message: `已自动更新到 v${version}` } });
    return { ok: true, version };
  }
  if (!exited) {
    child.kill();
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  await rollbackStagedUpdate({ stageRoot, targetRoot });
  return giveUp(`v${version} 启动失败，已自动恢复旧版本。`);
}

function spawnUpdateApplier({ stageRoot, targetRoot, parentPid, execPath = process.execPath, superviseRestart = false, relaunchArgs = [] } = {}) {
  const child = spawn(execPath, ["--apply-update", stageRoot, targetRoot, String(parentPid), ...(superviseRestart ? ["--supervise-restart", ...relaunchArgs] : [])], {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
  return { pid: child.pid };
}

module.exports = {
  CHANNEL_FORMAT,
  UPDATE_FORMAT,
  applyAndSuperviseRestart,
  applyStagedUpdate,
  checkLocalUpdate,
  checkRemoteUpdate,
  compareVersions,
  downloadAndStageUpdate,
  normalizeBaseUrl,
  parseSignedChannel,
  readUpdateSettings,
  rollbackStagedUpdate,
  safeRelativePath,
  signChannel,
  spawnUpdateApplier,
  stageLocalUpdate,
  writeUpdateSettings,
};
