// 区域字典：村 → 小组 → 地址匹配规则（纯函数，无 IO）。
// 小组候选从合并台账的装机地址自动发现，管理员审核后用于飞书村级抢修查询的范围细分。

export const VILLAGE_MENU_PON_THRESHOLD = 15;
export const SPARSE_PON_MAX_USERS = 2;
export const SPARSE_PON_MAX_SHARE = 0.3;
export const REGION_STATUSES = Object.freeze(["candidate", "active", "rejected"]);
const MIN_SUBGROUP_USERS = 5;
const EXTEND_RATIO = 0.9;
const ROAD_SUFFIX = /(?:大道|大街|路|街|巷)$/u;
const NUMERAL_SUFFIX = /[一二三四五六七八九十]+$/u;
const HAN_RUN = /^[一-鿿]+/u;

export function normalizeAddressText(value) {
  return String(value ?? "").replace(/\s+/g, "");
}

export function normalizeKeywordList(value) {
  const list = Array.isArray(value) ? value : String(value ?? "").split(/[,，;；\n]/);
  return [...new Set(list.map(normalizeAddressText).filter((item) => item.length >= 2))].slice(0, 20);
}

/** 地址是否属于该区域：命中任一包含关键词，且不命中任何排除关键词。 */
export function addressMatchesRegion(address, region) {
  const text = normalizeAddressText(address);
  if (!text) return false;
  const include = normalizeKeywordList(region?.includeKeywords);
  if (!include.length || !include.some((keyword) => text.includes(keyword))) return false;
  return !normalizeKeywordList(region?.excludeKeywords).some((keyword) => text.includes(keyword));
}

/** 取地址中最后一次出现村名之后的地名片段（地址常重复写“镇+村”前缀）。 */
export function addressTailAfterVillage(address, village) {
  const text = normalizeAddressText(address);
  const name = normalizeAddressText(village);
  const index = name ? text.lastIndexOf(name) : -1;
  if (index < 0) return null;
  return text.slice(index + name.length).replace(/^[（(][^）)]*[）)]/u, "");
}

function leadingHanRun(tail) {
  return String(tail || "").match(HAN_RUN)?.[0] || "";
}

/**
 * 自动发现某村的小组候选：统计村名之后的地名前缀，户数达到门槛的前缀再按 90% 一致度向后延伸。
 * users: [{ installationAddress, oltIp, onuIndex | chassis/board/pon }]
 */
export function discoverVillageSubgroups(users = [], village, { minUsers = MIN_SUBGROUP_USERS } = {}) {
  const name = normalizeAddressText(village);
  if (name.length < 2) return { village: name, candidates: [], matchedUsers: 0, uncoveredUsers: 0 };
  const runs = [];
  let matchedUsers = 0;
  for (const user of users) {
    const tail = addressTailAfterVillage(user?.installationAddress, name);
    if (tail === null) continue;
    matchedUsers += 1;
    const run = leadingHanRun(tail);
    if (run.length >= 2) runs.push(run);
  }
  const countPrefix = (prefix) => runs.filter((run) => run.startsWith(prefix)).length;
  const prefixCounts = new Map();
  for (const run of runs) prefixCounts.set(run.slice(0, 2), (prefixCounts.get(run.slice(0, 2)) || 0) + 1);
  const names = [];
  for (const [prefix, count] of [...prefixCounts].sort((left, right) => right[1] - left[1])) {
    if (count < minUsers) continue;
    let current = prefix;
    while (current.length < 8) {
      const next = new Map();
      for (const run of runs) {
        if (run.length > current.length && run.startsWith(current)) {
          const char = run[current.length];
          next.set(char, (next.get(char) || 0) + 1);
        }
      }
      const [bestChar, bestCount] = [...next].sort((left, right) => right[1] - left[1])[0] || [];
      if (!bestChar || bestCount < countPrefix(current) * EXTEND_RATIO) break;
      current += bestChar;
    }
    // “上坊一巷”“东风一路”这类门牌道路名只保留小组名本身。
    let stripped = current.replace(ROAD_SUFFIX, "");
    if (stripped !== current && stripped.replace(NUMERAL_SUFFIX, "").length >= 2) stripped = stripped.replace(NUMERAL_SUFFIX, "");
    names.push(stripped.length >= 2 ? stripped : current);
  }
  const unique = [...new Set(names)];
  const candidates = unique.map((subgroup) => ({
    village: name,
    name: subgroup,
    includeKeywords: [`${name}${subgroup}`],
    excludeKeywords: []
  }));
  const covered = users.filter((user) => candidates.some((candidate) => addressMatchesRegion(user?.installationAddress, candidate))).length;
  return { village: name, candidates, matchedUsers, uncoveredUsers: Math.max(0, matchedUsers - covered) };
}

