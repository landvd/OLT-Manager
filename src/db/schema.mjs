// 基础表结构、版本化迁移与 initDb。
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { normalizePonCoordinate } from "../pon-coordinate.mjs";
import { seedRoot } from "../runtime-paths.mjs";
import { createMigrationRunner } from "../db-migrations.mjs";
import { dataDir, dbPath, query, runSqlImmediate, sqlQuote } from "./core.mjs";
import { replaceOlts, replacePonPorts } from "./olts.mjs";
import { seedConfigTemplates } from "./config-templates.mjs";

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

export async function ensureBaseSchema(databasePath = dbPath) {
  await mkdir(dirname(databasePath), { recursive: true });
  await runSqlImmediate(`
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
  device_profiles_json TEXT NOT NULL DEFAULT '[]',
  business_type TEXT NOT NULL,
  port_mode TEXT NOT NULL DEFAULT 'single',
  default_params_json TEXT NOT NULL DEFAULT '{}',
  command_template TEXT NOT NULL DEFAULT '',
  input_params_json TEXT NOT NULL DEFAULT '[]',
  remark TEXT NOT NULL DEFAULT '',
  is_builtin INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
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
CREATE TABLE IF NOT EXISTS resource_management_credential (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  format TEXT NOT NULL,
  backend TEXT NOT NULL,
  purpose TEXT NOT NULL,
  reference TEXT NOT NULL DEFAULT '',
  envelope_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
  password TEXT NOT NULL DEFAULT '',
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
CREATE TABLE IF NOT EXISTS bot_ai_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  feishu_enabled INTEGER NOT NULL DEFAULT 0,
  feishu_app_id TEXT NOT NULL DEFAULT '',
  feishu_app_secret TEXT NOT NULL DEFAULT '',
  jev_provider_name TEXT NOT NULL DEFAULT '',
  jev_endpoint TEXT NOT NULL DEFAULT '',
  jev_model TEXT NOT NULL DEFAULT '',
  jev_format TEXT NOT NULL DEFAULT 'responses',
  jev_api_key TEXT NOT NULL DEFAULT '',
  pi_provider_name TEXT NOT NULL DEFAULT '',
  pi_endpoint TEXT NOT NULL DEFAULT '',
  pi_model TEXT NOT NULL DEFAULT '',
  pi_format TEXT NOT NULL DEFAULT 'chat-completions',
  pi_api_key TEXT NOT NULL DEFAULT '',
  anysearch_api_key TEXT NOT NULL DEFAULT '',
  anysearch_enabled INTEGER NOT NULL DEFAULT 1,
  wecom_enabled INTEGER NOT NULL DEFAULT 0,
  wecom_bot_id TEXT NOT NULL DEFAULT '',
  wecom_secret TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS agent_learned_memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  topic TEXT NOT NULL,
  fact_content TEXT NOT NULL,
  anti_pattern TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  source_context TEXT NOT NULL DEFAULT '',
  confidence REAL NOT NULL DEFAULT 1.0,
  hit_count INTEGER NOT NULL DEFAULT 0,
  last_hit_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'active',
  source TEXT NOT NULL DEFAULT '',
  reviewed_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_agent_mem_entity ON agent_learned_memories (domain, entity_key);
CREATE TABLE IF NOT EXISTS agent_user_corrections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  loid TEXT NOT NULL DEFAULT '',
  olt_ip TEXT NOT NULL DEFAULT '',
  onu_index TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL DEFAULT '',
  field TEXT NOT NULL,
  value TEXT NOT NULL,
  previous_value TEXT NOT NULL DEFAULT '',
  match_count INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT '',
  source_text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'candidate',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_agent_mem_topic ON agent_learned_memories (topic);
CREATE TABLE IF NOT EXISTS resource_sync_tasks (
  id TEXT PRIMARY KEY,
  operation TEXT NOT NULL DEFAULT 'nmse',
  olt_id TEXT NOT NULL DEFAULT '',
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
  completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  summary_json TEXT NOT NULL DEFAULT '{}'
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
  duplicate_count INTEGER NOT NULL DEFAULT 1,
  duplicate_conflicts_json TEXT NOT NULL DEFAULT '[]',
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
`, { databasePath });
}

