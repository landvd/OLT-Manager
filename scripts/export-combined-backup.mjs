import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createCombinedBackupService, FORMAT, VERSION } = require("../electron/combined-backup.cjs");
const { validateDatabaseBackup } = await import("../src/db.mjs");

function digest(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function encodeFile(bytes) {
  const value = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return { size: value.length, sha256: digest(value), data: value.toString("base64") };
}

async function main() {
  const workspaceRoot = path.resolve(".");
  const dbPath = path.join(workspaceRoot, "data", "olt-manager.sqlite");
  const feishuDir = path.join(os.homedir(), "Library", "Application Support", "olt-manager");
  const outputDir = path.join(workspaceRoot, "release");

  console.log("正在读取数据库:", dbPath);
  const sqliteBytes = await fs.readFile(dbPath);
  console.log(`SQLite 数据库大小: ${(sqliteBytes.length / (1024 * 1024)).toFixed(2)} MB`);

  console.log("正在验证 SQLite 数据库完整性...");
  await validateDatabaseBackup(sqliteBytes);
  console.log("SQLite 数据库完整性与表结构校验通过。");

  const files = {
    "database.sqlite": encodeFile(sqliteBytes)
  };

  const feishuFiles = ["feishu-state.enc", "feishu-state-key.json", "feishu-credentials.json"];
  for (const name of feishuFiles) {
    const filePath = path.join(feishuDir, name);
    try {
      const content = await fs.readFile(filePath);
      files[name] = encodeFile(content);
      console.log(`已打包飞书文件: ${name} (${content.length} 字节)`);
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
      console.log(`飞书文件不存在，跳过: ${name}`);
    }
  }

  const piAgentConfigPath = path.join(workspaceRoot, "data", "pi-agent-config.json");
  try {
    const content = await fs.readFile(piAgentConfigPath);
    files["pi-agent-config.json"] = encodeFile(content);
    console.log(`已打包 Pi Agent 配置文件: pi-agent-config.json (${content.length} 字节)`);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    console.log("Pi Agent 配置文件不存在，跳过: pi-agent-config.json");
  }

  const manifest = {};
  for (const [name, entry] of Object.entries(files)) {
    manifest[name] = { size: entry.size, sha256: entry.sha256 };
  }

  const archiveData = {
    format: FORMAT,
    version: VERSION,
    platform: process.platform,
    createdAt: new Date().toISOString(),
    manifest,
    files
  };

  const combinedBytes = Buffer.from(JSON.stringify(archiveData, null, 2), "utf8");

  await fs.mkdir(outputDir, { recursive: true });

  const dateStr = new Date().toISOString().slice(0, 10);
  const combinedOutPath = path.join(outputDir, `olt-manager-combined-backup-${dateStr}.oltbackup.json`);
  const sqliteOutPath = path.join(outputDir, `olt-manager-backup-${dateStr}.sqlite`);

  await fs.writeFile(combinedOutPath, combinedBytes);
  console.log(`已生成组合备份: ${combinedOutPath} (${(combinedBytes.length / (1024 * 1024)).toFixed(2)} MB)`);

  await fs.writeFile(sqliteOutPath, sqliteBytes);
  console.log(`已生成独立 SQLite 备份: ${sqliteOutPath} (${(sqliteBytes.length / (1024 * 1024)).toFixed(2)} MB)`);

  // 自检
  console.log("正在验证导出的组合备份...");
  const dummyService = createCombinedBackupService({
    dataDirectory: path.join(outputDir),
    feishuDataDirectory: path.join(outputDir),
    safeStorage: {},
    exportDatabaseBackup: async () => sqliteBytes,
    validateDatabaseBackup: async () => {},
    restoreDatabaseBackup: async () => {}
  });

  const inspected = dummyService.inspectBackup(combinedBytes);
  console.log("组合备份 inspect 校验成功，包含文件:", Object.keys(inspected.files));
  console.log("manifest 校验完全一致！");
}

main().catch((err) => {
  console.error("导出备份失败:", err);
  process.exit(1);
});
