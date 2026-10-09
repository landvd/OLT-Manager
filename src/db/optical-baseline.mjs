// 夜间光功率基线采样、运行记录与调度设置。
import { exec, query, sqlQuote } from "./core.mjs";
import { BASELINE_RETENTION_DAYS, nightlySampleRows, shiftDateKey } from "../optical-baseline.mjs";

const INSERT_CHUNK = 500;

function sqlNumber(value) {
  return Number.isFinite(value) ? String(value) : "NULL";
}

/** 写入一台 OLT 某晚的采样（同一晚重复采集时覆盖），并清理保留期之前的数据。 */
export async function recordOpticalNightlySamples({ oltId, sampleDate, sampledAt = new Date().toISOString(), rows = [] } = {}) {
  const id = String(oltId || "").trim();
  const date = String(sampleDate || "").trim();
  if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("夜间光功率采样缺少 OLT 或日期。");
  const samples = nightlySampleRows(rows);
  if (!samples.length) return { count: 0 };
  const statements = [];
  for (let index = 0; index < samples.length; index += INSERT_CHUNK) {
    const values = samples.slice(index, index + INSERT_CHUNK).map((sample) =>
      `(${[id, sample.chassis, sample.board, sample.pon, sample.onuId, date, sample.phase].map(sqlQuote).join(", ")}, ${sqlNumber(sample.rxDbm)}, ${sqlQuote(sampledAt)})`);
    statements.push(`INSERT OR REPLACE INTO onu_optical_nightly_samples (olt_id, chassis, board, pon, onu_id, sample_date, phase, rx_dbm, sampled_at) VALUES\n${values.join(",\n")};`);
  }
  await exec(`BEGIN;
${statements.join("\n")}
DELETE FROM onu_optical_nightly_samples WHERE sample_date < ${sqlQuote(shiftDateKey(date, -BASELINE_RETENTION_DAYS))};
COMMIT;`);
  return { count: samples.length };
}

export async function getOpticalNightlySamples({ oltId, chassis, board, pon, sinceDate = "" } = {}) {
  const clauses = [
    `olt_id = ${sqlQuote(String(oltId || ""))}`,
    `chassis = ${sqlQuote(String(chassis ?? ""))}`,
    `board = ${sqlQuote(String(board ?? ""))}`,
    `pon = ${sqlQuote(String(pon ?? ""))}`
  ];
  if (sinceDate) clauses.push(`sample_date >= ${sqlQuote(sinceDate)}`);
  const rows = await query(`SELECT onu_id, sample_date, phase, rx_dbm FROM onu_optical_nightly_samples WHERE ${clauses.join(" AND ")} ORDER BY sample_date, onu_id;`);
  return rows.map((row) => ({
    onuId: String(row.onu_id),
    sampleDate: String(row.sample_date),
    phase: String(row.phase || "unknown"),
    rxDbm: row.rx_dbm === null || row.rx_dbm === undefined ? null : Number(row.rx_dbm)
  }));
}

export async function beginOpticalBaselineRun({ sampleDate, trigger = "schedule", startedAt = new Date().toISOString() } = {}) {
  const [row] = await query(`INSERT INTO optical_baseline_runs (sample_date, trigger, status, started_at)
VALUES (${[sampleDate, trigger === "manual" ? "manual" : "schedule", "running", startedAt].map(sqlQuote).join(", ")});
SELECT last_insert_rowid() AS id;`);
  return Number(row?.id || 0);
}

export async function finishOpticalBaselineRun({ id, status, oltCount = 0, failedOltCount = 0, onuCount = 0, error = "", completedAt = new Date().toISOString() } = {}) {
  await exec(`UPDATE optical_baseline_runs SET
status = ${sqlQuote(status)},
olt_count = ${Number(oltCount) || 0},
failed_olt_count = ${Number(failedOltCount) || 0},
onu_count = ${Number(onuCount) || 0},
error = ${sqlQuote(String(error || "").slice(0, 500))},
completed_at = ${sqlQuote(completedAt)}
WHERE id = ${Number(id) || 0};`);
}

function mapRun(row) {
  return {
    id: Number(row.id),
    sampleDate: row.sample_date,
    trigger: row.trigger,
    status: row.status,
    oltCount: Number(row.olt_count || 0),
    failedOltCount: Number(row.failed_olt_count || 0),
    onuCount: Number(row.onu_count || 0),
    error: row.error || "",
    startedAt: row.started_at,
    completedAt: row.completed_at || ""
  };
}

export async function getOpticalBaselineRuns({ limit = 10 } = {}) {
  const rows = await query(`SELECT * FROM optical_baseline_runs ORDER BY id DESC LIMIT ${Math.max(1, Math.min(100, Number(limit) || 10))};`);
  return rows.map(mapRun);
}

/** 启动时把上次异常退出遗留的 running 记录标记为中断。 */
export async function markInterruptedOpticalBaselineRuns() {
  await exec("UPDATE optical_baseline_runs SET status = 'interrupted', completed_at = CURRENT_TIMESTAMP WHERE status = 'running';");
}

export async function getOpticalBaselineSettings() {
  const [row] = await query("SELECT enabled, run_hour, updated_at FROM optical_baseline_settings WHERE id = 1;");
  return {
    enabled: row ? Number(row.enabled) === 1 : true,
    runHour: row ? Number(row.run_hour) : 2,
    updatedAt: row?.updated_at || ""
  };
}

export async function saveOpticalBaselineSettings({ enabled, runHour } = {}) {
  const current = await getOpticalBaselineSettings();
  const nextEnabled = enabled === undefined ? current.enabled : Boolean(enabled);
  const hour = runHour === undefined ? current.runHour : Number(runHour);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error("采集时间必须是 0–23 点之间的整点。");
  await exec(`INSERT INTO optical_baseline_settings (id, enabled, run_hour, updated_at) VALUES (1, ${nextEnabled ? 1 : 0}, ${hour}, CURRENT_TIMESTAMP)
ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled, run_hour = excluded.run_hour, updated_at = CURRENT_TIMESTAMP;`);
  return getOpticalBaselineSettings();
}

export async function getOpticalBaselineCoverage() {
  const [row] = await query("SELECT count(DISTINCT sample_date) AS nights, min(sample_date) AS first_date, max(sample_date) AS last_date, count(*) AS samples FROM onu_optical_nightly_samples;");
  return {
    nights: Number(row?.nights || 0),
    firstDate: row?.first_date || "",
    lastDate: row?.last_date || "",
    samples: Number(row?.samples || 0)
  };
}
