import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { normalizeDeviceProfile } from "./device-profiles.mjs";
import { normalizePonCoordinate } from "./pon-coordinate.mjs";
import { dataRoot, missingToolMessage, resolveTool, seedRoot } from "./runtime-paths.mjs";

const dataDir = dataRoot;
const dbPath = join(dataDir, "olt-manager.sqlite");
const sqliteBin = resolveTool("sqlite3");
const allowedOltVendors = new Set(["zte", "huawei"]);
let sqlQueue = Promise.resolve();

function sqlQuote(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function runSqlImmediate(sql, { json = false, databasePath = dbPath } = {}) {
  return new Promise((resolve, reject) => {
    const args = ["-batch", "-cmd", ".timeout 10000"];
    if (json) args.push("-json");
    args.push(databasePath);
    const child = spawn(sqliteBin, args);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      if (error.code === "ENOENT") reject(new Error(missingToolMessage("sqlite3")));
      else reject(error);
    });
    child.on("close", (code) => {
      if (code !== 0) {
        const detail = [
          stderr || `sqlite3 exited with ${code}`,
          `sqlite3: ${sqliteBin}`,
          `args: ${args.join(" ")}`
        ].join("\n");
        reject(new Error(detail));
      }
      else resolve(stdout.trim());
    });
    child.stdin.end(sql);
  });
}

function runSql(sql, options = {}) {
  const task = sqlQueue.then(() => runSqlImmediate(sql, options));
  sqlQueue = task.catch(() => {});
  return task;
}

function queueDatabaseTask(task) {
  const queued = sqlQueue.then(task);
  sqlQueue = queued.catch(() => {});
  return queued;
}

async function query(sql) {
  const out = await runSql(sql, { json: true });
  return out ? JSON.parse(out) : [];
}

async function exec(sql) {
  await runSql(sql);
}

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
      await Promise.all([rm(`${dbPath}-wal`, { force: true }), rm(`${dbPath}-shm`, { force: true }), rm(previousPath, { force: true })]);
      await rename(dbPath, previousPath);
      try {
        await rename(restorePath, dbPath);
        await runSqlImmediate(`
CREATE TABLE IF NOT EXISTS resource_user_dataset_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO resource_user_dataset_state (id, revision, updated_at)
VALUES (1, lower(hex(randomblob(16))), CURRENT_TIMESTAMP)
ON CONFLICT(id) DO UPDATE SET revision = lower(hex(randomblob(16))), updated_at = CURRENT_TIMESTAMP;
CREATE TABLE IF NOT EXISTS resource_sync_tasks (
  id TEXT PRIMARY KEY,
  olt_id TEXT NOT NULL,
  run_at TEXT NOT NULL,
  repeat_days INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  result_count INTEGER NOT NULL DEFAULT 0,
  error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  completed_at TEXT,
  last_run_at TEXT,
  last_status TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_resource_sync_tasks_status_run_at
  ON resource_sync_tasks (status, run_at);
CREATE TABLE IF NOT EXISTS resource_olt_ip_mappings (
  resource_ip TEXT PRIMARY KEY,
  olt_ip TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL DEFAULT 'oss-ngb',
  synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS oss_resource_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  auth_base_url TEXT NOT NULL DEFAULT '',
  ngb_base_url TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL DEFAULT '',
  organization_name TEXT NOT NULL DEFAULT '',
  room_name TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS oss_resource_credential (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  format_version INTEGER NOT NULL DEFAULT 1,
  algorithm TEXT NOT NULL DEFAULT 'aes-256-gcm',
  kdf TEXT NOT NULL DEFAULT 'scrypt',
  kdf_n INTEGER NOT NULL DEFAULT 16384,
  kdf_r INTEGER NOT NULL DEFAULT 8,
  kdf_p INTEGER NOT NULL DEFAULT 1,
  salt TEXT NOT NULL,
  iv TEXT NOT NULL,
  auth_tag TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS merged_onu_snapshots (
  olt_ip TEXT NOT NULL,
  chassis TEXT NOT NULL,
  board TEXT NOT NULL,
  pon TEXT NOT NULL,
  onu_id TEXT NOT NULL,
  onu_index_display TEXT NOT NULL DEFAULT '',
  device_name TEXT NOT NULL DEFAULT '',
  device_number TEXT NOT NULL DEFAULT '',
  loid TEXT NOT NULL DEFAULT '',
  loid_display TEXT NOT NULL DEFAULT '',
  mac TEXT NOT NULL DEFAULT '',
  serial TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL DEFAULT '',
  username_source TEXT NOT NULL DEFAULT 'network',
  user_phone TEXT NOT NULL DEFAULT '',
  installation_address TEXT NOT NULL DEFAULT '',
  device_type TEXT NOT NULL DEFAULT '',
  pon_type TEXT NOT NULL DEFAULT '',
  phase TEXT NOT NULL DEFAULT '',
  rx_power TEXT NOT NULL DEFAULT '',
  distance TEXT NOT NULL DEFAULT '',
  nmse_olt_ip TEXT NOT NULL DEFAULT '',
  nmse_onu_index TEXT NOT NULL DEFAULT '',
  synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (olt_ip, chassis, board, pon, onu_id)
);
CREATE INDEX IF NOT EXISTS idx_merged_onu_snapshots_olt_pon
  ON merged_onu_snapshots (olt_ip, chassis, board, pon);
CREATE INDEX IF NOT EXISTS idx_merged_onu_snapshots_loid
  ON merged_onu_snapshots (loid);
CREATE TABLE IF NOT EXISTS merged_onu_sync_runs (
  id TEXT PRIMARY KEY,
  operation TEXT NOT NULL DEFAULT 'full',
  status TEXT NOT NULL,
  network_count INTEGER NOT NULL DEFAULT 0,
  nmse_count INTEGER NOT NULL DEFAULT 0,
  merged_count INTEGER NOT NULL DEFAULT 0,
  conflict_count INTEGER NOT NULL DEFAULT 0,
  backup_path TEXT NOT NULL DEFAULT '',
  backup_bytes INTEGER NOT NULL DEFAULT 0,
  backup_sha256 TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS merged_onu_conflicts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  olt_ip TEXT NOT NULL DEFAULT '',
  onu_index_display TEXT NOT NULL DEFAULT '',
  loid TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (run_id) REFERENCES merged_onu_sync_runs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_merged_onu_conflicts_run
  ON merged_onu_conflicts (run_id, id);
CREATE TABLE IF NOT EXISTS merged_onu_dataset_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO merged_onu_dataset_state (id, revision)
VALUES (1, lower(hex(randomblob(16))));
CREATE TABLE IF NOT EXISTS merged_onu_network_snapshots (
  olt_ip TEXT NOT NULL,
  chassis TEXT NOT NULL,
  board TEXT NOT NULL,
  pon TEXT NOT NULL,
  onu_id TEXT NOT NULL,
  onu_index_display TEXT NOT NULL DEFAULT '',
  device_name TEXT NOT NULL DEFAULT '',
  device_number TEXT NOT NULL DEFAULT '',
  loid TEXT NOT NULL DEFAULT '',
  loid_display TEXT NOT NULL DEFAULT '',
  mac TEXT NOT NULL DEFAULT '',
  serial TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL DEFAULT '',
  user_phone TEXT NOT NULL DEFAULT '',
  installation_address TEXT NOT NULL DEFAULT '',
  device_type TEXT NOT NULL DEFAULT '',
  pon_type TEXT NOT NULL DEFAULT '',
  phase TEXT NOT NULL DEFAULT '',
  rx_power TEXT NOT NULL DEFAULT '',
  distance TEXT NOT NULL DEFAULT '',
  synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (olt_ip, chassis, board, pon, onu_id)
);
CREATE INDEX IF NOT EXISTS idx_merged_onu_network_snapshots_olt_pon
  ON merged_onu_network_snapshots (olt_ip, chassis, board, pon);
CREATE TABLE IF NOT EXISTS merged_onu_nmse_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  olt_ip TEXT NOT NULL,
  onu_index_display TEXT NOT NULL DEFAULT '',
  loid TEXT NOT NULL DEFAULT '',
  loid_display TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL DEFAULT '',
  user_phone TEXT NOT NULL DEFAULT '',
  installation_address TEXT NOT NULL DEFAULT '',
  synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_merged_onu_nmse_snapshots_olt_loid
  ON merged_onu_nmse_snapshots (olt_ip, loid);
CREATE INDEX IF NOT EXISTS idx_merged_onu_nmse_snapshots_olt_index
  ON merged_onu_nmse_snapshots (olt_ip, onu_index_display);
CREATE TABLE IF NOT EXISTS merged_onu_source_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  network_revision TEXT NOT NULL DEFAULT '',
  network_count INTEGER NOT NULL DEFAULT 0,
  network_updated_at TEXT NOT NULL DEFAULT '',
  nmse_revision TEXT NOT NULL DEFAULT '',
  nmse_count INTEGER NOT NULL DEFAULT 0,
  nmse_updated_at TEXT NOT NULL DEFAULT ''
);
INSERT OR IGNORE INTO merged_onu_source_state (id) VALUES (1);
`);
        const mergedRunColumns = JSON.parse(await runSqlImmediate("PRAGMA table_info(merged_onu_sync_runs);", { json: true }) || "[]");
        if (!mergedRunColumns.some((column) => column.name === "operation")) {
          await runSqlImmediate("ALTER TABLE merged_onu_sync_runs ADD COLUMN operation TEXT NOT NULL DEFAULT 'full';");
        }
        for (const table of ["merged_onu_network_snapshots", "merged_onu_snapshots"]) {
          const columns = JSON.parse(await runSqlImmediate(`PRAGMA table_info(${table});`, { json: true }) || "[]");
          if (!columns.some((column) => column.name === "device_number")) {
            await runSqlImmediate(`ALTER TABLE ${table} ADD COLUMN device_number TEXT NOT NULL DEFAULT '';`);
          }
        }
        const mergedNmseColumns = JSON.parse(await runSqlImmediate("PRAGMA table_info(merged_onu_nmse_snapshots);", { json: true }) || "[]");
        if (!mergedNmseColumns.some((column) => column.name === "user_phone")) {
          await runSqlImmediate("ALTER TABLE merged_onu_nmse_snapshots ADD COLUMN user_phone TEXT NOT NULL DEFAULT '';");
        }
        if (!mergedNmseColumns.some((column) => column.name === "installation_address")) {
          await runSqlImmediate("ALTER TABLE merged_onu_nmse_snapshots ADD COLUMN installation_address TEXT NOT NULL DEFAULT '';");
        }
        const resourceTaskColumns = JSON.parse(await runSqlImmediate("PRAGMA table_info(resource_sync_tasks);", { json: true }) || "[]");
        const resourceTaskColumnNames = new Set(resourceTaskColumns.map((column) => column.name));
        const resourceTaskMigrations = [];
        if (!resourceTaskColumnNames.has("repeat_days")) resourceTaskMigrations.push("ALTER TABLE resource_sync_tasks ADD COLUMN repeat_days INTEGER NOT NULL DEFAULT 0;");
        if (!resourceTaskColumnNames.has("last_run_at")) resourceTaskMigrations.push("ALTER TABLE resource_sync_tasks ADD COLUMN last_run_at TEXT;");
        if (!resourceTaskColumnNames.has("last_status")) resourceTaskMigrations.push("ALTER TABLE resource_sync_tasks ADD COLUMN last_status TEXT NOT NULL DEFAULT '';");
        if (resourceTaskMigrations.length) await runSqlImmediate(resourceTaskMigrations.join("\n"));
      } catch (error) {
        await rename(previousPath, dbPath);
        throw error;
      }
      await rm(previousPath, { force: true });
    } finally {
      await rm(restorePath, { force: true });
    }
  });
}

