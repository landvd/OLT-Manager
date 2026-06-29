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
