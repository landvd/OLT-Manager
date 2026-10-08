// SNMP v2c 只读 get/walk 访问（内置实现或系统 net-snmp 工具）与状态诊断。
import { execFile } from "node:child_process";
import { snmpGetViaUdp, snmpWalkViaUdp } from "../snmp-client.mjs";
import { missingToolMessage, resolveTool } from "../runtime-paths.mjs";

function run(command, args, timeout = 5000) {
  if (command !== "snmpget" && command !== "snmpwalk" && command !== "snmpbulkwalk") {
    return Promise.resolve({ ok: false, stdout: "", stderr: "SNMP command is not allowed", error: "SNMP command is not allowed", bin: command });
  }
  return new Promise((resolve) => {
    const bin = resolveTool(command);
    const isNodeScript = /\.(?:cjs|mjs|js)$/i.test(bin);
    const executable = isNodeScript ? process.execPath : bin;
    const executableArgs = isNodeScript ? [bin, ...args] : args;
    execFile(executable, executableArgs, { timeout, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      const toolError = error?.code === "ENOENT" ? missingToolMessage(command) : error?.message || "";
      resolve({
        ok: !error,
        stdout,
        stderr,
        error: toolError,
        bin,
        code: error?.code ?? "",
        signal: error?.signal ?? "",
        timedOut: Boolean(error?.killed && error?.signal === "SIGTERM")
      });
    });
  });
}

function redactSecrets(text, secrets = []) {
  let redacted = String(text || "");
  for (const secret of secrets) {
    if (!secret) continue;
    redacted = redacted.split(String(secret)).join("[redacted]");
  }
  return redacted;
}

function formatSnmpError(result, secrets = []) {
  const parts = [];
  const message = redactSecrets(result?.error || result?.stderr || "SNMP command failed", secrets).trim();
  if (message) parts.push(message);
  if (result?.timedOut) parts.push("command timed out");
  if (result?.code !== undefined && result?.code !== "") parts.push(`code=${result.code}`);
  if (result?.signal) parts.push(`signal=${result.signal}`);
  return parts.join("; ");
}

export function shouldUseInternalSnmp(result) {
  return result?.code === "ENOENT" || /未找到 .*snmp|ENOENT/i.test(`${result?.error || ""} ${result?.stderr || ""}`);
}

export function buildSnmpStatusDiagnostics({ olt, checks }) {
  const secrets = [olt?.readCommunity];
  return checks.map(({ label, result }) => ({
    check: label,
    ok: Boolean(result?.ok),
    tool: result?.tool || result?.bin || resolveTool("snmpget"),
    target: result?.target || `${olt?.host || ""}:${olt?.snmpPort || 161}`,
    oid: result?.oid || "",
    error: result?.ok ? "" : formatSnmpError(result, secrets)
  }));
}

export async function snmpGet(olt, oid, timeout = 5000) {
  if (!olt.host) return { ok: false, value: "", error: "OLT host is empty", target: "", oid, tool: resolveTool("snmpget") };
  const target = `${olt.host}:${olt.snmpPort || 161}`;
  const result = await run("snmpget", ["-v2c", "-c", olt.readCommunity, "-Ovq", target, oid], timeout);
  if (shouldUseInternalSnmp(result)) {
    const fallback = await snmpGetViaUdp({
      host: olt.host,
      port: olt.snmpPort || 161,
      community: olt.readCommunity,
      oid,
      timeout
    });
    return {
      ok: fallback.ok,
      value: fallback.value || "",
      error: fallback.ok ? "" : `${result.error}; internal SNMP fallback failed: ${fallback.error}`,
      target,
      oid,
      tool: "internal-node-snmp",
      code: fallback.ok ? "" : result.code,
      signal: "",
      timedOut: /timeout/i.test(fallback.error || "")
    };
  }
  return {
    ok: result.ok,
    value: result.stdout.trim(),
    error: result.stderr || result.error,
    target,
    oid,
    tool: result.bin,
    code: result.code,
    signal: result.signal,
    timedOut: result.timedOut
  };
}

export async function snmpGetMany(olt, oids, timeout = 8000) {
  if (!olt.host) return { ok: false, rows: [], error: "OLT host is empty" };
  if (!oids.length) return { ok: true, rows: [], error: "" };
  const target = `${olt.host}:${olt.snmpPort || 161}`;
  const result = await run("snmpget", ["-v2c", "-c", olt.readCommunity, "-On", target, ...oids], timeout);
  if (shouldUseInternalSnmp(result)) {
    const results = await Promise.all(oids.map((item) => snmpGetViaUdp({
      host: olt.host,
      port: olt.snmpPort || 161,
      community: olt.readCommunity,
      oid: item,
      timeout
    })));
    const rows = results.flatMap((item) => item.rows || []);
    const failed = results.find((item) => !item.ok);
    return {
      ok: rows.length > 0,
      rows,
      error: rows.length ? "" : `${result.error}; internal SNMP fallback failed: ${failed?.error || "SNMP get returned no rows"}`
    };
  }
  const rows = result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [left, ...rest] = line.split(" = ");
      return { oid: left, value: rest.join(" = ") };
    });
  return { ok: result.ok || rows.length > 0, rows, error: result.stderr || result.error };
}

export async function snmpWalk(olt, oid, outputOption = "-On", timeout = 30000) {
  if (!olt.host) return { ok: false, rows: [], error: "OLT host is empty" };
  const target = `${olt.host}:${olt.snmpPort || 161}`;
  const result = await run("snmpbulkwalk", ["-v2c", "-c", olt.readCommunity, outputOption, target, oid], timeout);
  if (shouldUseInternalSnmp(result)) {
    const fallback = await snmpWalkViaUdp({
      host: olt.host,
      port: olt.snmpPort || 161,
      community: olt.readCommunity,
      oid,
      timeout,
      octetStringFormat: outputOption === "-Onx" ? "hex" : "auto"
    });
    return {
      ok: fallback.ok,
      rows: fallback.rows || [],
      error: fallback.ok ? "" : `${result.error}; internal SNMP fallback failed: ${fallback.error}`
    };
  }
  const rows = result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [left, ...rest] = line.split(" = ");
      return { oid: left, value: rest.join(" = ") };
    });
  return { ok: result.ok, rows, error: result.stderr || result.error };
}
