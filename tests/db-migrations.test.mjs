import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
process.env.OLT_MANAGER_DATA_DIR = await mkdtemp(join(tmpdir(), "olt-db-migrations-data-"));
const { createMigrationRunner } = await import("../src/db-migrations.mjs");
const { resolveTool } = await import("../src/runtime-paths.mjs");

function sqlite(databasePath, sql, { json = false } = {}) {
  return new Promise((resolve, reject) => {
    const args = ["-batch", "-cmd", ".timeout 10000"];
    if (json) args.push("-json");
    args.push(databasePath);
    const child = spawn(resolveTool("sqlite3"), args);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0
      ? resolve(stdout.trim())
      : reject(new Error(stderr || `sqlite3 exited with ${code}`)));
    child.stdin.end(sql);
  });
}

function runnerFor(databasePath, migrations) {
  return createMigrationRunner({
    runSql: (sql) => sqlite(databasePath, sql),
    querySql: async (sql) => {
      const output = await sqlite(databasePath, sql, { json: true });
      return output ? JSON.parse(output) : [];
    },
    migrations
  });
}

function sampleMigrations({ failing = false } = {}) {
  return [
    {
      version: 1,
      name: "create-legacy-records",
      checksum: "test-v1",
      sql: "CREATE TABLE IF NOT EXISTS records (id INTEGER PRIMARY KEY, value TEXT NOT NULL);"
    },
    {
      version: 2,
      name: "add-migrated-flag",
      checksum: failing ? "test-v2-failure" : "test-v2",
      up: async ({ query }) => {
        const columns = await query("PRAGMA table_info(records);");
        if (failing) return "ALTER TABLE records ADD COLUMN migrated INTEGER NOT NULL DEFAULT 1;\nTHIS IS NOT SQL;";
        return columns.some((column) => column.name === "migrated")
          ? "UPDATE records SET migrated = 1;"
          : "ALTER TABLE records ADD COLUMN migrated INTEGER NOT NULL DEFAULT 1;";
      }
    }
  ];
}

test("empty SQLite database runs all migrations and records metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "olt-db-migrations-empty-"));
  const databasePath = join(root, "empty.sqlite");
  const result = await runnerFor(databasePath, sampleMigrations())();
  assert.deepEqual(result.applied.map((migration) => migration.version), [1, 2]);
  const rows = JSON.parse(await sqlite(databasePath, "SELECT version, name, checksum, duration_ms FROM schema_migrations ORDER BY version;", { json: true }));
  assert.deepEqual(rows.map((row) => [row.version, row.name, row.checksum]), [
    [1, "create-legacy-records", "test-v1"],
    [2, "add-migrated-flag", "test-v2"]
  ]);
});

test("legacy SQLite database upgrades without replacing existing data", async () => {
  const root = await mkdtemp(join(tmpdir(), "olt-db-migrations-legacy-"));
  const databasePath = join(root, "legacy.sqlite");
  await sqlite(databasePath, "CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT NOT NULL); INSERT INTO records VALUES (7, '现场数据');");
  await runnerFor(databasePath, sampleMigrations())();
  const rows = JSON.parse(await sqlite(databasePath, "SELECT id, value, migrated FROM records;", { json: true }));
  assert.deepEqual(rows, [{ id: 7, value: "现场数据", migrated: 1 }]);
});

test("restarting the migration runner is idempotent", async () => {
  const root = await mkdtemp(join(tmpdir(), "olt-db-migrations-repeat-"));
  const databasePath = join(root, "repeat.sqlite");
  const migrations = sampleMigrations();
  await runnerFor(databasePath, migrations)();
  const second = await runnerFor(databasePath, migrations)();
  assert.deepEqual(second.applied, []);
  const [{ count }] = JSON.parse(await sqlite(databasePath, "SELECT count(*) AS count FROM schema_migrations;", { json: true }));
  assert.equal(count, 2);
});

test("failed migration rolls back its schema changes and metadata record", async () => {
  const root = await mkdtemp(join(tmpdir(), "olt-db-migrations-failure-"));
  const databasePath = join(root, "failure.sqlite");
  await assert.rejects(runnerFor(databasePath, sampleMigrations({ failing: true }))(), /not sql|syntax/i);
  const migrations = JSON.parse(await sqlite(databasePath, "SELECT version FROM schema_migrations ORDER BY version;", { json: true }));
  assert.deepEqual(migrations, [{ version: 1 }]);
  const columns = JSON.parse(await sqlite(databasePath, "PRAGMA table_info(records);", { json: true }));
  assert.equal(columns.some((column) => column.name === "migrated"), false);
});

test("database restore invokes the same migration runner", async () => {
  const dataDir = process.env.OLT_MANAGER_DATA_DIR;
  const db = await import(`../src/db.mjs?db-migrations-test=${Date.now()}`);
  await db.initDb();

  const sourceRoot = await mkdtemp(join(tmpdir(), "olt-db-migrations-restore-source-"));
  const sourcePath = join(sourceRoot, "legacy-backup.sqlite");
  await sqlite(sourcePath, `CREATE TABLE olts (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, vendor TEXT NOT NULL, model TEXT NOT NULL,
    version TEXT NOT NULL, host TEXT NOT NULL UNIQUE, snmp_port INTEGER NOT NULL,
    read_community TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE pon_ports (
    id INTEGER PRIMARY KEY AUTOINCREMENT, olt_ip TEXT NOT NULL,
    pon_port TEXT NOT NULL, address TEXT NOT NULL DEFAULT ''
  );
  INSERT INTO olts (id, name, vendor, model, version, host, snmp_port, read_community) VALUES ('legacy', 'Legacy', 'zte', 'C300', 'old', '192.0.2.10', 161, 'public');
  INSERT INTO pon_ports (olt_ip, pon_port, address) VALUES ('192.0.2.10', '1/2/3', '现场地址');`);
  await db.restoreDatabaseBackup(await readFile(sourcePath));

  const targetPath = join(dataDir, "olt-manager.sqlite");
  const migrations = JSON.parse(await sqlite(targetPath, "SELECT version, name FROM schema_migrations ORDER BY version;", { json: true }));
  assert.deepEqual(migrations, [
    { version: 1, name: "baseline-schema" },
    { version: 2, name: "legacy-schema-and-data-reconciliation" },
    { version: 3, name: "merged-onu-durable-recovery-state" },
    { version: 4, name: "resource-sync-operation-schedule" }
  ]);
  const oltColumns = JSON.parse(await sqlite(targetPath, "PRAGMA table_info(olts);", { json: true }));
  assert.equal(oltColumns.some((column) => column.name === "telnet_password"), true);
  const ponRows = JSON.parse(await sqlite(targetPath, "SELECT olt_ip, chassis, board, pon, pon_port, address FROM pon_ports;", { json: true }));
  assert.deepEqual(ponRows, [{ olt_ip: "192.0.2.10", chassis: "1", board: "2", pon: "3", pon_port: "1/2/3", address: "现场地址" }]);
});
