import assert from "node:assert/strict";
import test from "node:test";
import { createInitialAppState } from "../src/app-state.mjs";

test("creates credential-free authentication and resource defaults", () => {
  const state = createInitialAppState({ now: Date.UTC(2026, 0, 31, 12) });

  assert.equal(state.authenticated, false);
  assert.equal(state.authSetupRequired, false);
  assert.equal(state.authPassword, "");
  assert.equal(state.authError, "");
  assert.equal(state.resource.config.password, "");
  assert.equal(state.resource.config.migrationMasterPassword, "");
  assert.equal(state.resource.loggedIn, false);
  assert.equal(state.resourceSchedule.tasks.length, 0);
  assert.equal(state.oss.password, "");
  assert.equal(state.oss.migrationMasterPassword, "");
  assert.deepEqual(state.oss.dateRange, ["2026-01-01", "2026-01-31"]);
});

test("creates deeply isolated state instances", () => {
  const first = createInitialAppState({ now: 0 });
  const second = createInitialAppState({ now: 0 });

  first.authPassword = "not-a-real-password";
  first.resource.config.serverUrl = "http://example.invalid";
  first.resource.users.push({ id: "one" });
  first.mergedOnu.sources.network.synced = true;
  first.oss.dateRange.push("extra");
  first.projectDialog.form.name = "changed";

  assert.equal(second.authPassword, "");
  assert.equal(second.resource.config.serverUrl, "");
  assert.deepEqual(second.resource.users, []);
  assert.equal(second.mergedOnu.sources.network.synced, false);
  assert.deepEqual(second.oss.dateRange, ["1969-12-02", "1970-01-01"]);
  assert.equal(second.projectDialog.form.name, "");
  assert.notStrictEqual(first.resource, second.resource);
  assert.notStrictEqual(first.resource.config, second.resource.config);
  assert.notStrictEqual(first.mergedOnu.sources.network, second.mergedOnu.sources.network);
  assert.notStrictEqual(first.oss.dateRange, second.oss.dateRange);
});

test("uses a supplied clock without browser or network dependencies", () => {
  const state = createInitialAppState({ now: Date.UTC(2024, 5, 15, 8) });

  assert.deepEqual(state.oss.dateRange, ["2024-05-16", "2024-06-15"]);
  assert.equal(Object.hasOwn(state, "fetch"), false);
  assert.equal(Object.hasOwn(state, "timer"), false);
});
