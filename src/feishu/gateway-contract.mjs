export const FEISHU_GATEWAY_CONTRACT_VERSION = "1";
export const FEISHU_QUERY_CANDIDATE_LIMIT = 100;
export const FEISHU_VILLAGE_PON_PAGE_LIMIT = 20;

function invalid(message) {
  throw new Error(`Feishu Gateway contract violation: ${message}`);
}

function text(value) {
  return typeof value === "string" && value.length > 0;
}

function coordinate(value, fields) {
  return value && fields.every((field) => text(value[field]));
}

function sameCoordinate(left, right, fields) {
  return coordinate(left, fields) && coordinate(right, fields) &&
    fields.every((field) => String(left[field]) === String(right[field]));
}

function scopedQuery(request) {
  return request && text(request.intent) && text(request.value) &&
    Array.isArray(request.oltIds) && request.oltIds.length > 0 &&
    request.oltIds.every(text);
}

function onuReadRequest(request) {
  return request && text(request.oltId) &&
    coordinate(request.coordinate, ["chassis", "board", "pon", "onuId"]);
}

function onuHistoryRequest(request) {
  return onuReadRequest(request) &&
    (request.days === undefined || (Number.isInteger(request.days) && request.days >= 1 && request.days <= 7)) &&
    (request.limit === undefined || (Number.isInteger(request.limit) && request.limit >= 1 && request.limit <= 48));
}

