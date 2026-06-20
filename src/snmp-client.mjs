import dgram from "node:dgram";

const TYPE_SEQUENCE = 0x30;
const TYPE_INTEGER = 0x02;
const TYPE_OCTET_STRING = 0x04;
const TYPE_NULL = 0x05;
const TYPE_OID = 0x06;
const TYPE_GET_REQUEST = 0xa0;
const TYPE_GET_BULK_REQUEST = 0xa5;
const TYPE_GET_RESPONSE = 0xa2;
const TYPE_END_OF_MIB = 0x82;

function encodeLength(length) {
  if (length < 0x80) return Buffer.from([length]);
  const bytes = [];
  let value = length;
  while (value > 0) {
    bytes.unshift(value & 0xff);
    value >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function tlv(type, value) {
  const body = Buffer.from(value);
  return Buffer.concat([Buffer.from([type]), encodeLength(body.length), body]);
}

function sequence(items) {
  return tlv(TYPE_SEQUENCE, Buffer.concat(items));
}

function integer(value) {
  const bytes = [];
  let current = Math.max(0, Number(value) || 0);
  do {
    bytes.unshift(current & 0xff);
    current >>= 8;
  } while (current > 0);
  if (bytes[0] & 0x80) bytes.unshift(0);
  return tlv(TYPE_INTEGER, Buffer.from(bytes));
}

function octetString(value) {
  return tlv(TYPE_OCTET_STRING, Buffer.from(String(value || ""), "utf8"));
}

function nullValue() {
  return Buffer.from([TYPE_NULL, 0x00]);
}

function encodeBase128(value) {
  const bytes = [value & 0x7f];
  let current = value >> 7;
  while (current > 0) {
    bytes.unshift((current & 0x7f) | 0x80);
    current >>= 7;
  }
  return bytes;
}

function oidValue(oid) {
  const parts = String(oid).split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length < 2 || parts.some((part) => !Number.isFinite(part) || part < 0)) {
    throw new Error(`Invalid OID: ${oid}`);
  }
  return tlv(TYPE_OID, Buffer.from([
    parts[0] * 40 + parts[1],
    ...parts.slice(2).flatMap(encodeBase128)
  ]));
}

function varbind(oid) {
  return sequence([oidValue(oid), nullValue()]);
}

function requestMessage({ pduType, community, oid, requestId, nonRepeaters = 0, maxRepetitions = 10 }) {
  const counters = pduType === TYPE_GET_BULK_REQUEST
    ? [integer(nonRepeaters), integer(maxRepetitions)]
    : [integer(0), integer(0)];
  const pdu = tlv(pduType, Buffer.concat([
    integer(requestId),
    ...counters,
    sequence([varbind(oid)])
  ]));
  return sequence([integer(1), octetString(community), pdu]);
}

function readLength(buffer, offset) {
  const first = buffer[offset];
  if (first < 0x80) return { length: first, offset: offset + 1 };
  const count = first & 0x7f;
  let length = 0;
  for (let i = 0; i < count; i += 1) length = (length << 8) + buffer[offset + 1 + i];
  return { length, offset: offset + 1 + count };
}

function readTlv(buffer, offset = 0) {
  const type = buffer[offset];
  const lengthInfo = readLength(buffer, offset + 1);
  const start = lengthInfo.offset;
  const end = start + lengthInfo.length;
  if (end > buffer.length) throw new Error("Invalid SNMP BER length");
  return { type, value: buffer.subarray(start, end), nextOffset: end };
}

function readChildren(buffer) {
  const children = [];
  let offset = 0;
  while (offset < buffer.length) {
    const item = readTlv(buffer, offset);
    children.push(item);
    offset = item.nextOffset;
  }
  return children;
}

function parseInteger(buffer) {
  let value = 0;
  for (const byte of buffer) value = (value << 8) + byte;
  return value;
}

function decodeOid(buffer) {
  if (!buffer.length) return "";
  const first = buffer[0];
  const parts = [Math.floor(first / 40), first % 40];
  let value = 0;
  for (const byte of buffer.subarray(1)) {
    value = (value << 7) | (byte & 0x7f);
    if (!(byte & 0x80)) {
      parts.push(value);
      value = 0;
    }
  }
  return parts.join(".");
}

function printableText(buffer) {
  const text = buffer.toString("utf8");
  return /^[\x09\x0a\x0d\x20-\x7e]*$/.test(text) ? text : "";
}

function formatValue(type, value, options = {}) {
  if (type === TYPE_OCTET_STRING) {
    if (options.octetStringFormat === "hex") {
      return `Hex-STRING: ${[...value].map((byte) => byte.toString(16).padStart(2, "0").toUpperCase()).join(" ")}`;
    }
    const text = printableText(value);
    if (text) return text;
    return `Hex-STRING: ${[...value].map((byte) => byte.toString(16).padStart(2, "0").toUpperCase()).join(" ")}`;
  }
  if (type === TYPE_INTEGER || type === 0x41 || type === 0x42 || type === 0x43 || type === 0x46) {
    return String(parseInteger(value));
  }
  if (type === 0x40 && value.length === 4) return [...value].join(".");
  if (type === TYPE_OID) return decodeOid(value);
  if (type === TYPE_NULL) return "";
  if (type === TYPE_END_OF_MIB) return "endOfMibView";
  return `Unsupported SNMP type 0x${type.toString(16)}`;
}

export function parseSnmpResponse(buffer, expectedRequestId, options = {}) {
  const message = readTlv(buffer);
  if (message.type !== TYPE_SEQUENCE) throw new Error("Invalid SNMP response");
  const [version, , pdu] = readChildren(message.value);
  if (!version || parseInteger(version.value) !== 1) throw new Error("Unsupported SNMP version");
  if (!pdu || pdu.type !== TYPE_GET_RESPONSE) throw new Error("Invalid SNMP response PDU");

  const [requestId, errorStatus, errorIndex, varbindList] = readChildren(pdu.value);
  const responseRequestId = parseInteger(requestId.value);
  if (expectedRequestId !== undefined && responseRequestId !== expectedRequestId) {
    throw new Error("SNMP response request id mismatch");
  }
  const status = parseInteger(errorStatus.value);
  if (status) return { ok: false, rows: [], error: `SNMP error status ${status} at index ${parseInteger(errorIndex.value)}` };

  const rows = [];
  for (const item of readChildren(varbindList.value)) {
    const [name, value] = readChildren(item.value);
    rows.push({
      oid: decodeOid(name.value),
      value: formatValue(value.type, value.value, options),
      endOfMib: value.type === TYPE_END_OF_MIB
    });
  }
  return { ok: true, rows, error: "" };
}

function sendUdpRequest({ host, port, message, timeout }) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    const timer = setTimeout(() => {
      socket.close();
      resolve({ ok: false, error: `SNMP UDP timeout after ${timeout}ms` });
    }, timeout);

    socket.once("message", (response) => {
      clearTimeout(timer);
      socket.close();
      resolve({ ok: true, response });
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      socket.close();
      resolve({ ok: false, error: error.message });
    });
    socket.send(message, port, host);
  });
}

