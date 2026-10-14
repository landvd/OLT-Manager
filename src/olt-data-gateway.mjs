import { defaultChassisForVendor } from "./pon-coordinate.mjs";
import { placeLabel, placeMatchesTarget, ponPlaceKey, resolvePlaceTarget } from "./onu-places.mjs";
import { comparePonRepair, localDateKey, shiftDateKey } from "./optical-baseline.mjs";
import { groupOutageEvents, outagePonKey } from "./outage-events.mjs";
import {
  addressInVillage,
  addressMatchesRegion,
  countRegionCoverage,
  discoverVillageSubgroups,
  isSparsePon,
  normalizeAddressText,
  resolveRegionPons,
  resolveVillageRegion,
  transferRegions
} from "./village-regions.mjs";

const INTENT_FIELDS = Object.freeze({
  find_by_name: "username",
  find_by_phone: "userPhone",
  find_by_address: "installationAddress",
  find_by_sn: "serialNumber",
  find_by_loid: "loid",
  find_by_mac: "mac",
  find_by_onu_coordinate: "onuIndex"
});

const UNSUPPORTED_ONU_DETAIL_FIELDS = Object.freeze([
  "type",
  "configuredChannel",
  "currentChannel",
  "adminState",
  "configState",
  "authenticationMode",
  "snBind",
  "password",
  "vportMode",
  "dbaMode",
  "onuStatus",
  "omciBwProfile",
  "lineProfile",
  "serviceProfile",
  "onlineDuration",
  "fec",
  "fecActualMode",
  "ppsTod",
  "autoReplace",
  "multicastEncryption",
  "authHistory"
]);

const VERIFIED_ONU_DETAIL_VENDORS = new Set(["zte"]);
const MAX_QUERY_CANDIDATES = 100;
const MAX_VILLAGE_PON_PAGE = 20;

function contractError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function capabilityError(code, message, statusCode = 503) {
  return Object.assign(new Error(message), { code, statusCode });
}

function requiredText(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw contractError(`Missing ${label}.`);
  return normalized;
}

function validIpv4(value) {
  const parts = String(value ?? "").trim().split(".");
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}

function parseCoordinate(value) {
  const [path = "", onuId = ""] = String(value || "").split(":", 2);
  const [chassis = "", board = "", pon = ""] = path.split("/", 3);
  return { chassis, board, pon, onuId };
}

function normalizeCoordinate(value = {}) {
  return {
    chassis: requiredText(value.chassis, "ONU chassis"),
    board: requiredText(value.board ?? value.slot, "ONU board"),
    pon: requiredText(value.pon, "ONU PON"),
    onuId: requiredText(value.onuId, "ONU ID")
  };
}

function normalizePonCoordinate(value = {}) {
  return {
    chassis: requiredText(value.chassis, "PON chassis"),
    board: requiredText(value.board ?? value.slot, "PON board"),
    pon: requiredText(value.pon, "PON port")
  };
}

function hasReadableRxPower(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) && ![65535, 65534, 2147483647].includes(Math.abs(value));
  }
  const raw = String(value ?? "").trim();
  if (!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:\s*dBm)?$/iu.test(raw)) return false;
  const number = Number(raw.replace(/\s*dBm$/iu, ""));
  return Number.isFinite(number) && ![65535, 65534, 2147483647].includes(Math.abs(number));
}

function normalizeDate(value, label) {
  const normalized = requiredText(value, label);
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(normalized)
    ? Date.parse(`${normalized}T00:00:00Z`) : NaN;
  const roundTrip = Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === normalized;
  if (!roundTrip) {
    throw contractError(`${label} must be an ISO date (YYYY-MM-DD).`);
  }
  return normalized;
}

function normalizeHistoricalOpticalRow(row) {
  if (!row || typeof row !== "object" || !String(row.reportTime || "").trim()) {
    throw capabilityError("HISTORICAL_OPTICAL_INVALID_RESPONSE",
      "网管二期历史光功率返回了无法识别的记录。", 502);
  }
  const numericOrNull = (value) => value === null || value === undefined || value === ""
    ? null
    : Number.isFinite(Number(value)) ? Number(value) : (() => {
      throw capabilityError("HISTORICAL_OPTICAL_INVALID_RESPONSE",
        "网管二期历史光功率包含无法识别的数值。", 502);
    })();
  return {
    reportTime: String(row.reportTime),
    rxOptical: numericOrNull(row.rxOptical),
    txOptical: numericOrNull(row.txOptical),
    oltRxOptical: numericOrNull(row.oltRxOptical),
    lightDecay: numericOrNull(row.lightDecay)
  };
}

function safeLiveStatus(row) {
  return {
    phase: String(row.phase || "unknown"),
    rxPower: String(row.rxPower || "unknown"),
    distance: String(row.distance || "unknown"),
    serial: String(row.serial || "unknown"),
    name: String(row.name || "")
  };
}

function safeOlt(olt) {
  return {
    oltId: String(olt.id),
    name: String(olt.name || olt.id),
    ip: String(olt.host || ""),
    vendor: String(olt.vendor || ""),
    model: String(olt.model || ""),
    enabled: olt.enabled !== false
  };
}

function ponAddressFor(ponPorts, olt, onu) {
  const exact = (ponPorts ?? []).find((port) =>
    String(port.oltIp || "") === String(olt.host || "") &&
    String(port.chassis || "") === String(onu.chassis || "") &&
    String(port.board || "") === String(onu.board || "") &&
    String(port.pon || "") === String(onu.pon || "")
  );
  if (exact) return String(exact.address || "");
  const withoutChassis = (ponPorts ?? []).find((port) =>
    String(port.oltIp || "") === String(olt.host || "") &&
    String(port.board || "") === String(onu.board || "") &&
    String(port.pon || "") === String(onu.pon || "")
  );
  return String(withoutChassis?.address || "");
}

function userCandidate(row, oltId, primaryAddress = "") {
  const onu = parseCoordinate(row.onuIndex);
  const candidate = {
    candidateId: `${oltId}:${row.onuIndex}`,
    oltId,
    name: String(row.username || ""),
    phone: String(row.userPhone || ""),
    address: String(row.installationAddress || ""),
    loid: String(row.loid || ""),
    mac: String(row.mac || ""),
    primaryAddress: String(primaryAddress || ""),
    onu,
    snapshotAt: row.syncedAt || null
  };
  if (row.serialNumber || row.serial) {
    candidate.serialNumber = String(row.serialNumber || row.serial);
  }
  if (row.deviceNumber) {
    candidate.deviceNumber = String(row.deviceNumber);
  }
  // 用户归属（村 · 小组 · 小区），来自合并台账的归属列（ADR-087）。
  const place = placeLabel(row);
  if (place) candidate.place = place;
  // 当天装机工单（ADR-090）：还没合并进台账，资料来自一期网管。
  if (row.source === "boss-recent") candidate.recentInstall = true;
  return candidate;
}

function includesNormalized(value, search) {
  return String(value || "").trim().toLocaleLowerCase("zh-Hans-CN")
    .includes(search.toLocaleLowerCase("zh-Hans-CN"));
}

function searchValueVariants(value, label) {
  const original = requiredText(value, label);
  const variants = [original];
  let natural = original.replace(/\s+/g, " ").trim();
  for (let index = 0; index < 3; index += 1) {
    const next = natural
      .replace(/^(?:请|麻烦|帮忙|帮我|帮查|查询一下|查询|查一下|查查|查找|查|找一下|找|搜索|定位|看一下|看看|看)\s*[:：,，。-]*/i, "")
      .trim();
    if (next === natural) break;
    natural = next;
  }
  let trimmed = natural;
  for (let index = 0; index < 3; index += 1) {
    const next = trimmed
      .replace(/\s*(?:的)?(?:ONU|ONT|用户|客户|光功率|状态|详情|信息|位置|端口|PON口|pon口|在线情况|在哪里|在哪儿|在哪|情况)[?？。！!,，、\s]*$/i, "")
      .trim();
    if (next === trimmed) break;
    trimmed = next;
  }
  variants.push(natural, trimmed);
  const compact = original.replace(/\s+/g, "");
  if (compact !== original) variants.push(compact);
  const digits = original.replace(/\D/g, "");
  if (digits.length >= 4) variants.push(digits);
  return [...new Set(variants.map((item) => item.trim()).filter(Boolean))];
}

