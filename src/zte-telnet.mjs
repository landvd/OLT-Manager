import { isIP } from "node:net";
import { loginAndRunReadOnlyCommands } from "./telnet-client.mjs";

function numericPart(value, name) {
  const text = String(value || "").trim();
  if (!/^\d{1,3}$/.test(text) || Number(text) < 1 || Number(text) > 255) {
    throw new Error(`${name} 格式无效`);
  }
  return text;
}

function interfaceName({ chassis = 1, board, slot, pon, onuId }) {
  const safeChassis = numericPart(chassis, "槽");
  const safeBoard = numericPart(board || slot, "板卡");
  const safePon = numericPart(pon, "PON");
  const safeOnuId = numericPart(onuId, "ONU ID");
  return `gpon-onu_${safeChassis}/${safeBoard}/${safePon}:${safeOnuId}`;
}

export function buildZteReadOnlyCommands(parts) {
  const name = interfaceName(parts);
  return [
    `show running-config interface ${name}`,
    `show onu running config ${name}`
  ];
}

export function buildZteC600PonOpticalCommand({ chassis = 1, board, slot, pon }) {
  const safeChassis = numericPart(chassis, "槽");
  const safeBoard = numericPart(board || slot, "板卡");
  const safePon = numericPart(pon, "PON");
  return `show pon power olt-rx gpon_olt-${safeChassis}/${safeBoard}/${safePon}`;
}

export function parseZteC600PonRxPowerOutput(output = "") {
  const rows = new Map();
  const linePattern = /^\s*gpon_onu-(\d+)\/(\d+)\/(\d+):(\d+)\s+(.+?)\s*$/i;
  for (const line of String(output || "").split(/\r?\n/)) {
    const match = line.match(linePattern);
    if (!match) continue;
    const [, chassis, board, pon, onuId, rawValue] = match;
    if (/^no signal$/i.test(rawValue.trim())) {
      rows.set(`${chassis}/${board}/${pon}/${onuId}`, "no signal");
      continue;
    }
    const value = Number.parseFloat(rawValue.match(/-?\d+(?:\.\d+)?/)?.[0] || "");
    if (Number.isFinite(value)) rows.set(`${chassis}/${board}/${pon}/${onuId}`, `${value.toFixed(2)} dBm`);
  }
  return rows;
}

export async function queryZteC600PonOpticalReadOnly({
  host,
  port = 23,
  username,
  password,
  chassis = 1,
  board,
  slot,
  pon
}) {
  if (!isIP(String(host || ""))) return { ok: false, error: "OLT IP 格式无效" };
  if (!username || !password) return { ok: false, unavailable: true, error: "TELNET 凭据未配置" };

  let command;
  try {
    command = buildZteC600PonOpticalCommand({ chassis, board, slot, pon });
  } catch (error) {
    return { ok: false, error: error.message };
  }

  try {
    const result = await loginAndRunReadOnlyCommands({
      host,
      telnetPort: port,
      telnetUsername: username,
      telnetPassword: password,
      vendor: "zte"
    }, [command], { commandTimeoutMs: 22000 });
    const output = result.outputs?.[0] || "";
    const rows = parseZteC600PonRxPowerOutput(output);
    if (!output || !rows.size) return { ok: false, error: "C600 光功率查询返回内容不完整" };
    return {
      ok: true,
      source: "TELNET 只读查询",
      command,
      rows: [...rows.entries()].map(([coordinate, rxPower]) => ({ coordinate, rxPower }))
    };
  } catch (error) {
    return { ok: false, error: error.message || "C600 光功率查询失败" };
  }
}

export async function queryZteOnuReadOnly({
  host,
  port = 23,
  username,
  password,
  chassis,
  board,
  slot,
  pon,
  onuId
}) {
  if (!isIP(String(host || ""))) return { ok: false, error: "OLT IP 格式无效" };
  if (!username || !password) return { ok: false, unavailable: true, error: "TELNET 凭据未配置" };

  let name;
  let commands;
  try {
    name = interfaceName({ chassis, board, slot, pon, onuId });
    commands = buildZteReadOnlyCommands({ chassis, board, slot, pon, onuId });
  } catch (error) {
    return { ok: false, error: error.message };
  }

  try {
    const result = await loginAndRunReadOnlyCommands({
      host,
      telnetPort: port,
      telnetUsername: username,
      telnetPassword: password,
      vendor: "zte"
    }, commands, { commandTimeoutMs: 22000 });
    const [runningConfig, onuRunningConfig] = result.outputs;
    if (!runningConfig || !onuRunningConfig) {
      return { ok: false, error: "TELNET 查询返回内容不完整" };
    }
    return {
      ok: true,
      source: "TELNET 只读查询",
      runningConfig,
      onuRunningConfig
    };
  } catch (error) {
    return { ok: false, error: error.message || "TELNET 查询失败" };
  }
}
