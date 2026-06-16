import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTerminalLoginAppleScript,
  openTerminalLogin,
  terminalLoginCommandSequence,
  validateTerminalLoginOlt
} from "../src/terminal-login.mjs";

test("Terminal login validates OLT identity and Telnet credentials", () => {
  assert.equal(validateTerminalLoginOlt(null).error, "未找到 OLT。");
  assert.equal(validateTerminalLoginOlt({ host: "" }).error, "OLT IP 未配置。");
  assert.equal(validateTerminalLoginOlt({ host: "172.19.104.102", telnetUsername: "", telnetPassword: "x" }).error, "TELNET 用户名或密码未配置。");

  assert.deepEqual(
    validateTerminalLoginOlt({
      host: "172.19.104.102",
      telnetPort: 23,
      telnetUsername: "user",
      telnetPassword: "pass"
    }),
    { ok: true }
  );
});

test("Terminal login command sequence enters vendor configuration mode", () => {
  assert.deepEqual(terminalLoginCommandSequence({ vendor: "zte" }), ["con t"]);
  assert.deepEqual(terminalLoginCommandSequence({ vendor: "huawei" }), ["enable", "config"]);
});

test("Terminal login AppleScript logs in without embedding preview commands", () => {
  const script = buildTerminalLoginAppleScript({
    host: "172.19.104.102",
    port: 23,
    username: "HouJie",
    password: "secret",
    vendor: "huawei"
  });

  assert.match(script, /telnet 172\.19\.104\.102 23/);
  assert.match(script, /User name:/);
  assert.match(script, /User password:/);
  assert.match(script, /write text "enable"/);
  assert.match(script, /write text "config"/);
  assert.doesNotMatch(script, /ont add|service-port|sn-auth/);
});

test("Terminal login open helper rejects unsupported platforms before opening Terminal", async () => {
  assert.deepEqual(
    await openTerminalLogin({
      id: "olt-1",
      host: "172.19.104.102",
      telnetPort: 23,
      telnetUsername: "user",
      telnetPassword: "pass"
    }, { platform: "linux" }),
    { ok: false, status: 501, error: "当前仅支持在 macOS 上打开 Terminal。" }
  );

  assert.equal(
    (await openTerminalLogin({ id: "olt-2", host: "172.19.104.102" }, { platform: "linux" })).error,
    "TELNET 用户名或密码未配置。"
  );
});
