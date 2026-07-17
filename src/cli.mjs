#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { cliToolByName, cliTools, requestForTool, validateToolInput } from "./cli-tools.mjs";

const DEFAULT_TIMEOUT_MS = 20_000;
let activeServer;
let activeController;
let interrupted = false;

async function writeJson(value, pretty = false) {
  await new Promise((resolve) => process.stdout.write(`${JSON.stringify(value, null, pretty ? 2 : 0)}\n`, resolve));
}

function meta(tool, startedAt) {
  return { tool, durationMs: Date.now() - startedAt };
}

function failure(tool, startedAt, code, message, details) {
  const error = { code, message: redactMessage(message) };
  if (details !== undefined) error.details = details;
  return { ok: false, error, meta: meta(tool, startedAt) };
}

function redactMessage(message) {
  let redacted = String(message || "");
  const secrets = [
    process.env.OLT_TELNET_PASSWORD,
    process.env.OLT_TELNET_USER,
    process.env.OLT_SNMP_COMMUNITY,
    process.env.SNMP_COMMUNITY
  ].filter(Boolean);
  for (const secret of secrets) redacted = redacted.split(secret).join("[redacted]");
  return redacted
    .replace(/((?:password|community|username)\s*[=:]\s*)\S+/gi, "$1[redacted]")
    .replace(/\n\s+at\s[\s\S]*/m, "");
}

function redactValue(value, secrets) {
  if (typeof value === "string") {
    let redacted = redactMessage(value);
    for (const secret of secrets) redacted = redacted.split(secret).join("[redacted]");
    return redacted;
  }
  if (Array.isArray(value)) return value.map((item) => redactValue(item, secrets));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactValue(item, secrets)]));
  }
  return value;
}

function parseArgs(argv) {
  const prettyIndex = argv.indexOf("--pretty");
  const pretty = prettyIndex !== -1;
  const args = argv.filter((_, index) => index !== prettyIndex);
  if (args[0] === "tools" && args.length === 1) return { command: "tools", pretty };
  if (args[0] !== "call" || !args[1]) throw new Error("用法：olt-manager tools [--pretty] 或 olt-manager call <tool-name> --input '<json>' [--pretty]");
  const inputIndex = args.indexOf("--input");
  if (inputIndex === -1 || args[inputIndex + 1] === undefined || args.length !== 4) throw new Error("call 命令必须且只能提供 --input '<json>'，使用 --input - 可从 stdin 读取。");
  return { command: "call", tool: args[1], inputSource: args[inputIndex + 1], pretty };
}

async function readInput(source) {
  let raw = source;
  if (source === "-") {
    raw = "";
    process.stdin.setEncoding("utf8");
    for await (const chunk of process.stdin) raw += chunk;
  }
  return JSON.parse(raw);
}

function errorCode(status, message) {
  if (/OLT.*(?:不存在|未找到)|未找到 OLT/.test(message)) return "OLT_NOT_FOUND";
  if (status === 404) return "RESOURCE_NOT_FOUND";
  if (status === 400) return "INVALID_INPUT";
  if (/timed?\s*out|超时/i.test(message)) return "DEVICE_TIMEOUT";
  if (/not found|缺少|ENOENT|工具/i.test(message)) return "TOOL_UNAVAILABLE";
  return "API_ERROR";
}

function sanitizedDetails(data) {
  if (!data || typeof data !== "object") return undefined;
  const safe = {};
  for (const key of ["ok", "blocked", "warnings", "operation", "oid", "durationMs", "summary"]) {
    if (data[key] !== undefined) safe[key] = data[key];
  }
  return Object.keys(safe).length ? safe : undefined;
}

async function closeActiveServer(force = false) {
  const server = activeServer;
  activeServer = undefined;
  if (!server?.listening) return;
  const closing = new Promise((resolve) => server.close(resolve));
  if (force) server.closeAllConnections?.();
  await Promise.race([
    closing,
    new Promise((resolve) => setTimeout(resolve, 1_000))
  ]);
}

