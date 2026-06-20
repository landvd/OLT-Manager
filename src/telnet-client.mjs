import net from "node:net";
import { EventEmitter } from "node:events";

const IAC = 255;
const WILL = 251;
const WONT = 252;
const DO = 253;
const DONT = 254;
const SB = 250;
const SE = 240;
const ECHO = 1;
const SUPPRESS_GO_AHEAD = 3;
const TERMINAL_TYPE = 24;
const NAWS = 31;
const TERMINAL_TYPE_IS = 0;
const TERMINAL_TYPE_SEND = 1;

export class TelnetCodec {
  constructor() {
    this.state = "data";
    this.command = 0;
    this.subnegotiation = [];
    this.cols = 80;
    this.rows = 24;
    this.nawsEnabled = false;
  }

  push(input) {
    const data = [];
    const replies = [];
    for (const byte of input) {
      if (this.state === "data") {
        if (byte === IAC) this.state = "iac";
        else data.push(byte);
      } else if (this.state === "iac") {
        if (byte === IAC) {
          data.push(IAC);
          this.state = "data";
        } else if ([WILL, WONT, DO, DONT].includes(byte)) {
          this.command = byte;
          this.state = "option";
        } else if (byte === SB) {
          this.subnegotiation = [];
          this.state = "subnegotiation";
        } else {
          this.state = "data";
        }
      } else if (this.state === "option") {
        this.negotiateOption(byte, replies);
        this.state = "data";
      } else if (this.state === "subnegotiation") {
        if (byte === IAC) this.state = "subnegotiation-iac";
        else this.subnegotiation.push(byte);
      } else if (this.state === "subnegotiation-iac") {
        if (byte === IAC) {
          this.subnegotiation.push(IAC);
          this.state = "subnegotiation";
        } else if (byte === SE) {
          this.handleSubnegotiation(replies);
          this.state = "data";
        } else {
          this.state = "subnegotiation";
        }
      }
    }
    return { data: Buffer.from(data), replies };
  }

  resize(cols, rows) {
    this.cols = Math.max(1, Math.min(65535, Math.floor(Number(cols) || 80)));
    this.rows = Math.max(1, Math.min(65535, Math.floor(Number(rows) || 24)));
    return this.nawsEnabled ? this.naws() : undefined;
  }

  negotiateOption(option, replies) {
    if (this.command === WILL) {
      const response = option === ECHO || option === SUPPRESS_GO_AHEAD ? DO : DONT;
      replies.push(Buffer.from([IAC, response, option]));
    } else if (this.command === DO) {
      if (option === TERMINAL_TYPE || option === NAWS) {
        replies.push(Buffer.from([IAC, WILL, option]));
        if (option === NAWS) {
          this.nawsEnabled = true;
          replies.push(this.naws());
        }
      } else {
        replies.push(Buffer.from([IAC, WONT, option]));
      }
    }
  }

  handleSubnegotiation(replies) {
    if (this.subnegotiation[0] === TERMINAL_TYPE && this.subnegotiation[1] === TERMINAL_TYPE_SEND) {
      replies.push(Buffer.from([IAC, SB, TERMINAL_TYPE, TERMINAL_TYPE_IS, ...Buffer.from("XTERM"), IAC, SE]));
    }
  }

  naws() {
    const values = [this.cols >> 8, this.cols & 255, this.rows >> 8, this.rows & 255];
    const escaped = values.flatMap((value) => (value === IAC ? [IAC, IAC] : [value]));
    return Buffer.from([IAC, SB, NAWS, ...escaped, IAC, SE]);
  }
}

