import { createHash } from "node:crypto";

const MIGRATION_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  duration_ms INTEGER NOT NULL DEFAULT 0
);`;

function migrationChecksum(migration) {
  if (migration.checksum) return String(migration.checksum);
  const source = typeof migration.up === "function" ? migration.up.toString() : String(migration.sql || "");
  return createHash("sha256").update(`${migration.version}:${migration.name}:${source}`).digest("hex");
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function normalizeMigrations(migrations) {
  const sorted = [...migrations].sort((a, b) => Number(a.version) - Number(b.version));
  const seen = new Set();
  for (const migration of sorted) {
    const version = Number(migration.version);
    if (!Number.isInteger(version) || version < 1 || seen.has(version)) {
      throw new Error("数据库迁移版本必须是唯一的正整数。");
    }
    if (!String(migration.name || "").trim()) throw new Error(`数据库迁移 ${version} 缺少名称。`);
    if (typeof migration.up !== "function" && !String(migration.sql || "").trim()) {
      throw new Error(`数据库迁移 ${version} 缺少执行内容。`);
    }
    seen.add(version);
  }
  return sorted;
}

/**
 * Creates the one serialized migration entry point used by fresh, legacy and
 * restored databases. `runSql` must execute one complete sqlite CLI input and
 * reject on a non-zero exit. `querySql` returns parsed rows for the same DB.
 */
export function createMigrationRunner({ runSql, querySql, migrations, now = () => Date.now() }) {
  if (typeof runSql !== "function" || typeof querySql !== "function") {
    throw new TypeError("数据库迁移 runner 需要 runSql 和 querySql。");
  }
  const orderedMigrations = normalizeMigrations(migrations);

  return async function runMigrations(options = {}) {
    await runSql(MIGRATION_TABLE_SQL);
    const appliedRows = await querySql("SELECT version, name, checksum FROM schema_migrations ORDER BY version;");
    const applied = new Map(appliedRows.map((row) => [Number(row.version), row]));
    const appliedNow = [];

    for (const migration of orderedMigrations) {
      const version = Number(migration.version);
      const checksum = migrationChecksum(migration);
      const previous = applied.get(version);
      if (previous) {
        if (previous.name !== migration.name || previous.checksum !== checksum) {
          throw new Error(`数据库迁移 ${version} 的名称或 checksum 与已记录版本不一致。`);
        }
        continue;
      }

      const startedAt = now();
      const sql = typeof migration.up === "function" ? await migration.up({ query: querySql, ...options }) : migration.sql;
      const durationMs = Math.max(0, Number(now()) - Number(startedAt));
      const migrationSql = String(sql || "").trim();
      const recordSql = `INSERT INTO schema_migrations (version, name, checksum, duration_ms)
VALUES (${version}, ${sqlString(migration.name)}, ${sqlString(checksum)}, ${durationMs});`;
      // `.bail on` makes sqlite stop at the first failed statement. Closing the
      // process with the transaction open rolls it back, so the record cannot
      // be written when the migration body fails.
      await runSql(`.bail on
BEGIN IMMEDIATE;
${migrationSql}
${recordSql}
COMMIT;`);
      appliedNow.push({ version, name: migration.name, checksum, durationMs });
    }
    return { applied: appliedNow, currentVersion: orderedMigrations.at(-1)?.version || 0 };
  };
}

export { MIGRATION_TABLE_SQL, migrationChecksum };