async function callTool(name, input, startedAt) {
  const controller = new AbortController();
  activeController = controller;
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  let secrets = [];
  try {
    const { startServer } = await import("./server.mjs");
    const started = await startServer({ host: "127.0.0.1", port: 0 });
    activeServer = started.server;
    const adminOltsResponse = await fetch(`${started.url}/api/admin/olts`, { signal: controller.signal });
    const adminOlts = await adminOltsResponse.json();
    secrets = adminOlts.flatMap((olt) => [olt.readCommunity, olt.telnetUsername, olt.telnetPassword]).filter(Boolean);
    if (input.oltId) {
      if (!adminOlts.some((olt) => olt.id === input.oltId)) {
        return { exitCode: 1, output: failure(name, startedAt, "OLT_NOT_FOUND", `OLT ${input.oltId} 不存在。`) };
      }
    }
    const request = requestForTool(name, input);
    const response = await fetch(`${started.url}${request.path}`, {
      method: request.method || "GET",
      headers: request.body ? { "content-type": "application/json" } : undefined,
      body: request.body ? JSON.stringify(request.body) : undefined,
      signal: controller.signal
    });
    const data = await response.json();
    if (!response.ok || data?.ok === false) {
      const message = String(data?.error || data?.summary || `HTTP ${response.status}`);
      return { exitCode: 1, output: redactValue(failure(name, startedAt, errorCode(response.status, message), message, sanitizedDetails(data)), secrets) };
    }
    return {
      exitCode: 0,
      output: redactValue({ ok: true, data: request.select ? request.select(data) : data, meta: meta(name, startedAt) }, secrets)
    };
  } catch (error) {
    const timedOut = error?.name === "AbortError";
    const wasInterrupted = timedOut && interrupted;
    const message = wasInterrupted ? "CLI 调用已中断。" : timedOut ? "CLI 调用超时。" : String(error?.message || "CLI 调用失败。");
    return {
      exitCode: 1,
      output: redactValue(failure(name, startedAt, wasInterrupted ? "INTERRUPTED" : timedOut ? "DEVICE_TIMEOUT" : errorCode(500, message), message), secrets)
    };
  } finally {
    clearTimeout(timeout);
    activeController = undefined;
    await closeActiveServer(controller.signal.aborted);
  }
}

export async function main(argv = process.argv.slice(2)) {
  const startedAt = Date.now();
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    await writeJson(failure("", startedAt, "INVALID_INPUT", error.message));
    return 2;
  }
  if (parsed.command === "tools") {
    await writeJson({ ok: true, data: { tools: cliTools }, meta: meta("tools", startedAt) }, parsed.pretty);
    return 0;
  }
  const tool = cliToolByName.get(parsed.tool);
  if (!tool) {
    await writeJson(failure(parsed.tool, startedAt, "UNKNOWN_TOOL", `未知工具 ${parsed.tool}。`), parsed.pretty);
    return 2;
  }
  let input;
  try {
    input = await readInput(parsed.inputSource);
  } catch {
    await writeJson(failure(parsed.tool, startedAt, "INVALID_INPUT", "--input 必须是有效 JSON。"), parsed.pretty);
    return 2;
  }
  const validationError = validateToolInput(tool, input);
  if (validationError) {
    await writeJson(failure(parsed.tool, startedAt, "INVALID_INPUT", validationError), parsed.pretty);
    return 2;
  }
  const result = await callTool(parsed.tool, input, startedAt);
  await writeJson(result.output, parsed.pretty);
  return result.exitCode;
}

function handleSignal() {
  interrupted = true;
  activeController?.abort();
  activeServer?.closeAllConnections?.();
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  process.once("SIGINT", handleSignal);
  process.once("SIGTERM", handleSignal);
  const exitCode = await main();
  process.exit(exitCode);
}
