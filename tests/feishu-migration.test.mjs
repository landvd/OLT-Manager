import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createFeishuMigrationService } from "../src/feishu/migration.mjs";
import { emptyFeishuState } from "../src/feishu/state.mjs";

async function makeFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "olt-feishu-migration-"));
  const legacyDirectory = path.join(root, "legacy");
  await fs.mkdir(legacyDirectory);
  const legacy = {
    operators: [
      { openId: "ou-valid", remark: "旧管理员", oltIds: ["olt-1", "old-olt"] },
      { openId: "ou-invalid", remark: "无效范围", oltIds: ["old-olt"] }
    ],
    authorizedChats: [{ chatId: "oc-1", remark: "旧群", type: "group" }],
    operatorAccessRequests: [{ openId: "ou-request", chatId: "oc-direct", requestedAt: "2026-08-01T00:00:00.000Z" }],
    authorizationAuditReferences: ["old-audit-reference"],
    feishu: { appId: "cli_0123456789abcdef", credentialReference: "old-app-ref" }
  };
  const legacyPath = path.join(legacyDirectory, "local-administration.json");
  const serialized = JSON.stringify(legacy, null, 2);
  await fs.writeFile(legacyPath, serialized, { mode: 0o600 });
  let state = emptyFeishuState();
  let writes = 0;
  const service = createFeishuMigrationService({
    legacyDirectory,
    stateStore: {
      async read() { return structuredClone(state); },
      async write(next) { state = structuredClone(next); writes += 1; }
    },
    gateway: { async listOlts() { return [{ oltId: "olt-1" }]; } },
    exportBackup: async () => Buffer.from("encrypted-combined-backup"),
    now: () => "2026-08-05T00:00:00.000Z"
  });
  return { service, legacyPath, serialized, readState: () => structuredClone(state), writes: () => writes };
}

test("legacy Feishu migration previews, maps only new credential references, and keeps Feishu disabled", async () => {
  const fixture = await makeFixture();
  const preview = await fixture.service.preview({ credentialReferenceMap: { "old-app-ref": "new-app-ref" } });
  assert.equal(preview.requiresConfirmation, true);
  assert.deepEqual(preview.counts, { operators: 1, authorizedChats: 1, accessRequests: 1, auditReferences: 1 });
  assert.equal(preview.credentialBindings[0].method, "explicit-map");
  assert.match(preview.warnings.join("\n"), /未知 OLT Scope/);

  const result = await fixture.service.apply({ confirmed: true, credentialReferenceMap: { "old-app-ref": "new-app-ref" } });
  assert.equal(result.applied, true);
  assert.deepEqual(result.backupBefore, new Uint8Array(Buffer.from("encrypted-combined-backup")));
  assert.deepEqual(result.backupAfter, new Uint8Array(Buffer.from("encrypted-combined-backup")));
  assert.equal(fixture.readState().enabled, false);
  assert.equal(fixture.readState().app.credentialReference, "new-app-ref");
  assert.deepEqual(fixture.readState().operators, [{ openId: "ou-valid", remark: "旧管理员", oltIds: ["olt-1"], enabled: true }]);
  assert.equal(fixture.readState().auditArchive.at(-1).eventType, "legacy-feishu-migration");
  assert.equal(await fs.readFile(fixture.legacyPath, "utf8"), fixture.serialized);
});

test("legacy migration is idempotent and blocks conflicting target authorization", async () => {
  const fixture = await makeFixture();
  await fixture.service.apply({ confirmed: true, credentialReferenceMap: { "old-app-ref": "new-app-ref" } });
  const writesAfterFirstApply = fixture.writes();
  const repeated = await fixture.service.apply({ confirmed: true, credentialReferenceMap: { "old-app-ref": "new-app-ref" } });
  assert.equal(repeated.applied, false);
  assert.equal(fixture.writes(), writesAfterFirstApply);

  const conflict = await makeFixture();
  const target = conflict.readState();
  target.operators.push({ openId: "ou-valid", remark: "当前配置", oltIds: ["olt-1"], enabled: true });
  // Replace the fixture's state through a deliberately conflicting state store.
  const service = createFeishuMigrationService({
    legacyDirectory: path.dirname(conflict.legacyPath),
    stateStore: {
      async read() { return target; },
      async write() {}
    },
    gateway: { async listOlts() { return [{ oltId: "olt-1" }]; } }
  });
  await assert.rejects(() => service.apply({ confirmed: true, credentialReferenceMap: { "old-app-ref": "new-app-ref" } }), /迁移存在冲突/);
});

test("legacy migration requires explicit confirmation", async () => {
  const fixture = await makeFixture();
  await assert.rejects(() => fixture.service.apply(), /人工确认/);
});
