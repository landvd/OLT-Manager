export const FEISHU_GATEWAY_CONTRACT_VERSION = "1";
export const FEISHU_QUERY_CANDIDATE_LIMIT = 100;

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

function ponReadRequest(request) {
  return request && text(request.oltId) &&
    coordinate(request.coordinate, ["chassis", "board", "pon"]);
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

    async readPonStatuses(request) {
      if (!ponReadRequest(request)) invalid("invalid PON status request");
      const result = await gateway.readPonStatuses(request);
      validatePonStatus(result, request);
      return result;
    }
  });
}
