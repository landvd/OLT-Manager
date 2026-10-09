// 抢修档案服务：夜间采集后识别断纤、飞书抢修验收存档、同缆组推断与提示、未解决问题记录。
// 只基于已有的 SNMP 只读结果和本地 SQLite，不对 OLT 做任何写操作。
import { detectPonOutage, groupOutageEvents, inferCableGroups, outagePonKey } from "./outage-events.mjs";

const CABLE_LOOKBACK_DAYS = 180;

function ponKeyFor(oltIp, vendor, { chassis, board, pon }) {
  return outagePonKey({ oltIp, chassis: String(vendor).toLowerCase() === "huawei" ? "0" : chassis, board, pon });
}

export function createFieldArchiveService({
  getOlts,
  getPonPorts = async () => [],
  recordOutageOccurrences,
  closeOutageOccurrences,
  getOutageOccurrences,
  recordRepairInspection,
  getRepairInspections,
  saveCableGroupCandidates,
  getCableGroups,
  recordUnresolvedQuestion,
  now = () => new Date(),
  log = () => {}
} = {}) {
  async function oltIndex() {
    const olts = await getOlts();
    return { byId: new Map(olts.map((olt) => [String(olt.id), olt])), byHost: new Map(olts.map((olt) => [String(olt.host), olt])) };
  }

  /** 夜间采集每台 OLT 后调用：按 PON 口识别断纤，已恢复的口关闭未结束的断纤记录。 */
  async function afterOltCapture(olt, rows = []) {
    const byPon = new Map();
    for (const row of rows) {
      const key = ponKeyFor(olt.host, olt.vendor, { chassis: row.chassis, board: row.board ?? row.slot, pon: row.pon });
      if (!byPon.has(key)) byPon.set(key, { coordinate: { chassis: String(row.chassis), board: String(row.board ?? row.slot), pon: String(row.pon) }, rows: [] });
      byPon.get(key).rows.push(row);
    }
    const detected = [];
    const healthy = [];
    for (const [key, { coordinate, rows: ponRows }] of byPon) {
      const outage = detectPonOutage(ponRows, { now: now() });
      if (outage) {
        detected.push({ oltIp: olt.host, ...coordinate, chassis: String(olt.vendor).toLowerCase() === "huawei" ? "0" : coordinate.chassis, ...outage });
      }
      if (!outage || outage.kind === "recovered") healthy.push(key);
    }
    const nowIso = now().toISOString();
    if (detected.length) await recordOutageOccurrences(detected, { now: nowIso });
    await closeOutageOccurrences(healthy, { now: nowIso });
    return { detected: detected.length };
  }

  /** 用最近半年的断纤记录重新推断同缆组候选。 */
  async function refreshCableGroups() {
    const since = new Date(now().getTime() - CABLE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const events = groupOutageEvents(await getOutageOccurrences({ since }));
    const groups = inferCableGroups(events);
    if (groups.length) await saveCableGroupCandidates(groups);
    return groups;
  }

  /** 飞书村级抢修验收完成后存档；整口离线的口同时记为一次正在进行的断纤。 */
  async function recordInspection({ queryValue, pons = [], outagePons = [], verdict = "", summary = {} } = {}) {
    try {
      const { byId } = await oltIndex();
      const keyOf = (item) => {
        const olt = byId.get(String(item.oltId));
        return olt ? { olt, key: ponKeyFor(olt.host, olt.vendor, item.pon) } : null;
      };
      const ponKeys = pons.map(keyOf).filter(Boolean).map((item) => item.key);
      await recordRepairInspection({ queryValue, ponKeys, verdict, summary });
      const outages = outagePons.map((item) => {
        const resolved = keyOf(item);
        if (!resolved) return null;
        return {
          oltIp: resolved.olt.host,
          chassis: String(resolved.olt.vendor).toLowerCase() === "huawei" ? "0" : String(item.pon.chassis),
          board: String(item.pon.board),
          pon: String(item.pon.pon),
          startedAt: now().toISOString(),
          kind: "ongoing",
          source: "feishu-query",
          affected: Number(item.configuredCount || 0),
          total: Number(item.configuredCount || 0)
        };
      }).filter(Boolean);
      if (outages.length) {
        await recordOutageOccurrences(outages, { now: now().toISOString() });
        await refreshCableGroups();
      }
    } catch (error) {
      log(`[field-archive] 抢修验收存档失败：${error?.message || error}`);
    }
  }

  /** 已审核的同缆组提示：这些口历史上和哪些口一起断过。 */
  async function cableHints(pons = []) {
    try {
      const { byId } = await oltIndex();
      const groups = await getCableGroups({ status: "active" });
      if (!groups.length) return [];
      const addresses = new Map();
      for (const port of await getPonPorts()) {
        const key = outagePonKey({ oltIp: port.oltIp, chassis: port.chassis, board: port.board ?? port.slot, pon: port.pon });
        if (!addresses.has(key) && port.address) addresses.set(key, String(port.address));
      }
      const hints = [];
      for (const item of pons) {
        const olt = byId.get(String(item.oltId));
        if (!olt) continue;
        const key = ponKeyFor(olt.host, olt.vendor, item.pon);
        const group = groups.find((candidate) => candidate.ponKeys.includes(key));
        if (!group) continue;
        hints.push({
          ponKey: key,
          pon: item.pon,
          together: group.together,
          partners: group.ponKeys.filter((partner) => partner !== key).map((partner) => {
            const [oltIp, path] = partner.split("|");
            return { ponKey: partner, oltIp, coordinate: path, address: addresses.get(partner) || "" };
          })
        });
      }
      return hints;
    } catch (error) {
      log(`[field-archive] 读取同缆组失败：${error?.message || error}`);
      return [];
    }
  }

  async function recordQuestion({ question, reason = "", source = "feishu" } = {}) {
    try {
      return await recordUnresolvedQuestion({ question, reason, source });
    } catch (error) {
      log(`[field-archive] 记录未解决问题失败：${error?.message || error}`);
      return null;
    }
  }

  /** 桌面端断纤事件列表：按时间归并，附上一级分光地址和相关的抢修验收。 */
  async function listEvents({ days = 90 } = {}) {
    const since = new Date(now().getTime() - days * 24 * 60 * 60 * 1000).toISOString();
    const [occurrences, inspections, ponPorts, { byHost }] = await Promise.all([
      getOutageOccurrences({ since }),
      getRepairInspections({ since: since.replace("T", " ").slice(0, 19) }),
      getPonPorts(),
      oltIndex()
    ]);
    const addresses = new Map();
    for (const port of ponPorts) {
      const key = outagePonKey({ oltIp: port.oltIp, chassis: port.chassis, board: port.board ?? port.slot, pon: port.pon });
      if (!addresses.has(key) && port.address) addresses.set(key, String(port.address));
    }
    return groupOutageEvents(occurrences).reverse().map((event) => {
      const start = Date.parse(event.startedAt);
      const related = inspections.filter((inspection) => {
        const time = Date.parse(`${String(inspection.inspectedAt).replace(" ", "T")}Z`);
        return inspection.ponKeys.some((key) => event.ponKeys.includes(key)) && time >= start - 6 * 3600 * 1000 && time <= start + 7 * 24 * 3600 * 1000;
      });
      return {
        ...event,
        pons: event.ponKeys.map((key) => {
          const [oltIp, path] = key.split("|");
          return { ponKey: key, oltIp, oltName: byHost.get(oltIp)?.name || oltIp, coordinate: path, address: addresses.get(key) || "" };
        }),
        inspections: related.map(({ id, queryValue, verdict, inspectedAt, summary }) => ({ id, queryValue, verdict, inspectedAt, summary }))
      };
    });
  }

  return Object.freeze({ afterOltCapture, refreshCableGroups, recordInspection, cableHints, recordQuestion, listEvents });
}
