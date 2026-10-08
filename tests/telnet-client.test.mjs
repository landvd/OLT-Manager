import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import {
  InteractiveTelnetSession,
  TelnetCodec,
  loginAndRunReadOnlyCommands,
  pasteWaitState,
  terminalLoginCommandSequence
} from "../src/telnet-client.mjs";
import { buildZteReadOnlyCommands } from "../src/zte-telnet.mjs";

const sockets = [];
const servers = [];

test.afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

test("Telnet codec responds to negotiation and strips control bytes", () => {
  const codec = new TelnetCodec();
  const result = codec.push(Buffer.from([255, 251, 1, ...Buffer.from("Username:")]));
  assert.equal(result.data.toString("utf8"), "Username:");
  assert.deepEqual([...result.replies[0]], [255, 253, 1]);
});

test("Terminal login sequence only enters the intended vendor mode", () => {
  assert.deepEqual(terminalLoginCommandSequence({ vendor: "zte" }), ["configure terminal"]);
  assert.deepEqual(terminalLoginCommandSequence({ vendor: "huawei" }), ["enable"]);
  assert.equal(terminalLoginCommandSequence({ vendor: "zte" }).join("\n").includes("service-port"), false);
});

test("Interactive session logs in and enters configuration mode", async () => {
  const mock = await createMockOlt({ vendor: "zte" });
  const events = [];
  const session = new InteractiveTelnetSession("session-1", {
    host: "127.0.0.1",
    telnetPort: mock.port,
    telnetUsername: "admin",
    telnetPassword: "secret",
    vendor: "zte"
  }, { connectTimeoutMs: 1000, loginTimeoutMs: 1000 });
  session.on("event", (event) => events.push(event));
  session.connect();
  await waitFor(() => mock.received.join("").includes("configure terminal\r\n"));
  assert.equal(events.some((event) => event.type === "connected"), true);
  assert.equal(mock.received.join("").includes("service-port"), false);
  session.close();
});

test("Read-only query executes only fixed show commands", async () => {
  const mock = await createMockOlt({ vendor: "zte", commandPrompt: "OLT#" });
  const commands = buildZteReadOnlyCommands({ slot: 9, pon: 16, onuId: 41 });
  const result = await loginAndRunReadOnlyCommands({
    host: "127.0.0.1",
    telnetPort: mock.port,
    telnetUsername: "admin",
    telnetPassword: "secret",
    vendor: "zte"
  }, commands, { connectTimeoutMs: 1000, loginTimeoutMs: 1000, commandTimeoutMs: 1000 });

  assert.equal(result.ok, true);
  assert.equal(result.outputs.length, 2);
  assert.match(result.outputs[0], /interface output/);
  assert.match(result.outputs[1], /onu output/);
  assert.deepEqual(mock.commands, commands);
});

test("Interactive session reports login failure", async () => {
  const mock = await createMockOlt({ vendor: "zte", failLogin: true });
  const events = [];
  const session = new InteractiveTelnetSession("session-2", {
    host: "127.0.0.1",
    telnetPort: mock.port,
    telnetUsername: "admin",
    telnetPassword: "wrong",
    vendor: "zte"
  }, { connectTimeoutMs: 1000, loginTimeoutMs: 1000 });
  session.on("event", (event) => events.push(event));
  session.connect();
  await waitFor(() => events.some((event) => event.type === "error"));
  assert.match(events.find((event) => event.type === "error").message, /认证失败/);
});

