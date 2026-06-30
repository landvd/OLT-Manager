import { isIP } from "node:net";
import { loginAndRunReadOnlyCommands } from "./telnet-client.mjs";

function coordinatePart(value, name) {
  const text = String(value ?? "").trim();
  if (!/^\d{1,3}$/.test(text) || Number(text) < 0 || Number(text) > 255) {
    throw new Error(`${name} 格式无效`);
  }
  return text;
}

export function buildHuaweiReadOnlyCommands({ chassis, board, slot, pon, onuId, ontId }) {
  const safeChassis = coordinatePart(chassis, "槽");
  const safeBoard = coordinatePart(board ?? slot, "板卡");
  const safePon = coordinatePart(pon, "PON");
  const safeOntId = coordinatePart(ontId ?? onuId, "ONT ID");
  return [`display current-configuration ont ${safeChassis}/${safeBoard}/${safePon} ${safeOntId}`];
}

export async function queryHuaweiOnuReadOnly({
  host,
  port = 23,
  username,
  password,
  chassis,
  board,
  slot,
  pon,
  onuId,
  ontId
}) {
  if (!isIP(String(host || ""))) return { ok: false, error: "OLT IP 格式无效" };
  if (!username || !password) return { ok: false, unavailable: true, error: "TELNET 凭据未配置" };

  let commands;
  try {
    commands = buildHuaweiReadOnlyCommands({ chassis, board, slot, pon, onuId, ontId });
  } catch (error) {
    return { ok: false, error: error.message };
  }

  try {
    const result = await loginAndRunReadOnlyCommands({
      host,
      telnetPort: port,
      telnetUsername: username,
      telnetPassword: password,
      vendor: "huawei"
    }, [commands[0], commands[0]], {
      commandTimeoutMs: 30000,
      requireCommandEcho: false
    });
    const onuRunningConfig = result.outputs.find((output) => /\[gpon\]|ont add\b|service-port\b|return\b/i.test(output)) || result.outputs.at(-1);
    if (!onuRunningConfig) return { ok: false, error: "TELNET 查询返回内容不完整" };
    return {
      ok: true,
      source: "TELNET CLI 只读查询",
      command: commands[0],
      onuRunningConfig
    };
  } catch (error) {
    return { ok: false, error: error.message || "TELNET 查询失败" };
  }
}
