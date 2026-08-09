import { spawn } from "node:child_process";
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
`);
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
DROP TABLE IF EXISTS oid_entries;
DROP TABLE IF EXISTS oid_profiles;
`);
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

export async function getOnuStatusHistory({ oltId, chassis, board, pon, onuId, limit = 48 } = {}) {
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 48));
  const rows = await query(`SELECT serial, phase, rx_power, distance, last_online_time, last_offline_time, last_offline_cause, last_offline_cause_code, sampled_at
FROM onu_status_history
WHERE olt_id = ${sqlQuote(oltId)} AND chassis = ${sqlQuote(chassis)} AND board = ${sqlQuote(board)} AND pon = ${sqlQuote(pon)} AND onu_id = ${sqlQuote(onuId)}
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