function nextRequestId() {
  return Math.floor(Math.random() * 0x7fffffff) || 1;
}

export async function snmpGetViaUdp({
  host,
  port = 161,
  community,
  oid,
  timeout = 5000,
  requestId = nextRequestId(),
  transport = sendUdpRequest,
  octetStringFormat = "auto"
}) {
  const message = requestMessage({ pduType: TYPE_GET_REQUEST, community, oid, requestId });
  const result = await transport({ host, port, message, timeout });
  if (Buffer.isBuffer(result)) {
    const parsed = parseSnmpResponse(result, requestId, { octetStringFormat });
    const rows = parsed.rows.filter((row) => !row.endOfMib);
    return { ok: parsed.ok && rows.length > 0, value: rows[0]?.value || "", rows: publicRows(rows), error: parsed.error || "" };
  }
  if (!result.ok) return { ok: false, value: "", rows: [], error: result.error };
  try {
    const parsed = parseSnmpResponse(result.response, requestId, { octetStringFormat });
    const rows = parsed.rows.filter((row) => !row.endOfMib);
    return { ok: parsed.ok && rows.length > 0, value: rows[0]?.value || "", rows: publicRows(rows), error: parsed.error || "" };
  } catch (error) {
    return { ok: false, value: "", rows: [], error: error.message };
  }
}

function isUnderOid(rowOid, baseOid) {
  return rowOid === baseOid || rowOid.startsWith(`${baseOid}.`);
}

function publicRows(rows) {
  return rows.map(({ oid, value }) => ({ oid, value }));
}

export async function snmpWalkViaUdp({
  host,
  port = 161,
  community,
  oid,
  timeout = 30000,
  requestId = nextRequestId(),
  maxRepetitions = 10,
  maxRows = 5000,
  transport = sendUdpRequest,
  octetStringFormat = "auto"
}) {
  const rows = [];
  let currentOid = oid;
  let currentRequestId = requestId;
  const deadline = Date.now() + timeout;

  while (rows.length < maxRows && Date.now() < deadline) {
    const remaining = Math.max(250, deadline - Date.now());
    const message = requestMessage({
      pduType: TYPE_GET_BULK_REQUEST,
      community,
      oid: currentOid,
      requestId: currentRequestId,
      maxRepetitions
    });
    const result = await transport({ host, port, message, timeout: remaining });
    if (!Buffer.isBuffer(result) && !result.ok) return { ok: rows.length > 0, rows: publicRows(rows), error: rows.length ? "" : result.error };

    let parsed;
    try {
      parsed = parseSnmpResponse(Buffer.isBuffer(result) ? result : result.response, currentRequestId, { octetStringFormat });
    } catch (error) {
      return { ok: rows.length > 0, rows: publicRows(rows), error: rows.length ? "" : error.message };
    }
    if (!parsed.ok) return { ok: rows.length > 0, rows: publicRows(rows), error: rows.length ? "" : parsed.error };

    const nextRows = parsed.rows.filter((row) => !row.endOfMib && isUnderOid(row.oid, oid));
    if (!nextRows.length) break;
    rows.push(...nextRows.slice(0, maxRows - rows.length));
    currentOid = nextRows.at(-1).oid;
    currentRequestId = currentRequestId >= 0x7fffffff ? 1 : currentRequestId + 1;
    if (nextRows.length < parsed.rows.length) break;
  }

  return { ok: rows.length > 0, rows: publicRows(rows), error: rows.length ? "" : "SNMP walk returned no rows" };
}
