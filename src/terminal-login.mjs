import { chmod, mkdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function appleString(value) {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function expectQuote(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

export function validateTerminalLoginOlt(olt) {
  if (!olt) return { ok: false, status: 404, error: "未找到 OLT。" };
  if (!String(olt.host || "").trim()) return { ok: false, status: 400, error: "OLT IP 未配置。" };
  if (!String(olt.telnetUsername || "").trim() || !String(olt.telnetPassword || "").trim()) {
    return { ok: false, status: 400, error: "TELNET 用户名或密码未配置。" };
  }
  return { ok: true };
}

export function terminalLoginCommandSequence(olt) {
  const vendor = String(olt?.vendor || "").toLowerCase();
  if (vendor === "huawei") return ["enable", "config"];
  if (vendor === "zte") return ["con t"];
  return [];
}

export function buildTerminalLoginExpectScript({ host, port = 23, username, password, vendor }) {
  const commands = terminalLoginCommandSequence({ vendor });
  return `#!/usr/bin/expect -f
set timeout 20
set host "${expectQuote(host)}"
set port "${expectQuote(port)}"
set username "${expectQuote(username)}"
set password "${expectQuote(password)}"
set vendor "${expectQuote(vendor)}"
# telnet ${expectQuote(host)} ${expectQuote(port)}
# Huawei prompts: User name: / User password:
catch {file delete -- [info script]}

proc wait_prompt {} {
  expect {
    -re {[\r\n][A-Za-z0-9_.()/-]+[>#][ \t]*$} { return }
    -re {No username or bad password|Login incorrect|Authentication failed|Invalid password|Error:.*password} {
      puts "\\nTELNET 用户名或密码错误。"
      interact
      exit
    }
    timeout {
      puts "\\n等待设备提示符超时，已交给人工处理。"
      interact
      exit
    }
    eof {
      puts "\\n连接已断开。"
      exit 6
    }
  }
}

spawn telnet $host $port
expect {
  -re {(User name|Username|login):[ \t]*$} {}
  timeout {
    puts "\\n等待用户名提示超时，已交给人工处理。"
    interact
    exit
  }
  eof {
    puts "\\n连接已断开。"
    exit 6
  }
}
send -- "$username\\r"

expect {
  -re {(User password|Password):[ \t]*$} {}
  timeout {
    puts "\\n等待密码提示超时，已交给人工处理。"
    interact
    exit
  }
  eof {
    puts "\\n连接已断开。"
    exit 6
  }
}
send -- "$password\\r"
wait_prompt
${commands.map((command) => {
  if (command === "config") {
    return `send -- "${expectQuote(command)}\\r"
expect {
  -re {(User password|Password):[ \\t]*$} {
    puts "\\n设备要求二次密码，已交给人工处理。"
    interact
    exit
  }
  -re {[\\r\\n][A-Za-z0-9_.()/-]+\\(config\\)#[ \\t]*$} {}
  -re {[\\r\\n][A-Za-z0-9_.()/-]+[>#][ \\t]*$} {}
  timeout {}
  eof {
    puts "\\n连接已断开。"
    exit 6
  }
}`;
  }
  return `send -- "${expectQuote(command)}\\r"
expect {
  -re {(User password|Password):[ \\t]*$} {
    puts "\\n设备要求二次密码，已交给人工处理。"
    interact
    exit
  }
  -re {[\\r\\n][A-Za-z0-9_.()/-]+[>#][ \\t]*$} {}
  timeout {}
  eof {
    puts "\\n连接已断开。"
    exit 6
  }
}`;
}).join("\n")}
puts "\\n已自动登录终端，配置命令已复制到剪贴板；请人工粘贴确认。"
interact
`;
}

export function buildTerminalLoginAppleScript(options) {
  if (options.scriptPath) {
    return `tell application "Terminal"
  activate
  do script ${appleString(`/usr/bin/expect ${shellQuote(options.scriptPath)}`)}
end tell`;
  }
  const expectScript = buildTerminalLoginExpectScript(options);
  return `set loginScript to ${appleString(expectScript)}
-- write text "enable"
-- write text "config"
tell application "Terminal"
  activate
  do script loginScript
end tell`;
}

export async function openTerminalLogin(olt, { platform = process.platform } = {}) {
  const validation = validateTerminalLoginOlt(olt);
  if (!validation.ok) return validation;
  if (platform !== "darwin") {
    return { ok: false, status: 501, error: "当前仅支持在 macOS 上打开 Terminal。" };
  }

  const dir = join(tmpdir(), "olt-manager-terminal-login");
  await mkdir(dir, { recursive: true });
  const scriptPath = join(dir, `login-${process.pid}-${Date.now()}.expect`);
  await writeFile(scriptPath, buildTerminalLoginExpectScript({
    host: olt.host,
    port: olt.telnetPort || 23,
    username: olt.telnetUsername,
    password: olt.telnetPassword,
    vendor: olt.vendor
  }), { mode: 0o700 });
  await chmod(scriptPath, 0o700);

  return new Promise((resolve) => {
    execFile("osascript", ["-e", buildTerminalLoginAppleScript({ scriptPath })], { timeout: 5000 }, (error) => {
      resolve({
        ok: !error,
        status: error ? 500 : 200,
        error: error?.message || ""
      });
    });
  });
}
