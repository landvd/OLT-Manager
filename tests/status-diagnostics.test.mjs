import test from "node:test";
import assert from "node:assert/strict";
import { buildSnmpStatusDiagnostics, shouldUseInternalSnmp } from "../src/server.mjs";

test("SNMP status diagnostics include tool context without leaking community", () => {
  const diagnostics = buildSnmpStatusDiagnostics({
    olt: {
      host: "10.0.0.8",
      snmpPort: 161,
      readCommunity: "private-community"
    },
    checks: [
      {
        label: "sysDescr",
        result: {
          ok: false,
          tool: "C:\\Tools\\net-snmp\\bin\\snmpget.exe",
          target: "10.0.0.8:161",
          oid: "1.3.6.1.2.1.1.1.0",
          error: "Timeout: No Response from 10.0.0.8:161 using private-community",
          code: 1
        }
      }
    ]
  });

  const text = JSON.stringify(diagnostics);
  assert.match(text, /snmpget\.exe/);
  assert.match(text, /10\.0\.0\.8:161/);
  assert.match(text, /1\.3\.6\.1\.2\.1\.1\.1\.0/);
  assert.match(text, /Timeout: No Response/);
  assert.doesNotMatch(text, /private-community/);
});

test("missing snmpget executable triggers internal SNMP fallback", () => {
  assert.equal(shouldUseInternalSnmp({
    code: "ENOENT",
    error: "未找到 snmpget.exe"
  }), true);
  assert.equal(shouldUseInternalSnmp({
    code: 1,
    error: "Timeout: No Response"
  }), false);
});
