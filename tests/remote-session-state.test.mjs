import test from "node:test";
import assert from "node:assert/strict";
import { createRemoteSessionState } from "../src/remote-session-state.mjs";

test("remote session state starts empty and keeps secret state in memory only", () => {
  const state = createRemoteSessionState();

  assert.equal(state.getNmseSession(), null);
  assert.equal(state.getNmseMigrationMasterPassword(), "");
  assert.equal(state.getOssNgbSession(), null);
  assert.equal(Object.keys(state).includes("nmseMigrationMasterPassword"), false);

  const nmseSession = { auth: { token: "synthetic-token" }, olts: [] };
  const ossSession = { auth: { cookie: "synthetic-cookie" }, olts: [] };
  assert.equal(state.setNmseSession(nmseSession), nmseSession);
  assert.equal(state.setOssNgbSession(ossSession), ossSession);
  state.setNmseMigrationMasterPassword("synthetic-master-password");

  assert.equal(state.getNmseSession(), nmseSession);
  assert.equal(state.getOssNgbSession(), ossSession);
  assert.equal(state.getNmseMigrationMasterPassword(), "synthetic-master-password");
});

test("remote session state clears sessions independently and all together", () => {
  const state = createRemoteSessionState();
  state.setNmseSession({ id: "nmse" });
  state.setOssNgbSession({ id: "oss" });
  state.setNmseMigrationMasterPassword("synthetic-master-password");

  state.clearNmseSession();
  assert.equal(state.getNmseSession(), null);
  assert.deepEqual(state.getOssNgbSession(), { id: "oss" });
  assert.equal(state.getNmseMigrationMasterPassword(), "synthetic-master-password");

  state.clearAll();
  assert.equal(state.getNmseSession(), null);
  assert.equal(state.getOssNgbSession(), null);
  assert.equal(state.getNmseMigrationMasterPassword(), "");
});

test("invalid session values fail closed and password values are normalized", () => {
  const state = createRemoteSessionState();

  assert.equal(state.setNmseSession(undefined), null);
  assert.equal(state.setOssNgbSession(false), null);
  state.setNmseMigrationMasterPassword(null);
  assert.equal(state.getNmseMigrationMasterPassword(), "");
  state.setNmseMigrationMasterPassword("synthetic-master-password");
  state.setNmseMigrationMasterPassword(123);
  assert.equal(state.getNmseMigrationMasterPassword(), "");
});
