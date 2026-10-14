// 飞书资料修改申请（ADR-089）：外勤提交一级地址或村 / 小组 / 小区的修改，指定审批人在飞书同意后自动修改。
// 只改本地 PON 台账和用户归属修正，不触发任何 OLT 命令，不回写网管二期或一期 BOSS。
import { randomBytes } from "node:crypto";
import { normalizeAddressText } from "./village-regions.mjs";
import { parsePlaceLabel, placeLabel, resolvePlaceTarget } from "./onu-places.mjs";

// row-place：PON 台账行（口 + 一级地址）的归属，整行用户都按它算；place：单户归属，只用于口不在台账里的户。
export const EDIT_KINDS = Object.freeze({
  "primary-address": "一级地址",
  "row-place": "村 / 小组 / 小区",
  place: "村 / 小组 / 小区"
});

const MAX_VALUE_LENGTH = 100;

function editError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

// 看起来是楼盘 / 小区名的写法（没写“小区”时按小区处理）。
const ESTATE_PATTERN = /(?:大厦|大楼|花园|广场|公寓|名苑|家园|山庄|豪庭|华庭|雅苑|雅居|名都|府|苑|城|庭|阁|居|中心|商城|小区)$/;

/**
 * 解析外勤 / 审批人填写的归属：“厚街村/下栅小组”“厚街村下栅小组”“下栅小组”“丰泰小区”“厚街村”“新塘村/顺景大厦”。
 * 村后面没写“小组 / 小区”的部分：本村已有的小组按小组、已有的小区按小区、楼盘名按小区；认不出时请外勤写清楚，不会丢掉。
 */
export function parsePlaceInput(value, places = []) {
  const text = normalizeAddressText(value);
  if (!text) throw editError("请填写村 / 小组 / 小区，例如“厚街村/下栅小组”或“丰泰小区”。");
  if (text.length > MAX_VALUE_LENGTH) throw editError("归属写得太长了。");
  const villages = [...new Set(places.map((item) => normalizeAddressText(item.village)).filter(Boolean))]
    .sort((left, right) => right.length - left.length);
  let segments;
  if (text.includes("/")) {
    segments = text.split("/").filter(Boolean);
  } else {
    const target = resolvePlaceTarget(text, places);
    if (target && target.kind !== "community") {
      segments = [target.village, ...(target.group ? [`${target.group}小组`] : [])];
    } else {
      // 已知村名优先；新村名按第一个“村 / 社区”拆开，例如“新塘村顺景大厦”。
      const village = villages.find((name) => text.startsWith(name) && text.length > name.length)
        || (target ? "" : text.match(/^(.{1,10}?(?:村|社区))(?=.)/)?.[1] || "");
      segments = village ? [village, text.slice(village.length)] : [text];
    }
  }
  const result = { village: "", villageGroup: "", community: "" };
  for (const [index, segment] of segments.entries()) {
    if (segment.endsWith("小组") && segment.length > 2) {
      result.villageGroup = segment.slice(0, -2);
    } else if (segment.endsWith("小区") && segment.length > 2) {
      result.community = segment.slice(0, -2);
    } else if (index === 0 && !result.village) {
      result.village = segment;
    } else {
      const sameVillage = places.filter((item) => normalizeAddressText(item.village) === result.village);
      if (sameVillage.some((item) => normalizeAddressText(item.villageGroup) === segment)) result.villageGroup = segment;
      else if (places.some((item) => normalizeAddressText(item.community) === segment) || ESTATE_PATTERN.test(segment)) result.community = segment;
      else throw editError(`“${segment}”是小组还是小区？请写成“${result.village || "某村"}/${segment}小组”或“${result.village || "某村"}/${segment}小区”。`);
    }
  }
  result.village = result.village.slice(0, 32);
  result.villageGroup = result.villageGroup.slice(0, 32);
  result.community = result.community.slice(0, 32);
  if (result.villageGroup && !result.village) throw editError("小组要写明属于哪个村，例如“厚街村/下栅小组”。");
  if (!result.village && !result.community) throw editError("没有认出村或小区，请写成“厚街村/下栅小组”或“丰泰小区”。");
  return { ...result, label: placeLabel(result) };
}

