// 数据库备份、校验与还原。
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { executeBackupCleanup, planBackupCleanup } from "../backup-runtime.mjs";
import { closeDatabase, dataDir, dbPath, queueDatabaseTask, runSqlImmediate, sqlQuote } from "./core.mjs";
import { ensureBaseSchema, runSchemaMigrations } from "./schema.mjs";

export async function exportDatabaseBackup() {
  return queueDatabaseTask(async () => {
    const backupPath = `${dbPath}.backup-${process.pid}-${Date.now()}.sqlite`;
    await rm(backupPath, { force: true });
    await runSqlImmediate(`VACUUM INTO ${sqlQuote(backupPath)};`);
    try {
      return await readFile(backupPath);
    } finally {
      await rm(backupPath, { force: true });
    }
  });
}

function backupReasonSlug(reason) {
  const slug = String(reason || "sync")
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "sync";
}

function backupTimestamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\./g, "");
}

export async function createDatabaseBackup(options = {}) {
  const reason = typeof options === "string" ? options : options?.reason || "sync";
  return queueDatabaseTask(async () => {
    await mkdir(join(dataDir, "backups"), { recursive: true });
    const backupPath = join(
      dataDir,
      "backups",
      `olt-manager-${backupReasonSlug(reason)}-${backupTimestamp()}-${process.pid}.sqlite`
    );
    await rm(backupPath, { force: true });
    try {
      await runSqlImmediate(`VACUUM INTO ${sqlQuote(backupPath)};`);
      const integrity = await runSqlImmediate("PRAGMA integrity_check;", { databasePath: backupPath });
      if (integrity.trim() !== "ok") throw new Error("同步前数据库备份完整性校验失败。");
      const bytes = await readFile(backupPath);
      return {
        path: backupPath,
        bytes: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex")
      };
    } catch (error) {
      await rm(backupPath, { force: true });
      throw error;
    }
  });
}

export async function backupDatabaseBeforeSync(options = {}) {
  return createDatabaseBackup(options);
}

export async function planDatabaseBackupCleanup(options = {}) {
  const { policy, now } = options && typeof options === "object" ? options : {};
  return planBackupCleanup({ backupsRoot: join(dataDir, "backups"), policy, now });
}

export async function executeDatabaseBackupCleanup({ plan, confirmed = false } = {}) {
  return executeBackupCleanup({ backupsRoot: join(dataDir, "backups"), plan, confirmed });
}

export async function validateDatabaseBackup(bytes) {
  return queueDatabaseTask(async () => {
    const validationPath = `${dbPath}.validate-${process.pid}-${Date.now()}.sqlite`;
    await writeFile(validationPath, bytes, { flag: "wx" });
    try {
      const integrity = await runSqlImmediate("PRAGMA integrity_check;", { databasePath: validationPath });
      if (integrity.trim() !== "ok") throw new Error("备份文件完整性校验失败。");
      const tables = await runSqlImmediate("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('olts', 'pon_ports');", { json: true, databasePath: validationPath });
      if (!JSON.parse(tables || "[]").some((table) => table.name === "olts")) {
        throw new Error("备份文件不是 OLT Manager 项目数据。");
      }
    } finally {
      await rm(validationPath, { force: true });
    }
  });
}

export async function restoreDatabaseBackup(bytes) {
  return queueDatabaseTask(async () => {
    const restorePath = `${dbPath}.restore-${process.pid}-${Date.now()}.sqlite`;
    const previousPath = `${dbPath}.restore-previous`;
    await writeFile(restorePath, bytes, { flag: "wx" });
    try {
      const integrity = await runSqlImmediate("PRAGMA integrity_check;", { databasePath: restorePath });
      if (integrity.trim() !== "ok") throw new Error("备份文件完整性校验失败。");
      const tables = await runSqlImmediate("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('olts', 'pon_ports');", { json: true, databasePath: restorePath });
      if (!tables || !JSON.parse(tables).some((table) => table.name === "olts")) throw new Error("备份文件不是 OLT Manager 项目数据。");
      await runSqlImmediate("PRAGMA wal_checkpoint(TRUNCATE);");
      // 主库连接常驻进程内，替换文件前必须关闭，否则 Windows 无法重命名、
      // 其他平台会继续写入已被移走的旧文件。
      closeDatabase();
      await Promise.all([rm(`${dbPath}-wal`, { force: true }), rm(`${dbPath}-shm`, { force: true }), rm(previousPath, { force: true })]);
      await rename(dbPath, previousPath);
      try {
        await rename(restorePath, dbPath);
        await ensureBaseSchema(dbPath);
        await runSchemaMigrations(dbPath, { restore: true });
      } catch (error) {
        closeDatabase();
        await rename(previousPath, dbPath);
        throw error;
      }
      await rm(previousPath, { force: true });
    } finally {
      await rm(restorePath, { force: true });
    }
  });
}
