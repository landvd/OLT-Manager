import test from "node:test";
import assert from "node:assert/strict";
import { telnetReadOnlyOptionsForOlt } from "../src/server.mjs";

test("ONU config Telnet query uses saved OLT credentials by default", () => {
  const previous = {
    port: process.env.OLT_TELNET_PORT,
    user: process.env.OLT_TELNET_USER,
    password: process.env.OLT_TELNET_PASSWORD
  };
  delete process.env.OLT_TELNET_PORT;
  delete process.env.OLT_TELNET_USER;
  delete process.env.OLT_TELNET_PASSWORD;

  try {
    assert.deepEqual(telnetReadOnlyOptionsForOlt({
      telnetPort: 2323,
      telnetUsername: "admin",
      telnetPassword: "secret"
    }), {
      port: 2323,
      username: "admin",
      password: "secret"
    });
  } finally {
    restoreEnv(previous);
  }
});

test("ONU config Telnet query allows environment overrides", () => {
  const previous = {
    port: process.env.OLT_TELNET_PORT,
    user: process.env.OLT_TELNET_USER,
    password: process.env.OLT_TELNET_PASSWORD
  };
  process.env.OLT_TELNET_PORT = "2223";
  process.env.OLT_TELNET_USER = "env-user";
  process.env.OLT_TELNET_PASSWORD = "env-secret";

  try {
    assert.deepEqual(telnetReadOnlyOptionsForOlt({
      telnetPort: 2323,
      telnetUsername: "admin",
      telnetPassword: "secret"
    }), {
      port: 2223,
      username: "env-user",
      password: "env-secret"
    });
  } finally {
    restoreEnv(previous);
  }
});

function restoreEnv(previous) {
  setOrDelete("OLT_TELNET_PORT", previous.port);
  setOrDelete("OLT_TELNET_USER", previous.user);
  setOrDelete("OLT_TELNET_PASSWORD", previous.password);
}

function setOrDelete(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