async function buildLegacySchemaMigrationSql({ query, restore = false } = {}) {
  const statements = [];
  const addMissingColumns = async (table, definitions) => {
    const columns = await query(`PRAGMA table_info(${table});`);
    const names = new Set(columns.map((column) => column.name));
    for (const [name, definition] of definitions) {
      if (!names.has(name)) statements.push(`ALTER TABLE ${table} ADD COLUMN ${definition};`);
    }
  };

  await addMissingColumns("merged_onu_sync_runs", [["operation", "operation TEXT NOT NULL DEFAULT 'full'"]]);
  await addMissingColumns("merged_onu_network_snapshots", [["device_number", "device_number TEXT NOT NULL DEFAULT ''"]]);
  await addMissingColumns("merged_onu_snapshots", [["device_number", "device_number TEXT NOT NULL DEFAULT ''"]]);
  await addMissingColumns("merged_onu_nmse_snapshots", [
    ["user_phone", "user_phone TEXT NOT NULL DEFAULT ''"],
    ["installation_address", "installation_address TEXT NOT NULL DEFAULT ''"]
  ]);
  await addMissingColumns("olts", [
    ["telnet_port", "telnet_port INTEGER NOT NULL DEFAULT 23"],
    ["telnet_username", "telnet_username TEXT NOT NULL DEFAULT ''"],
    ["telnet_password", "telnet_password TEXT NOT NULL DEFAULT ''"],
    ["device_profile", "device_profile TEXT NOT NULL DEFAULT ''"]
  ]);
  await addMissingColumns("pon_ports", [
    ["chassis", "chassis TEXT NOT NULL DEFAULT ''"],
    ["board", "board TEXT NOT NULL DEFAULT ''"],
    ["pon", "pon TEXT NOT NULL DEFAULT ''"],
    ["outer_vlan", "outer_vlan TEXT NOT NULL DEFAULT ''"]
  ]);
  await addMissingColumns("resource_sync_tasks", [
    ["operation", "operation TEXT NOT NULL DEFAULT 'nmse'"],
    ["repeat_days", "repeat_days INTEGER NOT NULL DEFAULT 0"],
    ["last_run_at", "last_run_at TEXT"],
    ["last_status", "last_status TEXT NOT NULL DEFAULT ''"]
  ]);
  await addMissingColumns("oss_resource_config", [
    ["password", "password TEXT NOT NULL DEFAULT ''"]
  ]);
  await addMissingColumns("bot_ai_config", [
    ["wecom_enabled", "wecom_enabled INTEGER NOT NULL DEFAULT 0"],
    ["wecom_bot_id", "wecom_bot_id TEXT NOT NULL DEFAULT ''"],
    ["wecom_secret", "wecom_secret TEXT NOT NULL DEFAULT ''"]
  ]);

  statements.push(`UPDATE onu_status_history
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
WHERE last_offline_cause_code IN (1, 2, 3, 4, 8, 9, 10);`);

  const ponColumns = await query("PRAGMA table_info(pon_ports);");
  const ponColumnNames = new Set(ponColumns.map((column) => column.name));
  const coordinateColumns = ["id", "olt_ip", "pon_port", "chassis", "board", "pon"]
    .filter((column) => column === "id" || column === "olt_ip" || column === "pon_port" || ponColumnNames.has(column));
  const rows = await query(`SELECT ${coordinateColumns.join(", ")} FROM pon_ports;`);
  const olts = await query("SELECT host, vendor FROM olts;");
  const vendorByHost = new Map(olts.map((olt) => [olt.host, olt.vendor]));
  for (const row of rows) {
    const coordinate = normalizePonCoordinate({
      chassis: row.chassis,
      board: row.board,
      pon: row.pon,
      ponPort: row.pon_port
    }, { vendor: vendorByHost.get(row.olt_ip) });
    if (!coordinate.chassis || !coordinate.board || !coordinate.pon) continue;
    if (row.chassis === coordinate.chassis && row.board === coordinate.board && row.pon === coordinate.pon && row.pon_port === coordinate.ponPort) continue;
    statements.push(`UPDATE pon_ports
SET chassis = ${sqlQuote(coordinate.chassis)}, board = ${sqlQuote(coordinate.board)},
    pon = ${sqlQuote(coordinate.pon)}, pon_port = ${sqlQuote(coordinate.ponPort)}
WHERE id = ${Number(row.id)};`);
  }
  if (restore) {
    statements.push(`INSERT INTO resource_user_dataset_state (id, revision, updated_at)
VALUES (1, lower(hex(randomblob(16))), CURRENT_TIMESTAMP)
ON CONFLICT(id) DO UPDATE SET revision = lower(hex(randomblob(16))), updated_at = CURRENT_TIMESTAMP;`);
  }
  return statements.join("\n");
}