export function oltInsertSql(olt) {
  const vendor = normalizeOltVendor(olt.vendor);
  const deviceProfile = normalizeDeviceProfile({ vendor, model: olt.model, deviceProfile: olt.deviceProfile || olt.device_profile });
  return `INSERT INTO olts (id, name, vendor, model, device_profile, version, host, snmp_port, read_community, telnet_port, telnet_username, telnet_password, enabled)
VALUES (${sqlQuote(olt.id)}, ${sqlQuote(olt.name)}, ${sqlQuote(vendor)}, ${sqlQuote(olt.model)}, ${sqlQuote(deviceProfile)}, ${sqlQuote(olt.version)}, ${sqlQuote(olt.host)}, ${Number(olt.snmpPort || olt.snmp_port || 161)}, ${sqlQuote(olt.readCommunity || olt.read_community || "")}, ${Number(olt.telnetPort || olt.telnet_port || 23)}, ${sqlQuote(olt.telnetUsername || olt.telnet_username || "")}, ${sqlQuote(olt.telnetPassword || olt.telnet_password || "")}, ${olt.enabled === false || olt.enabled === 0 ? 0 : 1});`;
}

export function normalizeOltVendor(vendor) {
  const clean = String(vendor || "").trim().toLowerCase();
  if (!allowedOltVendors.has(clean)) {
    throw new Error("OLT 厂商只能选择 zte 或 huawei。");
  }
  return clean;
}

function ponInsertSql(port, vendor = "") {
  const coordinate = normalizePonCoordinate(port, { vendor });
  return `INSERT INTO pon_ports (olt_ip, chassis, board, pon, pon_port, outer_vlan, address)
VALUES (${sqlQuote(port.oltIp || port.olt_ip)}, ${sqlQuote(coordinate.chassis)}, ${sqlQuote(coordinate.board)}, ${sqlQuote(coordinate.pon)}, ${sqlQuote(coordinate.ponPort)}, ${sqlQuote(port.outerVlan || port.outer_vlan || "")}, ${sqlQuote(port.address || "")});`;
}

