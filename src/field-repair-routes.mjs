// 抢修相关的本地管理接口：夜间光功率基线（状态、设置、手动采集）与区域字典审核。
// 只读写本地 SQLite；手动采集与夜间任务一样只对 OLT 做 SNMP 只读查询。
import { countRegionCoverage, discoverVillageSubgroups, normalizeAddressText, resolveRegionPons } from "./village-regions.mjs";

const REGION_ID_PATH = /^\/api\/village-regions\/(\d+)$/;
const REGION_PONS_PATH = /^\/api\/village-regions\/(\d+)\/pons$/;

export async function handleFieldRepairRoutes(req, res, url, {
  opticalBaselineScheduler,
  getOpticalBaselineCoverage,
  saveOpticalBaselineSettings,
  getMergedOnuSnapshots,
  getVillageRegions,
  getVillageRegionVillages,
  saveVillageRegionCandidates,
  createVillageRegion,
  updateVillageRegion,
  updateVillageRegionPons = null,
  deleteVillageRegion,
  getPonPorts = async () => [],
  getOlts = async () => [],
  readBody,
  json
} = {}) {
  const { pathname } = url;
  const fail = (error, fallback) => json(res, error?.status || 400, { ok: false, error: error?.message || fallback });

  if (req.method === "GET" && pathname === "/api/optical-baseline") {
    try {
      const [status, coverage] = await Promise.all([opticalBaselineScheduler.status(), getOpticalBaselineCoverage()]);
      await json(res, 200, { ok: true, ...status, coverage });
    } catch (error) {
      await fail(error, "读取夜间光功率基线状态失败。");
    }
    return true;
  }
  if (req.method === "PUT" && pathname === "/api/optical-baseline/settings") {
    try {
      const body = await readBody(req);
      const settings = await saveOpticalBaselineSettings({ enabled: body.enabled, runHour: body.runHour });
      await opticalBaselineScheduler.reschedule();
      await json(res, 200, { ok: true, ...settings });
    } catch (error) {
      await fail(error, "保存夜间光功率采集设置失败。");
    }
    return true;
  }
  if (req.method === "POST" && pathname === "/api/optical-baseline/run") {
    const status = await opticalBaselineScheduler.status();
    if (status.running) {
      await json(res, 409, { ok: false, error: "夜间光功率采集正在进行，请稍后再试。" });
      return true;
    }
    // 整网读取可能需要几分钟，后台执行，页面轮询状态。
    void opticalBaselineScheduler.runNow({ trigger: "manual" }).catch(() => {});
    await json(res, 202, { ok: true, started: true });
    return true;
  }

  if (!pathname.startsWith("/api/village-regions")) return false;
  // 小组的 PON 口按“一级分光地址 + 小组用户 + 手动勾选”确定，户数按地址统计。
  let contextPromise = null;
  const regionContext = () => (contextPromise ||= Promise.all([getMergedOnuSnapshots(), getPonPorts(), getOlts()])
    .then(([users, ponPorts, olts]) => ({ users, ponPorts, vendorByIp: new Map((olts || []).map((olt) => [String(olt.host), String(olt.vendor || "")])) })));
  const withCoverage = async (regions) => {
    const context = await regionContext();
    return countRegionCoverage(context.users, regions).map((region) => ({
      ...region,
      ponCount: resolveRegionPons(region, context).filter((pon) => pon.included).length
    }));
  };
  try {
    if (req.method === "GET" && pathname === "/api/village-regions") {
      const village = normalizeAddressText(url.searchParams.get("village") || "");
      const villages = await getVillageRegionVillages();
      if (!village) {
        await json(res, 200, { ok: true, villages, regions: [] });
        return true;
      }
      const { users } = await regionContext();
      const regions = await withCoverage(await getVillageRegions({ village }));
      const villageUsers = users.filter((user) => normalizeAddressText(user.installationAddress).includes(village)).length;
      await json(res, 200, { ok: true, villages, village, villageUsers, regions });
      return true;
    }
    if (req.method === "POST" && pathname === "/api/village-regions/discover") {
      const body = await readBody(req);
      const village = normalizeAddressText(body.village);
      if (village.length < 2) throw Object.assign(new Error("请输入村名，例如“厚街村”。"), { status: 400 });
      const { users } = await regionContext();
      const discovered = discoverVillageSubgroups(users, village);
      if (!discovered.matchedUsers) throw Object.assign(new Error(`合并台账中没有找到地址包含“${village}”的用户。`), { status: 404 });
      const saved = await saveVillageRegionCandidates(village, discovered.candidates);
      await json(res, 200, {
        ok: true,
        village,
        villageUsers: discovered.matchedUsers,
        discoveredCount: discovered.candidates.length,
        regions: await withCoverage(saved)
      });
      return true;
    }
    if (req.method === "POST" && pathname === "/api/village-regions") {
      const body = await readBody(req);
      const region = await createVillageRegion(body);
      const [counted] = await withCoverage([region]);
      await json(res, 200, { ok: true, region: counted });
      return true;
    }
    const ponsMatch = REGION_PONS_PATH.exec(pathname);
    if (ponsMatch && (req.method === "GET" || req.method === "PUT")) {
      const id = Number(ponsMatch[1]);
      let region = (await getVillageRegions()).find((item) => item.id === id);
      if (!region) throw Object.assign(new Error("区域不存在。"), { status: 404 });
      if (req.method === "PUT") {
        if (typeof updateVillageRegionPons !== "function") throw Object.assign(new Error("不支持手动勾选 PON 口。"), { status: 501 });
        const body = await readBody(req);
        region = await updateVillageRegionPons(id, { include: body.include, exclude: body.exclude });
      }
      const [counted] = await withCoverage([region]);
      await json(res, 200, { ok: true, region: counted, pons: resolveRegionPons(region, await regionContext()) });
      return true;
    }
    const match = REGION_ID_PATH.exec(pathname);
    if (match && req.method === "PUT") {
      const body = await readBody(req);
      const region = await updateVillageRegion(Number(match[1]), body);
      const [counted] = await withCoverage([region]);
      await json(res, 200, { ok: true, region: counted });
      return true;
    }
    if (match && req.method === "DELETE") {
      await deleteVillageRegion(Number(match[1]));
      await json(res, 200, { ok: true });
      return true;
    }
    await json(res, 404, { ok: false, error: "API not found" });
  } catch (error) {
    await fail(error, "区域字典操作失败。");
  }
  return true;
}
