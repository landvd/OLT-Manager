// 资料包（ADR-088）：在 Mac 和 Windows 之间搬运内勤维护的资料。
// 导入时只整类替换所选资料，其余数据（飞书配置、查询日志、夜间采样、抢修档案、台账同步结果）一律不动。
import { exec, query, runSql, sqlQuote } from "./core.mjs";
import { createDatabaseBackup } from "./backup.mjs";
import { ensurePlaceAssignments } from "./places.mjs";

export const DATA_PACKAGE_FORMAT = "olt-manager/data-package/v1";

export const DATA_PACKAGE_CATEGORIES = Object.freeze({
  places: { label: "用户归属", tables: ["pon_place_assignments", "place_rules", "onu_place_overrides"] },
  regions: { label: "区域字典", tables: ["village_regions"] },
  ponLedger: { label: "PON 台账", tables: ["pon_ports"] },
  agentKnowledge: { label: "Gd 知识与资料修正", tables: ["agent_learned_memories", "agent_user_corrections"] }
});

const CORRECTION_COLUMNS = Object.freeze({ userPhone: "user_phone", installationAddress: "installation_address" });

function packageError(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function selectedCategories(categories) {
  const list = Array.isArray(categories) ? categories : String(categories || "").split(",");
  const keys = [...new Set(list.map((item) => String(item).trim()).filter(Boolean))];
  const unknown = keys.find((key) => !DATA_PACKAGE_CATEGORIES[key]);
  if (unknown) throw packageError(`未知的资料类别：${unknown}`);
  if (!keys.length) throw packageError("至少选择一类资料。");
  return keys;
}

async function tableColumns(table) {
  return (await query(`PRAGMA table_info(${table});`)).map((column) => column.name);
}

async function schemaVersion() {
  const [row] = await query("SELECT max(version) AS version FROM schema_migrations;");
  return Number(row?.version || 0);
}

/** 导出所选资料：每张表记录列名和行（按列顺序的数组）。 */
export async function exportDataPackage({ categories = Object.keys(DATA_PACKAGE_CATEGORIES), appVersion = "", platform = process.platform } = {}) {
  const keys = selectedCategories(categories);
  const result = {};
  for (const key of keys) {
    const tables = {};
    for (const table of DATA_PACKAGE_CATEGORIES[key].tables) {
      const columns = await tableColumns(table);
      if (!columns.length) throw packageError(`本机数据库缺少表 ${table}，请先升级程序。`);
      const rows = await query(`SELECT ${columns.join(", ")} FROM ${table} ORDER BY rowid;`);
      tables[table] = { columns, rows: rows.map((row) => columns.map((column) => row[column] ?? null)) };
    }
    result[key] = { tables };
  }
  return {
    format: DATA_PACKAGE_FORMAT,
    createdAt: new Date().toISOString(),
    appVersion: String(appVersion || ""),
    platform: String(platform || ""),
    schemaVersion: await schemaVersion(),
    categories: result
  };
}

function validatePackage(pkg) {
  if (!pkg || pkg.format !== DATA_PACKAGE_FORMAT || typeof pkg.categories !== "object" || Array.isArray(pkg.categories)) {
    throw packageError("不是 OLT Manager 资料包，或资料包版本不兼容。");
  }
  for (const [key, category] of Object.entries(pkg.categories)) {
    const definition = DATA_PACKAGE_CATEGORIES[key];
    if (!definition) throw packageError(`资料包包含未知类别：${key}`);
    for (const table of definition.tables) {
      const entry = category?.tables?.[table];
      if (!entry || !Array.isArray(entry.columns) || !Array.isArray(entry.rows) ||
          entry.rows.some((row) => !Array.isArray(row) || row.length !== entry.columns.length)) {
        throw packageError(`资料包中 ${definition.label}（${table}）格式不正确。`);
      }
    }
  }
}

/** 预览：资料包来源和每类资料的条数（包内 / 本机）。 */
export async function inspectDataPackage(pkg) {
  validatePackage(pkg);
  const categories = [];
  for (const [key, definition] of Object.entries(DATA_PACKAGE_CATEGORIES)) {
    const tables = [];
    for (const table of definition.tables) {
      const [row] = await query(`SELECT count(*) AS total FROM ${table};`);
      tables.push({ table, packageRows: pkg.categories[key]?.tables?.[table]?.rows.length ?? null, localRows: Number(row?.total || 0) });
    }
    categories.push({ key, label: definition.label, included: Boolean(pkg.categories[key]), tables });
  }
  return {
    createdAt: String(pkg.createdAt || ""),
    appVersion: String(pkg.appVersion || ""),
    platform: String(pkg.platform || ""),
    schemaVersion: Number(pkg.schemaVersion || 0),
    localSchemaVersion: await schemaVersion(),
    categories
  };
}

/**
 * 导入：先做一次数据库备份，再在一个事务里整类替换所选资料。
 * 只写入两边都有的列；资料修正中已通过的电话 / 地址会立即写回合并台账（与审核通过时一致）。
 */
export async function importDataPackage(pkg, { categories, confirmed = false } = {}) {
  if (confirmed !== true) throw packageError("导入资料包需要明确确认。");
  validatePackage(pkg);
  const keys = selectedCategories(categories ?? Object.keys(pkg.categories));
  const missing = keys.find((key) => !pkg.categories[key]);
  if (missing) throw packageError(`资料包里没有${DATA_PACKAGE_CATEGORIES[missing].label}。`);
  const backup = await createDatabaseBackup({ reason: "data-package-import" });
  const statements = [];
  const imported = [];
  for (const key of keys) {
    for (const table of DATA_PACKAGE_CATEGORIES[key].tables) {
      const entry = pkg.categories[key].tables[table];
      const localColumns = await tableColumns(table);
      if (!localColumns.length) throw packageError(`本机数据库缺少表 ${table}，请先升级程序。`);
      const indexes = entry.columns.map((column, index) => (localColumns.includes(column) ? index : -1)).filter((index) => index >= 0);
      const columns = indexes.map((index) => entry.columns[index]);
      statements.push(`DELETE FROM ${table};`);
      for (let start = 0; start < entry.rows.length; start += 300) {
        const values = entry.rows.slice(start, start + 300).map((row) => `(${indexes.map((index) => sqlQuote(row[index])).join(", ")})`);
        statements.push(`INSERT INTO ${table} (${columns.join(", ")}) VALUES ${values.join(",\n")};`);
      }
      imported.push({ category: key, table, rows: entry.rows.length });
    }
  }
  if (keys.includes("agentKnowledge")) {
    for (const [field, column] of Object.entries(CORRECTION_COLUMNS)) {
      statements.push(`UPDATE merged_onu_snapshots SET ${column} = (
  SELECT value FROM agent_user_corrections AS c
  WHERE c.status = 'active' AND c.field = ${sqlQuote(field)} AND c.loid <> '' AND upper(trim(c.loid)) = upper(trim(merged_onu_snapshots.loid))
  ORDER BY c.id DESC LIMIT 1)
WHERE EXISTS (SELECT 1 FROM agent_user_corrections AS c
  WHERE c.status = 'active' AND c.field = ${sqlQuote(field)} AND c.loid <> '' AND upper(trim(c.loid)) = upper(trim(merged_onu_snapshots.loid)));`);
    }
  }
  await runSql(`BEGIN IMMEDIATE;\n${statements.join("\n")}\nCOMMIT;`);
  const places = await ensurePlaceAssignments({ force: true });
  return { ok: true, imported, backupPath: backup?.path || "", placesRecomputed: places.changed };
}

/**
 * 从其他操作系统还原整库后，本机只是副本：暂停定时同步和夜间采集，避免与原机器重复读取网管和 OLT。
 */
export async function pauseScheduledWorkForCopy() {
  await exec(`UPDATE optical_baseline_settings SET enabled = 0;
UPDATE resource_sync_tasks SET status = 'failed', error = '从其他系统还原的副本，已暂停定时同步；需要时请重新创建任务。'
WHERE status IN ('pending', 'running');`);
  return { paused: true };
}