async function readSeedJson(name) {
  const candidates = [name, name.replace(/\.json$/, ".example.json")];
  for (const candidate of candidates) {
    try {
      return JSON.parse(await readFile(join(dataDir, candidate), "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    try {
      return JSON.parse(await readFile(join(seedRoot, candidate), "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return [];
}

export function oltSchemaMigrationSql(columns = []) {
  const names = new Set(columns.map((column) => column.name));
  const statements = [];
  if (!names.has("telnet_port")) statements.push("ALTER TABLE olts ADD COLUMN telnet_port INTEGER NOT NULL DEFAULT 23;");
  if (!names.has("telnet_username")) statements.push("ALTER TABLE olts ADD COLUMN telnet_username TEXT NOT NULL DEFAULT '';");
  if (!names.has("telnet_password")) statements.push("ALTER TABLE olts ADD COLUMN telnet_password TEXT NOT NULL DEFAULT '';");
  if (!names.has("device_profile")) statements.push("ALTER TABLE olts ADD COLUMN device_profile TEXT NOT NULL DEFAULT '';");
  return statements.join("\n");
}

export function mapOltRow(row, { includeSecrets = false } = {}) {
  const mapped = {
    id: row.id,
    name: row.name,
    vendor: row.vendor,
    model: row.model,
    deviceProfile: row.device_profile || normalizeDeviceProfile({ vendor: row.vendor, model: row.model }),
    version: row.version,
    host: row.host,
    snmpPort: row.snmp_port,
    readCommunity: row.read_community,
    telnetPort: row.telnet_port || 23,
    telnetUsername: row.telnet_username || "",
    enabled: Boolean(row.enabled)
  };
  if (includeSecrets) mapped.telnetPassword = row.telnet_password || "";
  return mapped;
}

export async function initDb() {
  await mkdir(dirname(dbPath), { recursive: true });
  await exec(`
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS olts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  vendor TEXT NOT NULL,
  model TEXT NOT NULL,
  device_profile TEXT NOT NULL DEFAULT '',
  version TEXT NOT NULL,
  host TEXT NOT NULL UNIQUE,
  snmp_port INTEGER NOT NULL DEFAULT 161,
  read_community TEXT NOT NULL,
  telnet_port INTEGER NOT NULL DEFAULT 23,
  telnet_username TEXT NOT NULL DEFAULT '',
  telnet_password TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS pon_ports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  olt_ip TEXT NOT NULL,
  chassis TEXT NOT NULL DEFAULT '',
  board TEXT NOT NULL DEFAULT '',
  pon TEXT NOT NULL DEFAULT '',
  pon_port TEXT NOT NULL,
  outer_vlan TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS snmp_probe_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  olt_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  oid TEXT NOT NULL,
  ok INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  summary TEXT NOT NULL,
  raw_output TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS onu_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  olt_id TEXT NOT NULL,
  olt_ip TEXT NOT NULL,
  chassis TEXT NOT NULL,
  board TEXT NOT NULL,
  pon TEXT NOT NULL,
  onu_id TEXT NOT NULL,
  serial TEXT NOT NULL DEFAULT '',
  phase TEXT NOT NULL DEFAULT '',
  rx_power TEXT NOT NULL DEFAULT '',
  distance TEXT NOT NULL DEFAULT '',
  last_online_time TEXT NOT NULL DEFAULT '',
  last_offline_time TEXT NOT NULL DEFAULT '',
  last_offline_cause TEXT NOT NULL DEFAULT '',
  last_offline_cause_code INTEGER,
  sampled_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (olt_id, chassis, board, pon, onu_id, sampled_at)
);
CREATE INDEX IF NOT EXISTS idx_onu_status_history_identity_time
  ON onu_status_history (olt_id, chassis, board, pon, onu_id, sampled_at DESC);
CREATE TABLE IF NOT EXISTS admin_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  source TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS config_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  vendor TEXT NOT NULL,
  business_type TEXT NOT NULL,
  onu_type TEXT NOT NULL DEFAULT 'GPON-SFU',
  fixed_vlans_json TEXT NOT NULL DEFAULT '{}',
  dynamic_vlan_rules_json TEXT NOT NULL DEFAULT '{}',
  port_rules_json TEXT NOT NULL DEFAULT '{}',
  command_template_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  vlan INTEGER NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  contact_name TEXT NOT NULL DEFAULT '',
  contact_phone TEXT NOT NULL DEFAULT '',
  contact_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS project_onus (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  olt_id TEXT NOT NULL,
  chassis TEXT NOT NULL,
  board TEXT NOT NULL,
  pon TEXT NOT NULL,
  onu_id TEXT NOT NULL,
  serial TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  vlan TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (olt_id, chassis, board, pon, onu_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS resource_management_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  server_url TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL DEFAULT '',
  password TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS resource_olt_ip_mappings (
  resource_ip TEXT PRIMARY KEY,
  olt_ip TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL DEFAULT 'oss-ngb',
  synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS oss_resource_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  auth_base_url TEXT NOT NULL DEFAULT '',
  ngb_base_url TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL DEFAULT '',
  organization_name TEXT NOT NULL DEFAULT '',
  room_name TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS oss_resource_credential (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  format_version INTEGER NOT NULL DEFAULT 1,
  algorithm TEXT NOT NULL DEFAULT 'aes-256-gcm',
  kdf TEXT NOT NULL DEFAULT 'scrypt',
  kdf_n INTEGER NOT NULL DEFAULT 16384,
  kdf_r INTEGER NOT NULL DEFAULT 8,
  kdf_p INTEGER NOT NULL DEFAULT 1,
  salt TEXT NOT NULL,
  iv TEXT NOT NULL,
  auth_tag TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS resource_sync_tasks (
  id TEXT PRIMARY KEY,
  olt_id TEXT NOT NULL,
  run_at TEXT NOT NULL,
  repeat_days INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  result_count INTEGER NOT NULL DEFAULT 0,
  error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  completed_at TEXT,
  last_run_at TEXT,
  last_status TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_resource_sync_tasks_status_run_at
  ON resource_sync_tasks (status, run_at);
CREATE TABLE IF NOT EXISTS resource_user_snapshots (
  olt_ip TEXT NOT NULL,
  grid_rank TEXT NOT NULL,
  onu_index TEXT NOT NULL,
  loid TEXT NOT NULL DEFAULT '',
  mac TEXT NOT NULL DEFAULT '',
  pon TEXT NOT NULL DEFAULT '',
  pon_type TEXT NOT NULL DEFAULT '',
  device_type TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL DEFAULT '',
  user_phone TEXT NOT NULL DEFAULT '',
  installation_address TEXT NOT NULL DEFAULT '',
  synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (olt_ip, onu_index)
);
CREATE TABLE IF NOT EXISTS resource_user_dataset_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO resource_user_dataset_state (id, revision)
VALUES (1, lower(hex(randomblob(16))));
CREATE TABLE IF NOT EXISTS resource_user_checkpoints (
  olt_ip TEXT NOT NULL,
  grid_rank TEXT NOT NULL,
  expected_total INTEGER NOT NULL DEFAULT 0,
  completed_pages INTEGER NOT NULL DEFAULT 0,
  onu_index TEXT NOT NULL,
  loid TEXT NOT NULL DEFAULT '',
  mac TEXT NOT NULL DEFAULT '',
  pon TEXT NOT NULL DEFAULT '',
  pon_type TEXT NOT NULL DEFAULT '',
  device_type TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL DEFAULT '',
  user_phone TEXT NOT NULL DEFAULT '',
  installation_address TEXT NOT NULL DEFAULT '',
  checkpointed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (olt_ip, onu_index)
);
CREATE TABLE IF NOT EXISTS resource_pon_vlan_snapshots (
  olt_ip TEXT NOT NULL,
  grid_rank TEXT NOT NULL,
  board TEXT NOT NULL,
  pon TEXT NOT NULL,
  svlan TEXT NOT NULL,
  previous_outer_vlan TEXT NOT NULL DEFAULT '',
  synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (olt_ip, board, pon)
);
CREATE TABLE IF NOT EXISTS resource_olt_vlan_snapshots (
  olt_ip TEXT PRIMARY KEY,
  grid_rank TEXT NOT NULL,
  begin_cvlan TEXT NOT NULL DEFAULT '',
  end_cvlan TEXT NOT NULL DEFAULT '',
  distribution_type TEXT NOT NULL DEFAULT '',
  synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS merged_onu_snapshots (
  olt_ip TEXT NOT NULL,
  chassis TEXT NOT NULL,
  board TEXT NOT NULL,
  pon TEXT NOT NULL,
  onu_id TEXT NOT NULL,
  onu_index_display TEXT NOT NULL DEFAULT '',
  device_name TEXT NOT NULL DEFAULT '',
  device_number TEXT NOT NULL DEFAULT '',
  loid TEXT NOT NULL DEFAULT '',
  loid_display TEXT NOT NULL DEFAULT '',
  mac TEXT NOT NULL DEFAULT '',
  serial TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL DEFAULT '',
  username_source TEXT NOT NULL DEFAULT 'network',
  user_phone TEXT NOT NULL DEFAULT '',
  installation_address TEXT NOT NULL DEFAULT '',
  device_type TEXT NOT NULL DEFAULT '',
  pon_type TEXT NOT NULL DEFAULT '',
  phase TEXT NOT NULL DEFAULT '',
  rx_power TEXT NOT NULL DEFAULT '',
  distance TEXT NOT NULL DEFAULT '',
  nmse_olt_ip TEXT NOT NULL DEFAULT '',
  nmse_onu_index TEXT NOT NULL DEFAULT '',
  synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (olt_ip, chassis, board, pon, onu_id)
);
CREATE INDEX IF NOT EXISTS idx_merged_onu_snapshots_olt_pon
  ON merged_onu_snapshots (olt_ip, chassis, board, pon);
CREATE INDEX IF NOT EXISTS idx_merged_onu_snapshots_loid
  ON merged_onu_snapshots (loid);
CREATE TABLE IF NOT EXISTS merged_onu_sync_runs (
  id TEXT PRIMARY KEY,
  operation TEXT NOT NULL DEFAULT 'full',
  status TEXT NOT NULL,
  network_count INTEGER NOT NULL DEFAULT 0,
  nmse_count INTEGER NOT NULL DEFAULT 0,
  merged_count INTEGER NOT NULL DEFAULT 0,
  conflict_count INTEGER NOT NULL DEFAULT 0,
  backup_path TEXT NOT NULL DEFAULT '',
  backup_bytes INTEGER NOT NULL DEFAULT 0,
  backup_sha256 TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS merged_onu_conflicts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  olt_ip TEXT NOT NULL DEFAULT '',
  onu_index_display TEXT NOT NULL DEFAULT '',
  loid TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (run_id) REFERENCES merged_onu_sync_runs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_merged_onu_conflicts_run
  ON merged_onu_conflicts (run_id, id);
CREATE TABLE IF NOT EXISTS merged_onu_dataset_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO merged_onu_dataset_state (id, revision)
VALUES (1, lower(hex(randomblob(16))));
DROP TABLE IF EXISTS oid_entries;
DROP TABLE IF EXISTS oid_profiles;
CREATE TABLE IF NOT EXISTS merged_onu_network_snapshots (
  olt_ip TEXT NOT NULL,
  chassis TEXT NOT NULL,
  board TEXT NOT NULL,
  pon TEXT NOT NULL,
  onu_id TEXT NOT NULL,
  onu_index_display TEXT NOT NULL DEFAULT '',
  device_name TEXT NOT NULL DEFAULT '',
  device_number TEXT NOT NULL DEFAULT '',
  loid TEXT NOT NULL DEFAULT '',
  loid_display TEXT NOT NULL DEFAULT '',
  mac TEXT NOT NULL DEFAULT '',
  serial TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL DEFAULT '',
  user_phone TEXT NOT NULL DEFAULT '',
  installation_address TEXT NOT NULL DEFAULT '',
  device_type TEXT NOT NULL DEFAULT '',
  pon_type TEXT NOT NULL DEFAULT '',
  phase TEXT NOT NULL DEFAULT '',
  rx_power TEXT NOT NULL DEFAULT '',
  distance TEXT NOT NULL DEFAULT '',
  synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (olt_ip, chassis, board, pon, onu_id)
);
CREATE INDEX IF NOT EXISTS idx_merged_onu_network_snapshots_olt_pon
  ON merged_onu_network_snapshots (olt_ip, chassis, board, pon);
CREATE TABLE IF NOT EXISTS merged_onu_nmse_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  olt_ip TEXT NOT NULL,
  onu_index_display TEXT NOT NULL DEFAULT '',
  loid TEXT NOT NULL DEFAULT '',
  loid_display TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL DEFAULT '',
  user_phone TEXT NOT NULL DEFAULT '',
  installation_address TEXT NOT NULL DEFAULT '',
  synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_merged_onu_nmse_snapshots_olt_loid
  ON merged_onu_nmse_snapshots (olt_ip, loid);
CREATE INDEX IF NOT EXISTS idx_merged_onu_nmse_snapshots_olt_index
  ON merged_onu_nmse_snapshots (olt_ip, onu_index_display);
CREATE TABLE IF NOT EXISTS merged_onu_source_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  network_revision TEXT NOT NULL DEFAULT '',
  network_count INTEGER NOT NULL DEFAULT 0,
  network_updated_at TEXT NOT NULL DEFAULT '',
  nmse_revision TEXT NOT NULL DEFAULT '',
  nmse_count INTEGER NOT NULL DEFAULT 0,
  nmse_updated_at TEXT NOT NULL DEFAULT ''
);
INSERT OR IGNORE INTO merged_onu_source_state (id) VALUES (1);
`);
  const mergedRunColumns = await query("PRAGMA table_info(merged_onu_sync_runs);");
  if (!mergedRunColumns.some((column) => column.name === "operation")) {
    await exec("ALTER TABLE merged_onu_sync_runs ADD COLUMN operation TEXT NOT NULL DEFAULT 'full';");
  }
  for (const table of ["merged_onu_network_snapshots", "merged_onu_snapshots"]) {
    const columns = await query(`PRAGMA table_info(${table});`);
    if (!columns.some((column) => column.name === "device_number")) {
      await exec(`ALTER TABLE ${table} ADD COLUMN device_number TEXT NOT NULL DEFAULT '';`);
    }
  }
  const mergedNmseColumns = await query("PRAGMA table_info(merged_onu_nmse_snapshots);");
  if (!mergedNmseColumns.some((column) => column.name === "user_phone")) {
    await exec("ALTER TABLE merged_onu_nmse_snapshots ADD COLUMN user_phone TEXT NOT NULL DEFAULT '';" );
  }
  if (!mergedNmseColumns.some((column) => column.name === "installation_address")) {
    await exec("ALTER TABLE merged_onu_nmse_snapshots ADD COLUMN installation_address TEXT NOT NULL DEFAULT '';" );
  }
  const oltColumns = await query("PRAGMA table_info(olts);");
  const oltMigration = oltSchemaMigrationSql(oltColumns);
  if (oltMigration) await exec(oltMigration);

  const ponColumns = await query("PRAGMA table_info(pon_ports);");
  const ponColumnNames = new Set(ponColumns.map((column) => column.name));
  const ponMigrations = [];
  if (!ponColumnNames.has("chassis")) ponMigrations.push("ALTER TABLE pon_ports ADD COLUMN chassis TEXT NOT NULL DEFAULT '';");
  if (!ponColumnNames.has("board")) ponMigrations.push("ALTER TABLE pon_ports ADD COLUMN board TEXT NOT NULL DEFAULT '';");
  if (!ponColumnNames.has("pon")) ponMigrations.push("ALTER TABLE pon_ports ADD COLUMN pon TEXT NOT NULL DEFAULT '';");
  if (!ponColumns.some((column) => column.name === "outer_vlan")) {
    ponMigrations.push("ALTER TABLE pon_ports ADD COLUMN outer_vlan TEXT NOT NULL DEFAULT '';");
  }
  if (ponMigrations.length) await exec(ponMigrations.join("\n"));
  const resourceTaskColumns = await query("PRAGMA table_info(resource_sync_tasks);");
  const resourceTaskColumnNames = new Set(resourceTaskColumns.map((column) => column.name));
  const resourceTaskMigrations = [];
  if (!resourceTaskColumnNames.has("repeat_days")) resourceTaskMigrations.push("ALTER TABLE resource_sync_tasks ADD COLUMN repeat_days INTEGER NOT NULL DEFAULT 0;");
  if (!resourceTaskColumnNames.has("last_run_at")) resourceTaskMigrations.push("ALTER TABLE resource_sync_tasks ADD COLUMN last_run_at TEXT;");
  if (!resourceTaskColumnNames.has("last_status")) resourceTaskMigrations.push("ALTER TABLE resource_sync_tasks ADD COLUMN last_status TEXT NOT NULL DEFAULT '';" );
  if (resourceTaskMigrations.length) await exec(resourceTaskMigrations.join("\n"));
  await migrateOfflineCauseLabels();
  await migratePonCoordinates();

  const [{ count: oltCount }] = await query("SELECT count(*) AS count FROM olts;");
  if (oltCount === 0) {
    const olts = await readSeedJson("olts.json");
    await replaceOlts(olts, "migration");
  }

  const [{ count: ponCount }] = await query("SELECT count(*) AS count FROM pon_ports;");
  if (ponCount === 0) {
    const ports = await readSeedJson("pon-ports.json");
    await replacePonPorts(ports, "migration");
  }
}

async function migrateOfflineCauseLabels() {
  await exec(`
UPDATE onu_status_history
SET last_offline_cause = CASE last_offline_cause_code
  WHEN 1 THEN 'Unknown'
  WHEN 2 THEN 'DyingGasp'
  WHEN 3 THEN 'LOS'
  WHEN 4 THEN 'LOF'
  WHEN 8 THEN 'Deactive'
  WHEN 9 THEN 'Reboot'
  WHEN 10 THEN 'PEE'
  ELSE last_offline_cause
END
WHERE last_offline_cause_code IN (1, 2, 3, 4, 8, 9, 10);
`);
}

export async function getOlts(options = {}) {
  const rows = await query("SELECT * FROM olts;");
  return rows.map((row) => mapOltRow(row, options)).sort((a, b) => ipNumber(a.host) - ipNumber(b.host));
}

function ipNumber(host) {
  return host.split(".").reduce((sum, part) => (sum * 256) + Number(part || 0), 0);
}

async function migratePonCoordinates() {
  const rows = await query("SELECT id, olt_ip, chassis, board, pon, pon_port FROM pon_ports;");
  if (!rows.length) return;
  const olts = await getOlts();
  const vendorByHost = new Map(olts.map((olt) => [olt.host, olt.vendor]));
  const updates = [];
  for (const row of rows) {
    const coordinate = normalizePonCoordinate({
      chassis: row.chassis,
      board: row.board,
      pon: row.pon,
      ponPort: row.pon_port
    }, { vendor: vendorByHost.get(row.olt_ip) });
    if (!coordinate.chassis || !coordinate.board || !coordinate.pon) continue;
    if (
      row.chassis === coordinate.chassis &&
      row.board === coordinate.board &&
      row.pon === coordinate.pon &&
      row.pon_port === coordinate.ponPort
    ) {
      continue;
    }
    updates.push(`UPDATE pon_ports
SET chassis = ${sqlQuote(coordinate.chassis)},
    board = ${sqlQuote(coordinate.board)},
    pon = ${sqlQuote(coordinate.pon)},
    pon_port = ${sqlQuote(coordinate.ponPort)}
WHERE id = ${Number(row.id)};`);
  }
  if (updates.length) await exec(updates.join("\n"));
}

export async function replaceOlts(olts, source = "admin") {
  await exec(`BEGIN;
DELETE FROM olts;
${olts.map(oltInsertSql).join("\n")}
INSERT INTO admin_events (action, source, detail) VALUES ('save_olts', ${sqlQuote(source)}, ${sqlQuote(`${olts.length} rows`)});
COMMIT;`);
}

export async function getPonPorts() {
  const rows = await query("SELECT id, olt_ip, chassis, board, pon, pon_port, outer_vlan, address FROM pon_ports ORDER BY olt_ip, chassis, board, pon, id;");
  return rows.map((row) => ({
    id: row.id,
    oltIp: row.olt_ip,
    chassis: row.chassis,
    board: row.board,
    slot: row.board,
    pon: row.pon,
    ponPort: row.pon_port,
    outerVlan: row.outer_vlan,
    address: row.address
  }));
}

export async function replacePonPorts(ports, source = "admin") {
  const olts = await getOlts();
  const vendorByHost = new Map(olts.map((olt) => [olt.host, olt.vendor]));
  await exec(`BEGIN;
DELETE FROM pon_ports;
DELETE FROM sqlite_sequence WHERE name='pon_ports';
${ports.map((port) => ponInsertSql(port, vendorByHost.get(port.oltIp || port.olt_ip))).join("\n")}
INSERT INTO admin_events (action, source, detail) VALUES ('import_pon_ports', ${sqlQuote(source)}, ${sqlQuote(`${ports.length} rows`)});
COMMIT;`);
}

export async function updatePonPortVlans(updates, source = "snmp") {
  if (!updates.length) return;
  await exec(`BEGIN;
${updates.map((row) => `UPDATE pon_ports
SET outer_vlan = ${sqlQuote(row.outerVlan || "")}
WHERE olt_ip = ${sqlQuote(row.oltIp)} AND pon_port = ${sqlQuote(row.ponPort)};`).join("\n")}
INSERT INTO admin_events (action, source, detail) VALUES ('refresh_pon_vlans', ${sqlQuote(source)}, ${sqlQuote(`${updates.length} rows`)});
COMMIT;`);
}

export async function getResourceManagementConfig({ includeSecret = false } = {}) {
  const rows = await query("SELECT server_url, username, password, updated_at FROM resource_management_config WHERE id = 1;");
  const row = rows[0] || {};
  const result = { serverUrl: row.server_url || "", username: row.username || "", configured: Boolean(row.server_url && row.username && row.password), updatedAt: row.updated_at || "" };
  if (includeSecret) result.password = row.password || "";
  return result;
}

export async function saveResourceManagementConfig(input = {}) {
  const serverUrl = String(input.serverUrl || "").trim().replace(/\/$/, "");
  const username = String(input.username || "").trim();
  const existing = await getResourceManagementConfig({ includeSecret: true });
  const password = String(input.password || existing.password || "");
  if (!serverUrl || !username || !password) {
    const error = new Error("资源管理服务器地址、用户名和密码不能为空。");
    error.status = 400;
    throw error;
  }
  await exec(`INSERT INTO resource_management_config (id, server_url, username, password, updated_at)
VALUES (1, ${sqlQuote(serverUrl)}, ${sqlQuote(username)}, ${sqlQuote(password)}, CURRENT_TIMESTAMP)
ON CONFLICT(id) DO UPDATE SET server_url = excluded.server_url, username = excluded.username, password = excluded.password, updated_at = CURRENT_TIMESTAMP;
INSERT INTO admin_events (action, source, detail) VALUES ('save_resource_management_config', 'admin', 'configured');`);
  return getResourceManagementConfig();
}

function normalizeLocalBaseUrl(value, label) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    const error = new Error(`${label}无效。`);
    error.status = 400;
    throw error;
  }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    const error = new Error(`${label}必须是 http 或 https 基地址。`);
    error.status = 400;
    throw error;
  }
  return url.toString().replace(/\/$/, "");
}

export async function getOssResourceConfig() {
  const rows = await query(`SELECT auth_base_url, ngb_base_url, username, organization_name, room_name, updated_at
FROM oss_resource_config WHERE id = 1;`);
  const credentialRows = await query(`SELECT 1 AS configured FROM oss_resource_credential WHERE id = 1 AND ciphertext <> '' LIMIT 1;`);
  const row = rows[0] || {};
  return {
    authBaseUrl: row.auth_base_url || "",
    ngbBaseUrl: row.ngb_base_url || "",
    username: row.username || "",
    organizationName: row.organization_name || "",
    roomName: row.room_name || "",
    configured: Boolean(row.auth_base_url && row.ngb_base_url && row.username && row.organization_name && row.room_name),
    credentialConfigured: Boolean(credentialRows.length),
    updatedAt: row.updated_at || ""
  };
}

export async function getOssResourceCredential() {
  const rows = await query(`SELECT format_version, algorithm, kdf, kdf_n, kdf_r, kdf_p, salt, iv, auth_tag, ciphertext
FROM oss_resource_credential WHERE id = 1 LIMIT 1;`);
  const row = rows[0];
  if (!row) return null;
  return {
    version: Number(row.format_version),
    algorithm: row.algorithm,
    kdf: row.kdf,
    kdfN: Number(row.kdf_n),
    kdfR: Number(row.kdf_r),
    kdfP: Number(row.kdf_p),
    salt: row.salt,
    iv: row.iv,
    authTag: row.auth_tag,
    ciphertext: row.ciphertext
  };
}

export async function saveOssResourceCredential(credential = {}) {
  const required = ["version", "algorithm", "kdf", "kdfN", "kdfR", "kdfP", "salt", "iv", "authTag", "ciphertext"];
  if (required.some((key) => credential[key] === undefined || credential[key] === null || credential[key] === "")) {
    const error = new Error("网管二期密码密文不完整。");
    error.status = 400;
    throw error;
  }
  await exec(`INSERT INTO oss_resource_credential (id, format_version, algorithm, kdf, kdf_n, kdf_r, kdf_p, salt, iv, auth_tag, ciphertext, updated_at)
VALUES (1, ${Number(credential.version)}, ${sqlQuote(credential.algorithm)}, ${sqlQuote(credential.kdf)}, ${Number(credential.kdfN)}, ${Number(credential.kdfR)}, ${Number(credential.kdfP)}, ${sqlQuote(credential.salt)}, ${sqlQuote(credential.iv)}, ${sqlQuote(credential.authTag)}, ${sqlQuote(credential.ciphertext)}, CURRENT_TIMESTAMP)
ON CONFLICT(id) DO UPDATE SET format_version = excluded.format_version, algorithm = excluded.algorithm, kdf = excluded.kdf,
kdf_n = excluded.kdf_n, kdf_r = excluded.kdf_r, kdf_p = excluded.kdf_p, salt = excluded.salt, iv = excluded.iv,
auth_tag = excluded.auth_tag, ciphertext = excluded.ciphertext, updated_at = CURRENT_TIMESTAMP;
INSERT INTO admin_events (action, source, detail) VALUES ('save_oss_resource_credential', 'admin', 'encrypted_password_saved');`);
}

export async function saveOssResourceConfig(input = {}) {
  const authBaseUrl = normalizeLocalBaseUrl(input.authBaseUrl, "OSS 认证地址");
  const ngbBaseUrl = normalizeLocalBaseUrl(input.ngbBaseUrl, "网管二期地址");
  const username = String(input.username || "").trim();
  const organizationName = String(input.organizationName || "").trim();
  const roomName = String(input.roomName || "").trim();
  if (!username || !organizationName || !roomName) {
    const error = new Error("OSS 用户名、组织名称和机房名称不能为空。");
    error.status = 400;
    throw error;
  }
  await exec(`INSERT INTO oss_resource_config (id, auth_base_url, ngb_base_url, username, organization_name, room_name, updated_at)
VALUES (1, ${sqlQuote(authBaseUrl)}, ${sqlQuote(ngbBaseUrl)}, ${sqlQuote(username)}, ${sqlQuote(organizationName)}, ${sqlQuote(roomName)}, CURRENT_TIMESTAMP)
ON CONFLICT(id) DO UPDATE SET auth_base_url = excluded.auth_base_url, ngb_base_url = excluded.ngb_base_url,
username = excluded.username, organization_name = excluded.organization_name, room_name = excluded.room_name, updated_at = CURRENT_TIMESTAMP;
INSERT INTO admin_events (action, source, detail) VALUES ('save_oss_resource_config', 'admin', 'configured_without_password');`);
  return getOssResourceConfig();
}

function normalizeIpv4(value, label) {
  const ip = String(value || "").trim();
  const parts = ip.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part) || Number(part) > 255)) {
    throw new Error(`${label}格式无效。`);
  }
  return parts.map(Number).join(".");
}

