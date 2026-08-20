import { projectPayloadFor } from "./project-view-state.mjs";

async function readResponse(response, fallback) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || fallback);
  return data;
}

function projectIdPath(id) {
  return encodeURIComponent(String(id || "").trim());
}

export function createProjectApi({ fetch } = {}) {
  if (typeof fetch !== "function") throw new TypeError("项目 API 需要注入 fetch。 ");

  return Object.freeze({
    async list(search = "") {
      const params = new URLSearchParams();
      if (String(search || "").trim()) params.set("q", String(search).trim());
      const suffix = params.toString() ? `?${params}` : "";
      const data = await readResponse(await fetch(`/api/admin/projects${suffix}`), "读取项目失败");
      return Array.isArray(data.rows) ? data.rows : [];
    },

    async save(form = {}) {
      const id = String(form.id || "").trim();
      const url = id ? `/api/admin/projects/${projectIdPath(id)}` : "/api/admin/projects";
      const data = await readResponse(await fetch(url, {
        method: id ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(projectPayloadFor(form))
      }), "保存项目失败");
      return data.project || null;
    },

    async remove(id) {
      return readResponse(await fetch(`/api/admin/projects/${projectIdPath(id)}`, { method: "DELETE" }), "删除项目失败");
    },

    async listOnus(id) {
      const data = await readResponse(await fetch(`/api/admin/projects/${projectIdPath(id)}/onus`), "读取项目 ONU 失败");
      return Array.isArray(data.rows) ? data.rows : [];
    },

    async updateOnuNote(projectId, onuId, note) {
      const data = await readResponse(await fetch(`/api/admin/projects/${projectIdPath(projectId)}/onus/${projectIdPath(onuId)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note: note || "" })
      }), "保存设备安装地址失败");
      return data.onu || null;
    },

    async removeOnu(projectId, onuId) {
      return readResponse(await fetch(`/api/admin/projects/${projectIdPath(projectId)}/onus/${projectIdPath(onuId)}`, { method: "DELETE" }), "移除项目 ONU 失败");
    }
  });
}
