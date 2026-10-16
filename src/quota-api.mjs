// 渲染端定额预算 API（ADR-092）。上传与下载走原始 fetch，其余走统一的 JSON request。
const json = (body) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const put = (body) => ({ ...json(body), method: "PUT" });
const BASE = "/api/admin/quota";

async function errorFrom(response, fallback) {
  try {
    const data = await response.json();
    return new Error(data.error || fallback);
  } catch {
    return new Error(fallback);
  }
}

function fileNameFrom(response, fallback) {
  const header = response.headers.get("content-disposition") || "";
  const encoded = header.match(/filename\*=UTF-8''([^;]+)/);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1]);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

export function createQuotaApi({ request, rawFetch } = {}) {
  if (typeof request !== "function" || typeof rawFetch !== "function") throw new TypeError("定额预算 API 需要注入 request 和 rawFetch。");

  async function upload(path, file) {
    const response = await rawFetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream", "x-file-name": encodeURIComponent(file.name || "upload.xlsx") },
      body: file
    });
    if (!response.ok) throw await errorFrom(response, "上传失败");
    return response.json();
  }

  return Object.freeze({
    status: () => request(`${BASE}/status`),
    uploadTemplate: (file) => upload("/template", file),
    previewMaterials: (file) => upload("/materials/preview", file),
    uploadMaterials: (file) => upload("/materials", file),
    searchItems: (q) => request(`${BASE}/items?q=${encodeURIComponent(q || "")}`),
    searchMaterials: (q) => request(`${BASE}/materials?q=${encodeURIComponent(q || "")}`),
    overview: () => request(`${BASE}/overview`),
    catalog: () => request(`${BASE}/catalog`),
    setCommon: (kind, key, pinned) => request(`${BASE}/common`, put({ kind, key, pinned })),
    learned: () => request(`${BASE}/learned`),
    deleteLearned: (id) => request(`${BASE}/learned/${id}`, { method: "DELETE" }),
    presets: () => request(`${BASE}/presets`),
    savePreset: (preset) => (preset.id ? request(`${BASE}/presets/${preset.id}`, put(preset)) : request(`${BASE}/presets`, json(preset))),
    deletePreset: (id) => request(`${BASE}/presets/${id}`, { method: "DELETE" }),
    budgets: (q = "") => request(`${BASE}/budgets?q=${encodeURIComponent(q)}`),
    createBudget: (input) => request(`${BASE}/budgets`, json(input)),
    budget: (id) => request(`${BASE}/budgets/${id}`),
    updateInfo: (id, info) => request(`${BASE}/budgets/${id}`, put({ info })),
    deleteBudget: (id) => request(`${BASE}/budgets/${id}`, { method: "DELETE" }),
    saveAsPreset: (id, input) => request(`${BASE}/budgets/${id}/preset`, json(input)),
    savePipe: (id, input) => request(`${BASE}/budgets/${id}/pipe`, put(input)),
    refreshPrices: (id) => request(`${BASE}/budgets/${id}/refresh-prices`, json({})),
    addQuotaLine: (id, line) => request(`${BASE}/budgets/${id}/quota-lines`, json(line)),
    updateQuotaLine: (id, lineId, patch) => request(`${BASE}/budgets/${id}/quota-lines/${lineId}`, put(patch)),
    deleteQuotaLine: (id, lineId) => request(`${BASE}/budgets/${id}/quota-lines/${lineId}`, { method: "DELETE" }),
    addMaterialLine: (id, line) => request(`${BASE}/budgets/${id}/material-lines`, json(line)),
    updateMaterialLine: (id, lineId, patch) => request(`${BASE}/budgets/${id}/material-lines/${lineId}`, put(patch)),
    deleteMaterialLine: (id, lineId) => request(`${BASE}/budgets/${id}/material-lines/${lineId}`, { method: "DELETE" }),
    async exportBudget(id) {
      const response = await rawFetch(`${BASE}/budgets/${id}/export`);
      if (!response.ok) throw await errorFrom(response, "生成预算书失败");
      return { blob: await response.blob(), fileName: fileNameFrom(response, "预算书.xlsx") };
    }
  });
}