export function normalizeResourceOltIpMappings(mappings = []) {
  const resourceIps = new Set();
  const oltIps = new Set();
  return mappings.map((mapping) => {
    const resourceIp = normalizeIpv4(mapping.resourceIp || mapping.resource_ip, "网管二期 IP");
    const oltIp = normalizeIpv4(mapping.oltIp || mapping.olt_ip, "OLT IP");
    if (resourceIps.has(resourceIp)) throw new Error(`网管二期 IP 重复：${resourceIp}`);
    if (oltIps.has(oltIp)) throw new Error(`OLT IP 重复：${oltIp}`);
    resourceIps.add(resourceIp);
    oltIps.add(oltIp);
    return { resourceIp, oltIp };
  });
}

export async function getResourceOltIpMappings() {
  const rows = await query("SELECT resource_ip, olt_ip, source, synced_at FROM resource_olt_ip_mappings ORDER BY resource_ip;");
  return rows.map((row) => ({
    resourceIp: row.resource_ip,
    oltIp: row.olt_ip,
    source: row.source,
    syncedAt: row.synced_at
  }));
}

export async function replaceResourceOltIpMappings(mappings = [], source = "oss-ngb") {
  const rows = normalizeResourceOltIpMappings(mappings);
  const knownOlts = new Set((await getOlts()).map((olt) => olt.host));
  const unknown = rows.filter((row) => !knownOlts.has(row.oltIp)).map((row) => row.oltIp);
  if (unknown.length) throw new Error(`OLT Manager 中不存在对应 OLT：${unknown.join(", ")}`);
  await exec(`BEGIN;
DELETE FROM resource_olt_ip_mappings;
${rows.map((row) => `INSERT INTO resource_olt_ip_mappings (resource_ip, olt_ip, source, synced_at)
VALUES (${sqlQuote(row.resourceIp)}, ${sqlQuote(row.oltIp)}, ${sqlQuote(source)}, CURRENT_TIMESTAMP);`).join("\n")}
INSERT INTO admin_events (action, source, detail) VALUES ('sync_resource_olt_ip_mappings', ${sqlQuote(source)}, ${sqlQuote(`${rows.length} rows`)});
COMMIT;`);
  return getResourceOltIpMappings();
}

function mapResourceSyncTask(row) {
  return {
    id: row.id,
    oltId: row.olt_id,
    runAt: row.run_at,
    repeatDays: Number(row.repeat_days || 0),
    status: row.status,
    resultCount: Number(row.result_count || 0),
    error: row.error || "",
    createdAt: row.created_at || "",
    startedAt: row.started_at || "",
    completedAt: row.completed_at || "",
    lastRunAt: row.last_run_at || "",
    lastStatus: row.last_status || ""
  };
}

export async function getResourceSyncTasks({ pendingOnly = false } = {}) {
  const rows = await query(`SELECT id, olt_id, run_at, repeat_days, status, result_count, error, created_at, started_at, completed_at, last_run_at, last_status
FROM resource_sync_tasks
${pendingOnly ? "WHERE status = 'pending'" : ""}
ORDER BY run_at DESC, created_at DESC;`);
  return rows.map(mapResourceSyncTask);
}

export async function createResourceSyncTask({ id, oltId, runAt, repeatDays = 0 } = {}) {
  const taskId = String(id || "").trim();
  const targetOltId = String(oltId || "").trim();
  const timestamp = String(runAt || "").trim();
  const intervalDays = Number(repeatDays);
  if (!taskId || !targetOltId || !timestamp) throw new Error("定时任务参数不完整。");
  if (!Number.isInteger(intervalDays) || intervalDays < 0 || intervalDays > 365) throw new Error("重复间隔必须是 0-365 的整数天数。");
  await exec(`INSERT INTO resource_sync_tasks (id, olt_id, run_at, repeat_days)
VALUES (${sqlQuote(taskId)}, ${sqlQuote(targetOltId)}, ${sqlQuote(timestamp)}, ${intervalDays});`);
  const [row] = await query(`SELECT id, olt_id, run_at, repeat_days, status, result_count, error, created_at, started_at, completed_at, last_run_at, last_status
FROM resource_sync_tasks WHERE id = ${sqlQuote(taskId)};`);
  return mapResourceSyncTask(row);
}

export async function updateResourceSyncTask(id, update = {}) {
  const taskId = String(id || "").trim();
  const status = String(update.status || "").trim();
  const allowedStatuses = new Set(["pending", "running", "success", "failed", "canceled"]);
  if (!taskId || !allowedStatuses.has(status)) throw new Error("定时任务状态无效。");
  const resultCount = Number.isFinite(Number(update.resultCount)) ? Math.max(0, Number(update.resultCount)) : 0;
  const error = String(update.error || "").slice(0, 500);
  const fieldValue = (field, column) => Object.hasOwn(update, field) ? (update[field] ? sqlQuote(update[field]) : "NULL") : column;
  const runAt = fieldValue("runAt", "run_at");
  const startedAt = fieldValue("startedAt", "started_at");
  const completedAt = fieldValue("completedAt", "completed_at");
  const lastRunAt = fieldValue("lastRunAt", "last_run_at");
  const lastStatus = Object.hasOwn(update, "lastStatus") ? sqlQuote(update.lastStatus || "") : "last_status";
  await exec(`UPDATE resource_sync_tasks
SET run_at = ${runAt}, status = ${sqlQuote(status)}, result_count = ${resultCount}, error = ${sqlQuote(error)}, started_at = ${startedAt}, completed_at = ${completedAt}, last_run_at = ${lastRunAt}, last_status = ${lastStatus}
WHERE id = ${sqlQuote(taskId)};`);
  const [row] = await query(`SELECT id, olt_id, run_at, repeat_days, status, result_count, error, created_at, started_at, completed_at, last_run_at, last_status
FROM resource_sync_tasks WHERE id = ${sqlQuote(taskId)};`);
  return row ? mapResourceSyncTask(row) : null;
}

export async function deleteResourceSyncTask(id) {
  const taskId = String(id || "").trim();
  if (!taskId) throw new Error("定时任务 ID 无效。");
  await exec(`DELETE FROM resource_sync_tasks WHERE id = ${sqlQuote(taskId)};`);
  return { id: taskId };
}

