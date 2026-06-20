import http from "node:http";
import { readFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import {
  addSnmpProbe,
  getAdminEvents,
  getOlts,
  getPonPorts,
  getSnmpHistory,
  initDb,
  replaceOlts,
  replacePonPorts,
  updatePonPortVlans
} from "./db.mjs";
import { queryZteOnuReadOnly } from "./zte-telnet.mjs";
import { openTerminalLogin } from "./terminal-login.mjs";
import { snmpGetViaUdp, snmpWalkViaUdp } from "./snmp-client.mjs";
import {
  buildConfigPlanFromTemplate,
  configTemplates,
  extractMduOttVlans,
  huaweiSnAuthSerial,
  suggestNextOnuId
} from "./config-plan.mjs";
import { appRoot, dataRoot, missingToolMessage, resolveTool, staticRoot } from "./runtime-paths.mjs";
import {
  encodeZtePonIfIndex,
  oidSuffix,
  parseZteUnconfiguredIndex
} from "./snmp-parsers.mjs";

const root = appRoot;
const publicDir = join(root, "public");
const distDir = join(root, "dist");
const staticDir = staticRoot || (existsSync(join(distDir, "index.html")) ? distDir : publicDir);
const dataDir = dataRoot;

async function loadLocalTelnetEnv() {
  try {
    const text = await readFile(join(root, ".env.local"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^(OLT_TELNET_USER|OLT_TELNET_PASSWORD|OLT_TELNET_PORT)=(.*)$/);
      if (!match || process.env[match[1]]) continue;
      const value = match[2].trim().replace(/^(['"])(.*)\1$/, "$2");
      process.env[match[1]] = value;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

const oidProfiles = {
  zte: {
    sysDescr: "1.3.6.1.2.1.1.1.0",
    sysUpTime: "1.3.6.1.2.1.1.3.0",
    onuName: "1.3.6.1.4.1.3902.1012.3.28.1.1.3",
    serialNumber: "1.3.6.1.4.1.3902.1012.3.28.1.1.5",
    phaseState: "1.3.6.1.4.1.3902.1012.3.28.2.1.4",
    lastOnlineTime: "1.3.6.1.4.1.3902.1012.3.28.2.1.5",
    rxPower: "1.3.6.1.4.1.3902.1012.3.50.12.1.1.10",
    distance: "1.3.6.1.4.1.3902.1012.3.11.4.1.2",
    opticalAlarms: "1.3.6.1.4.1.3902.1012.3.45",
    unconfiguredSerial: "1.3.6.1.4.1.3902.1082.500.10.2.2.5.1.2",
    phaseMap: {
      0: "logging",
      1: "los",
      2: "syncMib",
      3: "working",
      4: "dyinggasp",
      5: "authFailed",
      6: "offline"
    },
    notes: "ZTE C300 V2.1 read-only OIDs for ONU name, serial number, phase state, RX power, and distance."
  },
  huawei: {
    sysDescr: "1.3.6.1.2.1.1.1.0",
    sysUpTime: "1.3.6.1.2.1.1.3.0",
    ifName: "1.3.6.1.2.1.31.1.1.1.1",
    ontDescription: "1.3.6.1.4.1.2011.6.128.1.1.2.45.1.4",
    runStatus: "1.3.6.1.4.1.2011.6.128.1.1.2.46.1.15",
    lastOnlineTime: "1.3.6.1.4.1.2011.6.128.1.1.2.46.1.22",
    rxPower: "1.3.6.1.4.1.2011.6.128.1.1.2.51.1.4",
    distance: "1.3.6.1.4.1.2011.6.128.1.1.2.46.1.20",
    ethernetOnlineState: "1.3.6.1.4.1.2011.6.128.1.1.2.62.1.22",
    registerTable: "1.3.6.1.4.1.2011.6.128.1.1.2.52",
    registerInfoUpTime: "1.3.6.1.4.1.2011.6.128.1.1.2.101.1.6",
    unconfiguredSerial: "1.3.6.1.4.1.2011.6.128.1.1.2.52.1.2",
    unconfiguredStatus: "1.3.6.1.4.1.2011.6.128.1.1.2.52.1.3",
    notes: "Huawei MA5800 uses HUAWEI-XPON-MIB. RX power/status/distance/unconfigured ONT OIDs are common MA56xx/MA58xx field OIDs, but must be tested against the installed software package."
  }
};

function publicOidProfiles() {
  const profiles = [];
  const entries = [];
  for (const [vendor, profile] of Object.entries(oidProfiles)) {
    const profileId = `${vendor}-${vendor === "huawei" ? "ma5800" : "c300"}`;
    profiles.push({
      id: profileId,
      vendor,
      model: vendor === "huawei" ? "MA5800" : "C300",
      version: vendor === "huawei" ? "unknown" : "V2.1",
      notes: profile.notes || "",
      verified: vendor === "zte"
    });
    for (const [fieldName, value] of Object.entries(profile)) {
      if (typeof value !== "string" || !/^\d+(\.\d+)+$/.test(value)) continue;
      entries.push({
        profile_id: profileId,
        field_name: fieldName,
        oid: value,
        operation: fieldName === "sysDescr" || fieldName === "sysUpTime" ? "get" : "walk",
        value_transform: fieldName === "rxPower" ? `${vendor}-rx-power` : "",
        index_parser: vendor === "huawei" ? "ifIndex+ontIndex" : "zte-pon-onu-index",
        status: vendor === "zte" ? "verified" : "candidate",
        notes: ""
      });
    }
  }
  return { profiles, entries };
}

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const allowedSnmpOperations = new Set(["get", "walk"]);
const dangerousOperationPattern = /\b(set|clear|erase|undo|delete|no|load|reboot|reset|reload|restart|shutdown|save|write|commit|format|factory|restore)\b/i;
const zteVlanIfConfVlan = "1.3.6.1.4.1.3902.1082.40.50.2.1.4.1.7";
const zteServicePortOids = {
  desc: "1.3.6.1.4.1.3902.1082.110.5.2.2.1.1",
  serviceMode: "1.3.6.1.4.1.3902.1082.110.5.2.2.1.4",
  vport: "1.3.6.1.4.1.3902.1082.110.5.2.2.1.5",
  userVlan: "1.3.6.1.4.1.3902.1082.110.5.2.2.1.8",
  cVlan: "1.3.6.1.4.1.3902.1082.110.5.2.2.1.18",
  sVlan: "1.3.6.1.4.1.3902.1082.110.5.2.2.1.19"
};
const huaweiSrvFlowFrame = "1.3.6.1.4.1.2011.5.14.5.2.1.2";
const huaweiSrvFlowSlot = "1.3.6.1.4.1.2011.5.14.5.2.1.3";
const huaweiSrvFlowPon = "1.3.6.1.4.1.2011.5.14.5.2.1.4";
const huaweiSrvFlowParaType = "1.3.6.1.4.1.2011.5.14.5.2.1.7";
const huaweiSrvFlowVlanId = "1.3.6.1.4.1.2011.5.14.5.2.1.8";

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function run(command, args, timeout = 5000) {
  if (command !== "snmpget" && command !== "snmpwalk" && command !== "snmpbulkwalk") {
    return Promise.resolve({ ok: false, stdout: "", stderr: "SNMP command is not allowed", error: "SNMP command is not allowed", bin: command });
  }
  return new Promise((resolve) => {
    const bin = resolveTool(command);
    execFile(bin, args, { timeout, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
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

function openLocalTerminal() {
  if (process.platform !== "darwin") {
    return { ok: false, status: 501, error: "当前仅支持在 macOS 上打开 Terminal。" };
  }
  return new Promise((resolve) => {
    execFile("open", ["-a", "Terminal"], { timeout: 3000 }, (error) => {
      resolve({
        ok: !error,
        status: error ? 500 : 200,
        error: error?.message || ""
      });
    });
  });
}

async function snmpGet(olt, oid, timeout = 5000) {
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

async function snmpGetMany(olt, oids, timeout = 8000) {
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

async function snmpWalk(olt, oid, outputOption = "-On", timeout = 30000) {
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

function decodeZtePort(encoded) {
  return {
    slot: (encoded >> 16) & 0xff,
    pon: (encoded >> 8) & 0xff
  };
}

function encodeZtePonIndex(slot, pon) {
  return (0x10 << 24) + (Number(slot) << 16) + (Number(pon) << 8);
}

function encodeZteVportIndex(onuId, vport) {
  return (0x18 << 24) + (Number(onuId) << 16) + (Number(vport) << 8);
}

function ztePonGroupKey(slot, pon) {
  const ponNumber = Number(pon);
  const groupStart = ponNumber <= 8 ? 1 : 9;
  return `${slot}/${groupStart}-${groupStart + 7}`;
}

function parseZteIndex(oid, baseOid) {
  const suffix = oidSuffix(oid, baseOid);
  const encoded = suffix[0] || 0;
  const onuId = suffix[1] || 0;
  return { ...decodeZtePort(encoded), onuId, encoded, key: `${encoded}.${onuId}` };
}

function parseHuaweiOntIndex(oid, baseOid) {
  const suffix = oidSuffix(oid, baseOid);
  const ifIndex = suffix[0] || 0;
  const onuId = suffix[1] ?? 0;
  return { ifIndex, onuId, key: `${ifIndex}.${onuId}` };
}

function parseZteOuterVlanRows(rows) {
  const byIfIndex = new Map();
  for (const row of rows) {
    const suffix = oidSuffix(row.oid, zteVlanIfConfVlan);
    const ifIndex = suffix[0];
    if (!ifIndex) continue;
    const value = cleanSnmpValue(row.value).replace(/^"|"$/g, "");
    if (!/^\d+$/.test(value)) continue;
    const vlan = Number(value);
    if (vlan < 1 || vlan > 4094) continue;
    if (!byIfIndex.has(ifIndex)) byIfIndex.set(ifIndex, new Set());
    byIfIndex.get(ifIndex).add(vlan);
  }
  const result = new Map();
  for (const [ifIndex, values] of byIfIndex) {
    const sorted = [...values].sort((a, b) => a - b);
    const outer = sorted.find((vlan) => vlan >= 1000 && vlan < 2000) || sorted.find((vlan) => vlan >= 1000) || sorted[0];
    if (outer) result.set(String(ifIndex), String(outer));
  }
  return result;
}

function rowsToIndexValueMap(rows, baseOid) {
  const map = new Map();
  for (const row of rows) {
    const index = oidSuffix(row.oid, baseOid)[0];
    if (!Number.isFinite(index)) continue;
    map.set(String(index), cleanSnmpValue(row.value).replace(/^"|"$/g, ""));
  }
  return map;
}

function selectOuterVlan(values) {
  const sorted = [...values]
    .map((value) => Number.parseInt(value, 10))
    .filter((vlan) => Number.isFinite(vlan) && vlan >= 1 && vlan <= 4094)
    .sort((a, b) => a - b);
  return sorted.find((vlan) => vlan >= 1000 && vlan < 2000) || sorted.find((vlan) => vlan >= 1000) || sorted[0] || "";
}

function parseHuaweiOuterVlanRows({ frameRows, slotRows, ponRows, typeRows, vlanRows }) {
  const frames = rowsToIndexValueMap(frameRows, huaweiSrvFlowFrame);
  const slots = rowsToIndexValueMap(slotRows, huaweiSrvFlowSlot);
  const pons = rowsToIndexValueMap(ponRows, huaweiSrvFlowPon);
  const types = rowsToIndexValueMap(typeRows, huaweiSrvFlowParaType);
  const vlans = rowsToIndexValueMap(vlanRows, huaweiSrvFlowVlanId);
  const byPonPort = new Map();

  for (const [index, vlan] of vlans) {
    if (frames.get(index) !== "0" || types.get(index) !== "4") continue;
    const slot = slots.get(index);
    const pon = pons.get(index);
    if (!slot || !pon) continue;
    const key = `${slot}/${pon}`;
    if (!byPonPort.has(key)) byPonPort.set(key, new Set());
    byPonPort.get(key).add(vlan);
  }

  const result = new Map();
  for (const [ponPort, values] of byPonPort) {
    const outer = selectOuterVlan(values);
    if (outer) result.set(ponPort, String(outer));
  }
  return result;
}

async function refreshPonVlans(body, olts) {
  const allPorts = await getPonPorts();
  const requestedOltIp = String(body.oltIp || "").trim();
  const requestedPonPort = String(body.ponPort || "").trim();
  const candidateOlts = olts.filter((olt) => ["zte", "huawei"].includes(olt.vendor) && (!requestedOltIp || olt.host === requestedOltIp));
  const updates = [];
  const results = [];

  for (const olt of candidateOlts) {
    const ports = allPorts.filter((port) =>
      port.oltIp === olt.host && (!requestedPonPort || port.ponPort === requestedPonPort)
    );
    if (!ports.length) continue;
    if (olt.vendor === "huawei") {
      const [frameRows, slotRows, ponRows, typeRows, vlanRows] = await Promise.all([
        snmpWalk(olt, huaweiSrvFlowFrame, "-On", 120000),
        snmpWalk(olt, huaweiSrvFlowSlot, "-On", 120000),
        snmpWalk(olt, huaweiSrvFlowPon, "-On", 120000),
        snmpWalk(olt, huaweiSrvFlowParaType, "-On", 120000),
        snmpWalk(olt, huaweiSrvFlowVlanId, "-On", 120000)
      ]);
      const walks = [frameRows, slotRows, ponRows, typeRows, vlanRows];
      const failed = walks.find((walk) => !walk.ok);
      if (failed) {
        results.push({ oltIp: olt.host, ok: false, updated: 0, error: failed.error || "Huawei service-flow walk failed" });
        continue;
      }
      const vlanByPonPort = parseHuaweiOuterVlanRows({
        frameRows: frameRows.rows,
        slotRows: slotRows.rows,
        ponRows: ponRows.rows,
        typeRows: typeRows.rows,
        vlanRows: vlanRows.rows
      });
      let updated = 0;
      for (const port of ports) {
        const outerVlan = vlanByPonPort.get(String(port.ponPort || ""));
        if (!outerVlan) continue;
        updates.push({ oltIp: olt.host, ponPort: port.ponPort, outerVlan });
        updated += 1;
      }
      results.push({ oltIp: olt.host, ok: true, updated, walkedRows: vlanRows.rows.length });
      continue;
    }

    const walk = await snmpWalk(olt, zteVlanIfConfVlan, "-On", 120000);
    if (!walk.ok) {
      results.push({ oltIp: olt.host, ok: false, updated: 0, error: walk.error || "SNMP walk failed" });
      continue;
    }
    const vlanByIfIndex = parseZteOuterVlanRows(walk.rows);
    const directVlanByPonPort = new Map();
    const vlanValuesByGroup = new Map();
    let updated = 0;
    for (const port of ports) {
      const [slot, pon] = String(port.ponPort || "").split("/");
      if (!slot || !pon) continue;
      const ifIndex = encodeZtePonIfIndex(slot, pon);
      const outerVlan = vlanByIfIndex.get(String(ifIndex));
      if (!outerVlan) continue;
      directVlanByPonPort.set(port.ponPort, outerVlan);
      const groupKey = ztePonGroupKey(slot, pon);
      if (!vlanValuesByGroup.has(groupKey)) vlanValuesByGroup.set(groupKey, []);
      vlanValuesByGroup.get(groupKey).push(outerVlan);
      updates.push({ oltIp: olt.host, ponPort: port.ponPort, outerVlan });
      updated += 1;
    }

    let inferred = 0;
    for (const port of ports) {
      if (directVlanByPonPort.has(port.ponPort)) continue;
      const [slot, pon] = String(port.ponPort || "").split("/");
      if (!slot || !pon) continue;
      const values = vlanValuesByGroup.get(ztePonGroupKey(slot, pon)) || [];
      const counts = values.reduce((map, value) => map.set(value, (map.get(value) || 0) + 1), new Map());
      const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
      if (!best || best[1] < 2) continue;
      updates.push({ oltIp: olt.host, ponPort: port.ponPort, outerVlan: best[0] });
      inferred += 1;
    }

    results.push({ oltIp: olt.host, ok: true, updated: updated + inferred, direct: updated, inferred, walkedRows: walk.rows.length });
  }

  await updatePonPortVlans(updates, "snmp_vlan_refresh");
  return { ok: true, count: updates.length, results, ponPorts: await getPonPorts() };
}

function parseHuaweiIfNameRows(rows) {
  const map = new Map();
  for (const row of rows) {
    const ifIndex = Number(oidSuffix(row.oid, oidProfiles.huawei.ifName)[0]);
    const name = cleanSnmpValue(row.value);
    const match = name.match(/^GPON\s+0\/(\d+)\/(\d+)$/i);
    if (!Number.isFinite(ifIndex) || !match) continue;
    const [, slot, pon] = match;
    map.set(`${slot}/${pon}`, { ifIndex, slot: Number(slot), pon: Number(pon), name });
  }
  return map;
}

function cleanSnmpValue(value) {
  return String(value)
    .replace(/^[A-Z-]+:\s*/, "")
    .replace(/^"|"$/g, "")
    .trim();
}

function decodeHexSerial(value) {
  const hex = String(value).match(/Hex-STRING:\s*([0-9A-Fa-f ]+)/)?.[1];
  if (!hex) return cleanSnmpValue(value);
  const bytes = hex.trim().split(/\s+/).map((part) => Number.parseInt(part, 16));
  if (bytes.every((byte) => byte === 0)) return "N/A";
  const vendor = String.fromCharCode(...bytes.slice(0, 4)).replace(/[^\x20-\x7e]/g, "");
  const serial = bytes.slice(4).map((byte) => byte.toString(16).padStart(2, "0").toUpperCase()).join("");
  return `${vendor}${serial}`;
}

function decodeZteRxPower(value) {
  const raw = Number.parseInt(cleanSnmpValue(value), 10);
  if (!Number.isFinite(raw) || raw === 65535 || raw === 65534) return "N/A";
  const dbm = raw > 30000 ? (raw - 65536) * 0.002 - 30 : raw * 0.002 - 30;
  return `${dbm.toFixed(2)} dBm`;
}

function decodeDistance(value) {
  const meters = Number.parseInt(cleanSnmpValue(value), 10);
  if (!Number.isFinite(meters) || meters <= 0) return "N/A";
  return `${(meters / 1000).toFixed(2)} km`;
}

function decodeHuaweiRxPower(value) {
  const raw = Number.parseInt(cleanSnmpValue(value), 10);
  if (!Number.isFinite(raw) || raw === 2147483647) return "N/A";
  return `${(raw / 100).toFixed(2)} dBm`;
}

function huaweiRunStatus(value) {
  const code = Number.parseInt(cleanSnmpValue(value), 10);
  const labels = {
    1: "online",
    2: "offline"
  };
  return labels[code] || cleanSnmpValue(value) || "unknown";
}

function huaweiUnconfiguredStatus(value) {
  const code = Number.parseInt(cleanSnmpValue(value), 10);
  const labels = {
    9: "未注册"
  };
  return labels[code] || cleanSnmpValue(value) || "未知";
}

function parseDateTimeText(value) {
  const text = cleanSnmpValue(value);
  const match = text.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (!match || text.startsWith("0000-00-00")) return null;
  const [, year, month, day, hour, minute, second] = match;
  const label = `${year}-${month}-${day} ${hour}:${minute}:${second}`;
  const ts = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`).getTime();
  return Number.isFinite(ts) ? { label, ts } : null;
}

function decodeSnmpDateAndTime(value) {
  const hex = String(value).match(/Hex-STRING:\s*([0-9A-Fa-f ]+)/)?.[1];
  if (!hex) return parseDateTimeText(value);
  const bytes = hex.trim().split(/\s+/).map((part) => Number.parseInt(part, 16));
  if (bytes.length < 8 || bytes.every((byte) => byte === 0)) return null;
  const year = bytes[0] * 256 + bytes[1];
  const month = bytes[2];
  const day = bytes[3];
  const hour = bytes[4];
  const minute = bytes[5];
  const second = bytes[6];
  if (!year || !month || !day) return null;
  const label = [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0")
  ].join("-") + ` ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`;
  let ts = new Date(`${label.replace(" ", "T")}`).getTime();
  if (bytes.length >= 11 && (bytes[8] === 0x2b || bytes[8] === 0x2d)) {
    const sign = bytes[8] === 0x2b ? 1 : -1;
    const offsetMinutes = sign * ((bytes[9] || 0) * 60 + (bytes[10] || 0));
    ts = Date.UTC(year, month - 1, day, hour, minute, second) - offsetMinutes * 60 * 1000;
  }
  return Number.isFinite(ts) ? { label, ts } : null;
}

function phaseSearchText(phase) {
  const key = String(phase || "").trim().toLowerCase();
  const map = {
    working: "working 在线 正常",
    online: "online 在线 正常",
    offline: "offline 离线",
    los: "los 光路断 光信号丢失",
    dyinggasp: "dyinggasp 断电 掉电",
    authfailed: "authfailed 认证失败",
    logging: "logging 登录中",
    syncmib: "syncmib 同步中"
  };
  return `${phase || ""} ${map[key] || ""}`;
}

function rxPowerSearchText(rxPower) {
  const raw = String(rxPower || "");
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return `${raw} unknown 未知`;
  if (value <= -12 && value >= -25) return `${raw} 绿色 正常`;
  if (value < -25 && value >= -27) return `${raw} 黄色 警告 偏低`;
  return `${raw} 红色 异常 过高 过低`;
}

function onuSearchText(onu) {
  return [
    onu.id,
    `${onu.slot}/${onu.pon}/${onu.onuId}`,
    onu.name,
    onu.serial,
    onu.phase,
    phaseSearchText(onu.phase),
    onu.rxPower,
    rxPowerSearchText(onu.rxPower),
    onu.distance,
    onu.address
  ].join(" ").toLowerCase();
}

function findLedgerPort(ponPorts, olt, slot, pon) {
  const ponPort = `${slot}/${pon}`;
  return ponPorts.find((port) => port.oltIp === olt.host && port.ponPort === ponPort) || {};
}

function zteBusinessName(userVlan, vport) {
  const vlan = String(userVlan || "");
  if (vlan === "3301") return "上网业务";
  if (vlan === "3111") return "互动 VLAN";
  if (vlan === "90") return "ONU 内置下发 VLAN";
  if (vlan === "86") return "直播 VLAN";
  return `业务 VLAN ${vlan || vport}`;
}

async function readZteServicePorts(olt, { slot, pon, onuId }) {
  if (!slot || !pon || !onuId) return [];
  const ponIfIndex = encodeZtePonIfIndex(slot, pon);
  const candidateVports = Array.from({ length: 8 }, (_, index) => index + 1);
  const rows = [];

  for (const vport of candidateVports) {
    const vportIndex = encodeZteVportIndex(onuId, vport);
    const oidRefs = [];
    for (const [field, baseOid] of Object.entries(zteServicePortOids)) {
      oidRefs.push({ field, vport, oid: `${baseOid}.${ponIfIndex}.${vportIndex}` });
    }
    const result = await snmpGetMany(olt, oidRefs.map((item) => item.oid), 5000);
    const byOid = new Map(result.rows.map((row) => [row.oid.replace(/^\./, ""), cleanSnmpValue(row.value).replace(/^"|"$/g, "")]));
    const values = {};
    for (const [field, baseOid] of Object.entries(zteServicePortOids)) {
      values[field] = byOid.get(`${baseOid}.${ponIfIndex}.${vportIndex}`) || "";
    }
    if (values.userVlan && !/No Such Instance|No Such Object/i.test(values.userVlan)) {
      rows.push({
        servicePort: vport,
        vport: values.vport || String(vport),
        serviceMode: values.serviceMode || "",
        userVlan: values.userVlan,
        cVlan: values.cVlan || "",
        sVlan: values.sVlan === "0" ? "" : values.sVlan,
        business: zteBusinessName(values.userVlan, vport),
        source: "SNMP 已验证"
      });
    }
  }

  return rows;
}

function buildConfigPlan({ olt, slot, pon, onuId = "<ONU_ID>", serial = "<ONU_SN>", outerVlan = "", address = "" }) {
  const vendor = String(olt.vendor || "").toLowerCase();
  const vlan = outerVlan || "<待补充外层VLAN>";
  const innerVlan = "<待填写内层VLAN>";
  const planName = vendor === "huawei" ? "Huawei MA5800 上网业务模板" : "ZTE C300 上网业务模板";
  const notes = [
    "只读系统仅展示命令模板，不会执行、不下发、不保存到 OLT。",
    outerVlan ? `外层 VLAN 已按 OLT IP + PON 台账带出：${outerVlan}` : "当前 PON 台账缺少外层 VLAN，配置前需要人工补充。",
    "内层 VLAN、profile、gemport、service-port 编号需按现场规划填写。"
  ];

  if (vendor === "huawei") {
    const snAuthSerial = serial ? huaweiSnAuthSerial(serial) : "<ONU_SN_HEX>";
    return {
      name: planName,
      vendor,
      outerVlan: outerVlan || "",
      innerVlan: "3301",
      notes,
      template: [
        `interface gpon 0/${slot}`,
        `ont add ${pon} <ONT_ID> sn-auth ${snAuthSerial} omci ont-lineprofile-id 300 ont-srvprofile-id 300 desc "${address || "<地址/客户名>"}"`,
        `ont port native-vlan ${pon} <ONT_ID> eth 1 vlan 3301`,
        "quit",
        `service-port vlan ${vlan} gpon 0/${slot}/${pon} ont <ONT_ID> gemport 0 multi-service user-vlan 3301 tag-transform translate-and-add inner-vlan 3301 inner-priority 0`
      ].join("\n")
    };
  }

  return {
    name: planName,
    vendor: vendor || "zte",
    outerVlan: outerVlan || "",
    innerVlan,
    notes,
    template: [
      `interface gpon-onu_1/${slot}/${pon}:${onuId || "<ONU_ID>"}`,
      `name ${address || "<地址/客户名>"}`,
      "tcont <TCONT_ID> profile <TCONT_PROFILE>",
      "gemport <GEMPORT_ID> tcont <TCONT_ID>",
      "switchport mode hybrid vport <VPORT_ID>",
      `service-port <SERVICE_PORT_ID> vport <VPORT_ID> user-vlan ${innerVlan} vlan ${vlan} svlan ${vlan}`
    ].join("\n")
  };
}

function buildConfigChecks(olt) {
  if (olt.vendor === "huawei") {
    return [
      { name: "ONT line profile", status: "待现场确认", value: "未接入正式 OID 解析" },
      { name: "ONT service profile", status: "待现场确认", value: "未接入正式 OID 解析" },
      { name: "GEM/TCONT", status: "待现场确认", value: "未接入正式 OID 解析" },
      { name: "Service-port / 内层 VLAN", status: "待现场确认", value: "仅展示模板，不推断真实配置" }
    ];
  }
  return [
    { name: "ONU profile", status: "待现场确认", value: "未接入正式 OID 解析" },
    { name: "TCONT/GEMPORT", status: "待现场确认", value: "未接入正式 OID 解析" },
    { name: "VPORT", status: "待现场确认", value: "未接入正式 OID 解析" },
    { name: "Service-port / 内层 VLAN", status: "待现场确认", value: "仅展示模板，不推断真实配置" }
  ];
}

async function findMduOttSampleVlans(olt, { slot, pon }) {
  const registeredRows = await listOnus(olt, { slot, pon });
  for (const row of registeredRows) {
    const servicePorts = await readZteServicePorts(olt, { slot, pon, onuId: row.onuId });
    const parsed = extractMduOttVlans(servicePorts);
    if (parsed.ok) {
      return {
        ok: true,
        sampleOnuId: row.onuId,
        servicePorts,
        ...parsed
      };
    }
  }
  return {
    ok: false,
    sampleOnuId: "",
    servicePorts: [],
    vlans: {},
    missing: ["innerVlan", "outerVlan", "ottVlan"],
    source: ""
  };
}

async function buildUnregisteredConfigPlan(olt, body = {}) {
  const slot = String(body.slot || "").trim();
  const pon = String(body.pon || "").trim();
  const serial = String(body.serial || "").trim();
  const defaultTemplateId = String(olt?.vendor || "").toLowerCase() === "huawei"
    ? "huawei-self-operated-internet"
    : "zte-self-operated-internet";
  const templateId = String(body.templateId || defaultTemplateId).trim();
  if (!olt?.id) return { ok: false, status: 404, error: "未找到 OLT。" };
  if (!slot || !pon || !serial) {
    return { ok: false, status: 400, error: "缺少 slot、pon 或 serial。" };
  }

  const ponPorts = await getPonPorts();
  const ledger = findLedgerPort(ponPorts, olt, slot, pon);
  const registeredRows = await listOnus(olt, { slot, pon });
  const next = suggestNextOnuId(registeredRows);
  if (next.blocked) {
    return {
      ok: true,
      blocked: true,
      warnings: [next.warning],
      variables: { slot, pon, serial, lastOnuId: next.lastOnuId },
      commands: "",
      templateId
    };
  }

  let dynamicVlans = {};
  let sample = null;
  if (String(olt.vendor || "").toLowerCase() === "zte" && templateId === "zte-mdu-ott") {
    sample = await findMduOttSampleVlans(olt, { slot, pon });
    dynamicVlans = {
      ...sample.vlans,
      ...(body.dynamicVlans || {})
    };
  }

  const plan = buildConfigPlanFromTemplate({
    templateId,
    slot,
    pon,
    serial,
    onuId: next.onuId,
    outerVlan: body.outerVlan || ledger.outerVlan || "",
    ethPorts: body.ethPorts,
    dynamicVlans
  });
  const warnings = [
    ...(plan.warnings || []),
    next.lastOnuId ? `ONU ID 按同 PON 最大 ID ${next.lastOnuId} + 1 建议为 ${next.onuId}。` : "当前 PON 未读取到已注册 ONU，ONU ID 建议为 1。",
    ...(templateId === "zte-mdu-ott" && sample?.ok ? [`MDU+OTT VLAN 来源：同 PON 样板 ONU ${slot}/${pon}:${sample.sampleOnuId}。`] : []),
    ...(templateId === "zte-mdu-ott" && sample && !sample.ok ? ["未找到可识别的同 PON MDU+OTT 样板 ONU，需要人工补充动态 VLAN。"] : [])
  ];

  return {
    ok: true,
    ...plan,
    warnings,
    variables: {
      ...(plan.variables || {}),
      lastOnuId: next.lastOnuId,
      suggestedOnuId: next.onuId,
      ledgerOuterVlan: ledger.outerVlan || "",
      sampleOnuId: sample?.sampleOnuId || ""
    },
    sampleServicePorts: sample?.servicePorts || []
  };
}

function indexRows(rows, baseOid, parser, valueMapper = cleanSnmpValue) {
  const map = new Map();
  for (const row of rows) {
    const idx = parser(row.oid, baseOid);
    if (idx.key) map.set(idx.key, { ...idx, value: valueMapper(row.value) });
  }
  return map;
}

function phaseLabel(profile, value) {
  const code = Number.parseInt(cleanSnmpValue(value), 10);
  return profile.phaseMap?.[code] || cleanSnmpValue(value) || "unknown";
}

async function buildStatus(olt) {
  const profile = oidProfiles[olt.vendor] || oidProfiles.zte;
  const timeout = olt.vendor === "huawei" ? 3500 : 5000;
  const [sysDescr, uptime] = await Promise.all([snmpGet(olt, profile.sysDescr, timeout), snmpGet(olt, profile.sysUpTime, timeout)]);
  const reachable = sysDescr.ok || uptime.ok;
  const snmpDiagnostics = buildSnmpStatusDiagnostics({
    olt,
    checks: [
      { label: "sysDescr", result: sysDescr },
      { label: "sysUpTime", result: uptime }
    ]
  });
  const failedDiagnostics = snmpDiagnostics.filter((item) => !item.ok);
  const offlineText = olt.vendor === "huawei"
    ? "网络可达，但 SNMP 161/udp 对当前 community 无响应；请检查华为 SNMP agent、ACL/view 或 community。"
    : "当前未读取到 SNMP 响应，界面显示模拟数据。";
  return {
    oltId: olt.id,
    reachable,
    snmpState: reachable ? "connected" : "mock/offline",
    sysDescr: reachable ? sysDescr.value : `${olt.vendor.toUpperCase()} ${olt.model} (${olt.host || "no host"})`,
    uptime: reachable ? uptime.value : "SNMP unavailable, showing cached/mock data",
    diagnostics: { snmp: snmpDiagnostics },
    alarms: reachable
      ? []
      : [
          { level: "warning", text: offlineText },
          ...failedDiagnostics.map((item) => ({
            level: "info",
            text: `${item.check} 失败：${item.error}；工具：${item.tool}；目标：${item.target}；OID：${item.oid}`
          })),
          { level: "info", text: "当前系统处于只读模式，仅执行 SNMP 查询。" }
        ]
  };
}

async function listOnus(olt, query) {
  const ponPorts = (await getPonPorts()).filter((p) => !olt.host || p.oltIp === olt.host);
  const profile = oidProfiles[olt.vendor] || oidProfiles.zte;
  let rows;

  if (olt.vendor === "zte") {
    const hasScopedPon = query.slot && query.pon;
    if (hasScopedPon) {
      const encodedPon = encodeZtePonIndex(query.slot, query.pon);
      const scoped = (oid) => `${oid}.${encodedPon}`;
      const [names, phases, serials, rxPowers, distances] = await Promise.all([
        snmpWalk(olt, scoped(profile.onuName)),
        snmpWalk(olt, scoped(profile.phaseState)),
        snmpWalk(olt, scoped(profile.serialNumber), "-Onx"),
        snmpWalk(olt, scoped(profile.rxPower)),
        snmpWalk(olt, scoped(profile.distance))
      ]);

      if (names.ok && names.rows.length) {
        const phaseByKey = indexRows(phases.rows, profile.phaseState, parseZteIndex, (value) => phaseLabel(profile, value));
        const serialByKey = indexRows(serials.rows, profile.serialNumber, parseZteIndex, decodeHexSerial);
        const rxByKey = indexRows(rxPowers.rows, profile.rxPower, parseZteIndex, decodeZteRxPower);
        const distanceByKey = indexRows(distances.rows, profile.distance, parseZteIndex, decodeDistance);

        rows = names.rows.map((row) => {
          const idx = parseZteIndex(row.oid, profile.onuName);
          const port = ponPorts.find((p) => p.ponPort === `${idx.slot}/${idx.pon}`) || {};
          return {
            id: `${idx.slot}/${idx.pon}/${idx.onuId}`,
            oltId: olt.id,
            oltHost: olt.host,
            slot: idx.slot,
            pon: idx.pon,
            onuId: idx.onuId,
            name: cleanSnmpValue(row.value),
            serial: serialByKey.get(idx.key)?.value || "unknown",
            phase: phaseByKey.get(idx.key)?.value || "unknown",
            rxPower: rxByKey.get(idx.key)?.value || "unknown",
            distance: distanceByKey.get(idx.key)?.value || "unknown",
            address: port.address || "",
            source: "snmp"
          };
        });
      }
    }
  } else {
    const hasScopedPon = query.slot && query.pon;
    if (hasScopedPon) {
      const ifNames = await snmpWalk(olt, profile.ifName, "-On", 8000);
      const ifIndexByPon = ifNames.ok ? parseHuaweiIfNameRows(ifNames.rows) : new Map();
      const portKey = `${query.slot}/${query.pon}`;
      const portInfo = ifIndexByPon.get(portKey);
      if (portInfo) {
        const scoped = (oid) => `${oid}.${portInfo.ifIndex}`;
        const [names, phases, rxPowers, distances] = await Promise.all([
          snmpWalk(olt, scoped(profile.ontDescription), "-On", 10000),
          snmpWalk(olt, scoped(profile.runStatus), "-On", 10000),
          snmpWalk(olt, scoped(profile.rxPower), "-On", 10000),
          snmpWalk(olt, scoped(profile.distance), "-On", 10000)
        ]);

        if (names.ok && names.rows.length) {
          const phaseByKey = indexRows(phases.rows, profile.runStatus, parseHuaweiOntIndex, huaweiRunStatus);
          const rxByKey = indexRows(rxPowers.rows, profile.rxPower, parseHuaweiOntIndex, decodeHuaweiRxPower);
          const distanceByKey = indexRows(distances.rows, profile.distance, parseHuaweiOntIndex, decodeDistance);
          const port = ponPorts.find((p) => p.ponPort === portKey) || {};

          rows = names.rows.map((row) => {
            const idx = parseHuaweiOntIndex(row.oid, profile.ontDescription);
            return {
              id: `${portInfo.slot}/${portInfo.pon}/${idx.onuId}`,
              oltId: olt.id,
              oltHost: olt.host,
              slot: portInfo.slot,
              pon: portInfo.pon,
              onuId: idx.onuId,
              name: cleanSnmpValue(row.value) || `ONT-${idx.onuId}`,
              serial: "N/A",
              phase: phaseByKey.get(idx.key)?.value || "unknown",
              rxPower: rxByKey.get(idx.key)?.value || "unknown",
              distance: distanceByKey.get(idx.key)?.value || "unknown",
              address: port.address || "",
              source: `snmp: ${portInfo.name}`
            };
          });
        }
      }
    }
  }

  rows ||= [];

  if (query.search) {
    const keyword = String(query.search).toLowerCase();
    rows = rows.filter((onu) => onuSearchText(onu).includes(keyword));
  }
  if (query.slot) rows = rows.filter((onu) => String(onu.slot) === String(query.slot));
  if (query.pon) rows = rows.filter((onu) => String(onu.pon) === String(query.pon));
  return rows;
}

async function listUnregisteredOnus(olt) {
  const ponPorts = await getPonPorts();
  if (olt.vendor === "zte") {
    const profile = oidProfiles.zte;
    const serials = await snmpWalk(olt, profile.unconfiguredSerial, "-Onx", 10000);
    const rows = serials.ok
      ? serials.rows
        .filter((row) => !/No Such Object|No Such Instance/i.test(row.value))
        .map((row) => {
          const idx = parseZteUnconfiguredIndex(row.oid, profile.unconfiguredSerial);
          const ledger = findLedgerPort(ponPorts, olt, idx.slot, idx.pon);
          return {
            slot: idx.slot,
            pon: idx.pon,
            serial: decodeHexSerial(row.value),
            detectedAt: new Date().toISOString(),
            state: "未注册",
            address: ledger.address || "",
            configPlan: buildConfigPlan({
              olt,
              slot: idx.slot,
              pon: idx.pon,
              serial: decodeHexSerial(row.value),
              outerVlan: ledger.outerVlan,
              address: ledger.address
            })
          };
        })
      : [];
    return {
      oltId: olt.id,
      oltHost: olt.host,
      source: profile.unconfiguredSerial,
      message: rows.length ? "" : "ZTE C300 当前未读取到未注册 ONU。",
      rows
    };
  }
  if (olt.vendor === "huawei") {
    const profile = oidProfiles.huawei;
    const [serials, statuses, ifNames] = await Promise.all([
      snmpWalk(olt, profile.unconfiguredSerial, "-Onx", 10000),
      snmpWalk(olt, profile.unconfiguredStatus, "-On", 10000),
      snmpWalk(olt, profile.ifName, "-On", 8000)
    ]);
    const ifIndexByPon = ifNames.ok ? parseHuaweiIfNameRows(ifNames.rows) : new Map();
    const ponByIfIndex = new Map([...ifIndexByPon.values()].map((port) => [port.ifIndex, port]));
    const statusByKey = statuses.ok
      ? indexRows(statuses.rows, profile.unconfiguredStatus, parseHuaweiOntIndex, huaweiUnconfiguredStatus)
      : new Map();
    const rows = serials.ok
      ? serials.rows
        .filter((row) => !/No Such Object|No Such Instance/i.test(row.value))
        .map((row) => {
          const idx = parseHuaweiOntIndex(row.oid, profile.unconfiguredSerial);
          const port = ponByIfIndex.get(idx.ifIndex) || {};
          const ledger = findLedgerPort(ponPorts, olt, port.slot ?? "-", port.pon ?? "-");
          return {
            slot: port.slot ?? "-",
            pon: port.pon ?? "-",
            serial: decodeHexSerial(row.value),
            detectedAt: new Date().toISOString(),
            state: statusByKey.get(idx.key)?.value || "未注册",
            address: ledger.address || "",
            configPlan: buildConfigPlan({
              olt,
              slot: port.slot ?? "<槽位>",
              pon: port.pon ?? "<PON>",
              serial: decodeHexSerial(row.value),
              outerVlan: ledger.outerVlan,
              address: ledger.address
            })
          };
        })
      : [];
    return {
      oltId: olt.id,
      oltHost: olt.host,
      source: profile.unconfiguredSerial,
      message: rows.length ? "" : "Huawei MA5800 当前未读取到未注册 ONU。",
      rows
    };
  }
  const vendorName = olt.vendor === "huawei" ? "Huawei MA5800" : "ZTE C300";
  return {
    oltId: olt.id,
    oltHost: olt.host,
    source: "read-only: unregistered ONU OID not verified",
    message: `${vendorName} 未注册 ONU 查询 OID 尚未完成现场验证，当前不显示占位数据。`,
    rows: []
  };
}

async function getOnuConfig(olt, query) {
  const slot = String(query.slot || "").trim();
  const pon = String(query.pon || "").trim();
  const onuId = String(query.onuId || "").trim();
  const serial = String(query.serial || "").trim();
  if (!slot || !pon) {
    return { ok: false, status: 400, error: "缺少槽位或 PON 参数。" };
  }

  const ponPorts = await getPonPorts();
  const ledger = findLedgerPort(ponPorts, olt, slot, pon);
  const rows = await listOnus(olt, { slot, pon });
  const row = rows.find((item) =>
    (onuId && String(item.onuId) === onuId) ||
    (serial && String(item.serial).toLowerCase() === serial.toLowerCase())
  );
  if (!row) {
    return { ok: false, status: 404, error: "当前槽位/PON 未读取到匹配的 ONU，请确认搜索结果是否仍在线。" };
  }

  const servicePorts = olt.vendor === "zte"
    ? await readZteServicePorts(olt, { slot, pon, onuId: row.onuId })
    : [];
  const cliConfig = olt.vendor === "zte"
    ? await queryZteOnuReadOnly({
      host: olt.host,
      port: Number(process.env.OLT_TELNET_PORT || 23),
      username: process.env.OLT_TELNET_USER,
      password: process.env.OLT_TELNET_PASSWORD,
      slot,
      pon,
      onuId: row.onuId
    })
    : { ok: false, unavailable: true, error: "当前厂商未启用 TELNET 查询" };
  const configChecks = buildConfigChecks(olt);
  if (olt.vendor === "zte" && servicePorts.length) {
    const pendingIndex = configChecks.findIndex((item) => item.name === "Service-port / 内层 VLAN");
    if (pendingIndex >= 0) configChecks.splice(pendingIndex, 1);
    configChecks.push({
      name: "Service-port / 业务 VLAN",
      status: "SNMP 已验证",
      value: `读取到 ${servicePorts.length} 条业务 VLAN：${servicePorts.map((item) => `${item.business} ${item.userVlan}`).join("、")}`
    });
  }

  return {
    ok: true,
    olt: {
      id: olt.id,
      name: olt.name,
      vendor: olt.vendor,
      model: olt.model,
      version: olt.version,
      host: olt.host
    },
    onu: {
      ...row,
      address: row.address || ledger.address || "",
      outerVlan: ledger.outerVlan || ""
    },
    linkStatus: {
      phase: row.phase,
      rxPower: row.rxPower,
      distance: row.distance
    },
    ledger: {
      ponPort: `${slot}/${pon}`,
      address: ledger.address || "",
      outerVlan: ledger.outerVlan || ""
    },
    configChecks,
    servicePorts,
    cliConfig,
    configPlan: buildConfigPlan({
      olt,
      slot,
      pon,
      onuId: row.onuId,
      serial: row.serial,
      outerVlan: ledger.outerVlan,
      address: row.address || ledger.address
    })
  };
}

async function listRecentOnus(olt, query = {}) {
  const profile = oidProfiles[olt.vendor] || oidProfiles.zte;
  const ponPorts = (await getPonPorts()).filter((p) => !olt.host || p.oltIp === olt.host);
  const hours = Math.max(1, Math.min(168, Number(query.hours || 48)));
  const cutoff = Date.now() - hours * 60 * 60 * 1000;

  if (olt.vendor === "zte") {
    const [lastOnlineRows, serials, phases] = await Promise.all([
      snmpWalk(olt, profile.lastOnlineTime, "-On", 30000),
      snmpWalk(olt, profile.serialNumber, "-Onx", 30000),
      snmpWalk(olt, profile.phaseState, "-On", 30000)
    ]);
    const serialByKey = serials.ok || serials.rows.length
      ? indexRows(serials.rows, profile.serialNumber, parseZteIndex, decodeHexSerial)
      : new Map();
    const phaseByKey = phases.ok || phases.rows.length
      ? indexRows(phases.rows, profile.phaseState, parseZteIndex, (value) => phaseLabel(profile, value))
      : new Map();
    const rows = lastOnlineRows.ok || lastOnlineRows.rows.length
      ? lastOnlineRows.rows
        .map((row) => {
          const idx = parseZteIndex(row.oid, profile.lastOnlineTime);
          const seen = parseDateTimeText(row.value);
          if (!seen || seen.ts < cutoff) return null;
          const port = ponPorts.find((p) => p.ponPort === `${idx.slot}/${idx.pon}`) || {};
          return {
            slot: idx.slot,
            pon: idx.pon,
            onuId: idx.onuId,
            serial: serialByKey.get(idx.key)?.value || "N/A",
            lastOnlineAt: seen.label,
            state: phaseByKey.get(idx.key)?.value || "已注册",
            address: port.address || ""
          };
        })
        .filter(Boolean)
      : [];
    rows.sort((a, b) => b.lastOnlineAt.localeCompare(a.lastOnlineAt));
    return {
      oltId: olt.id,
      oltHost: olt.host,
      source: profile.lastOnlineTime,
      hours,
      message: rows.length ? "" : `ZTE C300 最近 ${hours} 小时未读取到已注册 ONU 上线记录。`,
      rows
    };
  }

  if (olt.vendor === "huawei") {
    const [lastOnlineRows, statuses, names, ifNames] = await Promise.all([
      snmpWalk(olt, profile.lastOnlineTime, "-On", 30000),
      snmpWalk(olt, profile.runStatus, "-On", 30000),
      snmpWalk(olt, profile.ontDescription, "-On", 30000),
      snmpWalk(olt, profile.ifName, "-On", 8000)
    ]);
    const ifIndexByPon = ifNames.ok || ifNames.rows.length ? parseHuaweiIfNameRows(ifNames.rows) : new Map();
    const ponByIfIndex = new Map([...ifIndexByPon.values()].map((port) => [port.ifIndex, port]));
    const statusByKey = statuses.ok || statuses.rows.length
      ? indexRows(statuses.rows, profile.runStatus, parseHuaweiOntIndex, huaweiRunStatus)
      : new Map();
    const nameByKey = names.ok || names.rows.length
      ? indexRows(names.rows, profile.ontDescription, parseHuaweiOntIndex, cleanSnmpValue)
      : new Map();
    const rows = lastOnlineRows.ok || lastOnlineRows.rows.length
      ? lastOnlineRows.rows
        .map((row) => {
          const idx = parseHuaweiOntIndex(row.oid, profile.lastOnlineTime);
          const seen = decodeSnmpDateAndTime(row.value);
          if (!seen || seen.ts < cutoff) return null;
          const port = ponByIfIndex.get(idx.ifIndex) || {};
          const ponPort = port.slot != null && port.pon != null ? `${port.slot}/${port.pon}` : "";
          const ledger = ponPorts.find((p) => p.ponPort === ponPort) || {};
          return {
            slot: port.slot ?? "-",
            pon: port.pon ?? "-",
            onuId: idx.onuId,
            serial: nameByKey.get(idx.key)?.value || "N/A",
            lastOnlineAt: seen.label,
            state: statusByKey.get(idx.key)?.value || "已注册",
            address: ledger.address || ""
          };
        })
        .filter(Boolean)
      : [];
    rows.sort((a, b) => b.lastOnlineAt.localeCompare(a.lastOnlineAt));
    return {
      oltId: olt.id,
      oltHost: olt.host,
      source: profile.lastOnlineTime,
      hours,
      message: rows.length ? "" : `Huawei MA5800 最近 ${hours} 小时未读取到已注册 ONU 上线记录。`,
      rows
    };
  }

  return {
    oltId: olt.id,
    oltHost: olt.host,
    source: "",
    hours,
    message: "当前厂商暂未配置最近上线 ONU 查询 OID。",
    rows: []
  };
}

async function handleApi(req, res, url) {
  const olts = await getOlts();
  const olt = olts.find((item) => item.id === (url.searchParams.get("oltId") || olts[0]?.id));

  if (req.method === "GET" && url.pathname === "/api/bootstrap") {
    const ponPorts = await getPonPorts();
    return json(res, 200, { version: "1.0.0", olts, oidProfiles, ponPorts });
  }
  if (req.method === "GET" && url.pathname === "/api/status") {
    return json(res, 200, await buildStatus(olt));
  }
  if (req.method === "POST" && url.pathname === "/api/open-terminal") {
    const result = await openLocalTerminal();
    return json(res, result.status, result.ok ? { ok: true } : { ok: false, error: result.error });
  }
  if (req.method === "POST" && url.pathname === "/api/open-terminal-login") {
    const body = await readBody(req);
    const secretOlts = await getOlts({ includeSecrets: true });
    const requestedOltId = body.oltId || url.searchParams.get("oltId") || secretOlts[0]?.id;
    const targetOlt = secretOlts.find((item) => item.id === requestedOltId);
    const result = await openTerminalLogin(targetOlt);
    return json(res, result.status, result.ok ? { ok: true } : { ok: false, error: result.error });
  }
  if (req.method === "GET" && url.pathname === "/api/onus") {
    return json(res, 200, await listOnus(olt, Object.fromEntries(url.searchParams)));
  }
  if (req.method === "GET" && url.pathname === "/api/onu-config") {
    const result = await getOnuConfig(olt, Object.fromEntries(url.searchParams));
    if (!result.ok) return json(res, result.status || 500, { error: result.error || "ONU 配置读取失败" });
    return json(res, 200, result);
  }
  if (req.method === "GET" && url.pathname === "/api/unregistered-onus") {
    return json(res, 200, await listUnregisteredOnus(olt));
  }
  if (req.method === "GET" && url.pathname === "/api/config-templates") {
    return json(res, 200, { rows: configTemplates });
  }
  if (req.method === "POST" && url.pathname === "/api/config-templates/import-docx") {
    return json(res, 501, {
      ok: false,
      error: "DOCX 模板导入尚未实现。当前版本先提供内置 ZTE 自营上网、内部网络、MDU+OTT 和 Huawei 自营上网模板。"
    });
  }
  const configPlanMatch = url.pathname.match(/^\/api\/unregistered-onus\/([^/]+)\/config-plan$/);
  if (req.method === "POST" && configPlanMatch) {
    const body = await readBody(req);
    const result = await buildUnregisteredConfigPlan(olt, { ...body, id: decodeURIComponent(configPlanMatch[1]) });
    if (!result.ok) return json(res, result.status || 500, { error: result.error || "配置方案生成失败" });
    return json(res, 200, result);
  }
  if (req.method === "GET" && url.pathname === "/api/recent-onus") {
    return json(res, 200, await listRecentOnus(olt, Object.fromEntries(url.searchParams)));
  }
  if (req.method === "GET" && url.pathname === "/api/admin/olts") {
    return json(res, 200, await getOlts({ includeSecrets: true }));
  }
  if (req.method === "PUT" && url.pathname === "/api/admin/olts") {
    const body = await readBody(req);
    await replaceOlts(body.olts || body, "admin");
    return json(res, 200, { ok: true, olts: await getOlts(), adminOlts: await getOlts({ includeSecrets: true }) });
  }
  if (req.method === "GET" && url.pathname === "/api/admin/pon-ports") {
    return json(res, 200, await getPonPorts());
  }
  if (req.method === "POST" && url.pathname === "/api/admin/import-pon-ports") {
    const body = await readBody(req);
    await replacePonPorts(body.rows || [], "admin");
    return json(res, 200, { ok: true, count: (body.rows || []).length });
  }
  if (req.method === "POST" && url.pathname === "/api/admin/refresh-pon-vlans") {
    const body = await readBody(req);
    return json(res, 200, await refreshPonVlans(body, olts));
  }
  if (req.method === "GET" && url.pathname === "/api/admin/oid-profiles") {
    return json(res, 200, publicOidProfiles());
  }
  if (req.method === "POST" && url.pathname === "/api/admin/snmp-test") {
    const body = await readBody(req);
    const targetOlt = olts.find((item) => item.id === body.oltId) || olt;
    const started = Date.now();
    const operation = String(body.operation || "").trim().toLowerCase();
    if (!allowedSnmpOperations.has(operation) || dangerousOperationPattern.test(operation)) {
      return json(res, 400, {
        ok: false,
        error: "危险操作已被禁止。系统只允许只读 SNMP get/walk，不允许 set/clear/erase/undo/delete/no/load/reboot/reset/shutdown/write 等会修改或影响 OLT 的命令。"
      });
    }
    if (!/^\d+(\.\d+)+$/.test(String(body.oid || "").trim())) {
      return json(res, 400, { ok: false, error: "OID 格式无效，只允许数字点分格式。" });
    }
    const oid = String(body.oid).trim();
    const result = operation === "walk"
      ? await snmpWalk(targetOlt, oid, "-On", 10000)
      : await snmpGet(targetOlt, oid, 6000);
    const durationMs = Date.now() - started;
    const rawOutput = operation === "walk" ? result.rows.map((row) => `${row.oid} = ${row.value}`).join("\n") : result.value;
    const summary = result.ok
      ? operation === "walk" ? `${result.rows.length} rows` : result.value.slice(0, 160)
      : result.error || "SNMP failed";
    await addSnmpProbe({ oltId: targetOlt.id, operation, oid, ok: result.ok, durationMs, summary, rawOutput });
    return json(res, 200, { ok: result.ok, operation, oid, durationMs, summary, rawOutput, rows: result.rows || [] });
  }
  if (req.method === "GET" && url.pathname === "/api/admin/snmp-history") {
    return json(res, 200, await getSnmpHistory(Number(url.searchParams.get("limit") || 80)));
  }
  if (req.method === "GET" && url.pathname === "/api/admin/events") {
    return json(res, 200, await getAdminEvents(Number(url.searchParams.get("limit") || 80)));
  }
  return json(res, 404, { error: "API not found" });
}

async function serveStatic(req, res, url) {
  const rawPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = normalize(join(staticDir, rawPath));
  if (!filePath.startsWith(staticDir)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  if (!existsSync(filePath)) {
    res.writeHead(404);
    return res.end("Not found");
  }
  const type = mime[extname(filePath)] || "application/octet-stream";
  res.writeHead(200, { "content-type": type });
  createReadStream(filePath).on("error", () => {
    if (!res.headersSent) res.writeHead(500);
    res.end("Static file read failed");
  }).pipe(res);
}

await loadLocalTelnetEnv();

export async function startServer(options = {}) {
  const listenHost = options.host || process.env.HOST || "127.0.0.1";
  const listenPort = Number(options.port ?? process.env.PORT ?? 8787);
  await initDb();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    try {
      if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
      return await serveStatic(req, res, url);
    } catch (error) {
      return json(res, 500, { error: error.message });
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(listenPort, listenHost, () => {
      server.off("error", reject);
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : listenPort;
      resolve({ server, host: listenHost, port: actualPort, url: `http://${listenHost}:${actualPort}` });
    });
  });
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  const started = await startServer();
  console.log(`OLT manager listening on ${started.url}`);
}
