// 夜间光功率基线采集调度：每天固定整点对已启用 OLT 逐台做一次只读 SNMP 读取，
// 只保存坐标、在线状态和收光功率。电脑夜间关机错过采集时，开机后在当天补采一次。
import { localDateKey } from "./optical-baseline.mjs";
import { defaultChassisForVendor, normalizePonCoordinate, ponCoordinateKey } from "./pon-coordinate.mjs";

const MAX_TIMER_DELAY_MS = 2_147_000_000;
const CATCH_UP_DELAY_MS = 2 * 60 * 1000;

function requireFunction(value, name) {
  if (typeof value !== "function") throw new TypeError(`夜间光功率采集调度缺少依赖：${name}。`);
  return value;
}

/**
 * 一台 OLT 需要采集的 PON 口：PON 台账与合并台账中出现过的坐标取并集。
 * 现有 SNMP 只读查询都按单个 PON 口读取（先编码 PON 索引再 walk），不支持整机一次读取。
 */
export function baselinePonsForOlt(olt, { ponPorts = [], snapshotPons = [] } = {}) {
  const host = String(olt?.host || "").trim();
  const vendor = String(olt?.vendor || "").trim().toLowerCase();
  const pons = new Map();
  // hasUsers：合并台账中有用户的口；只在 PON 台账出现的口多半是空口，未返回数据属正常。
  const add = (row, hasUsers) => {
    const coordinate = normalizePonCoordinate(row, { vendor });
    // 华为机框固定为 0，与查询网关的处理保持一致。
    const chassis = vendor === "huawei" ? "0" : coordinate.chassis || defaultChassisForVendor(vendor);
    const key = ponCoordinateKey({ ...coordinate, chassis });
    if (!key || !/^\d+$/.test(coordinate.board) || !/^\d+$/.test(coordinate.pon)) return;
    const existing = pons.get(key);
    if (existing) existing.hasUsers ||= hasUsers;
    else pons.set(key, { chassis, board: coordinate.board, pon: coordinate.pon, hasUsers });
  };
  for (const port of ponPorts) if (String(port?.oltIp || "").trim() === host) add(port, false);
  for (const row of snapshotPons) if (String(row?.oltIp || "").trim() === host) add(row, true);
  return [...pons.values()].sort((left, right) =>
    Number(left.chassis) - Number(right.chassis) || Number(left.board) - Number(right.board) || Number(left.pon) - Number(right.pon));
}

/** 逐个 PON 口读取（限制并发），某个口没有数据或读取失败不影响其它口。 */
export async function collectOltRowsByPon({ pons = [], readPon, concurrency = 2, onProgress = () => {} } = {}) {
  const rows = [];
  let emptyPons = 0;
  let failedPons = 0;
  const missingWithUsers = [];
  let done = 0;
  let next = 0;
  const worker = async () => {
    while (next < pons.length) {
      const pon = pons[next];
      next += 1;
      try {
        const result = await readPon(pon);
        const ponRows = (Array.isArray(result) ? result : []).filter((row) =>
          String(row?.board ?? row?.slot ?? "") === pon.board && String(row?.pon ?? "") === pon.pon);
        if (ponRows.length) rows.push(...ponRows);
        else {
          emptyPons += 1;
          if (pon.hasUsers) missingWithUsers.push(ponCoordinateKey(pon));
        }
      } catch {
        failedPons += 1;
        if (pon.hasUsers) missingWithUsers.push(ponCoordinateKey(pon));
      }
      done += 1;
      onProgress({ ponDone: done, ponTotal: pons.length });
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, pons.length)) }, worker));
  return { rows, ponCount: pons.length, emptyPons, failedPons, missingWithUsers: missingWithUsers.sort() };
}