function mapResourceUser(row) {
  return {
    oltIp: row.olt_ip, gridRank: row.grid_rank, onuIndex: row.onu_index, loid: row.loid, mac: row.mac,
    pon: row.pon, ponType: row.pon_type, deviceType: row.device_type, username: row.username,
    userPhone: row.user_phone, installationAddress: row.installation_address, syncedAt: row.synced_at
  };
}

function compareResourceUserOnuIndex(left, right) {
  const parse = (value) => {
    const [ponPath = "", onuId = ""] = String(value || "").split(":", 2);
    const [chassis = "", board = "", pon = ""] = ponPath.split("/", 3);
    return [chassis, board, pon, onuId].map((part) => /^\d+$/.test(part) ? Number(part) : Number.POSITIVE_INFINITY);
  };
  const leftParts = parse(left.onuIndex);
  const rightParts = parse(right.onuIndex);
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
  }
  return String(left.onuIndex).localeCompare(String(right.onuIndex), "zh-Hans-CN");
}

export async function getResourceUsers({ oltIp = "", q = "" } = {}) {
  const host = String(oltIp || "").trim();
  const keyword = String(q || "").trim().toLowerCase();
  const clauses = [];
  if (host) clauses.push(`olt_ip = ${sqlQuote(host)}`);
  if (keyword) clauses.push(`(lower(onu_index) LIKE ${sqlQuote(`%${keyword}%`)} OR lower(loid) LIKE ${sqlQuote(`%${keyword}%`)} OR lower(mac) LIKE ${sqlQuote(`%${keyword}%`)} OR lower(username) LIKE ${sqlQuote(`%${keyword}%`)} OR lower(user_phone) LIKE ${sqlQuote(`%${keyword}%`)} OR lower(installation_address) LIKE ${sqlQuote(`%${keyword}%`)})`);
  const rows = await query(`SELECT * FROM resource_user_snapshots ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY pon, onu_index;`);
  return rows.map(mapResourceUser).sort(compareResourceUserOnuIndex);
}

export async function recordOnuStatusHistory({ oltId, oltIp, rows = [] } = {}) {
  const id = String(oltId || "").trim();
  const host = String(oltIp || "").trim();
  if (!id || !host || !rows.length) return { count: 0 };
  const inserts = rows
    .filter((row) => row.chassis !== undefined && row.board !== undefined && row.pon !== undefined && row.onuId !== undefined)
    .map((row) => {
      const values = {
        chassis: row.chassis,
        board: row.board ?? row.slot,
        pon: row.pon,
        onuId: row.onuId,
        serial: row.serial || "",
        phase: row.phase || "",
        rxPower: row.rxPower || "",
        distance: row.distance || "",
        lastOnlineTime: row.lastOnlineTime || "",
        lastOfflineTime: row.lastOfflineTime || "",
        lastOfflineCause: row.lastOfflineCause || "",
        lastOfflineCauseCode: row.lastOfflineCauseCode == null ? null : row.lastOfflineCauseCode
      };
      const fields = [
        id,
        host,
        values.chassis,
        values.board,
        values.pon,
        values.onuId,
        values.serial,
        values.phase,
        values.rxPower,
        values.distance,
        values.lastOnlineTime,
        values.lastOfflineTime,
        values.lastOfflineCause,
        values.lastOfflineCauseCode
      ].map(sqlQuote);
      return `INSERT INTO onu_status_history (olt_id, olt_ip, chassis, board, pon, onu_id, serial, phase, rx_power, distance, last_online_time, last_offline_time, last_offline_cause, last_offline_cause_code)
SELECT ${fields.join(", ")} WHERE NOT EXISTS (
  SELECT 1 FROM onu_status_history
  WHERE olt_id = ${sqlQuote(id)} AND chassis = ${sqlQuote(values.chassis)} AND board = ${sqlQuote(values.board)} AND pon = ${sqlQuote(values.pon)} AND onu_id = ${sqlQuote(values.onuId)}
    AND sampled_at >= datetime('now', '-5 minutes')
    AND serial = ${sqlQuote(values.serial)} AND phase = ${sqlQuote(values.phase)} AND rx_power = ${sqlQuote(values.rxPower)}
    AND last_offline_time = ${sqlQuote(values.lastOfflineTime)} AND last_offline_cause = ${sqlQuote(values.lastOfflineCause)}
);`;
    });
  if (!inserts.length) return { count: 0 };
  await exec(`BEGIN;
${inserts.join("\n")}
DELETE FROM onu_status_history WHERE sampled_at < datetime('now', '-30 days');
COMMIT;`);
  return { count: inserts.length };
}

export async function getOnuStatusHistory({ oltId, chassis, board, pon, onuId, days, limit = 48 } = {}) {
  const safeDays = days === undefined ? null : Math.max(1, Math.min(30, Number(days) || 7));
  const dateFilter = safeDays === null ? "" : `\n  AND sampled_at >= datetime('now', '-${safeDays} days')`;
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 48));
  const rows = await query(`SELECT serial, phase, rx_power, distance, last_online_time, last_offline_time, last_offline_cause, last_offline_cause_code, sampled_at
FROM onu_status_history
WHERE olt_id = ${sqlQuote(oltId)} AND chassis = ${sqlQuote(chassis)} AND board = ${sqlQuote(board)} AND pon = ${sqlQuote(pon)} AND onu_id = ${sqlQuote(onuId)}${dateFilter}
ORDER BY sampled_at DESC LIMIT ${safeLimit};`);
  return rows.map((row) => ({
    serial: row.serial || "",
    phase: row.phase || "",
    rxPower: row.rx_power || "",
    distance: row.distance || "",
    lastOnlineTime: row.last_online_time || "",
    lastOfflineTime: row.last_offline_time || "",
    lastOfflineCause: row.last_offline_cause || "",
    lastOfflineCauseCode: row.last_offline_cause_code == null ? null : Number(row.last_offline_cause_code),
    sampledAt: row.sampled_at || ""
  }));
}

export async function getResourceUserDatasetRevision() {
  const [state] = await query("SELECT revision FROM resource_user_dataset_state WHERE id = 1;");
  const revision = String(state?.revision || "").trim();
  if (!/^[a-f0-9]{32}$/.test(revision)) {
    throw new Error("用户快照数据集版本不可用。");
  }
  return `dataset:${revision}`;
}

function mapMergedOnuSnapshot(row) {
  return {
    oltIp: row.olt_ip,
    chassis: row.chassis,
    board: row.board,
    pon: row.pon,
    onuId: row.onu_id,
    onuIndex: `${row.chassis}/${row.board}/${row.pon}:${row.onu_id}`,
    onuIndexDisplay: row.onu_index_display || "",
    deviceName: row.device_name || "",
    deviceNumber: row.device_number || "",
    loid: row.loid || "",
    loidDisplay: row.loid_display || "",
    mac: row.mac || "",
    serial: row.serial || "",
    username: row.username || "",
    usernameSource: row.username_source || "network",
    userPhone: row.user_phone || "",
    installationAddress: row.installation_address || "",
    deviceType: row.device_type || "",
    ponType: row.pon_type || "",
    phase: row.phase || "",
    rxPower: row.rx_power || "",
    distance: row.distance || "",
    nmseOltIp: row.nmse_olt_ip || "",
    nmseOnuIndex: row.nmse_onu_index || "",
    syncedAt: row.synced_at || ""
  };
}

function mapMergedOnuNetworkSource(row) {
  return {
    oltIp: row.olt_ip || "",
    chassis: row.chassis || "",
    board: row.board || "",
    pon: row.pon || "",
    onuId: row.onu_id || "",
    onuIndex: `${row.chassis || ""}/${row.board || ""}/${row.pon || ""}:${row.onu_id || ""}`,
    onuIndexDisplay: row.onu_index_display || "",
    deviceName: row.device_name || "",
    deviceNumber: row.device_number || "",
    loid: row.loid || "",
    loidDisplay: row.loid_display || "",
    mac: row.mac || "",
    serial: row.serial || "",
    username: row.username || "",
    userPhone: row.user_phone || "",
    installationAddress: row.installation_address || "",
    deviceType: row.device_type || "",
    ponType: row.pon_type || "",
    phase: row.phase || "",
    rxPower: row.rx_power || "",
    distance: row.distance || "",
    syncedAt: row.synced_at || ""
  };
}

function mapMergedOnuNmseSource(row) {
  return {
    oltIp: row.olt_ip || "",
    onuIndex: row.onu_index_display || "",
    onuIndexDisplay: row.onu_index_display || "",
    loid: row.loid || "",
    loidDisplay: row.loid_display || "",
    username: row.username || "",
    userPhone: row.user_phone || "",
    installationAddress: row.installation_address || "",
    syncedAt: row.synced_at || ""
  };
}

export async function getMergedOnuNetworkSource() {
  const rows = await query(`SELECT * FROM merged_onu_network_snapshots
ORDER BY olt_ip, CAST(chassis AS INTEGER), CAST(board AS INTEGER), CAST(pon AS INTEGER), CAST(onu_id AS INTEGER);`);
  return rows.map(mapMergedOnuNetworkSource);
}

export async function getMergedOnuNmseSource() {
  const rows = await query(`SELECT olt_ip, onu_index_display, loid, loid_display, username, user_phone, installation_address, synced_at
FROM merged_onu_nmse_snapshots ORDER BY id;`);
  return rows.map(mapMergedOnuNmseSource);
}

export async function getMergedOnuSourceStatus() {
  const [state] = await query("SELECT * FROM merged_onu_source_state WHERE id = 1;");
  const source = (revision, count, updatedAt) => ({
    synced: Boolean(String(updatedAt || "").trim()),
    revision: revision ? `source:${revision}` : "",
    count: Number(count || 0),
    updatedAt: updatedAt || ""
  });
  return {
    network: source(state?.network_revision, state?.network_count, state?.network_updated_at),
    nmse: source(state?.nmse_revision, state?.nmse_count, state?.nmse_updated_at)
  };
}

function mergedOnuNetworkSourceValues(row) {
  return [
    row.oltIp || "", row.chassis || "", row.board || "", row.pon || "", row.onuId || "",
    row.onuIndexDisplay || row.onuIndex || "", row.deviceName || "", row.deviceNumber || "", row.loid || "",
    row.loidDisplay || row.loid || "", row.mac || "", row.serial || "", row.username || "",
    row.userPhone || "", row.installationAddress || "", row.deviceType || "", row.ponType || "",
    row.phase || "", row.rxPower || "", row.distance || ""
  ].map(sqlQuote);
}

export async function replaceMergedOnuNetworkSource({ rows = [] } = {}) {
  const invalid = rows.filter((row) => [row?.oltIp, row?.chassis, row?.board, row?.pon, row?.onuId].some((value) => !String(value ?? "").trim()));
  if (invalid.length) throw new Error("网管二期源快照包含缺少主键坐标的记录。");
  const inserts = rows.map((row) => `INSERT INTO merged_onu_network_snapshots
(olt_ip, chassis, board, pon, onu_id, onu_index_display, device_name, device_number, loid, loid_display, mac, serial, username, user_phone, installation_address, device_type, pon_type, phase, rx_power, distance)
VALUES (${mergedOnuNetworkSourceValues(row).join(", ")});`);
  await exec(`BEGIN;
DELETE FROM merged_onu_network_snapshots;
${inserts.join("\n")}
UPDATE merged_onu_source_state SET network_revision = lower(hex(randomblob(16))), network_count = ${rows.length}, network_updated_at = CURRENT_TIMESTAMP WHERE id = 1;
INSERT INTO admin_events (action, source, detail) VALUES ('sync_merged_onu_network_source', 'oss-ngb', ${sqlQuote(`${rows.length} rows`)});
COMMIT;`);
  return { count: rows.length, source: (await getMergedOnuSourceStatus()).network };
}