const promptProfiles = {
  zte: {
    username: [/(?:Username|login)\s*:\s*$/im],
    password: [/Password\s*:\s*$/im],
    success: [/[A-Za-z0-9._()-]+[>#]\s*$/im],
    failure: [/Login incorrect/im, /Authentication failed/im, /Invalid password/im, /No username or bad password/im]
  },
  huawei: {
    username: [/(?:User name|Username|login)\s*:\s*$/im],
    password: [/(?:User password|Password)\s*:\s*$/im],
    success: [/[A-Za-z0-9._()-]+(?:\(config\))?[>#]\s*$/im],
    failure: [/Login incorrect/im, /Authentication failed/im, /Error:.*password/im, /Invalid password/im]
  }
};

export function normalizeTelnetVendor(vendor) {
  const text = String(vendor || "").toLowerCase();
  if (text.includes("huawei")) return "huawei";
  return "zte";
}

export function terminalLoginCommandSequence(olt) {
  const vendor = normalizeTelnetVendor(olt?.vendor);
  if (vendor === "huawei") return ["enable", "config"];
  if (vendor === "zte") return ["con t"];
  return [];
}

export class LoginAutomator {
  constructor(credentials, vendor) {
    this.credentials = credentials;
    this.prompts = promptProfiles[normalizeTelnetVendor(vendor)] || promptProfiles.zte;
    this.state = "awaiting-username";
    this.failureReason = "";
    this.buffer = "";
  }

  feed(text) {
    if (this.state === "connected" || this.state === "failed") return [];
    this.buffer = `${this.buffer}${text}`.slice(-4096);
    if (this.prompts.failure.some((pattern) => pattern.test(this.buffer))) {
      this.state = "failed";
      this.failureReason = "OLT 返回认证失败，请检查用户名和密码";
      return [];
    }
    if (this.state === "awaiting-username" && this.prompts.username.some((pattern) => pattern.test(this.buffer))) {
      this.state = "awaiting-password";
      this.buffer = "";
      return [`${this.credentials.username}\r\n`];
    }
    if (this.state === "awaiting-password" && this.prompts.password.some((pattern) => pattern.test(this.buffer))) {
      this.state = "awaiting-success";
      this.buffer = "";
      return [`${this.credentials.password}\r\n`];
    }
    if (this.state === "awaiting-success" && this.prompts.success.some((pattern) => pattern.test(this.buffer))) {
      this.state = "connected";
    }
    return [];
  }
}

export function validateTelnetTarget(olt) {
  if (!olt) return { ok: false, status: 404, error: "未找到 OLT。" };
  if (!String(olt.host || "").trim()) return { ok: false, status: 400, error: "OLT IP 未配置。" };
  if (!String(olt.telnetUsername || "").trim() || !String(olt.telnetPassword || "").trim()) {
    return { ok: false, status: 400, error: "TELNET 用户名或密码未配置。" };
  }
  return { ok: true };
}

export class InteractiveTelnetSession extends EventEmitter {
  constructor(id, olt, options = {}) {
    super();
    this.id = id;
    this.olt = olt;
    this.options = options;
    this.codec = new TelnetCodec();
    this.automator = new LoginAutomator({
      username: olt.telnetUsername,
      password: olt.telnetPassword
    }, olt.vendor);
    this.connected = false;
    this.ended = false;
  }

  connect() {
    const validation = validateTelnetTarget(this.olt);
    if (!validation.ok) {
      this.fail(validation.error);
      return;
    }
    this.emit("event", { type: "connecting", sessionId: this.id, message: `正在连接 ${this.olt.host}:${this.olt.telnetPort || 23}` });
    this.socket = net.createConnection({ host: this.olt.host, port: Number(this.olt.telnetPort || 23) });
    this.connectTimer = setTimeout(() => this.fail("连接超时，请检查 IP、端口和网络"), this.options.connectTimeoutMs || 12000);
    this.socket.once("connect", () => {
      clearTimeout(this.connectTimer);
      this.emit("event", { type: "authenticating", sessionId: this.id, message: "已连接，正在自动登录" });
      this.loginTimer = setTimeout(() => this.fail("自动登录超时，设备提示符可能与模板不匹配"), this.options.loginTimeoutMs || 20000);
    });
    this.socket.on("data", (input) => this.onData(input));
    this.socket.once("error", (error) => this.fail(`连接错误：${error.message}`));
    this.socket.once("close", () => {
      if (!this.ended) this.emit("event", { type: "disconnected", sessionId: this.id, message: "连接已断开" });
      this.ended = true;
      this.clearTimers();
    });
  }

  send(data) {
    if (this.connected && this.socket?.writable) this.socket.write(data);
  }

  resize(cols, rows) {
    const message = this.codec.resize(cols, rows);
    if (message && this.socket?.writable) this.socket.write(message);
  }

  close() {
    this.ended = true;
    this.clearTimers();
    this.socket?.destroy();
    this.emit("event", { type: "disconnected", sessionId: this.id, message: "连接已关闭" });
  }

  onData(input) {
    const decoded = this.codec.push(input);
    for (const reply of decoded.replies) this.socket?.write(reply);
    if (decoded.data.length === 0) return;
    const text = decoded.data.toString("utf8");
    this.emit("event", { type: "data", sessionId: this.id, data: text });
    if (this.connected) return;
    for (const response of this.automator.feed(text)) this.socket?.write(response);
    if (this.automator.state === "connected") {
      this.connected = true;
      clearTimeout(this.loginTimer);
      this.emit("event", { type: "connected", sessionId: this.id, message: "自动登录成功" });
      this.enterConfigurationMode();
    } else if (this.automator.state === "failed") {
      this.fail(this.automator.failureReason || "认证失败");
    }
  }

  enterConfigurationMode() {
    const commands = this.options.enterConfig === false ? [] : terminalLoginCommandSequence(this.olt);
    for (const command of commands) this.socket?.write(`${command}\r\n`);
    if (commands.length) {
      this.emit("event", {
        type: "notice",
        sessionId: this.id,
        message: "已自动登录并进入配置模式。系统不会自动粘贴或执行配置方案，请人工粘贴并确认。"
      });
    }
  }

  fail(message) {
    if (this.ended) return;
    this.ended = true;
    this.clearTimers();
    this.emit("event", { type: "error", sessionId: this.id, message });
    this.socket?.destroy();
  }

  clearTimers() {
    clearTimeout(this.connectTimer);
    clearTimeout(this.loginTimer);
  }
}

function waitForSessionEvent(session, predicate, timeoutMs, timeoutMessage) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(timeoutMessage));
    }, timeoutMs);
    const onEvent = (event) => {
      if (event.type === "error") {
        cleanup();
        reject(new Error(event.message || "Telnet 查询失败"));
      } else if (predicate(event)) {
        cleanup();
        resolve(event);
      }
    };
    const cleanup = () => {
      clearTimeout(timer);
      session.off("event", onEvent);
    };
    session.on("event", onEvent);
  });
}