function normalizePrimaryAddress(value) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!text) throw editError("请填写新的一级地址。");
  if (text.length > MAX_VALUE_LENGTH) throw editError("一级地址写得太长了。");
  return text;
}

export function createEditRequestService({
  getOlts,
  getEditApprover,
  createEditRequest,
  getEditRequest,
  findPendingEditRequest,
  updateEditRequestPrevious,
  decideEditRequest,
  getPonLedgerRows,
  findPonLedgerRowsByAddress,
  applyPrimaryAddressEdit,
  getOnuPlace,
  getKnownPlaces,
  savePlaceOverride,
  getPortPlaceAssignments = async () => [],
  savePortPlaceAssignment = async () => null,
  ensurePlaceAssignments = async () => {},
  // 卡片回调不带姓名：按和机器人说过话的记录补外勤姓名。
  lookupUserName = async () => "",
  now = () => new Date(),
  createToken = () => randomBytes(18).toString("base64url"),
  log = () => {}
} = {}) {
  async function oltById(oltId) {
    const olt = (await getOlts()).find((item) => String(item.id) === String(oltId));
    if (!olt) throw editError("OLT 不存在。", 404);
    return olt;
  }

  async function currentPlace(target) {
    await ensurePlaceAssignments();
    const place = await getOnuPlace(target);
    return place ? placeLabel(place) : "";
  }

  /** 台账某一行按行指定的归属（没有指定时为空）。 */
  async function currentRowPlace({ oltIp, board, pon, rowAddress }) {
    const key = normalizeAddressText(rowAddress);
    const found = (await getPortPlaceAssignments()).find((item) =>
      item.oltIp === String(oltIp).trim() && item.board === String(board).trim() && item.pon === String(pon).trim() &&
      normalizeAddressText(item.address) === key);
    return found ? placeLabel(found) : "";
  }

  /**
   * 资料有误表单需要的当前值：该口台账各行的一级地址和按行指定的归属、该户现在的归属。
   * 口在台账里时，村 / 小组 / 小区改的是台账行（整行用户都按它算）；不在台账里时改这一户。
   */
  async function onuFormContext({ oltId, onu } = {}) {
    const approver = await getEditApprover();
    if (!approver) return { approver: null };
    const olt = await oltById(oltId);
    const target = { oltIp: olt.host, chassis: String(onu?.chassis ?? ""), board: String(onu?.board ?? ""), pon: String(onu?.pon ?? ""), onuId: String(onu?.onuId ?? "") };
    const rows = await getPonLedgerRows(target);
    const rowPlaces = [];
    for (const row of rows) rowPlaces.push(await currentRowPlace({ ...target, rowAddress: row.address }));
    return {
      approver: { name: approver.name },
      oltName: olt.name || "",
      rows: rows.map((row) => row.address),
      rowPlaces,
      place: await currentPlace(target)
    };
  }

  /** 按一级地址关键词找台账行（最多 10 行），附带 OLT 名称。 */
  async function findPonRows(keyword) {
    const approver = await getEditApprover();
    if (!approver) return { approver: null, rows: [] };
    const olts = await getOlts();
    const names = new Map(olts.map((olt) => [olt.host, olt.name || olt.host]));
    const rows = await findPonLedgerRowsByAddress(keyword, { limit: 10 });
    const result = [];
    for (const row of rows) {
      result.push({ ...row, oltName: names.get(row.oltIp) || row.oltIp, place: await currentRowPlace({ ...row, rowAddress: row.address }) });
    }
    return { approver: { name: approver.name }, rows: result };
  }

  /**
   * 提交一条申请。target: { oltIp 或 oltId, chassis, board, pon, onuId?, loid?, username?, userAddress? }。
   * 返回 { request, approver, duplicate }；值没有变化时返回 { unchanged: true }。
   */
  async function submit({ kind, target = {}, previousValue = "", proposedValue, requester = {} } = {}) {
    if (!EDIT_KINDS[kind]) throw editError("不支持修改这一项。");
    const approver = await getEditApprover();
    if (!approver) throw editError("还没有指定资料修改审批人，请联系管理员在桌面版“飞书设置”中指定。", 409);
    const olt = target.oltIp ? null : await oltById(target.oltId);
    const base = {
      kind,
      oltIp: String(target.oltIp || olt?.host || ""),
      oltName: String(target.oltName || olt?.name || ""),
      chassis: String(target.chassis ?? ""),
      board: String(target.board ?? ""),
      pon: String(target.pon ?? ""),
      onuId: kind === "place" ? String(target.onuId ?? "") : "",
      loid: kind === "place" ? String(target.loid ?? "") : "",
      username: kind === "place" ? String(target.username ?? "") : "",
      userAddress: kind === "place" ? String(target.userAddress ?? "") : "",
      rowAddress: kind === "row-place" ? String(target.rowAddress ?? "") : ""
    };
    if (!base.oltIp || !base.board || !base.pon || (kind === "place" && !base.onuId)) throw editError("申请缺少设备坐标。");
    let previous = String(previousValue ?? "");
    let proposed;
    if (kind === "primary-address") {
      proposed = normalizePrimaryAddress(proposedValue);
      const rows = await getPonLedgerRows(base);
      if (!rows.some((row) => normalizeAddressText(row.address) === normalizeAddressText(previous))) {
        throw editError("该口在 PON 台账里没有这个一级地址，可能刚被改过，请重新查询。", 409);
      }
      if (normalizeAddressText(proposed) === normalizeAddressText(previous)) return { unchanged: true };
    } else if (kind === "row-place") {
      const rows = await getPonLedgerRows(base);
      if (!rows.some((row) => normalizeAddressText(row.address) === normalizeAddressText(base.rowAddress))) {
        throw editError("该口在 PON 台账里没有这一行，可能刚被改过，请重新查询。", 409);
      }
      proposed = parsePlaceInput(proposedValue, await getKnownPlaces()).label;
      previous = await currentRowPlace(base);
      if (proposed === previous) return { unchanged: true };
    } else {
      proposed = parsePlaceInput(proposedValue, await getKnownPlaces()).label;
      previous = await currentPlace(base);
      if (proposed === previous) return { unchanged: true };
    }
    const duplicate = await findPendingEditRequest({ ...base, previousValue: previous, proposedValue: proposed });
    if (duplicate) return { request: duplicate, approver, duplicate: true };
    const request = await createEditRequest({
      ...base,
      token: createToken(),
      previousValue: previous,
      proposedValue: proposed,
      requesterOpenId: String(requester.openId || ""),
      requesterName: String(requester.name || await lookupUserName(requester.openId).catch(() => "") || ""),
      requesterChatId: String(requester.chatId || ""),
      createdAt: now().toISOString()
    });
    return { request, approver, duplicate: false };
  }

  async function apply(request, value) {
    if (request.kind === "primary-address") {
      const finalValue = normalizePrimaryAddress(value);
      const result = await applyPrimaryAddressEdit({
        oltIp: request.oltIp, board: request.board, pon: request.pon,
        previousValue: request.previousValue, value: finalValue
      });
      if (!result.updated) return { conflict: true, current: "" };
      // 一级地址是按行指定归属的键之一，改名后重算一次归属。
      try {
        await ensurePlaceAssignments({ force: true });
      } catch (error) {
        log(`[edit-request] 归属重算失败：${error?.message || error}`);
      }
      return { finalValue, result: `已把 PON 台账 ${request.board}/${request.pon} 口的一级地址由“${request.previousValue}”改为“${finalValue}”（${result.updated} 行）` };
    }
    const place = parsePlaceInput(value, await getKnownPlaces());
    if (request.kind === "row-place") {
      const rowTarget = { oltIp: request.oltIp, board: request.board, pon: request.pon, rowAddress: request.rowAddress };
      const rows = await getPonLedgerRows(rowTarget);
      if (!rows.some((row) => normalizeAddressText(row.address) === normalizeAddressText(request.rowAddress))) {
        return { conflict: true, current: "", missingRow: true };
      }
      const current = await currentRowPlace(rowTarget);
      if (current !== request.previousValue) return { conflict: true, current };
      await savePortPlaceAssignment({
        oltIp: request.oltIp, board: request.board, pon: request.pon, address: request.rowAddress,
        village: place.village, villageGroup: place.villageGroup, community: place.community
      });
      try {
        await ensurePlaceAssignments({ force: true });
      } catch (error) {
        log(`[edit-request] 归属重算失败：${error?.message || error}`);
      }
      return { finalValue: place.label, result: `已把 PON 台账 ${request.board}/${request.pon} 口“${request.rowAddress || "（空地址）"}”这一行的归属由“${request.previousValue || "未指定"}”改为“${place.label}”` };
    }
    const target = { oltIp: request.oltIp, chassis: request.chassis, board: request.board, pon: request.pon, onuId: request.onuId };
    const current = await currentPlace(target);
    if (current !== request.previousValue) return { conflict: true, current };
    await savePlaceOverride({
      loid: request.loid,
      ...target,
      village: place.village,
      villageGroup: place.villageGroup,
      community: place.community,
      note: `飞书申请 #${request.id}（${request.requesterName || "外勤"}）`
    });
    await ensurePlaceAssignments();
    return { finalValue: place.label, result: `已把 ${request.username || "该户"} 的归属由“${request.previousValue || "未归村"}”改为“${place.label}”` };
  }

  /**
   * 审批：只有指定的审批人可以处理。approve=true 时按 value（审批人可在卡片上改）修改资料。
   * 返回 { status: forbidden | not-found | already | conflict | approved | rejected, request, message }。
   */
  async function decide({ token, operator = {}, approve, value } = {}) {
    const request = await getEditRequest({ token });
    if (!request) return { status: "not-found", message: "这条申请不存在。" };
    const approver = await getEditApprover();
    if (!approver || approver.openId !== operator.openId) {
      return { status: "forbidden", request, message: "只有指定的资料修改审批人可以处理这条申请。" };
    }
    if (request.status !== "pending") return { status: "already", request, message: "这条申请已经处理过了。" };
    const decidedAt = now().toISOString();
    if (!approve) {
      const decided = await decideEditRequest({
        token, status: "rejected", approverOpenId: operator.openId, approverName: operator.name || approver.name,
        result: "已驳回", decidedAt
      });
      return decided
        ? { status: "rejected", request: decided, message: "已驳回。" }
        : { status: "already", request: await getEditRequest({ token }), message: "这条申请已经处理过了。" };
    }
    let applied;
    try {
      applied = await apply(request, value === undefined || value === null || String(value).trim() === "" ? request.proposedValue : value);
    } catch (error) {
      return { status: "invalid", request, message: error?.message || "修改失败。" };
    }
    if (applied.conflict) {
      const placeKind = request.kind === "place" || request.kind === "row-place";
      const updated = placeKind && !applied.missingRow ? await updateEditRequestPrevious({ token, previousValue: applied.current }) : request;
      return {
        status: "conflict",
        request: updated || request,
        message: placeKind && !applied.missingRow
          ? `原值已变为“${applied.current || (request.kind === "row-place" ? "未指定" : "未归村")}”，请确认后再同意。`
          : "PON 台账里这一行的一级地址已经被改过，无法按原值修改，请在桌面版核对后再处理。"
      };
    }
    const decided = await decideEditRequest({
      token, status: "approved", finalValue: applied.finalValue, approverOpenId: operator.openId,
      approverName: operator.name || approver.name, result: applied.result, decidedAt
    });
    return decided
      ? { status: "approved", request: decided, message: applied.result }
      : { status: "already", request: await getEditRequest({ token }), message: "这条申请已经处理过了。" };
  }

  return Object.freeze({ onuFormContext, findPonRows, submit, decide, approver: () => getEditApprover() });
}
