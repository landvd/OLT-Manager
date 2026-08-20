function requireFetch(fetcher) {
  if (typeof fetcher !== "function") throw new TypeError("OLT admin API requires fetch");
  return fetcher;
}

async function readResponse(response, fallback) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || data.message || fallback);
  return data;
}

export function createOltAdminApi({ fetch }) {
  const request = requireFetch(fetch);
  return {
    list() {
      return request("/api/admin/olts").then((response) => readResponse(response, "读取 OLT 列表失败"));
    },
    save(olts) {
      return request("/api/admin/olts", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ olts })
      }).then((response) => readResponse(response, "保存 OLT 信息失败"));
    }
  };
}
