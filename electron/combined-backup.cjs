const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const FORMAT = "olt-manager/combined-backup/v1";
const VERSION = 1;
const FILE_NAMES = ["database.sqlite", "feishu-state.enc", "feishu-state-key.json", "feishu-credentials.json"];

function digest(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function cloneBytes(value) {
  return Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(value || []);
}

function encodeFile(bytes) {
  const value = cloneBytes(bytes);
  return { size: value.length, sha256: digest(value), data: value.toString("base64") };
}

function parseArchive(bytes) {
  let archive;
  try {
    archive = JSON.parse(cloneBytes(bytes).toString("utf8"));
  } catch {
    throw new Error("组合备份不是有效 JSON 文件。");
  }
  if (archive?.format !== FORMAT || archive.version !== VERSION ||
      !archive.manifest || typeof archive.files !== "object" || Array.isArray(archive.files)) {
    throw new Error("组合备份格式或版本不兼容。");
  }
  const names = Object.keys(archive.files);
  if (!names.includes("database.sqlite") || names.some((name) => !FILE_NAMES.includes(name))) {
    throw new Error("组合备份缺少主 SQLite 或包含未知文件。");
  }
  const files = {};
  for (const name of names) {
    const entry = archive.files[name];
    if (!entry || typeof entry.data !== "string" || !archive.manifest[name]) {
      throw new Error(`组合备份 manifest 缺少 ${name}。`);
    }
    const bytesForFile = Buffer.from(entry.data, "base64");
    const manifest = archive.manifest[name];
    if (manifest.size !== bytesForFile.length || manifest.sha256 !== digest(bytesForFile)) {
      throw new Error(`组合备份文件校验失败：${name}。`);
    }
    files[name] = bytesForFile;
  }
  return { archive, files };
}

async function readOptional(directory, name) {
  try {
    return await fs.readFile(path.join(directory, name));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeAtomic(filePath, bytes) {
  const temporary = `${filePath}.combined-tmp-${process.pid}`;
  await fs.writeFile(temporary, bytes, { mode: 0o600 });
  await fs.rename(temporary, filePath);
}

function createCombinedBackupService({
  dataDirectory,
  feishuDataDirectory,
  safeStorage,
  exportDatabaseBackup,
  validateDatabaseBackup,
  restoreDatabaseBackup,
  createStateStore,
  createCredentialStore
}) {
  if (!dataDirectory || !feishuDataDirectory || typeof exportDatabaseBackup !== "function" ||
      typeof validateDatabaseBackup !== "function" || typeof restoreDatabaseBackup !== "function") {
    throw new TypeError("Combined backup service is incompletely configured.");
  }

  async function exportBackup() {
    const files = { database: encodeFile(await exportDatabaseBackup()) };
    for (const name of FILE_NAMES.slice(1)) {
      const value = await readOptional(feishuDataDirectory, name);
      if (value) files[name] = encodeFile(value);
    }
    const manifest = {};
    const archiveFiles = {};
    for (const [name, entry] of Object.entries(files)) {
      const archiveName = name === "database" ? "database.sqlite" : name;
      manifest[archiveName] = { size: entry.size, sha256: entry.sha256 };
      archiveFiles[archiveName] = entry;
    }
    return Buffer.from(JSON.stringify({
      format: FORMAT,
      version: VERSION,
      createdAt: new Date().toISOString(),
      manifest,
      files: archiveFiles
    }), "utf8");
  }

  async function validateFeishuFiles(files) {
    if (!files["feishu-state.enc"]) {
      return { warnings: ["备份不包含 Feishu 状态，恢复后 Feishu 子系统不可用。"] };
    }
    if (!files["feishu-state-key.json"]) throw new Error("Feishu 状态缺少加密密钥封装。");
    const staging = await fs.mkdtemp(path.join(feishuDataDirectory, ".combined-validate-"));
    try {
      for (const name of FILE_NAMES.slice(1)) {
        if (files[name]) await fs.writeFile(path.join(staging, name), files[name], { mode: 0o600 });
      }
      const stateStore = createStateStore({ dataDirectory: staging, safeStorage });
      const state = await stateStore.read();
      const references = [state?.app?.credentialReference, state?.language?.credentialReference]
        .filter(Boolean);
      if (references.length) {
        if (!files["feishu-credentials.json"]) throw new Error("Feishu 状态引用了凭据，但备份缺少加密凭据封装。");
        const credentialStore = createCredentialStore({ dataDirectory: staging, safeStorage });
        for (const reference of references) await credentialStore.readSecret(reference);
      }
      return { warnings: [] };
    } finally {
      await fs.rm(staging, { recursive: true, force: true });
    }
  }

  async function restoreBackup(bytes, { confirmed = false } = {}) {
    if (confirmed !== true) throw new Error("还原组合备份必须先完成人工确认。");
    const { files } = parseArchive(bytes);
    await validateDatabaseBackup(files["database.sqlite"]);
    const feishuResult = await validateFeishuFiles(files);
    const previous = {};
    for (const name of FILE_NAMES.slice(1)) previous[name] = await readOptional(feishuDataDirectory, name);
    await fs.mkdir(feishuDataDirectory, { recursive: true });
    try {
      for (const name of FILE_NAMES.slice(1)) {
        const target = path.join(feishuDataDirectory, name);
        if (files[name]) await writeAtomic(target, files[name]);
        else await fs.rm(target, { force: true });
      }
      await restoreDatabaseBackup(files["database.sqlite"]);
    } catch (error) {
      for (const name of FILE_NAMES.slice(1)) {
        const target = path.join(feishuDataDirectory, name);
        if (previous[name]) await writeAtomic(target, previous[name]);
        else await fs.rm(target, { force: true });
      }
      throw error;
    }
    return { ok: true, warnings: feishuResult.warnings };
  }

  return Object.freeze({ exportBackup, restoreBackup, inspectBackup: (bytes) => parseArchive(bytes) });
}

module.exports = { FORMAT, VERSION, createCombinedBackupService };
