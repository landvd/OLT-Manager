function requireRequest(request) {
  if (typeof request !== "function") throw new TypeError("ONU API requires a request function");
  return request;
}

function queryForRow(row) {
  return new URLSearchParams({
    oltId: String(row.oltId || ""),
    chassis: String(row.chassis ?? ""),
    board: String(row.board ?? row.slot ?? ""),
    slot: String(row.board ?? row.slot ?? ""),
    pon: String(row.pon ?? ""),
    onuId: String(row.onuId ?? ""),
    serial: String(row.serial ?? "")
  });
}

export function createOnuApi({ request }) {
  const send = requireRequest(request);
  return {
    status() {
      return send("/api/status");
    },
    unregistered() {
      return send("/api/unregistered-onus");
    },
    configTemplates() {
      return send("/api/config-templates");
    },
    list(params = new URLSearchParams()) {
      const query = params instanceof URLSearchParams ? params.toString() : new URLSearchParams(params).toString();
      return send(`/api/onus?${query}`);
    },
    config(row) {
      return send(`/api/onu-config?${queryForRow(row)}`);
    },
    configPlan(row, payload) {
      const key = `${row.chassis ?? ""}/${row.board ?? row.slot ?? ""}/${row.pon ?? ""}-${row.serial ?? ""}`;
      return send(`/api/unregistered-onus/${encodeURIComponent(key)}/config-plan`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
    }
  };
}