export async function replaceMergedOnuNmseSource({ rows = [] } = {}) {
  const invalid = rows.filter((row) => !String(row?.oltIp || "").trim() || (!String(row?.onuIndexDisplay || row?.onuIndex || "").trim() && !String(row?.loid || "").trim()));
  if (invalid.length) throw new Error("NMSE-PON 源快照包含无法归属的记录。");
  const inserts = rows.map((row) => `INSERT INTO merged_onu_nmse_snapshots
(olt_ip, onu_index_display, loid, loid_display, username, user_phone, installation_address)
VALUES (${[
    row.oltIp,
    row.onuIndexDisplay || row.onuIndex || "",
    row.loid || "",
    row.loidDisplay || row.loid || "",
    row.username || "",
    row.userPhone || "",
    row.installationAddress || ""
  ].map(sqlQuote).join(", ")});`);
  await exec(`BEGIN;
DELETE FROM merged_onu_nmse_snapshots;
${inserts.join("\n")}
UPDATE merged_onu_source_state SET nmse_revision = lower(hex(randomblob(16))), nmse_count = ${rows.length}, nmse_updated_at = CURRENT_TIMESTAMP WHERE id = 1;
INSERT INTO admin_events (action, source, detail) VALUES ('sync_merged_onu_nmse_source', 'nmse-pon', ${sqlQuote(`${rows.length} rows`)});
COMMIT;`);
  return { count: rows.length, source: (await getMergedOnuSourceStatus()).nmse };
}

export async function recordMergedOnuSourceSyncSuccess({
  runId,
  operation,
  networkCount = 0,
  nmseCount = 0,
  backup = null,
  startedAt = "",
  completedAt = ""
} = {}) {
  const id = String(runId || "").trim();
  const sourceOperation = String(operation || "").trim();
  if (!id || !["network", "nmse"].includes(sourceOperation)) throw new Error("合并 ONU 源同步运行参数无效。");
  await exec(`INSERT INTO merged_onu_sync_runs
(id, operation, status, network_count, nmse_count, merged_count, conflict_count, backup_path, backup_bytes, backup_sha256, error, started_at, completed_at)
VALUES (${[
    id, sourceOperation, "success", Number(networkCount) || 0, Number(nmseCount) || 0, 0, 0,
    backup?.path || "", Number(backup?.bytes || 0), backup?.sha256 || "", "",
    startedAt || new Date().toISOString(), completedAt || new Date().toISOString()
  ].map(sqlQuote).join(", ")});`);
  return { runId: id, operation: sourceOperation, status: "success" };
}

export async function getMergedOnuSnapshots({ oltIp = "" } = {}) {
  const host = String(oltIp || "").trim();
  const rows = await query(`SELECT * FROM merged_onu_snapshots${host ? ` WHERE olt_ip = ${sqlQuote(host)}` : ""}
ORDER BY olt_ip, CAST(chassis AS INTEGER), CAST(board AS INTEGER), CAST(pon AS INTEGER), CAST(onu_id AS INTEGER);`);
  return rows.map(mapMergedOnuSnapshot);
}

export async function getMergedOnuConflicts({ runId = "" } = {}) {
  const id = String(runId || "").trim();
  const rows = await query(`SELECT run_id, reason, olt_ip, onu_index_display, loid, detail, created_at
FROM merged_onu_conflicts${id ? ` WHERE run_id = ${sqlQuote(id)}` : ""} ORDER BY id;`);
  return rows.map((row) => ({
    runId: row.run_id,
    reason: row.reason,
    oltIp: row.olt_ip,
    onuIndexDisplay: row.onu_index_display || "",
    loid: row.loid || "",
    detail: row.detail || "",
    createdAt: row.created_at || ""
  }));
}

export async function getMergedOnuSyncRuns({ limit = 50 } = {}) {
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  const rows = await query(`SELECT id, operation, status, network_count, nmse_count, merged_count, conflict_count,
backup_path, backup_bytes, backup_sha256, error, started_at, completed_at
FROM merged_onu_sync_runs ORDER BY started_at DESC LIMIT ${safeLimit};`);
  return rows.map((row) => ({
    id: row.id,
    operation: row.operation || "full",
    status: row.status,
    networkCount: Number(row.network_count || 0),
    nmseCount: Number(row.nmse_count || 0),
    mergedCount: Number(row.merged_count || 0),
    conflictCount: Number(row.conflict_count || 0),
    backupPath: row.backup_path || "",
    backupBytes: Number(row.backup_bytes || 0),
    backupSha256: row.backup_sha256 || "",
    error: row.error || "",
    startedAt: row.started_at || "",
    completedAt: row.completed_at || ""
  }));
}

export async function getMergedOnuDatasetRevision() {
  const [state] = await query("SELECT revision, updated_at FROM merged_onu_dataset_state WHERE id = 1;");
  const revision = String(state?.revision || "").trim();
  if (!/^[a-f0-9]{32}$/.test(revision)) throw new Error("合并 ONU 数据集版本不可用。");
  return { revision: `dataset:${revision}`, updatedAt: state.updated_at || "" };
}

export async function getMergedOnuDatasetRevisionValue() {
  return (await getMergedOnuDatasetRevision()).revision;
}

export async function getMergedOnuDatasetStatus() {
  const [state] = await query("SELECT revision, updated_at FROM merged_onu_dataset_state WHERE id = 1;");
  const [snapshotCount] = await query("SELECT count(*) AS count FROM merged_onu_snapshots;");
  const [successfulRun] = await query("SELECT id, completed_at, conflict_count FROM merged_onu_sync_runs WHERE status = 'success' AND operation IN ('full', 'merge') ORDER BY completed_at DESC LIMIT 1;");
  const synced = Boolean(successfulRun);
  return {
    synced,
    revision: synced && state?.revision ? `dataset:${state.revision}` : "",
    updatedAt: synced ? state?.updated_at || "" : "",
    snapshotCount: Number(snapshotCount?.count || 0),
    lastConflictCount: Number(successfulRun?.conflict_count || 0),
    lastRunId: successfulRun?.id || "",
    lastCompletedAt: successfulRun?.completed_at || "",
    sources: await getMergedOnuSourceStatus()
  };
}

function mergedOnuKey(row) {
  return [row.oltIp, row.chassis, row.board, row.pon, row.onuId].map((value) => sqlQuote(value)).join(",");
}

export async function replaceMergedOnuDataset({
  runId,
  operation = "merge",
  rows = [],
  conflicts = [],
  networkCount = 0,
  nmseCount = 0,
  backup = null,
  startedAt = "",
  completedAt = ""
} = {}) {
  const id = String(runId || "").trim();
  if (!id) throw new Error("合并 ONU 同步运行 ID 不能为空。");
  const validRows = rows.filter((row) => row && row.persistable !== false);
  const invalidRows = validRows.filter((row) => [row.oltIp, row.chassis, row.board, row.pon, row.onuId].some((value) => !String(value ?? "").trim()));
  if (invalidRows.length) throw new Error("合并 ONU 数据包含缺少主键坐标的记录。");
  const values = (row) => [
    row.oltIp, row.chassis, row.board, row.pon, row.onuId, row.onuIndexDisplay,
    row.deviceName || "", row.deviceNumber || "", row.loid || "", row.loidDisplay || "", row.mac || "", row.serial || "", row.username || "",
    row.usernameSource, row.userPhone, row.installationAddress, row.deviceType,
    row.ponType, row.phase, row.rxPower, row.distance, row.nmseOltIp, row.nmseOnuIndex
  ].map(sqlQuote);
  const inserts = validRows.map((row) => `INSERT INTO merged_onu_snapshots
(olt_ip, chassis, board, pon, onu_id, onu_index_display, device_name, device_number, loid, loid_display, mac, serial, username, username_source, user_phone, installation_address, device_type, pon_type, phase, rx_power, distance, nmse_olt_ip, nmse_onu_index)
VALUES (${values(row).join(", ")});`);
  const conflictInserts = conflicts.map((conflict) => `INSERT INTO merged_onu_conflicts
(run_id, reason, olt_ip, onu_index_display, loid, detail)
VALUES (${[
    id, conflict.reason, conflict.oltIp, conflict.onuIndexDisplay, conflict.loid, conflict.detail
  ].map(sqlQuote).join(", ")});`);
  const backupPath = backup?.path || "";
  const backupBytes = Number(backup?.bytes || 0);
  const backupSha256 = backup?.sha256 || "";
  await exec(`BEGIN;
INSERT INTO merged_onu_sync_runs
(id, operation, status, network_count, nmse_count, merged_count, conflict_count, backup_path, backup_bytes, backup_sha256, error, started_at, completed_at)
VALUES (${[
    id, operation, "success", Number(networkCount) || 0, Number(nmseCount) || 0, validRows.length, conflicts.length,
    backupPath, backupBytes, backupSha256, "", startedAt || new Date().toISOString(), completedAt || new Date().toISOString()
  ].map(sqlQuote).join(", ")});
DELETE FROM merged_onu_snapshots;
${inserts.join("\n")}
${conflictInserts.join("\n")}
UPDATE merged_onu_dataset_state SET revision = lower(hex(randomblob(16))), updated_at = CURRENT_TIMESTAMP WHERE id = 1;
COMMIT;`);
  return {
    runId: id,
    mergedCount: validRows.length,
    conflictCount: conflicts.length,
    ...(await getMergedOnuDatasetRevision())
  };
}

export async function recordMergedOnuSyncFailure({
  runId,
  operation = "full",
  networkCount = 0,
  nmseCount = 0,
  backup = null,
  error = "合并 ONU 同步失败。",
  startedAt = "",
  completedAt = ""
} = {}) {
  const id = String(runId || "").trim();
  if (!id) throw new Error("合并 ONU 同步运行 ID 不能为空。");
  await exec(`INSERT INTO merged_onu_sync_runs
(id, operation, status, network_count, nmse_count, merged_count, conflict_count, backup_path, backup_bytes, backup_sha256, error, started_at, completed_at)
VALUES (${[
    id, operation, "failed", Number(networkCount) || 0, Number(nmseCount) || 0, 0, 0,
    backup?.path || "", Number(backup?.bytes || 0), backup?.sha256 || "", String(error || "").slice(0, 240),
    startedAt || new Date().toISOString(), completedAt || new Date().toISOString()
  ].map(sqlQuote).join(", ")});`);
  return { runId: id, status: "failed" };
}

const administrativeAddressSuffix = /(?:市|区|县|镇|乡|街道)$/;
const duplicatedRoadVillagePrefix = /^(?<prefix>.+(?:镇|乡|街道))(?<place>[\u4e00-\u9fff]{2,})(?:大道|路|街)\k<place>村(?<tail>.*)$/;

function removeDuplicatedResourceAddressPrefix(address) {
  const match = /^(?<prefix>.+?)(?<partition>\d+[^片]*片)(?<rest>.+)$/.exec(address);
  if (!match?.groups) return address;
  const { prefix, rest } = match.groups;
  for (let start = 0; start < prefix.length; start += 1) {
    const repeatedPrefix = prefix.slice(start);
    const repeatedAt = rest.indexOf(repeatedPrefix);
    if (administrativeAddressSuffix.test(repeatedPrefix) && repeatedAt >= 0) {
      return `${prefix}${rest.slice(repeatedAt + repeatedPrefix.length)}`;
    }
  }
  return address;
}

function removeDuplicatedRoadVillagePrefix(address) {
  const match = duplicatedRoadVillagePrefix.exec(address);
  if (!match?.groups) return address;
  const { prefix, place, tail } = match.groups;
  return `${prefix}${place}村${tail}`;
}