const schemaMigrations = [
  {
    version: 1,
    name: "baseline-schema",
    checksum: "olt-manager-baseline-schema-v1",
    sql: "-- Existing CREATE TABLE baseline is installed before the runner."
  },
  {
    version: 2,
    name: "legacy-schema-and-data-reconciliation",
    checksum: "olt-manager-legacy-reconciliation-v2",
    up: buildLegacySchemaMigrationSql
  },
  {
    version: 3,
    name: "merged-onu-durable-recovery-state",
    checksum: "olt-manager-merged-onu-durable-recovery-v3",
    sql: `
CREATE TABLE IF NOT EXISTS merged_onu_sync_runtime (
  run_id TEXT PRIMARY KEY,
  operation TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  phase TEXT NOT NULL DEFAULT 'starting',
  checkpoint_json TEXT NOT NULL DEFAULT '{"status":"not_started","cursor":null,"updatedAt":null}',
  lease_until TEXT NOT NULL DEFAULT '',
  worker_id TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_merged_onu_sync_runtime_idempotency
  ON merged_onu_sync_runtime (idempotency_key) WHERE idempotency_key <> '';
CREATE INDEX IF NOT EXISTS idx_merged_onu_sync_runtime_recovery
  ON merged_onu_sync_runtime (status, lease_until, updated_at);
CREATE TABLE IF NOT EXISTS merged_onu_sync_manifests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  manifest_type TEXT NOT NULL,
  source TEXT NOT NULL,
  idempotency_key TEXT NOT NULL DEFAULT '',
  manifest_json TEXT NOT NULL,
  source_revision_json TEXT NOT NULL DEFAULT '{}',
  target_olt_ids_json TEXT NOT NULL DEFAULT '[]',
  window_start TEXT NOT NULL,
  window_end TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (run_id, manifest_type, source)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_merged_onu_sync_manifests_idempotency
  ON merged_onu_sync_manifests (idempotency_key) WHERE idempotency_key <> '';
CREATE INDEX IF NOT EXISTS idx_merged_onu_sync_manifests_latest
  ON merged_onu_sync_manifests (manifest_type, source, updated_at DESC);
      `
  },
  {
    version: 4,
    name: "resource-sync-operation-schedule",
    checksum: "olt-manager-resource-sync-operation-schedule-v4",
    up: async ({ query }) => {
      const columns = await query("PRAGMA table_info(resource_sync_tasks);");
      return columns.some((column) => column.name === "operation")
        ? "UPDATE resource_sync_tasks SET operation = COALESCE(NULLIF(operation, ''), 'nmse');"
        : "ALTER TABLE resource_sync_tasks ADD COLUMN operation TEXT NOT NULL DEFAULT 'nmse';";
    }
  },
  {
    version: 5,
    name: "nmse-boss-incremental-watermark-and-events",
    checksum: "olt-manager-nmse-boss-incremental-v5",
    sql: `
CREATE TABLE IF NOT EXISTS nmse_boss_sync_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  watermark TEXT NOT NULL DEFAULT '',
  last_window_start TEXT NOT NULL DEFAULT '',
  last_window_end TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO nmse_boss_sync_state (id) VALUES (1);
CREATE TABLE IF NOT EXISTS nmse_boss_change_events (
  event_key TEXT PRIMARY KEY,
  work_order TEXT NOT NULL DEFAULT '',
  loid TEXT NOT NULL DEFAULT '',
  operation TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT '',
  olt_ip TEXT NOT NULL DEFAULT '',
  onu_index TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL DEFAULT '',
  user_phone TEXT NOT NULL DEFAULT '',
  installation_address TEXT NOT NULL DEFAULT '',
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_nmse_boss_change_events_received
  ON nmse_boss_change_events (received_at);
    `
  },
  {
    version: 6,
    name: "nmse-boss-semantic-fields",
    checksum: "olt-manager-nmse-boss-semantic-fields-v6",
    sql: `
ALTER TABLE nmse_boss_change_events ADD COLUMN mac TEXT NOT NULL DEFAULT '';
ALTER TABLE nmse_boss_change_events ADD COLUMN pon TEXT NOT NULL DEFAULT '';
ALTER TABLE nmse_boss_change_events ADD COLUMN pon_type TEXT NOT NULL DEFAULT '';
ALTER TABLE nmse_boss_change_events ADD COLUMN device_type TEXT NOT NULL DEFAULT '';
ALTER TABLE merged_onu_nmse_snapshots ADD COLUMN mac TEXT NOT NULL DEFAULT '';
ALTER TABLE merged_onu_nmse_snapshots ADD COLUMN pon TEXT NOT NULL DEFAULT '';
ALTER TABLE merged_onu_nmse_snapshots ADD COLUMN pon_type TEXT NOT NULL DEFAULT '';
ALTER TABLE merged_onu_nmse_snapshots ADD COLUMN device_type TEXT NOT NULL DEFAULT '';
    `
  },
  {
    version: 7,
    name: "nmse-boss-coverage-through",
    checksum: "olt-manager-nmse-boss-coverage-through-v7",
    sql: `
ALTER TABLE nmse_boss_sync_state ADD COLUMN coverage_through TEXT NOT NULL DEFAULT '';
    `
  },
  {
    version: 8,
    name: "oss-resource-local-password",
    checksum: "olt-manager-oss-resource-local-password-v8",
    up: async ({ query }) => {
      const columns = await query("PRAGMA table_info(oss_resource_config);");
      return columns.some((column) => column.name === "password")
        ? "SELECT 1;"
        : "ALTER TABLE oss_resource_config ADD COLUMN password TEXT NOT NULL DEFAULT '';";
    }
  },
  {
    version: 9,
    name: "nmse-boss-name-history",
    checksum: "olt-manager-nmse-boss-name-history-v9",
    up: async ({ query }) => {
      const columns = await query("PRAGMA table_info(nmse_boss_sync_state);");
      const names = new Set(columns.map((column) => column.name));
      const statements = columns.length ? [] : [`CREATE TABLE nmse_boss_sync_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  watermark TEXT NOT NULL DEFAULT '',
  last_window_start TEXT NOT NULL DEFAULT '',
  last_window_end TEXT NOT NULL DEFAULT '',
  coverage_through TEXT NOT NULL DEFAULT '',
  name_history_start TEXT NOT NULL DEFAULT '',
  name_history_end TEXT NOT NULL DEFAULT '',
  name_history_completed_at TEXT NOT NULL DEFAULT '',
  name_history_count INTEGER NOT NULL DEFAULT 0,
  name_history_skipped_count INTEGER NOT NULL DEFAULT 0,
  name_history_conflict_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);`];
      if (columns.length) {
        for (const [name, definition] of [
          ["name_history_start", "name_history_start TEXT NOT NULL DEFAULT ''"],
          ["name_history_end", "name_history_end TEXT NOT NULL DEFAULT ''"],
          ["name_history_completed_at", "name_history_completed_at TEXT NOT NULL DEFAULT ''"],
          ["name_history_count", "name_history_count INTEGER NOT NULL DEFAULT 0"],
          ["name_history_skipped_count", "name_history_skipped_count INTEGER NOT NULL DEFAULT 0"],
          ["name_history_conflict_count", "name_history_conflict_count INTEGER NOT NULL DEFAULT 0"]
        ]) if (!names.has(name)) statements.push(`ALTER TABLE nmse_boss_sync_state ADD COLUMN ${definition};`);
      }
      statements.push(`INSERT OR IGNORE INTO nmse_boss_sync_state (id) VALUES (1);`, `
CREATE TABLE IF NOT EXISTS nmse_boss_name_snapshots (
  loid TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  work_order TEXT NOT NULL DEFAULT '',
  received_at TEXT NOT NULL,
  synced_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_nmse_boss_name_snapshots_received
  ON nmse_boss_name_snapshots (received_at);
      `);
      return statements.join("\n");
    }
  },
  {
    version: 10,
    name: "merged-onu-network-duplicate-audit",
    checksum: "olt-manager-merged-onu-network-duplicate-audit-v10",
    up: async ({ query }) => {
      const columns = await query("PRAGMA table_info(merged_onu_network_snapshots);");
      const names = new Set(columns.map((column) => column.name));
      const statements = [];
      if (!names.has("duplicate_count")) {
        statements.push("ALTER TABLE merged_onu_network_snapshots ADD COLUMN duplicate_count INTEGER NOT NULL DEFAULT 1;");
      }
      if (!names.has("duplicate_conflicts_json")) {
        statements.push("ALTER TABLE merged_onu_network_snapshots ADD COLUMN duplicate_conflicts_json TEXT NOT NULL DEFAULT '[]';");
      }
      return statements.length ? statements.join("\n") : "SELECT 1;";
    }
  },
  {
    version: 11,
    name: "bot-ai-system-config",
    checksum: "olt-manager-bot-ai-system-config-v11",
    up: async () => {
      return `CREATE TABLE IF NOT EXISTS bot_ai_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  feishu_enabled INTEGER NOT NULL DEFAULT 0,
  feishu_app_id TEXT NOT NULL DEFAULT '',
  feishu_app_secret TEXT NOT NULL DEFAULT '',
  jev_provider_name TEXT NOT NULL DEFAULT '',
  jev_endpoint TEXT NOT NULL DEFAULT '',
  jev_model TEXT NOT NULL DEFAULT '',
  jev_format TEXT NOT NULL DEFAULT 'responses',
  jev_api_key TEXT NOT NULL DEFAULT '',
  pi_provider_name TEXT NOT NULL DEFAULT '',
  pi_endpoint TEXT NOT NULL DEFAULT '',
  pi_model TEXT NOT NULL DEFAULT '',
  pi_format TEXT NOT NULL DEFAULT 'chat-completions',
  pi_api_key TEXT NOT NULL DEFAULT '',
  anysearch_api_key TEXT NOT NULL DEFAULT '',
  anysearch_enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO bot_ai_config (id) VALUES (1);`;
    }
  },
  {
    version: 12,
    name: "wecom-bot-system-config",
    checksum: "olt-manager-wecom-bot-system-config-v12",
    up: async ({ query }) => {
      const columns = await query("PRAGMA table_info(bot_ai_config);");
      const names = new Set(columns.map((column) => column.name));
      const statements = [];
      if (!names.has("wecom_enabled")) {
        statements.push("ALTER TABLE bot_ai_config ADD COLUMN wecom_enabled INTEGER NOT NULL DEFAULT 0;");
      }
      if (!names.has("wecom_bot_id")) {
        statements.push("ALTER TABLE bot_ai_config ADD COLUMN wecom_bot_id TEXT NOT NULL DEFAULT '';");
      }
      if (!names.has("wecom_secret")) {
        statements.push("ALTER TABLE bot_ai_config ADD COLUMN wecom_secret TEXT NOT NULL DEFAULT '';");
      }
      return statements.length ? statements.join("\n") : "SELECT 1;";
    }
  },
  {
    version: 13,
    name: "config-templates-editor-fields",
    checksum: "olt-manager-config-templates-editor-fields-v13",
    up: async ({ query }) => {
      const columns = await query("PRAGMA table_info(config_templates);");
      const names = new Set(columns.map((column) => column.name));
      const statements = [];
      if (!names.has("device_profiles_json")) {
        statements.push("ALTER TABLE config_templates ADD COLUMN device_profiles_json TEXT NOT NULL DEFAULT '[]';");
      }
      if (!names.has("port_mode")) {
        statements.push("ALTER TABLE config_templates ADD COLUMN port_mode TEXT NOT NULL DEFAULT 'single';");
      }
      if (!names.has("default_params_json")) {
        statements.push("ALTER TABLE config_templates ADD COLUMN default_params_json TEXT NOT NULL DEFAULT '{}';");
      }
      if (!names.has("command_template")) {
        statements.push("ALTER TABLE config_templates ADD COLUMN command_template TEXT NOT NULL DEFAULT '';");
      }
      if (!names.has("remark")) {
        statements.push("ALTER TABLE config_templates ADD COLUMN remark TEXT NOT NULL DEFAULT '';");
      }
      if (!names.has("is_builtin")) {
        statements.push("ALTER TABLE config_templates ADD COLUMN is_builtin INTEGER NOT NULL DEFAULT 0;");
      }
      if (!names.has("sort_order")) {
        statements.push("ALTER TABLE config_templates ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;");
      }
      return statements.length ? statements.join("\n") : "SELECT 1;";
    }
  },
  {
    version: 14,
    name: "optical-baseline-and-village-regions",
    checksum: "olt-manager-optical-baseline-and-village-regions-v14",
    sql: `
CREATE TABLE IF NOT EXISTS onu_optical_nightly_samples (
  olt_id TEXT NOT NULL,
  chassis TEXT NOT NULL,
  board TEXT NOT NULL,
  pon TEXT NOT NULL,
  onu_id TEXT NOT NULL,
  sample_date TEXT NOT NULL,
  phase TEXT NOT NULL DEFAULT 'unknown',
  rx_dbm REAL,
  sampled_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (olt_id, chassis, board, pon, onu_id, sample_date)
);
CREATE INDEX IF NOT EXISTS idx_optical_nightly_pon_date
  ON onu_optical_nightly_samples (olt_id, chassis, board, pon, sample_date);
CREATE TABLE IF NOT EXISTS optical_baseline_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sample_date TEXT NOT NULL,
  trigger TEXT NOT NULL DEFAULT 'schedule',
  status TEXT NOT NULL DEFAULT 'running',
  olt_count INTEGER NOT NULL DEFAULT 0,
  failed_olt_count INTEGER NOT NULL DEFAULT 0,
  onu_count INTEGER NOT NULL DEFAULT 0,
  error TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS optical_baseline_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 1,
  run_hour INTEGER NOT NULL DEFAULT 2,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO optical_baseline_settings (id, enabled, run_hour) VALUES (1, 1, 2);
CREATE TABLE IF NOT EXISTS village_regions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  village TEXT NOT NULL,
  name TEXT NOT NULL,
  include_json TEXT NOT NULL DEFAULT '[]',
  exclude_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'candidate',
  source TEXT NOT NULL DEFAULT 'auto',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (village, name)
);`
  },
  {
    version: 15,
    name: "merged-onu-sync-run-summary",
    checksum: "olt-manager-merged-onu-sync-run-summary-v15",
    up: async ({ query }) => {
      const columns = await query("PRAGMA table_info(merged_onu_sync_runs);");
      return columns.some((column) => column.name === "summary_json")
        ? "SELECT 1;"
        : "ALTER TABLE merged_onu_sync_runs ADD COLUMN summary_json TEXT NOT NULL DEFAULT '{}';";
    }
  },
  {
    version: 16,
    name: "village-region-pon-bindings",
    checksum: "olt-manager-village-region-pon-bindings-v16",
    up: async ({ query }) => {
      const columns = new Set((await query("PRAGMA table_info(village_regions);")).map((column) => column.name));
      const statements = [];
      if (!columns.has("pon_include_json")) statements.push("ALTER TABLE village_regions ADD COLUMN pon_include_json TEXT NOT NULL DEFAULT '[]';");
      if (!columns.has("pon_exclude_json")) statements.push("ALTER TABLE village_regions ADD COLUMN pon_exclude_json TEXT NOT NULL DEFAULT '[]';");
      return statements.length ? statements.join("\n") : "SELECT 1;";
    }
  },
  {
    version: 17,
    name: "agent-memory-review-and-user-corrections",
    checksum: "olt-manager-agent-memory-review-and-user-corrections-v17",
    up: async ({ query }) => {
      // 既有记忆保持“已生效”，避免升级后行为突变；之后新学到的内容默认进入候选，需人工审核。
      const columns = new Set((await query("PRAGMA table_info(agent_learned_memories);")).map((column) => column.name));
      const statements = [];
      if (!columns.has("status")) statements.push("ALTER TABLE agent_learned_memories ADD COLUMN status TEXT NOT NULL DEFAULT 'active';");
      if (!columns.has("source")) statements.push("ALTER TABLE agent_learned_memories ADD COLUMN source TEXT NOT NULL DEFAULT '';");
      if (!columns.has("reviewed_at")) statements.push("ALTER TABLE agent_learned_memories ADD COLUMN reviewed_at TEXT NOT NULL DEFAULT '';");
      statements.push(`CREATE TABLE IF NOT EXISTS agent_user_corrections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  loid TEXT NOT NULL DEFAULT '',
  olt_ip TEXT NOT NULL DEFAULT '',
  onu_index TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL DEFAULT '',
  field TEXT NOT NULL,
  value TEXT NOT NULL,
  previous_value TEXT NOT NULL DEFAULT '',
  match_count INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT '',
  source_text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'candidate',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT NOT NULL DEFAULT ''
);`);
      return statements.join("\n");
    }
  },
  {
    version: 18,
    name: "field-archive-outages-cable-groups-questions",
    checksum: "olt-manager-field-archive-v18",
    sql: `
CREATE TABLE IF NOT EXISTS fiber_outage_occurrences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pon_key TEXT NOT NULL,
  olt_ip TEXT NOT NULL,
  chassis TEXT NOT NULL,
  board TEXT NOT NULL,
  pon TEXT NOT NULL,
  started_at TEXT NOT NULL,
  recovered_at TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL,
  affected INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_fiber_outage_pon ON fiber_outage_occurrences (pon_key, started_at);
CREATE INDEX IF NOT EXISTS idx_fiber_outage_started ON fiber_outage_occurrences (started_at);
CREATE TABLE IF NOT EXISTS fiber_repair_inspections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query_value TEXT NOT NULL,
  pon_keys_json TEXT NOT NULL DEFAULT '[]',
  verdict TEXT NOT NULL DEFAULT '',
  summary_json TEXT NOT NULL DEFAULT '{}',
  inspected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS cable_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pon_keys_json TEXT NOT NULL UNIQUE,
  together INTEGER NOT NULL DEFAULT 0,
  max_together INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'candidate',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS agent_unresolved_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  normalized TEXT NOT NULL UNIQUE,
  question TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  ask_count INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'open',
  memory_id INTEGER,
  first_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);`
  },
  {
    version: 19,
    name: "config-template-input-params",
    checksum: "olt-manager-config-template-input-params-v19",
    up: async ({ query }) => {
      const columns = await query("PRAGMA table_info(config_templates);");
      return columns.some((column) => column.name === "input_params_json")
        ? "SELECT 1;"
        : "ALTER TABLE config_templates ADD COLUMN input_params_json TEXT NOT NULL DEFAULT '[]';";
    }
  }
];

function createSchemaMigrationRunner(databasePath = dbPath) {
  return createMigrationRunner({
    runSql: (sql) => runSqlImmediate(sql, { databasePath }),
    querySql: async (sql) => {
      const output = await runSqlImmediate(sql, { json: true, databasePath });
      return output ? JSON.parse(output) : [];
    },
    migrations: schemaMigrations
  });
}

export async function runSchemaMigrations(databasePath = dbPath, options = {}) {
  return createSchemaMigrationRunner(databasePath)(options);
}

export async function initDb() {
  await mkdir(dirname(dbPath), { recursive: true });
  await ensureBaseSchema(dbPath);
  await runSchemaMigrations(dbPath);
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

  await seedConfigTemplates();
}
