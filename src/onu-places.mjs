// 用户归属（村 / 小组 / 小区）计算：纯函数，无 IO（ADR-087）。
// 村：单户修正 > 口归属 > 批量规则 > 区域字典“地名改归属” > 按地址自动识别；
// 小组：单户修正 > 口归属 > 本村已生效的区域字典小组；小区：单户修正 > 口归属 > 小区规则，与村相互独立。
import { addressMatchesRegion, normalizeAddressText, normalizeKeywordList } from "./village-regions.mjs";

export const PLACE_RULE_KINDS = Object.freeze(["village", "community"]);
export const PLACE_SOURCES = Object.freeze(["manual", "port", "rule", "dictionary", "address", ""]);
// 地址里出现次数达到这个门槛的“X村”才当作村名，避免把门牌里偶然出现的“新村”当成村。
export const KNOWN_VILLAGE_MIN_USERS = 20;

const TOWN = /市[一-龥]{2}镇/gu;
const AREA_CODE = /^\d[一-龥]{2,3}片/u;
const VILLAGE_CAPTURE = /(?:镇|片)([一-龥]{1,4}?村)/gu;
const COMMUNITY_CAPTURE = /([一-龥]{2})社区/u;

/**
 * 取地址里真正的门牌部分：最后一个“市 + X镇”之后，去掉“5桥头片”这类片区编码。
 * 台账地址常见“……5桥头片冲口村东莞市厚街镇涌口村北社……”，前半段是旧前缀。
 */
export function addressTail(address) {
  const text = normalizeAddressText(address);
  let start = 0;
  for (const match of text.matchAll(TOWN)) start = match.index + match[0].length;
  return text.slice(start).replace(AREA_CODE, "");
}

/** 从全部地址里统计出现足够多次的“X村”作为村名清单，再并上区域字典里登记的村。 */
export function knownVillages(addresses = [], { regions = [], minUsers = KNOWN_VILLAGE_MIN_USERS } = {}) {
  const counts = new Map();
  for (const address of addresses) {
    const found = new Set();
    for (const match of normalizeAddressText(address).matchAll(VILLAGE_CAPTURE)) found.add(match[1]);
    for (const village of found) counts.set(village, (counts.get(village) || 0) + 1);
  }
  const names = new Set([...counts].filter(([, count]) => count >= minUsers).map(([name]) => name));
  for (const region of regions) {
    const village = normalizeAddressText(region?.village);
    if (village) names.add(village);
  }
  return [...names];
}

/** 按地址自动识别村：门牌部分里最早出现的已知村名；“X社区”等同于“X村”。 */
export function villageFromAddress(address, villages = []) {
  const tail = addressTail(address);
  if (!tail) return "";
  let best = null;
  for (const village of villages) {
    const index = tail.indexOf(village);
    if (index < 0) continue;
    if (!best || index < best.index || (index === best.index && village.length > best.village.length)) best = { index, village };
  }
  const community = COMMUNITY_CAPTURE.exec(tail);
  if (community && villages.includes(`${community[1]}村`) && (!best || community.index < best.index)) {
    best = { index: community.index, village: `${community[1]}村` };
  }
  return best?.village || "";
}

export function normalizePlaceRule(rule = {}) {
  const kind = PLACE_RULE_KINDS.includes(rule.kind) ? rule.kind : "";
  const target = normalizeAddressText(rule.target);
  const includeKeywords = normalizeKeywordList(rule.includeKeywords);
  if (!kind) throw Object.assign(new Error("规则类型只能是村或小区。"), { status: 400 });
  if (target.length < 2 || target.length > 32) throw Object.assign(new Error("归属名称需要 2–32 个字符。"), { status: 400 });
  if (!includeKeywords.length) throw Object.assign(new Error("至少需要一个地址关键词（2 个字以上）。"), { status: 400 });
  return { kind, target, includeKeywords, excludeKeywords: normalizeKeywordList(rule.excludeKeywords) };
}

/** 规则按最长关键词优先：“三屯工业大道”比“三屯”更具体。 */
function ruleSpecificity(rule) {
  return Math.max(0, ...normalizeKeywordList(rule.includeKeywords).map((keyword) => keyword.length));
}