function waitForText(session, matcher, timeoutMs, timeoutMessage) {
  let buffer = "";
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(timeoutMessage));
    }, timeoutMs);
    const onEvent = (event) => {
      if (event.type === "error") {
        cleanup();
        reject(new Error(event.message || "Telnet 查询失败"));
      } else if (event.type === "data") {
        buffer = `${buffer}${event.data}`.slice(-1024 * 1024);
        if (matcher(buffer)) {
          cleanup();
          resolve(buffer);
        }
      }
    };
    const cleanup = () => {
      clearTimeout(timer);
      session.off("event", onEvent);
    };
    session.on("event", onEvent);
  });
}

function cleanCommandOutput(raw, command) {
  const lines = raw
    .replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "")
    .replaceAll("\r", "")
    .split("\n")
    .map((line) => line.trimEnd());
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  const commandIndex = lines.findIndex((line) => line.trim() === command);
  const sliced = commandIndex >= 0 ? lines.slice(commandIndex + 1) : lines;
  while (sliced.length && /^[A-Za-z0-9_.()/-]+(?:\(config\))?[>#]\s*$/.test(sliced.at(-1)?.trim() || "")) sliced.pop();
  while (sliced.length && !sliced.at(-1).trim()) sliced.pop();
  return sliced.join("\n");
}

export async function loginAndRunReadOnlyCommands(olt, commands, options = {}) {
  const session = new InteractiveTelnetSession(`readonly-${Date.now()}`, olt, {
    enterConfig: false,
    connectTimeoutMs: options.connectTimeoutMs || 12000,
    loginTimeoutMs: options.loginTimeoutMs || 20000
  });
  const outputs = [];
  try {
    session.connect();
    await waitForSessionEvent(session, (event) => event.type === "connected", options.loginTimeoutMs || 22000, "TELNET 自动登录超时");
    for (const command of commands) {
      session.send(`${command}\r\n`);
      const raw = await waitForText(
        session,
        (text) => text.includes(command) && /[\r\n][A-Za-z0-9_.()/-]+[>#]\s*$/.test(text),
        options.commandTimeoutMs || 18000,
        `${command} 查询超时`
      );
      outputs.push(cleanCommandOutput(raw, command));
    }
    return { ok: true, outputs };
  } finally {
    session.close();
  }
}
