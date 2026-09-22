import { defaultChassisForVendor } from "./pon-coordinate.mjs";

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

function userMatchesVillage(row, search) {
  return includesNormalized(row?.installationAddress, search);
}

export function createOltDataGateway({
  getOlts,
  getUsers,
  getPonPorts,
  getDatasetRevision,
  listOnus,
  getOnuStatusHistory = async () => [],
  readHistoricalOptical = null,
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

  async function queryVillagePonsImpl({ value, village, oltIds, offset = 0, limit = 5 } = {}) {
    const searchValue = requiredText(village ?? value, "village search value");
    const searches = searchValueVariants(searchValue, "village search value");
    const scopedOlts = await resolveOlts(oltIds);
    const ponPorts = await getPonPorts();
    const portsByKey = new Map();
    for (const port of ponPorts ?? []) {
      const key = `${String(port.oltIp)}:${String(port.chassis)}/${String(port.board ?? port.slot)}/${String(port.pon)}`;
      if (!portsByKey.has(key)) portsByKey.set(key, String(port.address || ""));
    }
    let rows = [];
    for (const search of searches) {
      const matches = [];
      for (const olt of scopedOlts) {
        // The merged snapshot is the authority for village membership. The PON
        // ledger is intentionally consulted only below for display metadata.
        const users = await getUsers({ oltIp: olt.host, q: "" });
        for (const user of users ?? []) {
          if (!userMatchesVillage(user, search)) continue;
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
    const all = [...grouped.values()];
    const safeOffset = Math.max(0, Math.floor(Number(offset) || 0));
    const safeLimit = Math.max(1, Math.min(MAX_VILLAGE_PON_PAGE, Math.floor(Number(limit) || 5)));
    const candidates = all.slice(safeOffset, safeOffset + safeLimit);
    return {
      authorizedCount: all.length,
      total: all.length,
      offset: safeOffset,
      limit: safeLimit,
      hasMore: safeOffset + candidates.length < all.length,
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
    const searches = searchValueVariants(searchValue, "village search value");
    let matchedUsers = [];
    for (const search of searches) {
      matchedUsers = (await getUsers({ oltIp: target.host, q: "" }) ?? []).filter((user) => {
        if (!userMatchesVillage(user, search)) return false;
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

    async readPonStatuses({ oltId, coordinate } = {}) {
      return readPonStatusesImpl({ oltId, coordinate });
    },

    async readPonStatusesByIp(request) {
      return readPonStatusesByIpImpl(request);
    }
  });
}