function coordinateKey(row) {
  return [row.oltIp, row.chassis, row.board, row.pon, row.onuId].map((part) => String(part ?? "").trim()).join("|");
}

/** 单户修正按 LOID 匹配；记录没有 LOID 时按坐标匹配（台账同步后坐标或 LOID 其一仍可对上）。 */
export function indexOverrides(overrides = []) {
  const byLoid = new Map();
  const byCoordinate = new Map();
  for (const override of overrides) {
    const loid = String(override?.loid ?? "").trim();
    if (loid) byLoid.set(loid, override);
    else byCoordinate.set(coordinateKey(override), override);
  }
  return (row) => {
    const loid = String(row?.loid ?? "").trim();
    if (loid && byLoid.has(loid)) return byLoid.get(loid);
    return byCoordinate.get(coordinateKey(row)) || null;
  };
}

/**
 * 计算每户的归属。rows: 合并台账行（oltIp/chassis/board/pon/onuId/loid/installationAddress）。
 * regions: 区域字典全部条目；rules: 批量规则；overrides: 单户修正。
 */
export function computePlaceAssignments(rows = [], { regions = [], rules = [], overrides = [], ports = [] } = {}) {
  const portFor = new Map(ports.map((port) => [ponPlaceKey(port), port]));
  const active = regions.filter((region) => region?.status === "active");
  const transfers = active.filter((region) => region.transfer);
  const villages = knownVillages(rows.map((row) => row?.installationAddress), { regions: active });
  const byRule = (kind) => rules.filter((rule) => rule?.kind === kind).sort((left, right) => ruleSpecificity(right) - ruleSpecificity(left));
  const villageRules = byRule("village");
  const communityRules = byRule("community");
  const overrideFor = indexOverrides(overrides);
  const matches = (address, rule) => addressMatchesRegion(address, rule);
  return rows.map((row) => {
    const address = row?.installationAddress || "";
    const override = overrideFor(row);
    const port = portFor.get(ponPlaceKey(row)) || null;
    let village = "";
    let source = "";
    if (override?.village) {
      village = normalizeAddressText(override.village);
      source = "manual";
    } else if (port?.village) {
      village = normalizeAddressText(port.village);
      source = "port";
    } else if (address) {
      const rule = villageRules.find((item) => matches(address, item));
      const transfer = rule ? null : transfers.find((item) => matches(address, item));
      if (rule) {
        village = rule.target;
        source = "rule";
      } else if (transfer) {
        village = normalizeAddressText(transfer.village);
        source = "dictionary";
      } else {
        village = villageFromAddress(address, villages);
        source = village ? "address" : "";
      }
    }
    let group = normalizeAddressText(override?.villageGroup || (override?.village ? "" : port?.villageGroup) || "");
    if (!group && village && address) {
      const region = active.find((item) => normalizeAddressText(item.village) === village && matches(address, item));
      group = region ? normalizeAddressText(region.name) : "";
    }
    let community = normalizeAddressText(override?.community || port?.community || "");
    if (!community && address) community = communityRules.find((item) => matches(address, item))?.target || "";
    // 没有村、只有小组或小区时，来源取小组 / 小区的来源。
    if (!source && (override?.villageGroup || override?.community)) source = "manual";
    else if (!source && (port?.villageGroup || port?.community)) source = "port";
    else if (!source && community) source = "rule";
    return {
      oltIp: row.oltIp,
      chassis: row.chassis,
      board: row.board,
      pon: row.pon,
      onuId: row.onuId,
      village,
      villageGroup: group,
      community,
      placeSource: source
    };
  });
}

const withSuffix = (name, suffix) => (name && !name.endsWith(suffix) ? `${name}${suffix}` : name);

/** 归属的显示文字：“厚街村”“厚街村/向北小组”“厚街村/万科城市广场小区”“万达广场小区”。 */
export function placeLabel({ village = "", villageGroup = "", community = "" } = {}) {
  return [village, withSuffix(villageGroup, "小组"), withSuffix(community, "小区")].filter(Boolean).join("/");
}

/**
 * 解析“厚街村/下栅小组”“厚街村/万科城市广场小区”“万达广场小区”这类写法，用于 Excel 导入等。
 * 以“小组”结尾的段为小组，以“小区”结尾的段为小区，其余第一段为村。
 */
