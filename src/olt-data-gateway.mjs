const INTENT_FIELDS = Object.freeze({
  find_by_name: "username",
  find_by_phone: "userPhone",
  find_by_address: "installationAddress",
  find_by_loid: "loid",
  find_by_mac: "mac",
  find_by_onu_coordinate: "onuIndex"
});

const UNSUPPORTED_ONU_DETAIL_FIELDS = Object.freeze([
  "type",
  "configuredChannel",
  "currentChannel",
  "adminState",
  "configState",
  "authenticationMode",
  "snBind",
  "password",
  "vportMode",
  "dbaMode",
  "onuStatus",
  "omciBwProfile",
  "lineProfile",
  "serviceProfile",
  "onlineDuration",
  "fec",
  "fecActualMode",
  "ppsTod",
  "autoReplace",
  "multicastEncryption",
  "authHistory"
]);

const VERIFIED_ONU_DETAIL_VENDORS = new Set(["zte"]);

function contractError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function requiredText(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw contractError(`Missing ${label}.`);
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

function normalizePonCoordinate(value = {}) {
  return {
    chassis: requiredText(value.chassis, "PON chassis"),
    board: requiredText(value.board ?? value.slot, "PON board"),
    pon: requiredText(value.pon, "PON port")
  };
}

function safeLiveStatus(row) {
  return {
    phase: String(row.phase || "unknown"),
    rxPower: String(row.rxPower || "unknown"),
    distance: String(row.distance || "unknown"),
    serial: String(row.serial || "unknown"),
    name: String(row.name || "")
  };
}

function safeOlt(olt) {
  return {
    oltId: String(olt.id),
    name: String(olt.name || olt.id),
    vendor: String(olt.vendor || ""),
    model: String(olt.model || ""),
    enabled: olt.enabled !== false
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

function matchesPonAddress(value, search) {
  if (includesNormalized(value, search)) return true;
  const withoutVillageSuffix = String(search).trim().replace(/村$/, "");
  return withoutVillageSuffix.length >= 2 &&
    withoutVillageSuffix !== String(search).trim() &&
    includesNormalized(value, withoutVillageSuffix);
}

export function createOltDataGateway({
  getOlts,
  getUsers,
  getPonPorts,
  getDatasetRevision,
  listOnus,
  now = () => new Date()
}) {
  if (typeof getOlts !== "function" || typeof getUsers !== "function" ||
      typeof getPonPorts !== "function" || typeof getDatasetRevision !== "function" ||
      typeof listOnus !== "function") {
    throw new TypeError("OltDataGateway adapters are required.");
  }

  async function resolveOlts(oltIds) {
    if (!Array.isArray(oltIds) || oltIds.length === 0) throw contractError("Missing Authorized OLT scope.");
    const requested = [...new Set(oltIds.map((id) => requiredText(id, "OLT ID")))];
    const all = await getOlts();
    const byId = new Map(all.map((olt) => [String(olt.id), olt]));
    const unknown = requested.find((id) => !byId.has(id));
    if (unknown) throw contractError("Unknown OLT in Authorized OLT scope.");
    const disabled = requested.find((id) => byId.get(id).enabled === false);
    if (disabled) throw contractError("Disabled OLT in Authorized OLT scope.");
    return requested.map((id) => byId.get(id));
  }

  async function queryUsersImpl({ intent, value, oltIds, limit = 10 } = {}) {
    const field = INTENT_FIELDS[intent];
    if (!field) throw contractError("Unsupported user query intent.");
    const search = requiredText(value, "search value");
    const scopedOlts = await resolveOlts(oltIds);
    const candidates = [];
    for (const olt of scopedOlts) {
      const rows = await getUsers({ oltIp: olt.host, q: search });
      for (const row of rows) {
        if (includesNormalized(row[field], search)) {
          candidates.push(userCandidate(row, String(olt.id)));
        }
      }
    }
    const authorizedCount = candidates.length;
    const safeLimit = Math.max(1, Math.min(Number(limit) || 10, 10));
    return { authorizedCount, candidates: candidates.slice(0, safeLimit) };
  }

  async function readOnuStatusImpl({ oltId, coordinate } = {}) {
    const [olt] = await resolveOlts([requiredText(oltId, "OLT ID")]);
    const onu = normalizeCoordinate(coordinate);
    const rows = await listOnus(olt, onu);
    const match = rows.find((row) =>
      String(row.chassis) === onu.chassis &&
      String(row.board ?? row.slot) === onu.board &&
      String(row.pon) === onu.pon &&
      String(row.onuId) === onu.onuId
    );
    if (!match) throw contractError("ONU not found in authorized OLT scope.", 404);
    return {
      oltId: String(olt.id),
      onu,
      status: safeLiveStatus(match),
      observedAt: now().toISOString()
    };
  }

  async function readOnuDetailImpl({ oltId, coordinate } = {}) {
    const [olt] = await resolveOlts([requiredText(oltId, "OLT ID")]);
    if (!VERIFIED_ONU_DETAIL_VENDORS.has(String(olt.vendor || "").toLowerCase())) {
      throw contractError("ONU detail is not verified for this OLT vendor.", 409);
    }
    const onu = normalizeCoordinate(coordinate);
    const rows = await listOnus(olt, onu, { includeLastOnlineTime: true });
    const match = rows.find((row) =>
      String(row.chassis) === onu.chassis &&
      String(row.board ?? row.slot) === onu.board &&
      String(row.pon) === onu.pon &&
      String(row.onuId) === onu.onuId
    );
    if (!match) throw contractError("ONU not found in authorized OLT scope.", 404);
    const status = safeLiveStatus(match);
    return {
      oltId: String(olt.id),
      onu,
      status,
      detail: {
        interface: `gpon-onu_${onu.chassis}/${onu.board}/${onu.pon}:${onu.onuId}`,
        name: status.name,
        phaseState: status.phase,
        serialNumber: status.serial,
        opticalRxPower: status.rxPower,
        distance: status.distance,
        lastOnlineTime: match.lastOnlineTime || null
      },
      unsupportedFields: [...UNSUPPORTED_ONU_DETAIL_FIELDS],
      observedAt: now().toISOString()
    };
  }

  return Object.freeze({
    async status() {
      return {
        contractVersion: "1",
        readOnly: true,
        datasetRevision: requiredText(await getDatasetRevision(), "dataset revision"),
        capabilities: [
          "listOlts",
          "queryUsers",
          "readOnuStatus",
          "readOnuDetail",
          "queryUserLiveStatus",
          "queryPons",
          "readPonStatuses"
        ]
      };
    },

    async listOlts() {
      return (await getOlts()).map(safeOlt);
    },

    async queryUsers({ intent, value, oltIds, limit = 10 } = {}) {
      return queryUsersImpl({ intent, value, oltIds, limit });
    },

    async readOnuStatus({ oltId, coordinate } = {}) {
      return readOnuStatusImpl({ oltId, coordinate });
    },

    async readOnuDetail({ oltId, coordinate } = {}) {
      return readOnuDetailImpl({ oltId, coordinate });
    },

    async queryUserLiveStatus(request) {
      const result = await queryUsersImpl({ ...request, limit: 2 });
      if (result.authorizedCount === 0) {
        throw contractError("User not found in Authorized OLT scope.", 404);
      }
      if (result.authorizedCount !== 1) {
        throw contractError("User query must resolve to exactly one candidate.", 409);
      }
      const candidate = result.candidates[0];
      return {
        candidate,
        liveStatus: await readOnuStatusImpl({
          oltId: candidate.oltId,
          coordinate: candidate.onu
        })
      };
    },

    async queryPons({ value, oltIds, limit = 10 } = {}) {
      const search = requiredText(value, "PON address search value");
      const scopedOlts = await resolveOlts(oltIds);
      const oltByHost = new Map(scopedOlts.map((olt) => [String(olt.host), olt]));
      const matchesByCoordinate = new Map();
      for (const port of await getPonPorts()) {
        if (!oltByHost.has(String(port.oltIp)) ||
            !matchesPonAddress(port.address, search)) continue;
        const olt = oltByHost.get(String(port.oltIp));
        const pon = normalizePonCoordinate(port);
        const key = `${olt.id}:${pon.chassis}/${pon.board}/${pon.pon}`;
        if (matchesByCoordinate.has(key)) continue;
        matchesByCoordinate.set(key, {
          candidateId: `${olt.id}:${port.chassis}/${port.board}/${port.pon}`,
          oltId: String(olt.id),
          oltName: String(olt.name || olt.id),
          address: String(port.address || ""),
          pon
        });
      }
      const matches = [...matchesByCoordinate.values()];
      const authorizedCount = matches.length;
      const safeLimit = Math.max(1, Math.min(Number(limit) || 10, 10));
      return {
        authorizedCount,
        candidates: matches.slice(0, safeLimit)
      };
    },

    async readPonStatuses({ oltId, coordinate } = {}) {
      const [olt] = await resolveOlts([requiredText(oltId, "OLT ID")]);
      const pon = normalizePonCoordinate(coordinate);
      const rows = (await listOnus(olt, pon)).filter((row) =>
        String(row.chassis) === pon.chassis &&
        String(row.board ?? row.slot) === pon.board &&
        String(row.pon) === pon.pon
      );
      if (rows.length > 128) {
        throw contractError("PON status result exceeds the 128 ONU safety limit.");
      }
      const nameByOnuId = new Map();
      for (const user of await getUsers({ oltIp: olt.host, q: "" })) {
        const userOnu = parseCoordinate(user.onuIndex);
        if (userOnu.chassis !== pon.chassis ||
            userOnu.board !== pon.board ||
            userOnu.pon !== pon.pon ||
            !userOnu.onuId ||
            nameByOnuId.has(userOnu.onuId)) continue;
        nameByOnuId.set(userOnu.onuId, String(user.username || ""));
      }
      const onus = rows.map((row) => ({
        onu: {
          chassis: pon.chassis,
          board: pon.board,
          pon: pon.pon,
          onuId: requiredText(row.onuId, "ONU ID")
        },
        name: nameByOnuId.get(String(row.onuId)) || "",
        phase: String(row.phase || "unknown"),
        rxPower: String(row.rxPower || "unknown")
      })).sort((left, right) =>
        Number(left.onu.onuId) - Number(right.onu.onuId)
      );
      return {
        oltId: String(olt.id),
        pon,
        onuCount: onus.length,
        onus,
        observedAt: now().toISOString()
      };
    }
  });
}