/** 下一次整点采集时间（本机时区）。 */
export function nextBaselineRunAt(now, runHour) {
  const next = new Date(now.getTime());
  next.setHours(runHour, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next;
}

/** 当天已过采集整点但还没有成功采集时，需要补采。 */
export function needsCatchUp({ now, runHour, lastSuccessDate }) {
  return now.getHours() >= runHour && String(lastSuccessDate || "") < localDateKey(now);
}

export function createOpticalBaselineScheduler({
  getSettings,
  getOlts,
  readOltRows,
  recordSamples,
  beginRun,
  finishRun,
  getRuns,
  markInterrupted = async () => {},
  onOltRows = null,
  onRunComplete = null,
  now = () => new Date(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  log = () => {}
} = {}) {
  for (const [name, value] of Object.entries({ getSettings, getOlts, readOltRows, recordSamples, beginRun, finishRun, getRuns })) {
    requireFunction(value, name);
  }
  let timer = null;
  let started = false;
  let running = null;
  let nextRunAt = "";
  let progress = null;

  function clear() {
    if (timer) clearTimer(timer);
    timer = null;
    nextRunAt = "";
  }

  function arm(delayMs, at) {
    clear();
    nextRunAt = at.toISOString();
    timer = setTimer(() => {
      timer = null;
      void runNow({ trigger: "schedule" }).catch(() => {}).finally(() => { if (started) void reschedule(); });
    }, Math.min(Math.max(0, delayMs), MAX_TIMER_DELAY_MS));
    timer?.unref?.();
  }

  async function lastSuccessDate() {
    const runs = await getRuns({ limit: 20 });
    return runs.find((run) => run.status === "success" || run.status === "partial")?.sampleDate || "";
  }

  async function reschedule({ allowCatchUp = false } = {}) {
    clear();
    if (!started) return;
    const settings = await getSettings();
    if (!settings.enabled) return;
    const current = now();
    if (allowCatchUp && needsCatchUp({ now: current, runHour: settings.runHour, lastSuccessDate: await lastSuccessDate() })) {
      arm(CATCH_UP_DELAY_MS, new Date(current.getTime() + CATCH_UP_DELAY_MS));
      return;
    }
    const next = nextBaselineRunAt(current, settings.runHour);
    arm(next.getTime() - current.getTime(), next);
  }

  async function capture(trigger) {
    const startedAt = now();
    const sampleDate = localDateKey(startedAt);
    const runId = await beginRun({ sampleDate, trigger, startedAt: startedAt.toISOString() });
    let oltCount = 0;
    let failedOltCount = 0;
    let onuCount = 0;
    const errors = [];
    try {
      const olts = (await getOlts()).filter((olt) => olt.enabled !== false);
      for (const olt of olts) {
        oltCount += 1;
        const label = olt.name || olt.id;
        progress = { oltIndex: oltCount, oltCount: olts.length, oltName: label, ponDone: 0, ponTotal: 0 };
        try {
          const result = await readOltRows(olt, { onProgress: (update) => { progress = { ...progress, ...update }; } });
          const rows = Array.isArray(result) ? result : result?.rows;
          if (!Array.isArray(rows) || rows.length === 0) {
            throw new Error(result?.ponCount ? `${result.ponCount} 个 PON 口均未返回 ONU 数据` : "设备未返回 ONU 数据");
          }
          const stored = await recordSamples({ oltId: olt.id, sampleDate, sampledAt: now().toISOString(), rows });
          onuCount += Number(stored?.count || 0);
          // 顺带识别断纤（抢修档案）；失败不影响采集结果。
          if (typeof onOltRows === "function") {
            try {
              await onOltRows(olt, rows);
            } catch (error) {
              log(`[optical-baseline] ${label} 断纤识别失败：${error?.message || error}`);
            }
          }
          // 只提示合并台账里有用户却没返回数据的口；纯空口不再逐晚报出。
          const missing = Array.isArray(result?.missingWithUsers) ? result.missingWithUsers : [];
          if (missing.length) {
            const sample = missing.slice(0, 5).join("、");
            errors.push(`${label}：${missing.length} 个有用户的 PON 口未返回数据（${sample}${missing.length > 5 ? " 等" : ""}）`);
          }
        } catch (error) {
          failedOltCount += 1;
          errors.push(`${olt.name || olt.id}：${error?.message || "读取失败"}`);
          log(`[optical-baseline] ${olt.name || olt.id} 采集失败：${error?.message || error}`);
        }
      }
      progress = null;
      if (typeof onRunComplete === "function") {
        try {
          await onRunComplete();
        } catch (error) {
          log(`[optical-baseline] 采集后处理失败：${error?.message || error}`);
        }
      }
      const status = oltCount === 0 ? "failed" : failedOltCount === 0 ? "success" : failedOltCount < oltCount ? "partial" : "failed";
      await finishRun({ id: runId, status, oltCount, failedOltCount, onuCount, error: oltCount === 0 ? "没有已启用的 OLT" : errors.join("；"), completedAt: now().toISOString() });
      return { status, sampleDate, oltCount, failedOltCount, onuCount, errors };
    } catch (error) {
      progress = null;
      await finishRun({ id: runId, status: "failed", oltCount, failedOltCount, onuCount, error: error?.message || "采集失败", completedAt: now().toISOString() });
      throw error;
    }
  }

  async function runNow({ trigger = "manual" } = {}) {
    if (running) {
      const error = new Error("夜间光功率采集正在进行，请稍后再试。");
      error.status = 409;
      throw error;
    }
    running = capture(trigger);
    try {
      return await running;
    } finally {
      running = null;
    }
  }

  return Object.freeze({
    async start() {
      if (started) return;
      started = true;
      await markInterrupted();
      await reschedule({ allowCatchUp: true });
    },
    stop() {
      started = false;
      clear();
    },
    reschedule: () => reschedule(),
    runNow,
    async status() {
      const [settings, runs] = await Promise.all([getSettings(), getRuns({ limit: 5 })]);
      return { ...settings, running: Boolean(running), progress: running ? progress : null, nextRunAt, recentRuns: runs };
    }
  });
}