export function parsePlaceLabel(text) {
  const result = { village: "", villageGroup: "", community: "" };
  for (const part of String(text ?? "").split("/").map(normalizeAddressText).filter(Boolean)) {
    if (part.endsWith("小组") && part.length > 2) result.villageGroup = part.slice(0, -2);
    else if (part.endsWith("小区") && part.length > 2) result.community = part.slice(0, -2);
    else if (!result.village) result.village = part;
  }
  return result;
}

/** 按 PON 口汇总归属：每个口列出涉及的村 / 小组 / 小区名称，例如“陈屋村、寮厦村”“陈屋村、未归村”。 */
export function summarizePonPlaces(rows = [], { limit = 3 } = {}) {
  const ports = new Map();
  for (const row of rows) {
    const key = ponPlaceKey(row);
    if (!ports.has(key)) ports.set(key, { total: 0, counts: new Map() });
    const port = ports.get(key);
    port.total += 1;
    const label = placeLabel(row) || "未归村";
    port.counts.set(label, (port.counts.get(label) || 0) + 1);
  }
  const result = {};
  for (const [key, port] of ports) {
    // 只列名称，不显示户数：按户数从多到少，“未归村”固定排最后。
    const ranked = [...port.counts]
      .sort((left, right) => (left[0] === "未归村") - (right[0] === "未归村") || right[1] - left[1] || left[0].localeCompare(right[0], "zh-Hans-CN"));
    const names = ranked.map(([label]) => label);
    const text = names.length > limit ? `${names.slice(0, limit).join("、")} 等 ${names.length} 处` : names.join("、");
    result[key] = { total: port.total, places: ranked.map(([label, count]) => ({ label, count })), text };
  }
  return result;
}

/**
 * PON 口汇总的键：OLT IP + 板卡 + PON。每台 OLT 只有一个框，而合并台账与 PON 台账的框号
 * 写法不一定一致（华为 0、中兴 1，个别 C600 记录为 0），所以不参与匹配。
 */
export function ponPlaceKey({ oltIp, board, slot, pon }) {
  return [oltIp, board ?? slot, pon].map((part) => String(part ?? "").trim()).join("|");
}

/**
 * 未归村地址的批量规则建议：取门牌部分开头的地名（2–6 个汉字），按户数排序。
 * 内勤可据此一次把“万达广场”“伦品涌工业区”等设为小区，或把“阳明山花园”归到某村。
 */
export function suggestUnassignedKeywords(rows = [], { limit = 30, minUsers = 3 } = {}) {
  const counts = new Map();
  for (const row of rows) {
    if (row?.village || row?.community) continue;
    const tail = addressTail(row?.installationAddress);
    const head = /^[一-龥]{2,6}/u.exec(tail)?.[0] || "";
    if (head.length < 2) continue;
    const key = head.replace(/(?:路|街|巷|大道|工业|社区)$/u, "") || head;
    if (!counts.has(key)) counts.set(key, { keyword: key, count: 0, samples: [] });
    const entry = counts.get(key);
    entry.count += 1;
    if (entry.samples.length < 3) entry.samples.push(String(row.installationAddress || ""));
  }
  return [...counts.values()].filter((entry) => entry.count >= minUsers).sort((left, right) => right.count - left.count).slice(0, limit);
}

// 推荐门槛：同口已归村的户中，最多的村至少 3 户且占 60% 以上才推荐。
export const PORT_RECOMMEND_MIN_USERS = 3;
export const PORT_RECOMMEND_MIN_SHARE = 0.6;

/**
 * 按所在 PON 口推荐村：统计每个口上已归村的户最多属于哪个村。
 * rows: [{ oltIp, board, pon, village, users }]（按口、村聚合后的户数）。返回 键 → { village, count, assigned }。
 */
export function portVillageRecommendations(rows = [], { minUsers = PORT_RECOMMEND_MIN_USERS, minShare = PORT_RECOMMEND_MIN_SHARE } = {}) {
  const ports = new Map();
  for (const row of rows) {
    const village = normalizeAddressText(row?.village);
    if (!village) continue;
    const key = ponPlaceKey(row);
    if (!ports.has(key)) ports.set(key, new Map());
    const counts = ports.get(key);
    counts.set(village, (counts.get(village) || 0) + (Number(row.users) || 1));
  }
  const result = new Map();
  for (const [key, counts] of ports) {
    const assigned = [...counts.values()].reduce((sum, count) => sum + count, 0);
    const [village, count] = [...counts].sort((left, right) => right[1] - left[1])[0];
    if (count >= minUsers && count / assigned >= minShare) result.set(key, { village, count, assigned });
  }
  return result;
}