async function createMockOlt({ vendor, failLogin = false, commandPrompt = "OLT#" }) {
  const received = [];
  const commands = [];
  const usernamePrompt = vendor === "huawei" ? "User name:" : "Username:";
  const passwordPrompt = vendor === "huawei" ? "User password:" : "Password:";
  const server = net.createServer((socket) => {
    sockets.push(socket);
    socket.setEncoding("utf8");
    socket.write(usernamePrompt);
    let step = 0;
    socket.on("data", (data) => {
      received.push(data);
      if (step === 0 && data.includes("admin")) {
        step = 1;
        socket.write(passwordPrompt);
      } else if (step === 1) {
        step = 2;
        if (failLogin) {
          socket.write("Login incorrect");
        } else {
          socket.write(commandPrompt);
        }
      } else {
        const command = data.trim();
        if (command) commands.push(command);
        if (command.startsWith("show running-config interface")) {
          socket.write(`${command}\r\ninterface output\r\n${commandPrompt}`);
        } else if (command.startsWith("show onu running config")) {
          socket.write(`${command}\r\nonu output\r\n${commandPrompt}`);
        } else {
          socket.write(`${command}\r\n${commandPrompt}`);
        }
      }
    });
  });
  servers.push(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { port: server.address().port, received, commands };
}

async function waitFor(condition, timeoutMs = 3000) {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error("等待条件超时");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("Interactive session decodes multi-byte UTF-8 split across TCP chunks", () => {
  const session = new InteractiveTelnetSession("session-utf8", { host: "127.0.0.1", vendor: "zte" });
  session.connected = true;
  const texts = [];
  session.on("event", (event) => { if (event.type === "data") texts.push(event.data); });
  const bytes = Buffer.from("ONU 描述：厚街镇", "utf8");
  const cut = bytes.indexOf(Buffer.from("厚", "utf8")) + 1;
  session.onData(bytes.subarray(0, cut));
  session.onData(bytes.subarray(cut));
  assert.equal(texts.join(""), "ONU 描述：厚街镇");
  assert.equal(texts.join("").includes("�"), false);
});


test("Paste wait state recognises vendor prompts, parameter prompts and paging", () => {
  assert.equal(pasteWaitState("show card\r\nZXAN(config-if-gpon-onu_1/2/3:4)#"), "prompt");
  assert.equal(pasteWaitState("display board 0\r\n<MA5800-X7>"), "prompt");
  assert.equal(pasteWaitState("ont add 1 sn-auth ...\r\n{ <cr>|ontid<U><0,127> }:"), "parameter");
  assert.equal(pasteWaitState("line\r\n---- More ( Press 'Q' to break ) ----"), "more");
  assert.equal(pasteWaitState("show card\r\nSlot  Type   Status"), "pending");
  assert.equal(pasteWaitState("\u001b[1D\u001b[KOLT#"), "prompt");
});

// 模拟设备：每行处理 40ms 后才回提示符，处理期间收到的输入全部丢弃（模拟缓冲区溢出丢字符）。
async function createSlowDevice({ prompt = "OLT(config)#", parameterLines = [] } = {}) {
  const lines = [];
  const server = net.createServer((socket) => {
    sockets.push(socket);
    socket.setEncoding("utf8");
    let busy = false;
    let pending = "";
    let awaitingParameter = false;
    socket.on("data", (data) => {
      if (busy) return;
      pending += data;
      let index;
      while ((index = pending.indexOf("\r")) !== -1) {
        const line = pending.slice(0, index);
        pending = pending.slice(index + 1);
        if (awaitingParameter) {
          awaitingParameter = false;
          busy = true;
          setTimeout(() => { busy = false; socket.write(`\r\n${prompt}`); }, 20);
          return;
        }
        lines.push(line);
        busy = true;
        socket.write(`${line}\r\n`);
        setTimeout(() => {
          busy = false;
          if (parameterLines.includes(line)) {
            awaitingParameter = true;
            socket.write("{ <cr>|ontid<U><0,127> }:");
          } else {
            socket.write(`output of ${line}\r\n${prompt}`);
          }
        }, 40);
        return;
      }
    });
  });
  servers.push(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { port: server.address().port, lines };
}

function connectedSession(port, vendor = "zte") {
  const session = new InteractiveTelnetSession(`paste-${port}`, { host: "127.0.0.1", telnetPort: port, vendor });
  session.socket = net.createConnection({ host: "127.0.0.1", port });
  session.socket.on("data", (input) => session.onData(input));
  session.connected = true;
  return new Promise((resolve) => session.socket.once("connect", () => resolve(session)));
}

test("Line paste waits for the device prompt before sending the next line", async () => {
  const device = await createSlowDevice({ prompt: "ZXAN(config-if-gpon-onu_1/2/3:4)#" });
  const session = await connectedSession(device.port);
  const commands = ["show card", "show onu state gpon-olt_1/2/3", "show version"];
  const progress = [];
  const result = await session.pasteLines(commands, { onProgress: (item) => progress.push(item.sent) });
  assert.deepEqual(device.lines, commands);
  assert.deepEqual(result, { sent: 3, total: 3, timeouts: 0, cancelled: false, confirmLine: "" });
  assert.deepEqual(progress, [1, 2, 3]);
  session.close();
});

test("Line paste answers Huawei parameter prompts only for lines that need an extra Enter", async () => {
  const addLine = "ont add 1 sn-auth 5A544547030C0914 omci ont-lineprofile-id 10";
  const device = await createSlowDevice({ prompt: "MA5800(config-if-gpon-0/1)#", parameterLines: [addLine] });
  const session = await connectedSession(device.port, "huawei");
  const result = await session.pasteLines([addLine, "display ont info 1 1"], {
    needsExtraEnter: (line) => line.startsWith("ont add")
  });
  assert.deepEqual(device.lines, [addLine, "display ont info 1 1"]);
  assert.equal(result.timeouts, 0);
  session.close();
});

test("Line paste falls back after a timeout and can be cancelled", async () => {
  const silent = net.createServer((socket) => { sockets.push(socket); });
  servers.push(silent);
  await new Promise((resolve) => silent.listen(0, "127.0.0.1", resolve));
  const session = await connectedSession(silent.address().port);
  const started = Date.now();
  const result = await session.pasteLines(["show a", "show b"], { lineTimeoutMs: 60 });
  assert.equal(result.sent, 2);
  assert.equal(result.timeouts, 2);
  assert.ok(Date.now() - started >= 110);
  const pending = session.pasteLines(["show c", "show d", "show e"], { lineTimeoutMs: 1000 });
  setTimeout(() => session.cancelPaste(), 50);
  const cancelled = await pending;
  assert.equal(cancelled.cancelled, true);
  assert.ok(cancelled.sent < 3);
  session.close();
});

test("Line paste confirms Huawei parameter prompts for any pasted line when enabled", async () => {
  const device = await createSlowDevice({ prompt: "<MA5800-X7>", parameterLines: ["display version"] });
  const session = await connectedSession(device.port, "huawei");
  const result = await session.pasteLines(["display version", "display time"], { confirmParameterPrompt: true, lineTimeoutMs: 1000 });
  assert.deepEqual(device.lines, ["display version", "display time"]);
  assert.deepEqual(result, { sent: 2, total: 2, timeouts: 0, cancelled: false, confirmLine: "" });
  session.close();
});

test("Line paste recognises yes/no confirmations", () => {
  assert.equal(pasteWaitState("undo service-port 1\r\nAre you sure to release service virtual port(s)? (y/n)[n]:"), "confirm");
  assert.equal(pasteWaitState("reboot\r\nConfirm to reboot? [Y/N]:"), "confirm");
  assert.equal(pasteWaitState("show card\r\nZXAN#"), "prompt");
});

test("Line paste pauses at a confirmation prompt and never answers it", async () => {
  const received = [];
  const server = net.createServer((socket) => {
    sockets.push(socket);
    socket.setEncoding("utf8");
    socket.on("data", (data) => {
      received.push(data);
      if (data.startsWith("undo service-port")) socket.write(`${data.trim()}\r\nAre you sure to release service virtual port(s)? (y/n)[n]:`);
      else socket.write(`${data.trim()}\r\nMA5800(config)#`);
    });
  });
  servers.push(server);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const session = await connectedSession(server.address().port, "huawei");
  const result = await session.pasteLines(["display time", "undo service-port 1", "yes-looking line"], { confirmParameterPrompt: true, lineTimeoutMs: 1000 });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(result.confirmLine, "undo service-port 1");
  assert.equal(result.sent, 2);
  assert.deepEqual(received, ["display time\r", "undo service-port 1\r"]);
  session.close();
});