function deviceNumberSearchVariants(value) {
  const original = requiredText(value, "device number");
  const labeled = original.replace(/\s+/g, " ").replace(/^(?:请|麻烦|帮忙|帮我|帮查|查询一下|查询|查一下|查查|查找|查|找一下|找|搜索|定位|看一下|看看|看)?\s*(?:ONU\s*)?(?:设备号|设备编号|设备号码|设备ID)\s*(?:查询|是|为|[:：=])?\s*/iu, "").trim();
  const values = labeled && labeled !== original ? [labeled, original] : [original];
  return [...new Set(values.flatMap((item) => searchValueVariants(item, "device number")))];
}

function userSearchValue(row, field) {
  if (field === "serialNumber") return row.serialNumber || row.serial || "";
  return row[field];
}

function matchesPonAddress(value, search) {
  if (includesNormalized(value, search)) return true;
  const withoutVillageSuffix = String(search).trim().replace(/村$/, "");
  return withoutVillageSuffix.length >= 2 &&
    withoutVillageSuffix !== String(search).trim() &&
    includesNormalized(value, withoutVillageSuffix);
}

function matchesPonTarget(port, search) {
  if (matchesPonAddress(port?.address, search)) return true;
  const str = String(search || "").trim();
  const m = str.match(/((?:\d{1,3}\.){1,3}\d{1,3})\s*(?:[/_\s]|gpon[-_]olt[-_])\s*(?:(\d+)[/_-])?(\d+)[/_-](\d+)/i);
  if (m) {
    const ipPart = m[1];
    const chassisPart = m[2];
    const boardPart = m[3];
    const ponPart = m[4];
    const portIp = String(port?.oltIp || "");
    if (portIp.endsWith(ipPart) || portIp === ipPart || portIp.includes(ipPart)) {
      if (String(port?.board) === String(boardPart) && String(port?.pon) === String(ponPart)) {
        if (!chassisPart || String(port?.chassis) === String(chassisPart)) {
          return true;
        }
      }
    }
  }
  return false;
}

function isOnlinePhase(value) {
  const phase = String(value ?? "").trim().toLowerCase();
  return new Set(["online", "working", "active", "up", "ready", "在线", "工作中", "就绪"]).has(phase);
}

function isConfirmedOfflinePhase(value) {
  const phase = String(value ?? "").trim().toLowerCase();
  return new Set([
    "offline", "los", "losi", "dyinggasp", "authfailed", "down",
    "离线", "光路中断", "掉电"
  ]).has(phase);
}

// 弱光门限：接收光功率不高于 -27 dBm（与抽测“实时光功率合格”门限一致）。
const WEAK_RX_DBM = -27;

function userMatchesVillage(row, search, transfers = []) {
  if (!transfers.length) return includesNormalized(row?.installationAddress, search);
  return addressInVillage(row?.installationAddress, search, transfers);
}