function userPonKey(user) {
  const oltIp = String(user?.oltIp ?? user?.olt_ip ?? "").trim();
  const coordinate = /(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)/u.exec(String(user?.onuIndex ?? user?.onuIndexDisplay ?? ""));
  if (coordinate) return `${oltIp}|${coordinate[1]}/${coordinate[2]}/${coordinate[3]}`;
  if ([user?.chassis, user?.board, user?.pon].every((part) => String(part ?? "").trim())) {
    return `${oltIp}|${user.chassis}/${user.board}/${user.pon}`;
  }
  return "";
}

/** 统计每个区域覆盖的户数和 PON 口数（用于审核页和飞书小组菜单）。 */
export function countRegionCoverage(users = [], regions = []) {
  return regions.map((region) => {
    const pons = new Set();
    let userCount = 0;
    for (const user of users) {
      if (!addressMatchesRegion(user?.installationAddress, region)) continue;
      userCount += 1;
      const key = userPonKey(user);
      if (key) pons.add(key);
    }
    return { ...region, userCount, ponCount: pons.size };
  });
}

/** 把飞书查询词解析为区域：“厚街村向北”或唯一的小组名“向北”。被驳回的条目不参与。 */
export function resolveVillageRegion(value, regions = []) {
  const text = normalizeAddressText(value);
  if (!text) return null;
  const usable = regions.filter((region) => region.status !== "rejected");
  const exact = usable.find((region) => text === `${normalizeAddressText(region.village)}${normalizeAddressText(region.name)}`);
  if (exact) return exact;
  const byName = usable.filter((region) => text === normalizeAddressText(region.name));
  return byName.length === 1 ? byName[0] : null;
}

/** 零星沾边口：命中户数很少且占该口总户数比例很低。 */
export function isSparsePon({ matchedUserCount, ponUserCount }) {
  const matched = Number(matchedUserCount) || 0;
  const total = Math.max(Number(ponUserCount) || 0, matched, 1);
  return matched <= SPARSE_PON_MAX_USERS && matched / total < SPARSE_PON_MAX_SHARE;
}

/** PON 口统一键：OLT 管理 IP + 机框/板卡/PON（华为机框固定为 0）。 */
export function regionPonKey({ oltIp, chassis, board, pon }, vendor = "") {
  const normalizedChassis = String(vendor).toLowerCase() === "huawei" ? "0" : String(chassis ?? "").trim();
  return `${String(oltIp ?? "").trim()}|${normalizedChassis}/${String(board ?? "").trim()}/${String(pon ?? "").trim()}`;
}

/**
 * 一级分光地址用的关键词：PON 台账的一级地址通常不带村名（如“菊塘路联胜横五巷”），
 * 因此去掉包含关键词里的“镇/村”前缀，再加上小组名本身。
 */
export function regionLedgerKeywords(region) {
  const village = normalizeAddressText(region?.village);
  const words = new Set();
  const name = normalizeAddressText(region?.name);
  if (name.length >= 2) words.add(name);
  for (const keyword of normalizeKeywordList(region?.includeKeywords)) {
    let tail = village && keyword.includes(village) ? keyword.slice(keyword.lastIndexOf(village) + village.length) : keyword;
    tail = tail.replace(/^.*?镇/u, "");
    if (tail.length >= 2) words.add(tail);
  }
  return [...words];
}

function parsePonFromIndex(value) {
  const match = /(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)/u.exec(String(value ?? ""));
  return match ? { chassis: match[1], board: match[2], pon: match[3] } : null;
}

/**
 * 计算一个小组覆盖的 PON 口：
 * - 一级分光地址命中小组关键词、且该口确有本村用户的口（按分光点归属，最接近物理拓扑）；
 * - 小组用户在该口不是零星沾边的口；
 * - 管理员手动勾选（ponInclude）或剔除（ponExclude）的口优先。
 * 返回所有相关口（含未纳入的候选），included 表示是否纳入抢修检查。
 */
