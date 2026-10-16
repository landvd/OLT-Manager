// 定额预算接口（ADR-092）：桌面“定额预算”页使用。只读写本地 SQLite 和上传 / 生成的文件，不触发任何 OLT 命令。
const PREFIX = "/api/admin/quota";
const UPLOAD_LIMIT = 30 * 1024 * 1024;

function fileNameFrom(req, fallback) {
  const raw = req.headers["x-file-name"];
  if (!raw) return fallback;
  try {
    return decodeURIComponent(String(raw)).replace(/[\\/]/g, "").slice(0, 200) || fallback;
  } catch {
    return fallback;
  }
}

export async function handleQuotaRoutes(req, res, url, { quotaService, json, readBody, readBinaryBody } = {}) {
  const { pathname } = url;
  if (!pathname.startsWith(PREFIX)) return false;
  const path = pathname.slice(PREFIX.length) || "/";
  const method = req.method;
  const done = (body = {}) => {
    json(res, 200, { ok: true, ...body });
    return true;
  };
  const upload = async () => {
    const buffer = await readBinaryBody(req, UPLOAD_LIMIT);
    if (!buffer.length) {
      const error = new Error("没有收到文件");
      error.status = 400;
      throw error;
    }
    return buffer;
  };
  let match;
  try {
    if (method === "GET" && path === "/status") return done(await quotaService.status());
    if (method === "POST" && path === "/template") {
      return done(await quotaService.importTemplate({ fileName: fileNameFrom(req, "预算书模板.xlsx"), buffer: await upload() }));
    }
    if (method === "POST" && path === "/materials/preview") return done(await quotaService.previewMaterials({ buffer: await upload() }));
    if (method === "POST" && path === "/materials") {
      return done(await quotaService.importMaterials({ fileName: fileNameFrom(req, "材料单价参考.xlsx"), buffer: await upload() }));
    }
    if (method === "GET" && path === "/items") return done({ rows: await quotaService.searchQuota(url.searchParams.get("q") || "", { limit: 50 }) });
    if (method === "GET" && path === "/materials") return done({ rows: await quotaService.searchMaterials(url.searchParams.get("q") || "", { limit: 50 }) });

    if (method === "GET" && path === "/overview") return done(await quotaService.overview());
    if (method === "GET" && path === "/catalog") return done(await quotaService.catalog());
    if (method === "PUT" && path === "/common") return done(await quotaService.setCommon(await readBody(req)));
    if (method === "GET" && path === "/learned") return done({ rows: await quotaService.listLearned() });
    if ((match = path.match(/^\/learned\/(\d+)$/)) && method === "DELETE") {
      await quotaService.deleteLearned(Number(match[1]));
      return done({ rows: await quotaService.listLearned() });
    }
    if (method === "GET" && path === "/presets") return done({ rows: await quotaService.listPresets() });
    if (method === "POST" && path === "/presets") return done({ preset: await quotaService.savePreset(await readBody(req)) });
    if ((match = path.match(/^\/presets\/(\d+)$/))) {
      if (method === "PUT") return done({ preset: await quotaService.savePreset({ ...(await readBody(req)), id: Number(match[1]) }) });
      if (method === "DELETE") return done({ deleted: await quotaService.deletePreset(Number(match[1])) });
    }

    if (method === "GET" && path === "/budgets") return done({ rows: await quotaService.listBudgets({ q: url.searchParams.get("q") || "" }) });
    if (method === "POST" && path === "/budgets") {
      const body = await readBody(req);
      return done({ budget: await quotaService.createBudget({ ...body, createdBy: "desktop", createdByName: "" }) });
    }
    if ((match = path.match(/^\/budgets\/(\d+)(\/.*)?$/))) {
      const budgetId = Number(match[1]);
      const rest = match[2] || "";
      if (rest === "") {
        if (method === "GET") return done(await quotaService.budgetView(budgetId));
        if (method === "PUT") {
          await quotaService.updateBudgetInfo(budgetId, (await readBody(req)).info || {});
          return done(await quotaService.budgetView(budgetId));
        }
        if (method === "DELETE") {
          await quotaService.deleteBudget(budgetId);
          return done();
        }
      }
      if (method === "POST" && rest === "/preset") return done({ preset: await quotaService.savePresetFromBudget(budgetId, await readBody(req)) });
      if (method === "PUT" && rest === "/pipe") {
        await quotaService.savePipeInput(budgetId, await readBody(req));
        return done(await quotaService.budgetView(budgetId));
      }
      if (method === "POST" && rest === "/refresh-prices") {
        const changed = await quotaService.refreshMaterialPrices(budgetId);
        return done({ changed, ...(await quotaService.budgetView(budgetId)) });
      }
      if (method === "POST" && rest === "/quota-lines") {
        await quotaService.addQuotaLine(budgetId, await readBody(req));
        return done(await quotaService.budgetView(budgetId));
      }
      if (method === "POST" && rest === "/material-lines") {
        await quotaService.addMaterialLine(budgetId, await readBody(req));
        return done(await quotaService.budgetView(budgetId));
      }
      const line = rest.match(/^\/(quota|material)-lines\/(\d+)$/);
      if (line) {
        const lineId = Number(line[2]);
        if (method === "PUT") {
          const patch = await readBody(req);
          if (line[1] === "quota") await quotaService.updateQuotaLine(budgetId, lineId, patch);
          else await quotaService.updateMaterialLine(budgetId, lineId, patch);
          return done(await quotaService.budgetView(budgetId));
        }
        if (method === "DELETE") {
          if (line[1] === "quota") await quotaService.deleteQuotaLine(budgetId, lineId);
          else await quotaService.deleteMaterialLine(budgetId, lineId);
          return done(await quotaService.budgetView(budgetId));
        }
      }
      if (method === "GET" && rest === "/export") {
        const { fileName, buffer } = await quotaService.exportBudget(budgetId);
        res.writeHead(200, {
          "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "content-disposition": `attachment; filename="budget.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
          "content-length": buffer.length,
          "cache-control": "no-store"
        });
        res.end(buffer);
        return true;
      }
    }
    return false;
  } catch (error) {
    await json(res, error?.status || 400, { ok: false, error: error?.message || "定额预算操作失败" });
    return true;
  }
}
