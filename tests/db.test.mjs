import test from "node:test";
import assert from "node:assert/strict";
import {
  mapOltRow,
  normalizeOltVendor,
  oltInsertSql,
  oltSchemaMigrationSql
} from "../src/db.mjs";

test("OLT row mapping hides Telnet password unless secrets are requested", () => {
  const row = {
    id: "huawei-site",
    name: "Huawei Site",
    vendor: "huawei",
    model: "MA5800",
    device_profile: "huawei-ma5800",
    version: "V100R021",
    host: "172.19.104.102",
    snmp_port: 161,
    read_community: "public",
    telnet_port: 23,
    telnet_username: "HouJie",
    telnet_password: "secret",
    enabled: 1
  };

  assert.deepEqual(mapOltRow(row), {
    id: "huawei-site",
    name: "Huawei Site",
    vendor: "huawei",
    model: "MA5800",
    deviceProfile: "huawei-ma5800",
    version: "V100R021",
    host: "172.19.104.102",
    snmpPort: 161,
    readCommunity: "public",
    telnetPort: 23,
    telnetUsername: "HouJie",
    enabled: true
  });

  assert.equal(mapOltRow(row, { includeSecrets: true }).telnetPassword, "secret");
});

test("OLT insert SQL persists Telnet login fields", () => {
  const sql = oltInsertSql({
    id: "zte-site",
    name: "ZTE Site",
    vendor: "zte",
    model: "C300",
    version: "V2.1",
    host: "172.19.104.98",
    snmpPort: 161,
    readCommunity: "public",
    telnetPort: 2323,
    telnetUsername: "admin",
    telnetPassword: "secret",
    enabled: true
  });

  assert.match(sql, /telnet_port, telnet_username, telnet_password/);
  assert.match(sql, /2323/);
  assert.match(sql, /'admin'/);
  assert.match(sql, /'secret'/);
});

test("OLT vendor is normalized and limited to supported vendors", () => {
  assert.equal(normalizeOltVendor(" Huawei "), "huawei");
  assert.equal(normalizeOltVendor("ZTE"), "zte");
  assert.throws(() => normalizeOltVendor("zte c300"), /只能选择 zte 或 huawei/);

  const sql = oltInsertSql({
    id: "huawei-site",
    name: "Huawei Site",
    vendor: "Huawei",
    model: "MA5800",
    version: "V100R021",
    host: "172.19.104.102",
    snmpPort: 161,
    readCommunity: "public",
    enabled: true
  });

  assert.match(sql, /'huawei'/);
  assert.doesNotMatch(sql, /'Huawei'/);
});

test("OLT insert SQL persists selected device profile and allows unsupported models", () => {
  const sql = oltInsertSql({
    id: "zte-c600-site",
    name: "ZTE C600 Site",
    vendor: "zte",
    model: "C600",
    deviceProfile: "zte-c600",
    version: "unknown",
    host: "172.19.104.200",
    snmpPort: 161,
    readCommunity: "public",
    enabled: true
  });

  assert.match(sql, /device_profile/);
  assert.match(sql, /'zte-c600'/);
});

test("OLT schema migration adds missing Telnet columns", () => {
  const sql = oltSchemaMigrationSql([
    { name: "id" },
    { name: "read_community" }
  ]);

  assert.match(sql, /ALTER TABLE olts ADD COLUMN telnet_port INTEGER NOT NULL DEFAULT 23/);
  assert.match(sql, /ALTER TABLE olts ADD COLUMN telnet_username TEXT NOT NULL DEFAULT ''/);
  assert.match(sql, /ALTER TABLE olts ADD COLUMN telnet_password TEXT NOT NULL DEFAULT ''/);
  assert.match(sql, /ALTER TABLE olts ADD COLUMN device_profile TEXT NOT NULL DEFAULT ''/);
});
