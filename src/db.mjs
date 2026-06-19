import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { dataRoot, missingToolMessage, resolveTool, seedRoot } from "./runtime-paths.mjs";

const dataDir = dataRoot;
const dbPath = join(dataDir, "olt-manager.sqlite");
const sqliteBin = resolveTool("sqlite3");
let sqlQueue = Promise.resolve();

function sqlQuote(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function runSqlImmediate(sql, { json = false } = {}) {
  return new Promise((resolve, reject) => {
    const args = ["-batch", "-cmd", ".timeout 10000"];
    if (json) args.push("-json");
    args.push(dbPath);
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
      if (code !== 0) reject(new Error(stderr || `sqlite3 exited with ${code}`));
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

async function query(sql) {
  const out = await runSql(sql, { json: true });
  return out ? JSON.parse(out) : [];
}

async function exec(sql) {
  await runSql(sql);
}

export function oltInsertSql(olt) {
  return `INSERT INTO olts (id, name, vendor, model, version, host, snmp_port, read_community, telnet_port, telnet_username, telnet_password, enabled)
VALUES (${sqlQuote(olt.id)}, ${sqlQuote(olt.name)}, ${sqlQuote(olt.vendor)}, ${sqlQuote(olt.model)}, ${sqlQuote(olt.version)}, ${sqlQuote(olt.host)}, ${Number(olt.snmpPort || olt.snmp_port || 161)}, ${sqlQuote(olt.readCommunity || olt.read_community || "")}, ${Number(olt.telnetPort || olt.telnet_port || 23)}, ${sqlQuote(olt.telnetUsername || olt.telnet_username || "")}, ${sqlQuote(olt.telnetPassword || olt.telnet_password || "")}, ${olt.enabled === false || olt.enabled === 0 ? 0 : 1});`;
}

function ponInsertSql(port) {
  return `INSERT INTO pon_ports (olt_ip, pon_port, outer_vlan, address)
VALUES (${sqlQuote(port.oltIp || port.olt_ip)}, ${sqlQuote(port.ponPort || port.pon_port)}, ${sqlQuote(port.outerVlan || port.outer_vlan || "")}, ${sqlQuote(port.address || "")});`;
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
  return statements.join("\n");
}

export function mapOltRow(row, { includeSecrets = false } = {}) {
  const mapped = {
    id: row.id,
    name: row.name,
    vendor: row.vendor,
    model: row.model,
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
DROP TABLE IF EXISTS oid_entries;
DROP TABLE IF EXISTS oid_profiles;
`);
  const oltColumns = await query("PRAGMA table_info(olts);");
  const oltMigration = oltSchemaMigrationSql(oltColumns);
  if (oltMigration) await exec(oltMigration);

  const ponColumns = await query("PRAGMA table_info(pon_ports);");
  if (!ponColumns.some((column) => column.name === "outer_vlan")) {
    await exec("ALTER TABLE pon_ports ADD COLUMN outer_vlan TEXT NOT NULL DEFAULT '';");
  }

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

export async function getOlts(options = {}) {
  const rows = await query("SELECT * FROM olts;");
  return rows.map((row) => mapOltRow(row, options)).sort((a, b) => ipNumber(a.host) - ipNumber(b.host));
}

function ipNumber(host) {
  return host.split(".").reduce((sum, part) => (sum * 256) + Number(part || 0), 0);
}

export async function replaceOlts(olts, source = "admin") {
  await exec(`BEGIN;
DELETE FROM olts;
${olts.map(oltInsertSql).join("\n")}
INSERT INTO admin_events (action, source, detail) VALUES ('save_olts', ${sqlQuote(source)}, ${sqlQuote(`${olts.length} rows`)});
COMMIT;`);
}

export async function getPonPorts() {
  const rows = await query("SELECT id, olt_ip, pon_port, outer_vlan, address FROM pon_ports ORDER BY olt_ip, pon_port, id;");
  return rows.map((row) => ({ id: row.id, oltIp: row.olt_ip, ponPort: row.pon_port, outerVlan: row.outer_vlan, address: row.address }));
}

export async function replacePonPorts(ports, source = "admin") {
  await exec(`BEGIN;
DELETE FROM pon_ports;
DELETE FROM sqlite_sequence WHERE name='pon_ports';
${ports.map(ponInsertSql).join("\n")}
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