/** 台账行的键：口 + 一级地址（去空白）。同一个口机房加分光器后可能分成几路，每一路一行。 */
export function ponRowPlaceKey(row) {
  return `${ponPlaceKey(row)}|${normalizeAddressText(row?.address)}`;
}

/**
 * 把按台账行指定的归属折算到口：一个口上已指定的行归属都相同时，整口用户按它算；
 * 各行不同（分路）时整口不套用，口上用户按各自地址自动判断。返回 { ports, splitKeys }。
 */
export function effectivePortAssignments(rows = []) {
  const byPort = new Map();
  for (const row of rows) {
    const key = ponPlaceKey(row);
    if (!byPort.has(key)) byPort.set(key, []);
    byPort.get(key).push(row);
  }
  const ports = [];
  const splitKeys = new Set();
  for (const [key, list] of byPort) {
    const labels = new Set(list.map((row) => placeLabel(row)));
    if (labels.size === 1) ports.push({ ...list[0] });
    else splitKeys.add(key);
  }
  return { ports, splitKeys };
}

const stripSuffix = (text, suffix) => (text.endsWith(suffix) && text.length > suffix.length ? text.slice(0, -suffix.length) : text);

/**
 * 把查询说法解析成归属目标（ADR-087 第二步）：“厚街村”→村，“厚街村下栅 / 厚街村下栅小组 / 下栅小组”→村 + 小组，
 * “卓越维港 / 卓越维港小区 / 厚街村卓越维港”→小区。名称来自每户的归属字段和按行指定的归属；解析不到返回 null，
 * 由调用方沿用原来的区域字典 / 地址匹配。
 * places: [{ village, villageGroup, community }]（去重后的归属组合）。
 */
export function resolvePlaceTarget(value, places = []) {
  const text = normalizeAddressText(value);
  if (text.length < 2) return null;
  const villages = new Set();
  const groups = new Map();
  const communities = new Map();
  for (const place of places) {
    const village = normalizeAddressText(place?.village);
    const group = normalizeAddressText(place?.villageGroup);
    const community = normalizeAddressText(place?.community);
    if (village) villages.add(village);
    if (village && group) groups.set(`${village}|${group}`, { village, group });
    if (community) {
      if (!communities.has(community)) communities.set(community, new Set());
      if (village) communities.get(community).add(village);
    }
  }
  const villageTarget = (village) => ({ kind: "village", village, group: "", community: "", label: village });
  const groupTarget = ({ village, group }) => ({ kind: "group", village, group, community: "", label: placeLabel({ village, villageGroup: group }) });
  const communityTarget = (community) => ({ kind: "community", village: "", group: "", community, label: placeLabel({ community }) });
  if (villages.has(text)) return villageTarget(text);
  if (villages.has(`${text}村`)) return villageTarget(`${text}村`);
  const bareGroup = stripSuffix(text, "小组");
  const bareCommunity = stripSuffix(text, "小区");
  // 村 + 小组 / 村 + 小区的组合说法。
  for (const item of groups.values()) {
    if (bareGroup === `${item.village}${item.group}`) return groupTarget(item);
  }
  for (const [community, inVillages] of communities) {
    if (bareCommunity === community) return communityTarget(community);
    for (const village of inVillages) if (bareCommunity === `${village}${community}`) return communityTarget(community);
  }
  // 只说小组名：唯一时才认。
  const byGroupName = [...groups.values()].filter((item) => item.group === bareGroup);
  if (byGroupName.length === 1) return groupTarget(byGroupName[0]);
  return null;
}

/** 某户（或某行按行指定的归属）是否属于解析出的目标。 */
export function placeMatchesTarget(place, target) {
  if (!target) return false;
  const village = normalizeAddressText(place?.village);
  if (target.kind === "village") return village === target.village;
  if (target.kind === "group") return village === target.village && normalizeAddressText(place?.villageGroup) === target.group;
  return normalizeAddressText(place?.community) === target.community;
}
