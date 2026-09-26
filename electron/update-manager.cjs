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
  if (!artifact) return { configured: true, available: false, currentVersion, manifestPath: absoluteManifestPath };
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

async function applyStagedUpdate({ stageRoot, targetRoot, parentPid } = {}) {
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
    await fsp.rm(backupRoot, { recursive: true, force: true });
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

function spawnUpdateApplier({ stageRoot, targetRoot, parentPid, execPath = process.execPath } = {}) {
  const child = spawn(execPath, ["--apply-update", stageRoot, targetRoot, String(parentPid)], {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  child.unref();
  return { pid: child.pid };
}

module.exports = {
  UPDATE_FORMAT,
  applyStagedUpdate,
  checkLocalUpdate,
  compareVersions,
  safeRelativePath,
  spawnUpdateApplier,
  stageLocalUpdate,
};
