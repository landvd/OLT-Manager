const INTENT_FIELDS = Object.freeze({
  find_by_name: "username",
  find_by_phone: "userPhone",
  find_by_address: "installationAddress",
  find_by_loid: "loid",
  find_by_mac: "mac",
  find_by_onu_coordinate: "onuIndex"
});

function requiredText(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`Missing ${label}.`);
  return normalized;
}

function parseCoordinate(value) {
  const [path = "", onuId = ""] = String(value || "").split(":", 2);
  const [chassis = "", board = "", pon = ""] = path.split("/", 3);
  return { chassis, board, pon, onuId };
}

function normalizeCoordinate(value = {}) {
  return {
    chassis: requiredText(value.chassis, "ONU chassis"),
    board: requiredText(value.board ?? value.slot, "ONU board"),
    pon: requiredText(value.pon, "ONU PON"),
    onuId: requiredText(value.onuId, "ONU ID")
  };
}

function safeOlt(olt) {
  return {
    oltId: String(olt.id),
    name: String(olt.name || olt.id),
    vendor: String(olt.vendor || ""),
    model: String(olt.model || "")
  };
}

function userCandidate(row, oltId) {
  const onu = parseCoordinate(row.onuIndex);
  return {
    candidateId: `${oltId}:${row.onuIndex}`,
    oltId,
    name: String(row.username || ""),
    phone: String(row.userPhone || ""),
    address: String(row.installationAddress || ""),
    loid: String(row.loid || ""),
    mac: String(row.mac || ""),
    onu,
    snapshotAt: row.syncedAt || null
  };
}

function includesNormalized(value, search) {
  return String(value || "").trim().toLocaleLowerCase("zh-Hans-CN")
    .includes(search.toLocaleLowerCase("zh-Hans-CN"));
}

export function createOltDataGateway({ getOlts, getUsers, listOnus, now = () => new Date() }) {
  if (typeof getOlts !== "function" || typeof getUsers !== "function" || typeof listOnus !== "function") {
    throw new TypeError("OltDataGateway adapters are required.");
  }

  async function resolveOlts(oltIds) {
    if (!Array.isArray(oltIds) || oltIds.length === 0) throw new Error("Missing Authorized OLT scope.");
    const requested = [...new Set(oltIds.map((id) => requiredText(id, "OLT ID")))];
    const all = await getOlts();
    const byId = new Map(all.map((olt) => [String(olt.id), olt]));
    const unknown = requested.find((id) => !byId.has(id));
    if (unknown) throw new Error("Unknown OLT in Authorized OLT scope.");
    return requested.map((id) => byId.get(id));
  }

  return Object.freeze({
    async status() {
      return {
        contractVersion: "1",
        readOnly: true,
        capabilities: ["listOlts", "queryUsers", "readOnuStatus"]
      };
    },

    async listOlts() {
      return (await getOlts()).map(safeOlt);
    },

    async queryUsers({ intent, value, oltIds, limit = 10 } = {}) {
      const field = INTENT_FIELDS[intent];
      if (!field) throw new Error("Unsupported user query intent.");
      const search = requiredText(value, "search value");
      const scopedOlts = await resolveOlts(oltIds);
      const candidates = [];
      for (const olt of scopedOlts) {
        const rows = await getUsers({ oltIp: olt.host, q: search });
        for (const row of rows) {
          if (includesNormalized(row[field], search)) candidates.push(userCandidate(row, String(olt.id)));
        }
      }
      const authorizedCount = candidates.length;
      const safeLimit = Math.max(1, Math.min(Number(limit) || 10, 10));
      return { authorizedCount, candidates: candidates.slice(0, safeLimit) };
    },

    async readOnuStatus({ oltId, coordinate } = {}) {
      const [olt] = await resolveOlts([requiredText(oltId, "OLT ID")]);
      const onu = normalizeCoordinate(coordinate);
      const rows = await listOnus(olt, onu);
      const match = rows.find((row) =>
        String(row.chassis) === onu.chassis &&
        String(row.board ?? row.slot) === onu.board &&
        String(row.pon) === onu.pon &&
        String(row.onuId) === onu.onuId
      );
      if (!match) throw new Error("ONU not found in authorized OLT scope.");
      return {
        oltId: String(olt.id),
        onu,
        status: {
          phase: String(match.phase || "unknown"),
          rxPower: String(match.rxPower || "unknown"),
          distance: String(match.distance || "unknown"),
          serial: String(match.serial || "unknown"),
          name: String(match.name || "")
        },
        observedAt: now().toISOString()
      };
    }
  });
}