export function normalizeResourceInstallationAddress(value) {
  let address = String(value || "").trim().replace(/#+$/g, "").trim();
  while (true) {
    const cleaned = removeDuplicatedResourceAddressPrefix(address)
      .replace(/^广东省东莞市厚街镇?\d+[^东]*?片(?:\d+厚街村)?东莞市厚街镇/, "广东省东莞市厚街镇")
      .replace(/^广东省东莞市厚街镇厚街村/, "广东省东莞市厚街镇");
    const normalized = removeDuplicatedRoadVillagePrefix(cleaned);
    if (normalized === address) return address;
    address = normalized;
  }
}

function resourceInstallationAddress(row) {
  return normalizeResourceInstallationAddress(row.useraddr || row.installationAddress || "");
}

export async function cleanResourceInstallationAddresses() {
  const [snapshotRows, checkpointRows] = await Promise.all([
    query("SELECT olt_ip, onu_index, installation_address FROM resource_user_snapshots;"),
    query("SELECT olt_ip, onu_index, installation_address FROM resource_user_checkpoints;")
  ]);
  const changedSnapshots = snapshotRows.map((row) => ({ ...row, cleaned: normalizeResourceInstallationAddress(row.installation_address) }))
    .filter((row) => row.cleaned !== row.installation_address);
  const changedCheckpoints = checkpointRows.map((row) => ({ ...row, cleaned: normalizeResourceInstallationAddress(row.installation_address) }))
    .filter((row) => row.cleaned !== row.installation_address);
  const count = changedSnapshots.length + changedCheckpoints.length;
  if (!count) return { count: 0, snapshots: 0, checkpoints: 0 };
  await exec(`BEGIN;
${changedSnapshots.map((row) => `UPDATE resource_user_snapshots SET installation_address = ${sqlQuote(row.cleaned)} WHERE olt_ip = ${sqlQuote(row.olt_ip)} AND onu_index = ${sqlQuote(row.onu_index)};`).join("\n")}
${changedCheckpoints.map((row) => `UPDATE resource_user_checkpoints SET installation_address = ${sqlQuote(row.cleaned)} WHERE olt_ip = ${sqlQuote(row.olt_ip)} AND onu_index = ${sqlQuote(row.onu_index)};`).join("\n")}
INSERT INTO admin_events (action, source, detail) VALUES ('clean_resource_addresses', 'admin', ${sqlQuote(`${count} rows`)});
UPDATE resource_user_dataset_state SET revision = lower(hex(randomblob(16))), updated_at = CURRENT_TIMESTAMP WHERE id = 1;
COMMIT;`);
  return { count, snapshots: changedSnapshots.length, checkpoints: changedCheckpoints.length };
}

export async function replaceResourceUsers({ oltIp, gridRank, rows = [] } = {}) {
  const host = String(oltIp || "").trim();
  if (!host) throw new Error("缺少 OLT 地址。");
  const inserts = rows.map((row) => `INSERT INTO resource_user_snapshots (olt_ip, grid_rank, onu_index, loid, mac, pon, pon_type, device_type, username, user_phone, installation_address)
VALUES (${sqlQuote(host)}, ${sqlQuote(gridRank)}, ${sqlQuote(row.onuIndexName || row.onuIndex || "")}, ${sqlQuote(row.loid || "")}, ${sqlQuote(row.mac || "")}, ${sqlQuote(row.ponNo || row.pon || "")}, ${sqlQuote(row.ponType || "")}, ${sqlQuote(row.deviceType || "")}, ${sqlQuote(row.username || "")}, ${sqlQuote(row.usertel || row.userPhone || "")}, ${sqlQuote(resourceInstallationAddress(row))});`);
  if (rows.some((row) => !String(row.onuIndexName || row.onuIndex || "").trim())) throw new Error("资源管理用户数据缺少 ONU 索引。");
  await exec(`BEGIN;
DELETE FROM resource_user_snapshots WHERE olt_ip = ${sqlQuote(host)};
${inserts.join("\n")}
UPDATE resource_user_dataset_state SET revision = lower(hex(randomblob(16))), updated_at = CURRENT_TIMESTAMP WHERE id = 1;
INSERT INTO admin_events (action, source, detail) VALUES ('sync_resource_users', ${sqlQuote(host)}, ${sqlQuote(`${rows.length} rows`)});
COMMIT;`);
  return { count: rows.length };
}

export async function replaceResourceUsersBatch({ datasets = [] } = {}) {
  if (!Array.isArray(datasets) || datasets.some((dataset) => !String(dataset?.oltIp || "").trim())) {
    throw new Error("资源管理用户批量快照缺少 OLT 地址。");
  }
  const hosts = [...new Set(datasets.map((dataset) => String(dataset.oltIp).trim()))];
  const invalidRows = datasets.flatMap((dataset) => (Array.isArray(dataset.rows) ? dataset.rows : [])
    .filter((row) => !String(row?.onuIndexName || row?.onuIndex || "").trim()));
  if (invalidRows.length) throw new Error("资源管理用户数据缺少 ONU 索引。");
  const inserts = datasets.flatMap((dataset) => (dataset.rows || []).map((row) => `INSERT INTO resource_user_snapshots (olt_ip, grid_rank, onu_index, loid, mac, pon, pon_type, device_type, username, user_phone, installation_address)
VALUES (${sqlQuote(dataset.oltIp)}, ${sqlQuote(dataset.gridRank)}, ${sqlQuote(row.onuIndexName || row.onuIndex || "")}, ${sqlQuote(row.loid || "")}, ${sqlQuote(row.mac || "")}, ${sqlQuote(row.ponNo || row.pon || "")}, ${sqlQuote(row.ponType || "")}, ${sqlQuote(row.deviceType || "")}, ${sqlQuote(row.username || "")}, ${sqlQuote(row.usertel || row.userPhone || "")}, ${sqlQuote(resourceInstallationAddress(row))});`));
  await exec(`BEGIN;
DELETE FROM resource_user_snapshots WHERE olt_ip IN (${hosts.map(sqlQuote).join(", ")});
${inserts.join("\n")}
UPDATE resource_user_dataset_state SET revision = lower(hex(randomblob(16))), updated_at = CURRENT_TIMESTAMP WHERE id = 1;
INSERT INTO admin_events (action, source, detail) VALUES ('sync_resource_users_batch', 'nmse-pon', ${sqlQuote(`${inserts.length} rows, ${hosts.length} olts`)});
COMMIT;`);
  return { count: inserts.length, oltCount: hosts.length };
}

export async function replaceResourceUserCheckpoint({ oltIp, gridRank, expectedTotal = 0, completedPages = 0, rows = [] } = {}) {
  const host = String(oltIp || "").trim();
  if (!host) throw new Error("缺少 OLT 地址。");
  if (rows.some((row) => !String(row.onuIndexName || row.onuIndex || "").trim())) throw new Error("资源管理用户数据缺少 ONU 索引。");
  const inserts = rows.map((row) => `INSERT INTO resource_user_checkpoints (olt_ip, grid_rank, expected_total, completed_pages, onu_index, loid, mac, pon, pon_type, device_type, username, user_phone, installation_address)
VALUES (${sqlQuote(host)}, ${sqlQuote(gridRank)}, ${Number(expectedTotal) || 0}, ${Number(completedPages) || 0}, ${sqlQuote(row.onuIndexName || row.onuIndex || "")}, ${sqlQuote(row.loid || "")}, ${sqlQuote(row.mac || "")}, ${sqlQuote(row.ponNo || row.pon || "")}, ${sqlQuote(row.ponType || "")}, ${sqlQuote(row.deviceType || "")}, ${sqlQuote(row.username || "")}, ${sqlQuote(row.usertel || row.userPhone || "")}, ${sqlQuote(resourceInstallationAddress(row))});`);
  await exec(`BEGIN;
DELETE FROM resource_user_checkpoints WHERE olt_ip = ${sqlQuote(host)};
${inserts.join("\n")}
INSERT INTO admin_events (action, source, detail) VALUES ('checkpoint_resource_users', ${sqlQuote(host)}, ${sqlQuote(`${rows.length}/${Number(expectedTotal) || 0} rows, ${Number(completedPages) || 0} pages`)});
COMMIT;`);
  return { count: rows.length, expectedTotal: Number(expectedTotal) || 0, completedPages: Number(completedPages) || 0 };
}

export async function getResourceVlanSnapshot(oltIp) {
  const host = String(oltIp || "").trim();
  const [olt] = await query(`SELECT * FROM resource_olt_vlan_snapshots WHERE olt_ip = ${sqlQuote(host)};`);
  const ports = await query(`SELECT snapshot.board, snapshot.pon, snapshot.svlan, snapshot.previous_outer_vlan, snapshot.synced_at, ledger.pon_port, ledger.outer_vlan
FROM resource_pon_vlan_snapshots snapshot
LEFT JOIN pon_ports ledger ON ledger.olt_ip = snapshot.olt_ip AND ledger.board = snapshot.board AND ledger.pon = snapshot.pon
WHERE snapshot.olt_ip = ${sqlQuote(host)} ORDER BY CAST(snapshot.board AS INTEGER), CAST(snapshot.pon AS INTEGER);`);
  return {
    olt: olt ? { oltIp: olt.olt_ip, gridRank: olt.grid_rank, beginCvlan: olt.begin_cvlan, endCvlan: olt.end_cvlan, distributionType: olt.distribution_type, syncedAt: olt.synced_at } : null,
    ports: ports.map((row) => ({ board: row.board, pon: row.pon, ponPort: row.pon_port || "", svlan: row.svlan, previousOuterVlan: row.previous_outer_vlan || "", outerVlan: row.outer_vlan || "", syncedAt: row.synced_at }))
  };
}

export async function replaceResourceVlans({ oltIp, gridRank, ponVlans = [], cvlan = {} } = {}) {
  const host = String(oltIp || "").trim();
  if (!host) throw new Error("缺少 OLT 地址。");
  const ledger = await query(`SELECT board, pon, outer_vlan FROM pon_ports WHERE olt_ip = ${sqlQuote(host)};`);
  const previous = new Map(ledger.map((row) => [`${row.board}/${row.pon}`, row.outer_vlan || ""]));
  const rows = ponVlans.filter((row) => /^\d+$/.test(String(row.board)) && /^\d+$/.test(String(row.pon)) && /^\d{1,4}$/.test(String(row.svlan)));
  const inserts = rows.map((row) => `INSERT INTO resource_pon_vlan_snapshots (olt_ip, grid_rank, board, pon, svlan, previous_outer_vlan)
VALUES (${sqlQuote(host)}, ${sqlQuote(gridRank)}, ${sqlQuote(row.board)}, ${sqlQuote(row.pon)}, ${sqlQuote(row.svlan)}, ${sqlQuote(previous.get(`${row.board}/${row.pon}`) || "")});`);
  const updates = rows.map((row) => `UPDATE pon_ports SET outer_vlan = ${sqlQuote(row.svlan)} WHERE olt_ip = ${sqlQuote(host)} AND board = ${sqlQuote(row.board)} AND pon = ${sqlQuote(row.pon)};`);
  await exec(`BEGIN;
DELETE FROM resource_pon_vlan_snapshots WHERE olt_ip = ${sqlQuote(host)};
${inserts.join("\n")}
INSERT INTO resource_olt_vlan_snapshots (olt_ip, grid_rank, begin_cvlan, end_cvlan, distribution_type, synced_at)
VALUES (${sqlQuote(host)}, ${sqlQuote(gridRank)}, ${sqlQuote(cvlan.begin || "")}, ${sqlQuote(cvlan.end || "")}, ${sqlQuote(cvlan.distributionType || "")}, CURRENT_TIMESTAMP)
ON CONFLICT(olt_ip) DO UPDATE SET grid_rank = excluded.grid_rank, begin_cvlan = excluded.begin_cvlan, end_cvlan = excluded.end_cvlan, distribution_type = excluded.distribution_type, synced_at = CURRENT_TIMESTAMP;
${updates.join("\n")}
INSERT INTO admin_events (action, source, detail) VALUES ('sync_resource_vlans', ${sqlQuote(host)}, ${sqlQuote(`${rows.length} rows`)});
COMMIT;`);
  return { count: rows.length };
}

export async function addSnmpProbe(row) {
  await exec(`INSERT INTO snmp_probe_history (olt_id, operation, oid, ok, duration_ms, summary, raw_output)
VALUES (${sqlQuote(row.oltId)}, ${sqlQuote(row.operation)}, ${sqlQuote(row.oid)}, ${row.ok ? 1 : 0}, ${Number(row.durationMs || 0)}, ${sqlQuote(row.summary || "")}, ${sqlQuote(row.rawOutput || "")});
INSERT INTO admin_events (action, source, detail) VALUES ('snmp_test', ${sqlQuote(row.oltId)}, ${sqlQuote(`${row.operation} ${row.oid} ${row.ok ? "ok" : "failed"}`)});`);
}

export async function getSnmpHistory(limit = 80) {
  return query(`SELECT * FROM snmp_probe_history ORDER BY id DESC LIMIT ${Number(limit) || 80};`);
}

export async function getAdminEvents(limit = 80) {
  return query(`SELECT * FROM admin_events ORDER BY id DESC LIMIT ${Number(limit) || 80};`);
}

function projectId() {
  return `project-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function mapProjectRow(row) {
  return {
    id: row.id,
    name: row.name,
    vlan: Number(row.vlan),
    address: row.address || "",
    contactName: row.contact_name || "",
    contactPhone: row.contact_phone || "",
    contactNote: row.contact_note || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeProjectInput(input = {}) {
  const name = String(input.name || "").trim();
  const rawVlan = String(input.vlan ?? "").trim();
  const vlan = Number(rawVlan);
  if (!name) {
    const error = new Error("项目名称不能为空。");
    error.status = 400;
    throw error;
  }
  if (!/^\d+$/.test(rawVlan) || !Number.isInteger(vlan) || vlan < 1 || vlan > 4094) {
    const error = new Error("项目 VLAN 必须是 1-4094 范围内的单个 VLAN。");
    error.status = 400;
    throw error;
  }
  return {
    name,
    vlan,
    address: String(input.address || "").trim(),
    contactName: String(input.contactName || "").trim(),
    contactPhone: String(input.contactPhone || "").trim(),
    contactNote: String(input.contactNote || "").trim()
  };
}

export async function getProjects(options = {}) {
  const keyword = String(options.q || options.search || "").trim().toLowerCase();
  const where = keyword
    ? `WHERE lower(name) LIKE ${sqlQuote(`%${keyword}%`)}
      OR lower(address) LIKE ${sqlQuote(`%${keyword}%`)}
      OR lower(contact_name) LIKE ${sqlQuote(`%${keyword}%`)}
      OR lower(contact_phone) LIKE ${sqlQuote(`%${keyword}%`)}
      OR lower(contact_note) LIKE ${sqlQuote(`%${keyword}%`)}
      OR CAST(vlan AS TEXT) LIKE ${sqlQuote(`%${keyword}%`)}`
    : "";
  const rows = await query(`SELECT * FROM projects ${where} ORDER BY name COLLATE NOCASE, id;`);
  return rows.map(mapProjectRow);
}

export async function getProject(id) {
  const projectIdValue = String(id || "").trim();
  const rows = await query(`SELECT * FROM projects WHERE id = ${sqlQuote(projectIdValue)} LIMIT 1;`);
  return rows.length ? mapProjectRow(rows[0]) : null;
}

export async function createProject(input = {}) {
  const project = normalizeProjectInput(input);
  const duplicate = await query(`SELECT id FROM projects WHERE lower(name) = lower(${sqlQuote(project.name)}) LIMIT 1;`);
  if (duplicate.length) {
    const error = new Error("项目名称已存在，项目名称必须全局唯一。");
    error.status = 400;
    throw error;
  }
  const id = projectId();
  await exec(`BEGIN;
INSERT INTO projects (id, name, vlan, address, contact_name, contact_phone, contact_note)
VALUES (${sqlQuote(id)}, ${sqlQuote(project.name)}, ${Number(project.vlan)}, ${sqlQuote(project.address)}, ${sqlQuote(project.contactName)}, ${sqlQuote(project.contactPhone)}, ${sqlQuote(project.contactNote)});
INSERT INTO admin_events (action, source, detail) VALUES ('create_project', 'admin', ${sqlQuote(project.name)});
COMMIT;`);
  const rows = await query(`SELECT * FROM projects WHERE id = ${sqlQuote(id)};`);
  return mapProjectRow(rows[0]);
}

export async function updateProject(id, input = {}) {
  const projectIdValue = String(id || "").trim();
  const project = normalizeProjectInput(input);
  const existing = await query(`SELECT id FROM projects WHERE id = ${sqlQuote(projectIdValue)} LIMIT 1;`);
  if (!existing.length) {
    const error = new Error("项目不存在。");
    error.status = 404;
    throw error;
  }
  const duplicate = await query(`SELECT id FROM projects WHERE lower(name) = lower(${sqlQuote(project.name)}) AND id <> ${sqlQuote(projectIdValue)} LIMIT 1;`);
  if (duplicate.length) {
    const error = new Error("项目名称已存在，项目名称必须全局唯一。");
    error.status = 400;
    throw error;
  }
  await exec(`BEGIN;
UPDATE projects
SET name = ${sqlQuote(project.name)},
    vlan = ${Number(project.vlan)},
    address = ${sqlQuote(project.address)},
    contact_name = ${sqlQuote(project.contactName)},
    contact_phone = ${sqlQuote(project.contactPhone)},
    contact_note = ${sqlQuote(project.contactNote)},
    updated_at = CURRENT_TIMESTAMP
WHERE id = ${sqlQuote(projectIdValue)};
INSERT INTO admin_events (action, source, detail) VALUES ('update_project', 'admin', ${sqlQuote(project.name)});
COMMIT;`);
  const rows = await query(`SELECT * FROM projects WHERE id = ${sqlQuote(projectIdValue)};`);
  return mapProjectRow(rows[0]);
}

export async function deleteProject(id) {
  const projectIdValue = String(id || "").trim();
  const existing = await query(`SELECT name FROM projects WHERE id = ${sqlQuote(projectIdValue)} LIMIT 1;`);
  if (!existing.length) {
    const error = new Error("项目不存在。");
    error.status = 404;
    throw error;
  }
  await exec(`BEGIN;
DELETE FROM project_onus WHERE project_id = ${sqlQuote(projectIdValue)};
DELETE FROM projects WHERE id = ${sqlQuote(projectIdValue)};
INSERT INTO admin_events (action, source, detail) VALUES ('delete_project', 'admin', ${sqlQuote(existing[0].name)});
COMMIT;`);
  return { ok: true };
}

function mapProjectOnuRow(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name || "",
    projectVlan: row.project_vlan == null ? undefined : Number(row.project_vlan),
    oltId: row.olt_id,
    chassis: row.chassis,
    board: row.board,
    slot: row.board,
    pon: row.pon,
    onuId: row.onu_id,
    serial: row.serial || "",
    address: row.address || "",
    vlan: row.vlan || "",
    note: row.note || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function addProjectOnu(projectId, input = {}) {
  const projectIdValue = String(projectId || "").trim();
  const identity = {
    oltId: String(input.oltId || "").trim(),
    chassis: String(input.chassis || "").trim(),
    board: String(input.board || input.slot || "").trim(),
    pon: String(input.pon || "").trim(),
    onuId: String(input.onuId || "").trim()
  };
  if (!projectIdValue) {
    const error = new Error("项目不存在。");
    error.status = 404;
    throw error;
  }
  if (!identity.oltId || !identity.chassis || !identity.board || !identity.pon || !identity.onuId) {
    const error = new Error("缺少 OLT、槽、板卡、PON 或 ONU ID，不能加入项目。");
    error.status = 400;
    throw error;
  }
  const project = await query(`SELECT id FROM projects WHERE id = ${sqlQuote(projectIdValue)} LIMIT 1;`);
  if (!project.length) {
    const error = new Error("项目不存在。");
    error.status = 404;
    throw error;
  }
  const existing = await query(`
SELECT po.project_id, p.name AS project_name
FROM project_onus po
JOIN projects p ON p.id = po.project_id
WHERE po.olt_id = ${sqlQuote(identity.oltId)}
  AND po.chassis = ${sqlQuote(identity.chassis)}
  AND po.board = ${sqlQuote(identity.board)}
  AND po.pon = ${sqlQuote(identity.pon)}
  AND po.onu_id = ${sqlQuote(identity.onuId)}
LIMIT 1;`);
  if (existing.length) {
    const error = new Error(`该 ONU 已属于项目「${existing[0].project_name}」，请先从原项目移除后再添加。`);
    error.status = 400;
    throw error;
  }
  await exec(`INSERT INTO project_onus (project_id, olt_id, chassis, board, pon, onu_id, serial, address, vlan, note)
VALUES (${sqlQuote(projectIdValue)}, ${sqlQuote(identity.oltId)}, ${sqlQuote(identity.chassis)}, ${sqlQuote(identity.board)}, ${sqlQuote(identity.pon)}, ${sqlQuote(identity.onuId)}, ${sqlQuote(input.serial || "")}, ${sqlQuote(input.address || "")}, ${sqlQuote(input.vlan || "")}, ${sqlQuote(input.note || "")});
INSERT INTO admin_events (action, source, detail) VALUES ('add_project_onu', 'admin', ${sqlQuote(`${projectIdValue} ${identity.oltId}/${identity.chassis}/${identity.board}/${identity.pon}/${identity.onuId}`)});`);
  const rows = await query(`
SELECT po.*, p.name AS project_name, p.vlan AS project_vlan
FROM project_onus po
JOIN projects p ON p.id = po.project_id
WHERE po.project_id = ${sqlQuote(projectIdValue)}
ORDER BY po.id DESC
LIMIT 1;`);
  return mapProjectOnuRow(rows[0]);
}

export async function getProjectOnus(projectId) {
  const rows = await query(`SELECT * FROM project_onus WHERE project_id = ${sqlQuote(projectId)} ORDER BY id;`);
  return rows.map(mapProjectOnuRow);
}

export async function updateProjectOnuNote(projectId, onuAssociationId, input = {}) {
  const projectIdValue = String(projectId || "").trim();
  const associationId = Number(onuAssociationId);
  if (!projectIdValue || !Number.isInteger(associationId) || associationId <= 0) {
    const error = new Error("项目 ONU 关联不存在。");
    error.status = 404;
    throw error;
  }
  const existing = await query(`
SELECT po.*, p.name AS project_name, p.vlan AS project_vlan
FROM project_onus po
JOIN projects p ON p.id = po.project_id
WHERE po.project_id = ${sqlQuote(projectIdValue)} AND po.id = ${associationId}
LIMIT 1;`);
  if (!existing.length) {
    const error = new Error("项目 ONU 关联不存在。");
    error.status = 404;
    throw error;
  }
  const note = String(input.note || "").trim();
  await exec(`BEGIN;
UPDATE project_onus SET note = ${sqlQuote(note)}, updated_at = CURRENT_TIMESTAMP WHERE project_id = ${sqlQuote(projectIdValue)} AND id = ${associationId};
INSERT INTO admin_events (action, source, detail) VALUES ('update_project_onu_note', 'admin', ${sqlQuote(`${projectIdValue} ${associationId}`)});
COMMIT;`);
  const rows = await query(`
SELECT po.*, p.name AS project_name, p.vlan AS project_vlan
FROM project_onus po
JOIN projects p ON p.id = po.project_id
WHERE po.project_id = ${sqlQuote(projectIdValue)} AND po.id = ${associationId}
LIMIT 1;`);
  return mapProjectOnuRow(rows[0]);
}

export async function deleteProjectOnu(projectId, onuAssociationId) {
  const projectIdValue = String(projectId || "").trim();
  const associationId = Number(onuAssociationId);
  if (!projectIdValue || !Number.isInteger(associationId) || associationId <= 0) {
    const error = new Error("项目 ONU 关联不存在。");
    error.status = 404;
    throw error;
  }
  const existing = await query(`SELECT id FROM project_onus WHERE project_id = ${sqlQuote(projectIdValue)} AND id = ${associationId} LIMIT 1;`);
  if (!existing.length) {
    const error = new Error("项目 ONU 关联不存在。");
    error.status = 404;
    throw error;
  }
  await exec(`BEGIN;
DELETE FROM project_onus WHERE project_id = ${sqlQuote(projectIdValue)} AND id = ${associationId};
INSERT INTO admin_events (action, source, detail) VALUES ('delete_project_onu', 'admin', ${sqlQuote(`${projectIdValue} ${associationId}`)});
COMMIT;`);
  return { ok: true };
}

export async function getProjectOnuAssignments(options = {}) {
  const oltId = String(options.oltId || "").trim();
  const where = oltId ? `WHERE po.olt_id = ${sqlQuote(oltId)}` : "";
  const rows = await query(`
SELECT po.*, p.name AS project_name, p.vlan AS project_vlan
FROM project_onus po
JOIN projects p ON p.id = po.project_id
${where}
ORDER BY po.id;`);
  return rows.map(mapProjectOnuRow);
}