export function resolveRegionPons(region, { users = [], ponPorts = [], vendorByIp = new Map() } = {}) {
  const village = normalizeAddressText(region?.village);
  const exclude = normalizeKeywordList(region?.excludeKeywords);
  const ledgerKeywords = regionLedgerKeywords(region);
  const include = new Set((region?.ponInclude || []).map(String));
  const excludePons = new Set((region?.ponExclude || []).map(String));
  const pons = new Map();
  const entry = (oltIp, coordinate) => {
    const key = regionPonKey({ oltIp, ...coordinate }, vendorByIp.get(oltIp));
    if (!pons.has(key)) {
      const [, path] = key.split("|");
      const [chassis, board, pon] = path.split("/");
      pons.set(key, { key, oltIp, chassis, board, pon, regionUsers: 0, villageUsers: 0, ponUsers: 0, ledgerAddress: "", ledgerMatch: false });
    }
    return pons.get(key);
  };
  for (const user of users) {
    const oltIp = String(user?.oltIp ?? "").trim();
    const coordinate = parsePonFromIndex(user?.onuIndex ?? user?.onuIndexDisplay);
    if (!oltIp || !coordinate) continue;
    const address = normalizeAddressText(user?.installationAddress);
    const inVillage = village && address.includes(village);
    const inRegion = addressMatchesRegion(address, region);
    const key = regionPonKey({ oltIp, ...coordinate }, vendorByIp.get(oltIp));
    if (!inVillage && !inRegion && !pons.has(key)) {
      // 只统计和本村有关的口的总户数，避免为全网每个口都建条目。
      continue;
    }
    const item = entry(oltIp, coordinate);
    if (inVillage) item.villageUsers += 1;
    if (inRegion) item.regionUsers += 1;
  }
  // 第二遍补齐这些口的总户数。
  for (const user of users) {
    const oltIp = String(user?.oltIp ?? "").trim();
    const coordinate = parsePonFromIndex(user?.onuIndex ?? user?.onuIndexDisplay);
    if (!oltIp || !coordinate) continue;
    const item = pons.get(regionPonKey({ oltIp, ...coordinate }, vendorByIp.get(oltIp)));
    if (item) item.ponUsers += 1;
  }
  for (const port of ponPorts) {
    const oltIp = String(port?.oltIp ?? "").trim();
    const board = String(port?.board ?? port?.slot ?? "").trim();
    const pon = String(port?.pon ?? "").trim();
    if (!oltIp || !board || !pon) continue;
    const key = regionPonKey({ oltIp, chassis: port.chassis, board, pon }, vendorByIp.get(oltIp));
    const address = normalizeAddressText(port?.address);
    const matches = address && ledgerKeywords.some((keyword) => address.includes(keyword)) && !exclude.some((keyword) => address.includes(keyword));
    const item = pons.get(key);
    if (item) {
      // 同一口在台账里可能有多条记录，优先显示命中关键词的那条一级地址。
      if (matches && !item.ledgerMatch) item.ledgerAddress = String(port.address || "");
      else item.ledgerAddress ||= String(port.address || "");
      item.ledgerMatch ||= Boolean(matches);
    } else if (include.has(key)) {
      const created = entry(oltIp, { chassis: port.chassis, board, pon });
      created.ledgerAddress = String(port.address || "");
      created.ledgerMatch = Boolean(matches);
    }
  }
  for (const key of include) {
    if (!pons.has(key)) {
      const [oltIp, path = ""] = key.split("|");
      const [chassis, board, pon] = path.split("/");
      if (oltIp && board && pon) entry(oltIp, { chassis, board, pon });
    }
  }
  const result = [];
  for (const item of pons.values()) {
    const sparse = isSparsePon({ matchedUserCount: item.regionUsers, ponUserCount: item.ponUsers });
    const automatic = (item.ledgerMatch && item.villageUsers > 0) || (item.regionUsers > 0 && !sparse);
    const manual = include.has(item.key) ? "include" : excludePons.has(item.key) ? "exclude" : null;
    const included = manual ? manual === "include" : automatic;
    // 与本小组无关的口（只是同村、没有小组用户也不在分光点上）不列出。
    if (!included && item.regionUsers === 0 && !manual) continue;
    result.push({ ...item, sparse, automatic, manual, included });
  }
  return result.sort((left, right) =>
    Number(right.included) - Number(left.included) ||
    Number(right.ledgerMatch) - Number(left.ledgerMatch) ||
    right.regionUsers - left.regionUsers ||
    left.key.localeCompare(right.key));
}