function historicalOpticalRequest(request) {
  const validDate = (value) => {
    if (!text(value) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = Date.parse(`${value}T00:00:00Z`);
    return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
  };
  return onuReadRequest(request) && validDate(request.startDate) && validDate(request.endDate) &&
    (request.limit === undefined || (Number.isInteger(request.limit) && request.limit >= 1 && request.limit <= 48));
}

function ponReadRequest(request) {
  return request && text(request.oltId) &&
    coordinate(request.coordinate, ["chassis", "board", "pon"]);
}

function ipv4(value) {
  const parts = String(value ?? "").trim().split(".");
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}

function ponIpReadRequest(request) {
  return request && ipv4(request.oltIp) &&
    typeof request.board === "string" && /^\d+$/.test(request.board) &&
    typeof request.pon === "string" && /^\d+$/.test(request.pon) &&
    Array.isArray(request.oltIds) && request.oltIds.length > 0 && request.oltIds.every(text);
}

function villageQueryRequest(request) {
  return request && text(request.value) && Array.isArray(request.oltIds) &&
    request.oltIds.length > 0 && request.oltIds.every(text) &&
    Number.isInteger(request.offset) && request.offset >= 0 &&
    Number.isInteger(request.limit) && request.limit >= 1 && request.limit <= FEISHU_VILLAGE_PON_PAGE_LIMIT;
}

function validateOlt(value) {
  if (!value || !text(value.oltId) || !text(value.name) ||
      typeof value.vendor !== "string" || typeof value.model !== "string" ||
      typeof value.enabled !== "boolean") {
    invalid("invalid OLT projection");
  }
}

function validateCandidate(value, request) {
  if (!value || !text(value.candidateId) || !text(value.oltId) ||
      !coordinate(value.onu, ["chassis", "board", "pon", "onuId"]) ||
      !["name", "phone", "address", "loid", "mac"].every(
        (field) => typeof value[field] === "string"
      ) || !request.oltIds.includes(value.oltId)) {
      invalid("invalid user candidate projection");
  }
  if (value.serialNumber !== undefined && typeof value.serialNumber !== "string") {
    invalid("invalid user candidate serial projection");
  }
  if (value.deviceNumber !== undefined && typeof value.deviceNumber !== "string") {
    invalid("invalid user candidate device number projection");
  }
}

function validateStatus(value) {
  if (!value || !["phase", "rxPower", "distance", "serial", "name"].every(
    (field) => typeof value[field] === "string"
  )) {
    invalid("invalid ONU status projection");
  }
}

function validateOnuDetail(value) {
  if (!value || !["interface", "name", "phaseState", "serialNumber",
    "opticalRxPower", "distance"].every((field) => typeof value[field] === "string")) {
    invalid("invalid ONU detail projection");
  }
  for (const field of ["lastOnlineTime", "lastOfflineTime", "lastOfflineCause"]) {
    if (value[field] !== null && value[field] !== undefined &&
        typeof value[field] !== "string") invalid(`invalid ${field} projection`);
  }
  if (value.lastOfflineCauseCode !== null &&
      value.lastOfflineCauseCode !== undefined &&
      !Number.isInteger(value.lastOfflineCauseCode)) {
    invalid("invalid lastOfflineCauseCode projection");
  }
}

function validateOnuHistory(value, request) {
  if (!value || value.oltId !== request.oltId ||
      !sameCoordinate(value.onu, request.coordinate, ["chassis", "board", "pon", "onuId"]) ||
      !Number.isInteger(value.days) || value.days < 1 || value.days > 7 ||
      !Array.isArray(value.rows) || value.rows.length > 48 || !text(value.observedAt)) {
    invalid("invalid ONU history projection");
  }
  for (const row of value.rows) {
    if (!row || !text(row.sampledAt) || !text(row.phase) ||
        !text(row.rxPower) || !text(row.distance)) {
      invalid("invalid ONU history row projection");
    }
  }
}

function validateHistoricalOptical(value, request) {
  if (!value || value.source !== "oss-ngb" || value.oltId !== request.oltId ||
      !sameCoordinate(value.onu, request.coordinate, ["chassis", "board", "pon", "onuId"]) ||
      value.startDate !== request.startDate || value.endDate !== request.endDate ||
      !Array.isArray(value.rows) || value.rows.length > 48 || !text(value.observedAt)) {
    invalid("invalid remote historical optical projection");
  }
  for (const row of value.rows) {
    if (!row || !text(row.reportTime) ||
        !["rxOptical", "txOptical", "oltRxOptical", "lightDecay"].every((field) =>
          row[field] === null || typeof row[field] === "number")) {
      invalid("invalid remote historical optical row projection");
    }
  }
}

function validatePonCandidate(value, request) {
  if (!value || !text(value.candidateId) || !text(value.oltId) ||
      !text(value.oltName) || typeof value.address !== "string" ||
      !coordinate(value.pon, ["chassis", "board", "pon"]) ||
      !request.oltIds.includes(value.oltId)) {
    invalid("invalid PON candidate projection");
  }
}

function validatePonStatus(value, request) {
  if (!value || value.oltId !== request.oltId ||
      !sameCoordinate(value.pon, request.coordinate, ["chassis", "board", "pon"]) ||
      !Number.isInteger(value.onuCount) || value.onuCount < 0 ||
      !Array.isArray(value.onus) || value.onus.length > 128 ||
      !text(value.observedAt)) {
    invalid("invalid PON status projection");
  }
  for (const onu of value.onus) {
    if (!onu || !coordinate(onu.onu, ["chassis", "board", "pon", "onuId"]) ||
        typeof onu.name !== "string" || typeof onu.phase !== "string" ||
        typeof onu.rxPower !== "string") {
      invalid("invalid PON ONU projection");
    }
  }
}

export function createInProcessFeishuGateway({ gateway }) {
  if (!gateway || typeof gateway !== "object") {
    throw new TypeError("An OltDataGateway implementation is required.");
  }

  return Object.freeze({
    async status() {
      const result = await gateway.status();
      if (result?.contractVersion !== FEISHU_GATEWAY_CONTRACT_VERSION ||
          result.readOnly !== true || !text(result.datasetRevision)) {
        invalid("incompatible status");
      }
      return result;
    },

    async listOlts() {
      const result = await gateway.listOlts();
      if (!Array.isArray(result)) invalid("OLT list is not an array");
      result.forEach(validateOlt);
      return result;
    },

    async queryUsers(request) {
      if (!scopedQuery(request)) invalid("invalid user query request");
      const result = await gateway.queryUsers(request);
      if (!Number.isInteger(result?.authorizedCount) || result.authorizedCount < 0 ||
          !Array.isArray(result.candidates) || result.candidates.length > FEISHU_QUERY_CANDIDATE_LIMIT ||
          result.authorizedCount < result.candidates.length) {
        invalid("invalid user query result");
      }
      result.candidates.forEach((candidate) => validateCandidate(candidate, request));
      return result;
    },

    async queryUsersByDeviceNumber(request) {
      if (!request || !text(request.value) || !Array.isArray(request.oltIds) ||
          request.oltIds.length === 0 || !request.oltIds.every(text)) {
        invalid("invalid device number query request");
      }
      if (typeof gateway.queryUsersByDeviceNumber !== "function") {
        invalid("device number query is unavailable");
      }
      const result = await gateway.queryUsersByDeviceNumber(request);
      if (!Number.isInteger(result?.authorizedCount) || result.authorizedCount < 0 ||
          !Array.isArray(result.candidates) || result.candidates.length > FEISHU_QUERY_CANDIDATE_LIMIT ||
          result.authorizedCount < result.candidates.length) {
        invalid("invalid device number query result");
      }
      result.candidates.forEach((candidate) => validateCandidate(candidate, request));
      if (result.candidates.some((candidate) => typeof candidate.deviceNumber !== "string")) {
        invalid("device number query result is missing device number");
      }
      return result;
    },

    async readOnuStatus(request) {
      if (!onuReadRequest(request)) invalid("invalid ONU status request");
      const result = await gateway.readOnuStatus(request);
      if (!result || result.oltId !== request.oltId ||
          !sameCoordinate(result.onu, request.coordinate,
            ["chassis", "board", "pon", "onuId"]) || !text(result.observedAt)) {
        invalid("invalid ONU status result");
      }
      validateStatus(result.status);
      return result;
    },

    async readOnuDetail(request) {
      if (!onuReadRequest(request)) invalid("invalid ONU detail request");
      const result = await gateway.readOnuDetail(request);
      if (!result || result.oltId !== request.oltId ||
          !sameCoordinate(result.onu, request.coordinate,
            ["chassis", "board", "pon", "onuId"]) || !text(result.observedAt) ||
          !Array.isArray(result.unsupportedFields)) {
        invalid("invalid ONU detail result");
      }
      validateStatus(result.status);
      validateOnuDetail(result.detail);
      return result;
    },

    async readOnuHistory(request) {
      if (!onuHistoryRequest(request)) invalid("invalid ONU history request");
      if (typeof gateway.readOnuHistory !== "function") invalid("ONU history is unavailable");
      const result = await gateway.readOnuHistory(request);
      validateOnuHistory(result, request);
      return result;
    },

    async readOnuHistoricalOptical(request) {
      if (!historicalOpticalRequest(request)) invalid("invalid remote historical optical request");
      if (typeof gateway.readOnuHistoricalOptical !== "function") {
        const error = new Error("网管二期实时历史光功率尚未配置安全只读适配器。");
        error.code = "HISTORICAL_OPTICAL_UNAVAILABLE";
        error.statusCode = 503;
        throw error;
      }
      const result = await gateway.readOnuHistoricalOptical(request);
      validateHistoricalOptical(result, request);
      return result;
    },

    async queryPons(request) {
      if (!request || !text(request.value) || !Array.isArray(request.oltIds) ||
          request.oltIds.length === 0 || !request.oltIds.every(text)) {
        invalid("invalid PON query request");
      }
      const result = await gateway.queryPons(request);
      if (!Number.isInteger(result?.authorizedCount) || result.authorizedCount < 0 ||
          !Array.isArray(result.candidates) || result.candidates.length > FEISHU_QUERY_CANDIDATE_LIMIT ||
          result.authorizedCount < result.candidates.length) {
        invalid("invalid PON query result");
      }
      result.candidates.forEach((candidate) => validatePonCandidate(candidate, request));
      return result;
    },

    async queryVillagePons(request) {
      if (!villageQueryRequest(request)) invalid("invalid village PON query request");
      if (typeof gateway.queryVillagePons !== "function") invalid("village PON query is unavailable");
      const result = await gateway.queryVillagePons(request);
      if (!Number.isInteger(result?.authorizedCount) || result.authorizedCount < 0 ||
          result.total !== result.authorizedCount || !Number.isInteger(result.offset) ||
          result.offset !== request.offset || !Number.isInteger(result.limit) ||
          result.limit !== request.limit || typeof result.hasMore !== "boolean" ||
          !Array.isArray(result.candidates) || result.candidates.length > request.limit ||
          result.offset + result.candidates.length > result.total ||
          result.hasMore !== (result.offset + result.candidates.length < result.total) ||
          (result.hasMore && result.candidates.length !== result.limit)) {
        invalid("invalid village PON query result");
      }
      result.candidates.forEach((candidate) => validatePonCandidate(candidate, request));
      return result;
    },

    async sampleVillagePonOnlineUser(request) {
      if (!request || !text(request.value) || !text(request.oltId) ||
          !Array.isArray(request.oltIds) || !request.oltIds.includes(request.oltId) ||
          !ponReadRequest({ oltId: request.oltId, coordinate: request.pon })) {
        invalid("invalid village PON sample request");
      }
      if (typeof gateway.sampleVillagePonOnlineUser !== "function") invalid("village PON sampling is unavailable");
      const result = await gateway.sampleVillagePonOnlineUser(request);
      if (!result || (result.candidate === null && result.liveStatus === null)) return result;
      if (!result.candidate || !result.liveStatus) invalid("invalid village PON sample result");
      validateCandidate(result.candidate, request);
      if (result.candidate.oltId !== request.oltId ||
          !sameCoordinate(result.candidate.onu, result.liveStatus.onu, ["chassis", "board", "pon", "onuId"])) {
        invalid("village PON sample coordinate mismatch");
      }
      if (!sameCoordinate(result.candidate.onu, request.pon, ["chassis", "board", "pon"])) {
        invalid("village PON sample returned a different PON");
      }
      if (!text(result.liveStatus.observedAt)) invalid("invalid village PON sample time");
      validateStatus(result.liveStatus.status);
      return result;
    },

    async readPonStatuses(request) {
      if (!ponReadRequest(request)) invalid("invalid PON status request");
      const result = await gateway.readPonStatuses(request);
      validatePonStatus(result, request);
      return result;
    },

    async readPonStatusesByIp(request) {
      if (!ponIpReadRequest(request)) invalid("invalid OLT IPv4 PON status request");
      if (typeof gateway.readPonStatusesByIp !== "function") invalid("OLT IPv4 PON status is unavailable");
      const result = await gateway.readPonStatusesByIp(request);
      if (!result || !text(result.oltId) || !coordinate(result.pon, ["chassis", "board", "pon"])) {
        invalid("invalid OLT IPv4 PON status result");
      }
      validatePonStatus(result, { oltId: result.oltId, coordinate: result.pon });
      return result;
    }
  });
}
