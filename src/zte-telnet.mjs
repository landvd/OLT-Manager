import { execFile } from "node:child_process";
import { isIP } from "node:net";
import { fileURLToPath } from "node:url";

const expectBin = process.env.OLT_MANAGER_EXPECT_BIN || "/usr/bin/expect";
const expectScript = fileURLToPath(new URL("./zte-readonly.expect", import.meta.url));

function numericPart(value, name) {
  const text = String(value || "").trim();
  if (!/^\d{1,3}$/.test(text) || Number(text) < 1 || Number(text) > 255) {
    throw new Error(`${name} 格式无效`);
  }
  return text;
}

function interfaceName({ slot, pon, onuId }) {
  const safeSlot = numericPart(slot, "槽位");
  const safePon = numericPart(pon, "PON");
  const safeOnuId = numericPart(onuId, "ONU ID");
  return `gpon-onu_1/${safeSlot}/${safePon}:${safeOnuId}`;
}

export function buildZteReadOnlyCommands(parts) {
  const name = interfaceName(parts);
  return [
    `show running-config interface ${name}`,
    `show onu running config ${name}`
  ];
}

function cleanOutput(raw, command) {
  const lines = raw
    .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "")
    .replaceAll("\r", "")
    .split("\n")
    .map((line) => line.trimEnd());
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  if (lines[0]?.trim() === command) lines.shift();
  if (/^[A-Za-z0-9_.-]+#$/.test(lines.at(-1)?.trim() || "")) lines.pop();
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  return lines.join("\n");
}

function extractMarked(text, marker, command) {
  const match = text.match(new RegExp(`${marker}_BEGIN\\n([\\s\\S]*?)${marker}_END`));
  return match ? cleanOutput(match[1], command) : "";
}

export async function queryZteOnuReadOnly({
  host,
  port = 23,
  username,
  password,
  slot,
  pon,
  onuId
}) {
  if (!isIP(String(host || ""))) return { ok: false, error: "OLT IP 格式无效" };
  if (!username || !password) return { ok: false, unavailable: true, error: "TELNET 凭据未配置" };
  if (process.platform === "win32") return { ok: false, unavailable: true, error: "Windows 版暂不支持 ZTE TELNET 只读配置查询。" };

  let name;
  let commands;
  try {
    name = interfaceName({ slot, pon, onuId });
    commands = buildZteReadOnlyCommands({ slot, pon, onuId });
  } catch (error) {
    return { ok: false, error: error.message };
  }

  return new Promise((resolve) => {
    execFile(
      expectBin,
      [expectScript, String(host), String(port), name],
      {
        timeout: 50000,
        maxBuffer: 4 * 1024 * 1024,
        env: {
          ...process.env,
          OLT_TELNET_USER: username,
          OLT_TELNET_PASSWORD: password
        }
      },
      (error, stdout, stderr) => {
        if (error) {
          const message = /login failed/i.test(stderr)
            ? "TELNET 用户名或密码错误"
            : (stderr.trim() || error.message);
          return resolve({ ok: false, error: message });
        }
        const runningConfig = extractMarked(stdout, "RUNNING_CONFIG", commands[0]);
        const onuRunningConfig = extractMarked(stdout, "ONU_RUNNING_CONFIG", commands[1]);
        if (!runningConfig || !onuRunningConfig) {
          return resolve({ ok: false, error: "TELNET 查询返回内容不完整" });
        }
        return resolve({
          ok: true,
          source: "TELNET 只读查询",
          runningConfig,
          onuRunningConfig
        });
      }
    );
  });
}
