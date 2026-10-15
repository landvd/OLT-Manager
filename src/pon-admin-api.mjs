async function readResponse(response, fallback) {
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || data.message || fallback), { status: response.status, code: data.code || "" });
  return data;
}

export function createPonAdminApi({ fetch } = {}) {
  if (typeof fetch !== "function") throw new TypeError("PON 台账 API 需要注入 fetch。 ");

  return Object.freeze({
    async list() {
      const data = await readResponse(await fetch("/api/admin/pon-ports"), "读取 PON 台账失败");
      return Array.isArray(data) ? data : (Array.isArray(data.ponPorts) ? data.ponPorts : []);
    },

    // baseRevision：打开台账时的内容指纹；台账被别处改过时服务端返回 409（code PON_LEDGER_CHANGED）。
    async save(rows = [], fallback = "保存失败", { baseRevision = "" } = {}) {
      return readResponse(await fetch("/api/admin/import-pon-ports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(baseRevision ? { rows, baseRevision } : { rows })
      }), fallback);
    }
  });
}
