import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const cliPath = fileURLToPath(new URL("../src/cli.mjs", import.meta.url));
const emptySnmpWalkPath = fileURLToPath(new URL("./fixtures/empty-snmp-walk.mjs", import.meta.url));

async function runCli(args, options = {}) {
  const dataDir = options.dataDir || await mkdtemp(join(tmpdir(), "olt-manager-cli-"));
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      env: { ...process.env, ...options.env, OLT_MANAGER_DATA_DIR: dataDir },
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 15_000);
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode });
    });
    child.stdin.end(options.input || "");
  });
}

async function runInterruptedCli() {
  const dataDir = await mkdtemp(join(tmpdir(), "olt-manager-cli-signal-"));
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, "call", "olt_status", "--input", "{}"], {
      env: { ...process.env, OLT_MANAGER_DATA_DIR: dataDir },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (exitCode, signalCode) => resolve({ stdout, stderr, exitCode, signalCode }));
    setTimeout(() => child.kill("SIGINT"), 150);
  });
}

test("tools exposes the exact read-only model tool whitelist", async () => {
  const result = await runCli(["tools"]);
  assert.equal(result.exitCode, 0, result.stderr);

  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.deepEqual(output.data.tools.map((tool) => tool.name), [
    "olt_status",
    "olt_list",
    "onu_list",
    "onu_get_config",
    "onu_list_unregistered",
    "onu_list_recent",
    "pon_port_list",
    "project_list",
    "project_onu_list",
    "config_template_list",
    "config_plan_preview",
    "snmp_get",
    "snmp_walk",
    "snmp_history_list",
    "admin_event_list"
  ]);
  for (const tool of output.data.tools) {
    assert.equal(tool.type, "function");
    assert.equal(tool.parameters.type, "object");
    assert.equal(tool.parameters.additionalProperties, false);
  }
  assert.doesNotMatch(result.stdout, /snmpset|terminal:input|project_create|pon_port_import/i);
});

test("call accepts stdin JSON and returns a stable success envelope", async () => {
  const result = await runCli(["call", "project_list", "--input", "-"], {
    input: JSON.stringify({ q: "不存在的项目" })
  });
  assert.equal(result.exitCode, 0, result.stderr);

  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.deepEqual(output.data, { rows: [] });
  assert.equal(output.meta.tool, "project_list");
  assert.equal(Number.isInteger(output.meta.durationMs), true);
});

test("invalid CLI input returns JSON and parameter exit code 2", async () => {
  const result = await runCli(["call", "onu_list", "--input", "{bad json"]);
  assert.equal(result.exitCode, 2);

  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, false);
  assert.equal(output.error.code, "INVALID_INPUT");
  assert.equal(output.meta.tool, "onu_list");
  assert.doesNotMatch(result.stdout, /\n\s+at\s|password|community/i);
});

test("unknown tools return JSON and parameter exit code 2", async () => {
  const result = await runCli(["call", "terminal_input", "--input", "{}"]);
  assert.equal(result.exitCode, 2);

  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, false);
  assert.equal(output.error.code, "UNKNOWN_TOOL");
});

test("tool input schema rejects unknown fields and invalid coordinates before starting the service", async () => {
  const extra = await runCli(["call", "olt_list", "--input", JSON.stringify({ password: "do-not-accept" })]);
  assert.equal(extra.exitCode, 2);
  assert.equal(JSON.parse(extra.stdout).error.code, "INVALID_INPUT");

  const missing = await runCli(["call", "onu_get_config", "--input", JSON.stringify({
    chassis: "1",
    board: "2",
    pon: "3"
  })]);
  assert.equal(missing.exitCode, 2);
  assert.match(JSON.parse(missing.stdout).error.message, /onuId/);

  const invalidCoordinate = await runCli(["call", "onu_get_config", "--input", JSON.stringify({
    chassis: "one",
    board: "2",
    pon: "3",
    onuId: "4"
  })]);
  assert.equal(invalidCoordinate.exitCode, 2);
  assert.match(JSON.parse(invalidCoordinate.stdout).error.message, /chassis.*格式无效/);
});

test("pretty output remains one parseable JSON document", async () => {
  const result = await runCli(["tools", "--pretty"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.match(result.stdout, /^\{\n  "ok": true,/);
  assert.equal(JSON.parse(result.stdout).data.tools.length, 15);
});

test("unknown OLT IDs fail explicitly without leaking credentials", async () => {
  const result = await runCli(["call", "olt_status", "--input", JSON.stringify({ oltId: "missing-olt" })]);
  assert.equal(result.exitCode, 1, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.error.code, "OLT_NOT_FOUND");
  assert.doesNotMatch(result.stdout, /readCommunity|telnetPassword|telnetUsername/i);
});

test("olt_list returns only public OLT fields", async () => {
  const result = await runCli(["call", "olt_list", "--input", "{}"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.ok(output.data.rows.length > 0);
  assert.doesNotMatch(result.stdout, /readCommunity|telnetPassword|telnetUsername/i);
  assert.deepEqual(Object.keys(output.data.rows[0]), [
    "id", "name", "vendor", "model", "deviceProfile", "version", "host", "snmpPort", "telnetPort", "enabled"
  ]);
});

test("SIGINT aborts the active call and emits one stable JSON error", async () => {
  const result = await runInterruptedCli();
  if (process.platform === "win32") {
    assert.equal(result.exitCode, null, result.stderr);
    assert.equal(result.signalCode, "SIGINT", result.stderr);
    return;
  }
  assert.equal(result.exitCode, 1, result.stderr);
  const lines = result.stdout.trim().split("\n");
  assert.equal(lines.length, 1);
  const output = JSON.parse(lines[0]);
  assert.equal(output.ok, false);
  assert.equal(output.error.code, "INTERRUPTED");
  assert.equal(output.meta.tool, "olt_status");
});

test("config_plan_preview reaches the existing preview-only API without device writes", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "olt-manager-cli-plan-"));
  const list = await runCli(["call", "olt_list", "--input", "{}"], { dataDir });
  const zte = JSON.parse(list.stdout).data.rows.find((olt) => olt.deviceProfile === "zte-c300");
  assert.ok(zte);

  const result = await runCli(["call", "config_plan_preview", "--input", JSON.stringify({
    unregisteredId: "1-2-3-ZTEG00112233",
    oltId: zte.id,
    chassis: "1",
    board: "2",
    pon: "3",
    serial: "ZTEG00112233",
    templateId: "zte-link-booth",
    ethPorts: ["eth_0/1"]
  })], {
    dataDir,
    env: { OLT_MANAGER_SNMPBULKWALK_BIN: emptySnmpWalkPath }
  });

  assert.equal(result.exitCode, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.data.blocked, false);
  assert.match(output.data.commands, /gpon-onu_1\/2\/3:1/);
  assert.match(output.data.warnings.join("\n"), /不会执行|不会下发/);
});