export function createOltDataGateway({
  getOlts,
  getUsers,
  getPonPorts,
  getDatasetRevision,
  listOnus,
  getOnuStatusHistory = async () => [],
  readHistoricalOptical = null,
  getOpticalNightlySamples = null,
  getLatestOpticalSamples = null,
  getOutageOccurrences = null,
  getVillageRegions = async () => [],
  // 按 PON 台账行指定的归属（ADR-087）；用于把没有用户的口也算进村 / 小组 / 小区。
  getPortPlaceAssignments = async () => [],
  saveVillageRegionCandidates = null,
  getDatasetFreshness = null,
  now = () => new Date()
}) {
  if (typeof getOlts !== "function" || typeof getUsers !== "function" ||
      typeof getPonPorts !== "function" || typeof getDatasetRevision !== "function" ||
      typeof listOnus !== "function") {
    throw new TypeError("OltDataGateway adapters are required.");
  }

  async function resolveOlts(oltIds) {
    if (!Array.isArray(oltIds) || oltIds.length === 0) throw contractError("Missing Authorized OLT scope.");
    const requested = [...new Set(oltIds.map((id) => requiredText(id, "OLT ID")))];
    const all = await getOlts();
    const byId = new Map(all.map((olt) => [String(olt.id), olt]));
    const unknown = requested.find((id) => !byId.has(id));
    if (unknown) throw contractError("Unknown OLT in Authorized OLT scope.");
    const disabled = requested.find((id) => byId.get(id).enabled === false);
    if (disabled) throw contractError("Disabled OLT in Authorized OLT scope.");
    return requested.map((id) => byId.get(id));
  }

  async function queryUsersImpl({ intent, value, oltIds, limit = 10 } = {}) {
    const field = INTENT_FIELDS[intent];
    if (!field) throw contractError("Unsupported user query intent.");
    const searches = intent === "find_by_loid"
      ? [requiredText(value, "LOID")]
      : searchValueVariants(value, "search value");
    const scopedOlts = await resolveOlts(oltIds);
    const ponPorts = await getPonPorts();
    let candidates = [];
    for (const search of searches) {
      const nextCandidates = [];
      for (const olt of scopedOlts) {
        const rows = await getUsers({ oltIp: olt.host, q: search });
        for (const row of rows) {
          const matches = intent === "find_by_loid"
            ? String(userSearchValue(row, field) || "").trim().toLocaleLowerCase("zh-Hans-CN") ===
              String(search).trim().toLocaleLowerCase("zh-Hans-CN")
            : includesNormalized(userSearchValue(row, field), search);
          if (matches) {
            const onu = parseCoordinate(row.onuIndex);
            nextCandidates.push(userCandidate(row, String(olt.id), ponAddressFor(ponPorts, olt, onu)));
          }
        }
      }
      candidates = nextCandidates;
      if (candidates.length) break;
    }
    const authorizedCount = candidates.length;
    const safeLimit = Math.max(1, Math.min(Number(limit) || 10, MAX_QUERY_CANDIDATES));
    return { authorizedCount, candidates: candidates.slice(0, safeLimit) };
  }

  async function queryUsersByDeviceNumberImpl({ value, oltIds, limit = 10 } = {}) {
    const searches = deviceNumberSearchVariants(value);
    const scopedOlts = await resolveOlts(oltIds);
    const ponPorts = await getPonPorts();
    let candidates = [];
    for (const search of searches) {
      const nextCandidates = [];
      for (const olt of scopedOlts) {
        const rows = await getUsers({ oltIp: olt.host, q: search });
        for (const row of rows) {
          if (!includesNormalized(row.deviceNumber, search)) continue;
          const onu = parseCoordinate(row.onuIndex);
          nextCandidates.push(userCandidate(row, String(olt.id), ponAddressFor(ponPorts, olt, onu)));
        }
      }
      candidates = nextCandidates;
      if (candidates.length) break;
    }
    const safeLimit = Math.max(1, Math.min(Number(limit) || 10, MAX_QUERY_CANDIDATES));
    return { authorizedCount: candidates.length, candidates: candidates.slice(0, safeLimit) };
  }

  async function readOnuStatusImpl({ oltId, coordinate } = {}) {
    const [olt] = await resolveOlts([requiredText(oltId, "OLT ID")]);
    const onu = normalizeCoordinate(coordinate);
    const rows = await listOnus(olt, onu);
    const match = rows.find((row) =>
      String(row.chassis) === onu.chassis &&
      String(row.board ?? row.slot) === onu.board &&
      String(row.pon) === onu.pon &&
      String(row.onuId) === onu.onuId
    );
    if (!match) throw contractError("ONU not found in authorized OLT scope.", 404);
    return {
      oltId: String(olt.id),
      onu,
      status: safeLiveStatus(match),
      observedAt: now().toISOString()
    };
  }

  async function readOnuDetailImpl({ oltId, coordinate } = {}) {
    const [olt] = await resolveOlts([requiredText(oltId, "OLT ID")]);
    if (!VERIFIED_ONU_DETAIL_VENDORS.has(String(olt.vendor || "").toLowerCase())) {
      throw contractError("ONU detail is not verified for this OLT vendor.", 409);
    }
    const onu = normalizeCoordinate(coordinate);
    const rows = await listOnus(olt, onu, {
      includeLastOnlineTime: true,
      includeOfflineDetails: true
    });
    const match = rows.find((row) =>
      String(row.chassis) === onu.chassis &&
      String(row.board ?? row.slot) === onu.board &&
      String(row.pon) === onu.pon &&
      String(row.onuId) === onu.onuId
    );
    if (!match) throw contractError("ONU not found in authorized OLT scope.", 404);
    const status = safeLiveStatus(match);
    return {
      oltId: String(olt.id),
      onu,
      status,
      detail: {
        interface: `gpon-onu_${onu.chassis}/${onu.board}/${onu.pon}:${onu.onuId}`,
        name: status.name,
        phaseState: status.phase,
        serialNumber: status.serial,
        opticalRxPower: status.rxPower,
        distance: status.distance,
        lastOnlineTime: match.lastOnlineTime || null,
        lastOfflineTime: match.lastOfflineTime || null,
        lastOfflineCauseCode: Number.isInteger(match.lastOfflineCauseCode)
          ? match.lastOfflineCauseCode
          : null,
        lastOfflineCause: match.lastOfflineCause || null
      },
      unsupportedFields: [...UNSUPPORTED_ONU_DETAIL_FIELDS],
      observedAt: now().toISOString()
    };
  }

  async function readOnuHistoryImpl({ oltId, coordinate, days = 7, limit = 48 } = {}) {
    const [olt] = await resolveOlts([requiredText(oltId, "OLT ID")]);
    const onu = normalizeCoordinate(coordinate);
    const safeDays = Math.max(1, Math.min(7, Number(days) || 7));
    const safeLimit = Math.max(1, Math.min(48, Number(limit) || 48));
    const rows = await getOnuStatusHistory({
      oltId: olt.id,
      chassis: onu.chassis,
      board: onu.board,
      pon: onu.pon,
      onuId: onu.onuId,
      days: safeDays,
      limit: safeLimit
    });
    return {
      oltId: String(olt.id),
      onu,
      days: safeDays,
      rows: (rows ?? []).slice(0, safeLimit).map((row) => ({
        sampledAt: String(row.sampledAt || ""),
        phase: String(row.phase || "unknown"),
        rxPower: String(row.rxPower || "unknown"),
        distance: String(row.distance || "unknown")
      })),
      observedAt: now().toISOString()
    };
  }

  async function readOnuHistoricalOpticalImpl({
    oltId, coordinate, startDate, endDate, limit = 48
  } = {}) {
    if (typeof readHistoricalOptical !== "function") {
      throw capabilityError("HISTORICAL_OPTICAL_UNAVAILABLE",
        "网管二期实时历史光功率尚未配置安全只读适配器。", 503);
    }
    const [olt] = await resolveOlts([requiredText(oltId, "OLT ID")]);
    const onu = normalizeCoordinate(coordinate);
    const start = normalizeDate(startDate, "开始日期");
    const end = normalizeDate(endDate, "结束日期");
    if (Date.parse(`${start}T00:00:00Z`) > Date.parse(`${end}T23:59:59Z`)) {
      throw contractError("开始日期不能晚于结束日期。");
    }
    const safeLimit = Math.max(1, Math.min(48, Number(limit) || 48));
    let rows;
    try {
      rows = await readHistoricalOptical({
        oltId: String(olt.id),
        coordinate: onu,
        startDate: start,
        endDate: end
      });
    } catch (error) {
      if (error?.code || error?.statusCode) throw error;
      if (error?.status === 401) {
        throw capabilityError("HISTORICAL_OPTICAL_SESSION_EXPIRED",
          "网管二期历史光功率会话已失效。", 401);
      }
      if (error?.status === 404) {
        throw capabilityError("HISTORICAL_OPTICAL_NOT_FOUND",
          "网管二期未找到该 ONU 的历史光功率记录。", 404);
      }
      throw capabilityError("HISTORICAL_OPTICAL_READ_FAILED",
        "网管二期历史光功率读取失败。", 502);
    }
    if (!Array.isArray(rows)) {
      throw capabilityError("HISTORICAL_OPTICAL_INVALID_RESPONSE",
        "网管二期历史光功率返回格式不受支持。", 502);
    }
    return {
      source: "oss-ngb",
      oltId: String(olt.id),
      onu,
      startDate: start,
      endDate: end,
      rows: rows.slice(0, safeLimit).map(normalizeHistoricalOpticalRow),
      observedAt: now().toISOString()
    };
  }

  async function loadTransfers() {
    try {
      return transferRegions(await getVillageRegions());
    } catch {
      return [];
    }
  }

  async function resolveRegionForValue(searchValue) {
    try {
      return resolveVillageRegion(searchValue, await getVillageRegions());
    } catch {
      return null;
    }
  }

  // —— 按归属字段查地名（ADR-087 第二步）——
  // 每户的村 / 小组 / 小区来自合并台账的归属列，口还可能在“ONU 数据管理”里按行指定。
  // 地名能解析成这些归属时直接按字段过滤；解析不到时沿用区域字典 / 地址匹配。
  async function loadPlaceContext(scopedOlts) {
    const usersByOlt = new Map();
    for (const olt of scopedOlts) usersByOlt.set(String(olt.id), await getUsers({ oltIp: olt.host, q: "" }) ?? []);
    const hosts = new Set(scopedOlts.map((olt) => String(olt.host)));
    let assignments = [];
    try {
      assignments = (await getPortPlaceAssignments() ?? []).filter((item) => hosts.has(String(item.oltIp)));
    } catch {
      assignments = [];
    }
    const places = [];
    for (const users of usersByOlt.values()) {
      for (const user of users) if (user?.village || user?.community) places.push(user);
    }
    places.push(...assignments);
    return { usersByOlt, assignments, places };
  }

  function resolveFieldTarget(searchValue, context) {
    for (const variant of searchValueVariants(searchValue, "place search value")) {
      const target = resolvePlaceTarget(variant, context.places);
      if (target) return target;
    }
    return null;
  }

  // 目标为小组 / 小区时作为“已细分到小组”返回，飞书不再弹小组菜单。
  function targetRegion(target) {
    if (!target || target.kind === "village") return null;
    return target.kind === "group"
      ? { village: target.village, name: `${target.group}小组` }
      : { village: target.village, name: `${target.community}小区` };
  }

  /** 按归属字段列出目标的 PON 口：命中户所在的口，加上按行指定为该目标的口（即使口上还没有用户）。 */
  async function fieldPlacePons(target, scopedOlts, context) {
    const ponPorts = await getPonPorts() ?? [];
    const ledgerAddress = new Map();
    for (const port of ponPorts) {
      const key = ponPlaceKey(port);
      if (!ledgerAddress.has(key)) ledgerAddress.set(key, { address: String(port.address || ""), chassis: String(port.chassis || "") });
    }
    const items = new Map();
    const ensure = (olt, coordinate) => {
      const key = `${String(olt.id)}:${coordinate.chassis}/${coordinate.board}/${coordinate.pon}`;
      if (!items.has(key)) {
        items.set(key, {
          candidateId: key,
          oltId: String(olt.id),
          oltName: String(olt.name || olt.id),
          address: ledgerAddress.get(ponPlaceKey({ oltIp: olt.host, board: coordinate.board, pon: coordinate.pon }))?.address || "",
          pon: { chassis: coordinate.chassis, board: coordinate.board, pon: coordinate.pon },
          matchedUserCount: 0,
          ponUserCount: 0,
          assigned: false
        });
      }
      return items.get(key);
    };
    const ponUsers = new Map();
    for (const olt of scopedOlts) {
      for (const user of context.usersByOlt.get(String(olt.id)) ?? []) {
        const coordinate = parseCoordinate(user.onuIndex);
        if (!coordinate.board || !coordinate.pon) continue;
        const chassis = olt.vendor === "huawei" ? "0" : coordinate.chassis;
        const portKey = `${String(olt.id)}:${chassis}/${coordinate.board}/${coordinate.pon}`;
        ponUsers.set(portKey, (ponUsers.get(portKey) || 0) + 1);
        if (!placeMatchesTarget(user, target)) continue;
        ensure(olt, { chassis, board: coordinate.board, pon: coordinate.pon }).matchedUserCount += 1;
      }
    }
    const oltByHost = new Map(scopedOlts.map((olt) => [String(olt.host), olt]));
    for (const assignment of context.assignments) {
      if (!placeMatchesTarget(assignment, target)) continue;
      const olt = oltByHost.get(String(assignment.oltIp));
      if (!olt) continue;
      // 框号取该口已有记录的写法，其次 PON 台账，最后按厂商默认。
      const existing = [...items.values()].find((item) => item.oltId === String(olt.id) && item.pon.board === assignment.board && item.pon.pon === assignment.pon);
      const chassis = existing?.pon.chassis || (olt.vendor === "huawei" ? "0" : ledgerAddress.get(ponPlaceKey(assignment))?.chassis || defaultChassisForVendor(olt.vendor));
      const item = existing || ensure(olt, { chassis, board: assignment.board, pon: assignment.pon });
      item.assigned = true;
      if (assignment.address) item.address = assignment.address;
    }
    return [...items.values()].map(({ assigned, ...item }) => {
      const ponUserCount = ponUsers.get(item.candidateId) || item.matchedUserCount;
      // 按行指定过的口算主要口；其余按命中户数判断是否零星沾边。
      return { ...item, ponUserCount, sparse: !assigned && isSparsePon({ matchedUserCount: item.matchedUserCount, ponUserCount }) };
    }).sort((left, right) => right.matchedUserCount - left.matchedUserCount || left.candidateId.localeCompare(right.candidateId));
  }

  function pageVillagePons(ranked, { ponScope, offset, limit, region }) {
    const mainCount = ranked.filter((item) => !item.sparse).length;
    const sparseCount = ranked.length - mainCount;
    const all = ponScope === "main" ? ranked.filter((item) => !item.sparse)
      : ponScope === "sparse" ? ranked.filter((item) => item.sparse) : ranked;
    const safeOffset = Math.max(0, Math.floor(Number(offset) || 0));
    const safeLimit = Math.max(1, Math.min(MAX_VILLAGE_PON_PAGE, Math.floor(Number(limit) || 5)));
    const candidates = all.slice(safeOffset, safeOffset + safeLimit);
    return {
      authorizedCount: all.length,
      total: all.length,
      offset: safeOffset,
      limit: safeLimit,
      hasMore: safeOffset + candidates.length < all.length,
      mainCount,
      sparseCount,
      region,
      candidates
    };
  }

  async function queryVillagePonsImpl({ value, village, oltIds, offset = 0, limit = 5, ponScope = "all" } = {}) {
    {
      const fieldSearch = requiredText(village ?? value, "village search value");
      const fieldOlts = await resolveOlts(oltIds);
      const context = await loadPlaceContext(fieldOlts);
      const target = resolveFieldTarget(fieldSearch, context);
      if (target) {
        return pageVillagePons(await fieldPlacePons(target, fieldOlts, context), { ponScope, offset, limit, region: targetRegion(target) });
      }
    }
    const searchValue = requiredText(village ?? value, "village search value");
    const region = await resolveRegionForValue(searchValue);
    // 命中区域字典时按审核过的关键词匹配，否则沿用村名文本匹配。
    const searches = region ? [region] : searchValueVariants(searchValue, "village search value");
    const transfers = await loadTransfers();
    const matchesSearch = (user, search) => region
      ? addressMatchesRegion(user?.installationAddress, search)
      : userMatchesVillage(user, search, transfers);
    const scopedOlts = await resolveOlts(oltIds);
    const ponPorts = await getPonPorts();
    const portsByKey = new Map();
    for (const port of ponPorts ?? []) {
      const key = `${String(port.oltIp)}:${String(port.chassis)}/${String(port.board ?? port.slot)}/${String(port.pon)}`;
      if (!portsByKey.has(key)) portsByKey.set(key, String(port.address || ""));
    }
    let rows = [];
    const ponUserCounts = new Map();
    for (const search of searches) {
      const matches = [];
      for (const olt of scopedOlts) {
        // The merged snapshot is the authority for village membership. The PON
        // ledger is intentionally consulted only below for display metadata.
        const users = await getUsers({ oltIp: olt.host, q: "" });
        for (const user of users ?? []) {
          const coordinate = parseCoordinate(user.onuIndex);
          if (coordinate.board && coordinate.pon) {
            const chassis = olt.vendor === "huawei" ? "0" : coordinate.chassis;
            const ponKey = `${String(olt.id)}:${chassis}/${coordinate.board}/${coordinate.pon}`;
            ponUserCounts.set(ponKey, (ponUserCounts.get(ponKey) || 0) + 1);
          }
          if (!matchesSearch(user, search)) continue;
          const onu = parseCoordinate(user.onuIndex);
          if (!onu.chassis || !onu.board || !onu.pon || !onu.onuId) continue;
          const effectiveChassis = olt.vendor === "huawei" ? "0" : onu.chassis;
          matches.push({ olt, user, onu: { ...onu, chassis: effectiveChassis } });
        }
      }
      if (matches.length) {
        rows = matches;
        break;
      }
      ponUserCounts.clear();
    }
    const grouped = new Map();
    for (const { olt, user, onu } of rows) {
      const key = `${String(olt.id)}:${onu.chassis}/${onu.board}/${onu.pon}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.matchedUserCount += 1;
        continue;
      }
      const ledgerKey = `${String(olt.host)}:${onu.chassis}/${onu.board}/${onu.pon}`;
      let portAddress = portsByKey.get(ledgerKey) || "";
      if (!portAddress && user?.installationAddress) {
        portAddress = String(user.installationAddress).trim()
          .replace(/^(?:广东省|东莞市|厚街镇|\d+[\u4e00-\u9fa5]+片)+/g, "")
          .slice(0, 30);
      }
      grouped.set(key, {
        candidateId: `${String(olt.id)}:${onu.chassis}/${onu.board}/${onu.pon}`,
        oltId: String(olt.id),
        oltName: String(olt.name || olt.id),
        address: portAddress,
        pon: { chassis: onu.chassis, board: onu.board, pon: onu.pon },
        matchedUserCount: 1
      });
    }
    let ranked = [...grouped.values()].map((item) => {
      const ponUserCount = ponUserCounts.get(item.candidateId) || item.matchedUserCount;
      return { ...item, ponUserCount, sparse: isSparsePon({ matchedUserCount: item.matchedUserCount, ponUserCount }) };
    });
    if (region) {
      // 小组按“一级分光地址 + 小组用户 + 管理员手动勾选”确定 PON 口，未纳入的相关口作为零星口。
      const oltByHost = new Map(scopedOlts.map((olt) => [String(olt.host), olt]));
      const allUsers = [];
      for (const olt of scopedOlts) {
        for (const user of await getUsers({ oltIp: olt.host, q: "" }) ?? []) allUsers.push({ ...user, oltIp: olt.host });
      }
      const vendorByIp = new Map(scopedOlts.map((olt) => [String(olt.host), String(olt.vendor || "")]));
      ranked = resolveRegionPons(region, { users: allUsers, ponPorts: ponPorts ?? [], vendorByIp, transfers })
        .filter((pon) => oltByHost.has(pon.oltIp))
        .map((pon) => {
          const olt = oltByHost.get(pon.oltIp);
          const candidateId = `${String(olt.id)}:${pon.chassis}/${pon.board}/${pon.pon}`;
          return {
            candidateId,
            oltId: String(olt.id),
            oltName: String(olt.name || olt.id),
            address: pon.ledgerAddress || grouped.get(candidateId)?.address || "",
            pon: { chassis: pon.chassis, board: pon.board, pon: pon.pon },
            matchedUserCount: pon.regionUsers,
            ponUserCount: pon.ponUsers,
            sparse: !pon.included
          };
        });
    }
    const mainCount = ranked.filter((item) => !item.sparse).length;
    const sparseCount = ranked.length - mainCount;
    // “全部”保持原有顺序；主要口/零星口按命中户数从多到少排列。
    const byMatched = (left, right) => right.matchedUserCount - left.matchedUserCount;
    const order = (list) => region ? list : list.sort(byMatched);
    const all = ponScope === "main"
      ? order(ranked.filter((item) => !item.sparse))
      : ponScope === "sparse"
        ? order(ranked.filter((item) => item.sparse))
        : ranked;
    const safeOffset = Math.max(0, Math.floor(Number(offset) || 0));
    const safeLimit = Math.max(1, Math.min(MAX_VILLAGE_PON_PAGE, Math.floor(Number(limit) || 5)));
    const candidates = all.slice(safeOffset, safeOffset + safeLimit);
    return {
      authorizedCount: all.length,
      total: all.length,
      offset: safeOffset,
      limit: safeLimit,
      hasMore: safeOffset + candidates.length < all.length,
      mainCount,
      sparseCount,
      region: region ? { id: region.id, village: region.village, name: region.name } : null,
      candidates
    };
  }

  async function readPonStatusesImpl({ oltId, coordinate } = {}) {
    const [olt] = await resolveOlts([requiredText(oltId, "OLT ID")]);
    const pon = normalizePonCoordinate(coordinate);
    const rows = (await listOnus(olt, pon)).filter((row) =>
      String(row.chassis) === pon.chassis &&
      String(row.board ?? row.slot) === pon.board &&
      String(row.pon) === pon.pon
    );
    if (rows.length > 128) {
      throw contractError("PON status result exceeds the 128 ONU safety limit.");
    }
    const nameByOnuId = new Map();
    for (const user of await getUsers({ oltIp: olt.host, q: "" })) {
      const userOnu = parseCoordinate(user.onuIndex);
      if (userOnu.chassis !== pon.chassis ||
          userOnu.board !== pon.board ||
          userOnu.pon !== pon.pon ||
          !userOnu.onuId ||
          nameByOnuId.has(userOnu.onuId)) continue;
      nameByOnuId.set(userOnu.onuId, String(user.username || ""));
    }
    const onus = rows.map((row) => ({
      onu: {
        chassis: pon.chassis,
        board: pon.board,
        pon: pon.pon,
        onuId: requiredText(row.onuId, "ONU ID")
      },
      name: nameByOnuId.get(String(row.onuId)) || "",
      phase: String(row.phase || "unknown"),
      rxPower: String(row.rxPower || "unknown")
    })).sort((left, right) =>
      Number(left.onu.onuId) - Number(right.onu.onuId)
    );
    return {
      oltId: String(olt.id),
      pon,
      onuCount: onus.length,
      onus,
      observedAt: now().toISOString()
    };
  }

  async function readPonStatusesByIpImpl({ oltIp, board, pon, oltIds } = {}) {
    const ip = requiredText(oltIp, "OLT IPv4");
    if (!validIpv4(ip)) throw contractError("Invalid OLT IPv4.");
    const safeBoard = requiredText(board, "PON board");
    const safePon = requiredText(pon, "PON port");
    if (!/^\d+$/.test(safeBoard) || !/^\d+$/.test(safePon)) {
      throw contractError("PON board and port must be numeric.");
    }
    const scopedOlts = await resolveOlts(oltIds);
    const olt = scopedOlts.find((item) => String(item.host || "") === ip);
    if (!olt) throw contractError("Unknown or unauthorized OLT IPv4.", 404);
    const ports = await getPonPorts();
    const chassis = [...new Set((ports ?? [])
      .filter((port) => String(port.oltIp || "") === ip &&
        String(port.board ?? port.slot ?? "") === safeBoard &&
        String(port.pon || "") === safePon && String(port.chassis || "").trim())
      .map((port) => String(port.chassis).trim()))];
    if (chassis.length > 1) {
      throw contractError("该 OLT 的板卡/PON 对应多个槽位，请提供完整坐标。", 409);
    }
    const resolvedChassis = chassis[0] || defaultChassisForVendor(olt.vendor);
    if (!resolvedChassis) {
      throw contractError("无法确定槽位，请提供完整的槽位/板卡/PON 坐标。", 400);
    }
    const result = await readPonStatusesImpl({
      oltId: String(olt.id),
      coordinate: { chassis: resolvedChassis, board: safeBoard, pon: safePon }
    });
    const matchedPort = (ports ?? []).find((p) =>
      String(p.oltIp || "") === ip &&
      String(p.board ?? p.slot ?? "") === safeBoard &&
      String(p.pon || "") === safePon
    );
    const address = String(matchedPort?.address || "");
    return address ? { ...result, address } : result;
  }

  async function sampleVillagePonOnlineUserImpl({
    value, village, oltIds, oltId, pon, excludeOnuIds = [], random = Math.random
  } = {}) {
    const searchValue = requiredText(village ?? value, "village search value");
    const targetPon = normalizePonCoordinate(pon);
    const scopedOlts = await resolveOlts(oltIds);
    const target = scopedOlts.find((olt) => String(olt.id) === String(oltId || pon?.oltId || "")) ||
      (scopedOlts.length === 1 ? scopedOlts[0] : null);
    if (!target) throw contractError("Village PON sample requires one authorized OLT.");
    const excludedOnuIds = new Set((Array.isArray(excludeOnuIds) ? excludeOnuIds : [])
      .map((onuId) => String(onuId)));
    const placeTarget = resolveFieldTarget(searchValue, await loadPlaceContext([target]));
    const region = placeTarget ? null : await resolveRegionForValue(searchValue);
    const searches = placeTarget ? [placeTarget] : region ? [region] : searchValueVariants(searchValue, "village search value");
    const transfers = placeTarget ? [] : await loadTransfers();
    let matchedUsers = [];
    for (const search of searches) {
      matchedUsers = (await getUsers({ oltIp: target.host, q: "" }) ?? []).filter((user) => {
        const inPlace = placeTarget ? placeMatchesTarget(user, placeTarget)
          : region ? addressMatchesRegion(user?.installationAddress, search) : userMatchesVillage(user, search, transfers);
        if (!inPlace) return false;
        const coordinate = parseCoordinate(user.onuIndex);
        const userChassis = target.vendor === "huawei" ? "0" : coordinate.chassis;
        return (coordinate.chassis === targetPon.chassis || userChassis === targetPon.chassis) &&
          coordinate.board === targetPon.board &&
          coordinate.pon === targetPon.pon && coordinate.onuId;
      });
      if (matchedUsers.length) break;
    }
    const rows = await listOnus(target, targetPon);
    const ponRows = (rows ?? []).filter((row) =>
      (String(row.chassis) === targetPon.chassis || (target.vendor === "huawei" && targetPon.chassis === "0")) &&
      String(row.board ?? row.slot) === targetPon.board &&
      String(row.pon) === targetPon.pon
    );
    const onlineRows = ponRows.filter((row) => isOnlinePhase(row.phase));
    const offlineRows = ponRows.filter((row) => isConfirmedOfflinePhase(row.phase));
    const measurableOnlineRows = onlineRows.filter((row) => hasReadableRxPower(row.rxPower));
    const configuredRows = ponRows;
    const ponStatus = {
      status: onlineRows.length > 0
        ? "has-online"
        : configuredRows.length === 0 ? "no-configured-data"
          : offlineRows.length === configuredRows.length ? "all-offline" : "state-incomplete",
      configuredCount: configuredRows.length,
      onlineCount: onlineRows.length,
      offlineCount: offlineRows.length,
      unknownCount: Math.max(configuredRows.length - onlineRows.length - offlineRows.length, 0),
      observedAt: now().toISOString()
    };
    const measurableOnlineById = new Map(measurableOnlineRows.map((row) => [String(row.onuId), row]));
    let candidates = matchedUsers.filter((user) => {
      const onuId = parseCoordinate(user.onuIndex).onuId;
      return !excludedOnuIds.has(onuId) && measurableOnlineById.has(onuId);
    });
    if (!candidates.length) {
      // 若目标村样本离线或当前 RX 不可用，优先回退到同口有有效 RX 的在线 ONU。
      const allPonUsers = (await getUsers({ oltIp: target.host, q: "" }) ?? []).filter((user) => {
        const coordinate = parseCoordinate(user.onuIndex);
        const userChassis = target.vendor === "huawei" ? "0" : coordinate.chassis;
        return (coordinate.chassis === targetPon.chassis || userChassis === targetPon.chassis) &&
          coordinate.board === targetPon.board &&
          coordinate.pon === targetPon.pon && coordinate.onuId;
      });
      candidates = allPonUsers.filter((user) => {
        const onuId = parseCoordinate(user.onuIndex).onuId;
        return !excludedOnuIds.has(onuId) && measurableOnlineById.has(onuId);
      });
    }
    const availableOnlineRows = onlineRows.filter((row) => !excludedOnuIds.has(String(row.onuId)));
    if (!candidates.length && availableOnlineRows.length > 0) {
      // 有在线 ONU 但整口都没有可解析的 RX 时，仍返回在线状态供 UI 准确说明，不能标成无在线。
      const firstOnline = measurableOnlineRows.find((row) => !excludedOnuIds.has(String(row.onuId))) ||
        availableOnlineRows[0];
      const coordinate = {
        chassis: targetPon.chassis,
        board: targetPon.board,
        pon: targetPon.pon,
        onuId: String(firstOnline.onuId)
      };
      const candidate = {
        candidateId: `${String(target.id)}:${coordinate.chassis}/${coordinate.board}/${coordinate.pon}:${coordinate.onuId}`,
        oltId: String(target.id),
        name: String(firstOnline.name || `ONU ${coordinate.onuId}`),
        phone: "",
        address: searchValue,
        loid: String(firstOnline.loid || ""),
        mac: String(firstOnline.mac || ""),
        onu: coordinate
      };
      const liveStatus = {
        oltId: String(target.id),
        onu: coordinate,
        status: safeLiveStatus(firstOnline),
        observedAt: now().toISOString()
      };
      return { candidate, liveStatus, ponStatus };
    }
    if (!candidates.length) return { candidate: null, liveStatus: null, ponStatus };
    const randomValue = Number(random());
    const bounded = Number.isFinite(randomValue) ? Math.min(Math.max(randomValue, 0), 0.999999999) : 0;
    const selected = candidates[Math.floor(bounded * candidates.length)];
    const coordinate = parseCoordinate(selected.onuIndex);
    const candidate = userCandidate(selected, String(target.id), "");
    const selectedRow = measurableOnlineById.get(coordinate.onuId);
    const liveStatus = {
      oltId: String(target.id),
      onu: coordinate,
      status: safeLiveStatus(selectedRow),
      observedAt: now().toISOString()
    };
    return { candidate, liveStatus, ponStatus };
  }

  function ponUsersFor(users, target, targetPon) {
    return (users ?? []).filter((user) => {
      const coordinate = parseCoordinate(user.onuIndex);
      const userChassis = target.vendor === "huawei" ? "0" : coordinate.chassis;
      return (coordinate.chassis === targetPon.chassis || userChassis === targetPon.chassis) &&
        coordinate.board === targetPon.board &&
        coordinate.pon === targetPon.pon && coordinate.onuId;
    });
  }

  async function villageRegionMenuImpl({ value, oltIds } = {}) {
    {
      // 按归属字段：小组 / 小区直接返回；村则列出该村下的小组和小区作为菜单。
      const fieldOlts = await resolveOlts(oltIds);
      const context = await loadPlaceContext(fieldOlts);
      const target = resolveFieldTarget(value, context);
      if (target && target.kind !== "village") return { village: target.village, region: targetRegion(target), regions: [] };
      if (target) {
        const entries = new Map();
        const add = (name, kind, user, portKey) => {
          if (!entries.has(name)) entries.set(name, { village: target.village, name, kind, users: 0, pons: new Set() });
          const entry = entries.get(name);
          if (user) entry.users += 1;
          if (portKey) entry.pons.add(portKey);
        };
        for (const olt of fieldOlts) {
          for (const user of context.usersByOlt.get(String(olt.id)) ?? []) {
            if (!placeMatchesTarget(user, target)) continue;
            const coordinate = parseCoordinate(user.onuIndex);
            const portKey = `${olt.host}|${coordinate.board}|${coordinate.pon}`;
            if (user.villageGroup) add(`${user.villageGroup}小组`, "group", user, portKey);
            if (user.community) add(`${user.community}小区`, "community", user, portKey);
          }
        }
        for (const assignment of context.assignments) {
          if (!placeMatchesTarget(assignment, target)) continue;
          const portKey = `${assignment.oltIp}|${assignment.board}|${assignment.pon}`;
          if (assignment.villageGroup) add(`${assignment.villageGroup}小组`, "group", null, portKey);
          if (assignment.community) add(`${assignment.community}小区`, "community", null, portKey);
        }
        const regions = [...entries.values()]
          .map((entry) => ({ village: entry.village, name: entry.name, status: "active", userCount: entry.users, ponCount: entry.pons.size }))
          .sort((left, right) => right.userCount - left.userCount || right.ponCount - left.ponCount);
        if (regions.length) return { village: target.village, region: null, discovered: false, regions };
      }
    }
    const searchValue = normalizeAddressText(requiredText(value, "village search value"));
    const allRegions = await getVillageRegions();
    const region = resolveVillageRegion(searchValue, allRegions);
    if (region) return { village: region.village, region: { id: region.id, village: region.village, name: region.name }, regions: [] };
    const scopedOlts = await resolveOlts(oltIds);
    const users = [];
    for (const olt of scopedOlts) {
      for (const user of await getUsers({ oltIp: olt.host, q: "" }) ?? []) users.push({ ...user, oltIp: olt.host });
    }
    const transfers = transferRegions(allRegions);
    let regions = allRegions.filter((item) => item.village === searchValue && item.status !== "rejected");
    let discovered = false;
    if (!regions.some((item) => item.village === searchValue) && typeof saveVillageRegionCandidates === "function") {
      // 首次遇到大村时自动发现小组候选并保存，等待管理员在桌面端审核。
      const { candidates } = discoverVillageSubgroups(users, searchValue, { transfers });
      if (candidates.length) {
        regions = (await saveVillageRegionCandidates(searchValue, candidates)).filter((item) => item.status !== "rejected");
        discovered = true;
      }
    }
    const ponPorts = await getPonPorts() ?? [];
    const vendorByIp = new Map(scopedOlts.map((olt) => [String(olt.host), String(olt.vendor || "")]));
    const covered = countRegionCoverage(users, regions)
      .map((item) => ({ ...item, ponCount: resolveRegionPons(item, { users, ponPorts, vendorByIp, transfers }).filter((pon) => pon.included).length }))
      .filter((item) => item.userCount > 0 || item.ponCount > 0)
      .sort((left, right) => (left.status === "active" ? 0 : 1) - (right.status === "active" ? 0 : 1) || right.userCount - left.userCount)
      .map((item) => ({ id: item.id, village: item.village, name: item.name, status: item.status, userCount: item.userCount, ponCount: item.ponCount }));
    return { village: searchValue, region: null, discovered, regions: covered };
  }

  async function readPonRepairComparisonImpl({ oltId, pon, oltIds } = {}) {
    const scopedOlts = await resolveOlts(oltIds);
    const target = scopedOlts.find((olt) => String(olt.id) === String(oltId || ""));
    if (!target) throw contractError("PON repair comparison requires one authorized OLT.");
    const targetPon = normalizePonCoordinate(pon);
    if (typeof getOpticalNightlySamples !== "function") return { status: "no-baseline", oltId: String(target.id), pon: targetPon };
    const today = localDateKey(now());
    const samples = await getOpticalNightlySamples({
      oltId: String(target.id), chassis: targetPon.chassis, board: targetPon.board, pon: targetPon.pon,
      sinceDate: shiftDateKey(today, -21)
    });
    if (!samples.length) return { status: "no-baseline", oltId: String(target.id), pon: targetPon };
    const rows = (await listOnus(target, targetPon) ?? []).filter((row) =>
      (String(row.chassis) === targetPon.chassis || (target.vendor === "huawei" && targetPon.chassis === "0")) &&
      String(row.board ?? row.slot) === targetPon.board &&
      String(row.pon) === targetPon.pon
    );
    const users = ponUsersFor(await getUsers({ oltIp: target.host, q: "" }), target, targetPon)
      .map((user) => ({ ...user, onuId: parseCoordinate(user.onuIndex).onuId }));
    return {
      ...comparePonRepair({ liveRows: rows, samples, users, today }),
      oltId: String(target.id),
      pon: targetPon,
      observedAt: now().toISOString()
    };
  }

  // 按地名找用户：区域字典小组 → 村名（含地名改归属）→ 地址片段，命中即停。
  async function collectPlaceUsers(searchValue, scopedOlts) {
    const context = await loadPlaceContext(scopedOlts);
    const target = resolveFieldTarget(searchValue, context);
    if (target) {
      const rows = [];
      for (const olt of scopedOlts) {
        for (const user of context.usersByOlt.get(String(olt.id)) ?? []) {
          if (!placeMatchesTarget(user, target)) continue;
          const onu = parseCoordinate(user.onuIndex);
          if (!onu.board || !onu.pon || !onu.onuId) continue;
          rows.push({ olt, user, onu: { ...onu, chassis: olt.vendor === "huawei" ? "0" : onu.chassis } });
        }
      }
      return { label: target.label, rows, usersByOlt: context.usersByOlt };
    }
    const region = await resolveRegionForValue(searchValue);
    const transfers = await loadTransfers();
    const usersByOlt = new Map();
    for (const olt of scopedOlts) usersByOlt.set(String(olt.id), await getUsers({ oltIp: olt.host, q: "" }) ?? []);
    const searches = region ? [region] : searchValueVariants(searchValue, "place search value");
    for (const search of searches) {
      const rows = [];
      for (const olt of scopedOlts) {
        for (const user of usersByOlt.get(String(olt.id))) {
          const matched = region ? addressMatchesRegion(user?.installationAddress, search) : userMatchesVillage(user, search, transfers);
          if (!matched) continue;
          const onu = parseCoordinate(user.onuIndex);
          if (!onu.board || !onu.pon || !onu.onuId) continue;
          rows.push({ olt, user, onu: { ...onu, chassis: olt.vendor === "huawei" ? "0" : onu.chassis } });
        }
      }
      if (rows.length) return { label: region ? `${region.village}${region.name}` : search, rows, usersByOlt };
    }
    return { label: region ? `${region.village}${region.name}` : searchValue, rows: [], usersByOlt };
  }

  /** 弱光查询：只用最近一晚的夜间采样，不读设备，速度快。 */
  async function queryWeakLightImpl({ value, oltIds, threshold = WEAK_RX_DBM, limit = 50 } = {}) {
    const searchValue = requiredText(value, "weak light search value");
    const scopedOlts = await resolveOlts(oltIds);
    const { label, rows } = await collectPlaceUsers(searchValue, scopedOlts);
    const base = { place: label, threshold, totalUsers: rows.length };
    if (!rows.length) return { status: "no-match", ...base };
    if (typeof getLatestOpticalSamples !== "function") return { status: "no-baseline", ...base };
    const rowsByOlt = new Map();
    for (const row of rows) {
      const key = String(row.olt.id);
      if (!rowsByOlt.has(key)) rowsByOlt.set(key, []);
      rowsByOlt.get(key).push(row);
    }
    let sampled = 0;
    let offline = 0;
    // 来自网管二期 0 点数据的户数（当晚 SNMP 失败时补充的采样）。
    let fallbackSampled = 0;
    let sampleDate = "";
    const weak = [];
    for (const [oltId, oltRows] of rowsByOlt) {
      const olt = oltRows[0].olt;
      const samples = new Map();
      for (const sample of await getLatestOpticalSamples({ oltId }) ?? []) {
        const chassis = olt.vendor === "huawei" ? "0" : String(sample.chassis);
        samples.set(`${chassis}/${sample.board}/${sample.pon}:${sample.onuId}`, sample);
      }
      for (const { user, onu } of oltRows) {
        const sample = samples.get(`${onu.chassis}/${onu.board}/${onu.pon}:${onu.onuId}`);
        if (!sample) continue;
        sampled += 1;
        if (sample.source === "oss-ngb") fallbackSampled += 1;
        if (sample.sampleDate > sampleDate) sampleDate = sample.sampleDate;
        if (!Number.isFinite(sample.rxDbm)) {
          offline += 1;
          continue;
        }
        if (sample.rxDbm <= threshold) {
          weak.push({
            name: String(user.username || ""),
            address: String(user.installationAddress || ""),
            phone: String(user.userPhone || ""),
            oltId,
            oltName: String(olt.name || ""),
            pon: { chassis: onu.chassis, board: onu.board, pon: onu.pon },
            onuId: onu.onuId,
            rxDbm: sample.rxDbm
          });
        }
      }
    }
    if (!sampled) return { status: "no-baseline", ...base };
    weak.sort((left, right) => left.rxDbm - right.rxDbm);
    const ponMap = new Map();
    for (const item of weak) {
      const key = `${item.oltId}:${item.pon.chassis}/${item.pon.board}/${item.pon.pon}`;
      if (!ponMap.has(key)) ponMap.set(key, { oltName: item.oltName, pon: item.pon, weakCount: 0, worstRx: item.rxDbm });
      const entry = ponMap.get(key);
      entry.weakCount += 1;
      entry.worstRx = Math.min(entry.worstRx, item.rxDbm);
    }
    return {
      status: "ok",
      ...base,
      sampled,
      offline,
      fallbackSampled,
      sampleDate,
      weakCount: weak.length,
      users: weak.slice(0, Math.max(1, Math.min(100, Number(limit) || 50))),
      pons: [...ponMap.values()].sort((left, right) => right.weakCount - left.weakCount || left.worstRx - right.worstRx).slice(0, 10)
    };
  }

  /** 断纤历史：地名对应的主要 PON 口在抢修档案里的断纤记录。 */
  async function queryOutageHistoryImpl({ value, oltIds, days = 90 } = {}) {
    const searchValue = requiredText(value, "outage history search value");
    const scopedOlts = await resolveOlts(oltIds);
    const { label, rows, usersByOlt } = await collectPlaceUsers(searchValue, scopedOlts);
    const span = Math.max(1, Math.min(365, Number(days) || 90));
    const base = { place: label, days: span };
    if (!rows.length) return { status: "no-match", ...base };
    if (typeof getOutageOccurrences !== "function") return { status: "unavailable", ...base };
    // 只看本地名的主要口：零星沾边的口不算。
    const matchedPerPon = new Map();
    for (const { olt, onu } of rows) {
      const key = outagePonKey({ oltIp: olt.host, chassis: onu.chassis, board: onu.board, pon: onu.pon });
      if (!matchedPerPon.has(key)) matchedPerPon.set(key, { olt, pon: { chassis: onu.chassis, board: onu.board, pon: onu.pon }, matched: 0, total: 0 });
      matchedPerPon.get(key).matched += 1;
    }
    for (const olt of scopedOlts) {
      for (const user of usersByOlt.get(String(olt.id))) {
        const onu = parseCoordinate(user.onuIndex);
        const key = outagePonKey({ oltIp: olt.host, chassis: olt.vendor === "huawei" ? "0" : onu.chassis, board: onu.board, pon: onu.pon });
        if (matchedPerPon.has(key)) matchedPerPon.get(key).total += 1;
      }
    }
    const pons = new Map([...matchedPerPon].filter(([, item]) => !isSparsePon({ matchedUserCount: item.matched, ponUserCount: item.total })));
    const since = new Date(now().getTime() - span * 24 * 60 * 60 * 1000).toISOString();
    const occurrences = (await getOutageOccurrences({ since }) ?? []).filter((item) => pons.has(item.ponKey));
    const events = groupOutageEvents(occurrences).reverse().map((event) => ({
      startedAt: event.startedAt,
      recoveredAt: event.recoveredAt || "",
      pons: event.ponKeys.map((key) => {
        const item = pons.get(key);
        return { oltName: String(item.olt.name || ""), pon: { ...item.pon } };
      })
    }));
    const perPon = new Map();
    for (const item of occurrences) perPon.set(item.ponKey, (perPon.get(item.ponKey) || 0) + 1);
    return {
      status: "ok",
      ...base,
      ponCount: pons.size,
      eventCount: events.length,
      events: events.slice(0, 10),
      frequentPons: [...perPon].sort((left, right) => right[1] - left[1]).slice(0, 5).map(([key, count]) => {
        const item = pons.get(key);
        return { oltName: String(item.olt.name || ""), pon: { ...item.pon }, count };
      })
    };
  }

  return Object.freeze({
    async status() {
      return {
        contractVersion: "1",
        readOnly: true,
        datasetRevision: requiredText(await getDatasetRevision(), "dataset revision"),
        capabilities: [
          "listOlts",
          "queryUsers",
          "readOnuStatus",
          "readOnuDetail",
          "readOnuHistory",
          ...(typeof readHistoricalOptical === "function" ? ["readOnuHistoricalOptical"] : []),
          "queryUserLiveStatus",
          "queryPons",
          "queryVillagePons",
          "sampleVillagePonOnlineUser",
          "villageRegionMenu",
          ...(typeof getOpticalNightlySamples === "function" ? ["readPonRepairComparison"] : []),
          ...(typeof getLatestOpticalSamples === "function" ? ["queryWeakLight"] : []),
          ...(typeof getOutageOccurrences === "function" ? ["queryOutageHistory"] : []),
          "readPonStatuses",
          ...(typeof readPonStatusesByIpImpl === "function" ? ["readPonStatusesByIp"] : [])
        ]
      };
    },

    async listOlts() {
      return (await getOlts()).map(safeOlt);
    },

    async queryUsers({ intent, value, oltIds, limit = 10 } = {}) {
      return queryUsersImpl({ intent, value, oltIds, limit });
    },

    async queryUsersByDeviceNumber({ value, oltIds, limit = 10 } = {}) {
      return queryUsersByDeviceNumberImpl({ value, oltIds, limit });
    },

    async readOnuStatus({ oltId, coordinate } = {}) {
      return readOnuStatusImpl({ oltId, coordinate });
    },

    async readOnuDetail({ oltId, coordinate } = {}) {
      return readOnuDetailImpl({ oltId, coordinate });
    },

    async readOnuHistory({ oltId, coordinate, days = 7, limit = 48 } = {}) {
      return readOnuHistoryImpl({ oltId, coordinate, days, limit });
    },

    async readOnuHistoricalOptical(request) {
      return readOnuHistoricalOpticalImpl(request);
    },

    async queryUserLiveStatus(request) {
      const result = await queryUsersImpl({ ...request, limit: 2 });
      if (result.authorizedCount === 0) {
        throw contractError("User not found in Authorized OLT scope.", 404);
      }
      if (result.authorizedCount !== 1) {
        throw contractError("User query must resolve to exactly one candidate.", 409);
      }
      const candidate = result.candidates[0];
      return {
        candidate,
        liveStatus: await readOnuStatusImpl({
          oltId: candidate.oltId,
          coordinate: candidate.onu
        })
      };
    },

    async queryPons({ value, oltIds, limit = 10 } = {}) {
      const searches = searchValueVariants(value, "PON address search value");
      const scopedOlts = await resolveOlts(oltIds);
      const oltByHost = new Map(scopedOlts.map((olt) => [String(olt.host), olt]));
      let matches = [];
      for (const search of searches) {
        const matchesByCoordinate = new Map();
        for (const port of await getPonPorts()) {
          if (!oltByHost.has(String(port.oltIp)) ||
              !matchesPonTarget(port, search)) continue;
          const olt = oltByHost.get(String(port.oltIp));
          const pon = normalizePonCoordinate(port);
          const key = `${olt.id}:${pon.chassis}/${pon.board}/${pon.pon}`;
          if (matchesByCoordinate.has(key)) continue;
          matchesByCoordinate.set(key, {
            candidateId: `${olt.id}:${port.chassis}/${port.board}/${port.pon}`,
            oltId: String(olt.id),
            oltName: String(olt.name || olt.id),
            address: String(port.address || ""),
            pon
          });
        }
        matches = [...matchesByCoordinate.values()];
        if (matches.length) break;
      }
      const authorizedCount = matches.length;
      const safeLimit = Math.max(1, Math.min(Number(limit) || 10, MAX_QUERY_CANDIDATES));
      return {
        authorizedCount,
        candidates: matches.slice(0, safeLimit)
      };
    },

    async queryVillagePons(request) {
      return queryVillagePonsImpl(request);
    },

    async sampleVillagePonOnlineUser(request) {
      return sampleVillagePonOnlineUserImpl(request);
    },

    async datasetFreshness() {
      if (typeof getDatasetFreshness !== "function") return null;
      const status = await getDatasetFreshness();
      return {
        syncedAt: String(status?.syncedAt || ""),
        latestRun: status?.latestRun ? {
          status: String(status.latestRun.status || ""),
          completedAt: String(status.latestRun.completedAt || "")
        } : null
      };
    },

    async villageRegionMenu(request) {
      return villageRegionMenuImpl(request);
    },

    async queryWeakLight(request) {
      return queryWeakLightImpl(request);
    },

    async queryOutageHistory(request) {
      return queryOutageHistoryImpl(request);
    },

    async readPonRepairComparison(request) {
      return readPonRepairComparisonImpl(request);
    },

    async readPonStatuses({ oltId, coordinate } = {}) {
      return readPonStatusesImpl({ oltId, coordinate });
    },

    async readPonStatusesByIp(request) {
      return readPonStatusesByIpImpl(request);
    }
  });
}
