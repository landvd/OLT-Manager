import test from "node:test";
import assert from "node:assert/strict";
import { snmpGetViaUdp, snmpWalkViaUdp } from "../src/snmp-client.mjs";

function tlv(type, value) {
  const body = Buffer.from(value);
  if (body.length < 0x80) return Buffer.concat([Buffer.from([type, body.length]), body]);
  return Buffer.concat([Buffer.from([type, 0x81, body.length]), body]);
}

function sequence(items) {
  return tlv(0x30, Buffer.concat(items));
}

function integer(value) {
  return tlv(0x02, Buffer.from([value]));
}

function octetString(value) {
  return tlv(0x04, Buffer.from(value, "utf8"));
}

function oid(value) {
  const parts = value.split(".").map((part) => Number.parseInt(part, 10));
  const bytes = [parts[0] * 40 + parts[1]];
  for (const part of parts.slice(2)) {
    if (part < 128) {
      bytes.push(part);
      continue;
    }
    const stack = [part & 0x7f];
    let next = part >> 7;
    while (next) {
      stack.unshift((next & 0x7f) | 0x80);
      next >>= 7;
    }
    bytes.push(...stack);
  }
  return tlv(0x06, Buffer.from(bytes));
}

function varbind(id, value) {
  return sequence([oid(id), value]);
}

function response({ requestId, community = "public", rows }) {
  const pdu = tlv(0xa2, Buffer.concat([
    integer(requestId),
    integer(0),
    integer(0),
    sequence(rows.map((row) => varbind(row.oid, row.value)))
  ]));
  return sequence([integer(1), octetString(community), pdu]);
}

test("SNMP UDP client reads a v2c get response without external snmpget", async () => {
  const transport = async () => response({
    requestId: 7,
    rows: [{ oid: "1.3.6.1.2.1.1.1.0", value: octetString("ZTE C300") }]
  });
  const result = await snmpGetViaUdp({
    host: "127.0.0.1",
    port: 1161,
    community: "public",
    oid: "1.3.6.1.2.1.1.1.0",
    requestId: 7,
    timeout: 500,
    transport
  });

  assert.equal(result.ok, true);
  assert.equal(result.value, "ZTE C300");
  assert.deepEqual(result.rows, [{ oid: "1.3.6.1.2.1.1.1.0", value: "ZTE C300" }]);
});

test("SNMP UDP client walks rows under the requested OID", async () => {
  const transport = async () => response({
    requestId: 11,
    rows: [
      { oid: "1.3.6.1.2.1.2.2.1.2.1", value: octetString("gpon-1") },
      { oid: "1.3.6.1.2.1.2.2.1.2.2", value: octetString("gpon-2") }
    ]
  });
  const result = await snmpWalkViaUdp({
    host: "127.0.0.1",
    port: 1161,
    community: "public",
    oid: "1.3.6.1.2.1.2.2.1.2",
    requestId: 11,
    timeout: 500,
    maxRows: 2,
    transport
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.rows, [
    { oid: "1.3.6.1.2.1.2.2.1.2.1", value: "gpon-1" },
    { oid: "1.3.6.1.2.1.2.2.1.2.2", value: "gpon-2" }
  ]);
});

test("SNMP UDP client can format octet strings as Hex-STRING for serial walks", async () => {
  const transport = async () => response({
    requestId: 19,
    rows: [
      { oid: "1.3.6.1.4.1.3902.1.1", value: tlv(0x04, Buffer.from([0x5a, 0x54, 0x45, 0x47, 0x03, 0x0c, 0x09, 0x14])) }
    ]
  });
  const result = await snmpWalkViaUdp({
    host: "127.0.0.1",
    port: 1161,
    community: "public",
    oid: "1.3.6.1.4.1.3902.1",
    requestId: 19,
    timeout: 500,
    maxRows: 1,
    octetStringFormat: "hex",
    transport
  });

  assert.equal(result.ok, true);
  assert.equal(result.rows[0].value, "Hex-STRING: 5A 54 45 47 03 0C 09 14");
});
