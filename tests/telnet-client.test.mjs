import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import {
  InteractiveTelnetSession,
  TelnetCodec,
  loginAndRunReadOnlyCommands,
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

test("Terminal login sequence only enters vendor mode", () => {
  assert.deepEqual(terminalLoginCommandSequence({ vendor: "zte" }), ["con t"]);
  assert.deepEqual(terminalLoginCommandSequence({ vendor: "huawei" }), ["enable", "config"]);
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
  await waitFor(() => mock.received.join("").includes("con t\r\n"));
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
