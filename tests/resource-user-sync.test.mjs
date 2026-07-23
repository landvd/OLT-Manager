import test from "node:test";
import assert from "node:assert/strict";
import { createResourceUserSync } from "../src/resource-user-sync.mjs";

function deferred() {
  let resolve;
  const promise = new Promise((next) => { resolve = next; });
  return { promise, resolve };
}

test("resource user sync commits a complete snapshot only after remote rows arrive", async () => {
  const commits = [];
  const sync = createResourceUserSync({
    remote: {
      async getUsers({ onProgress }) {
        onProgress({ phase: "syncing-pages", total: 2, pages: 1, completedPages: 1, received: 2, workers: 1 });
        return [{ onuIndexName: "1/1/1:1" }, { onuIndexName: "1/1/1:2" }];
      }
    },
    snapshots: {
      async replaceComplete(input) { commits.push(input); return { count: input.rows.length }; },
      async replaceCheckpoint() { throw new Error("not used"); }
    }
  });

  const result = await sync.syncComplete({ oltId: "olt-1", oltIp: "192.0.2.1", gridRank: "grid-1", session: {} });
  assert.equal(result.count, 2);
  assert.equal(commits.length, 1);
  assert.equal(sync.progressFor("olt-1").running, false);
  assert.equal(sync.progressFor("olt-1").received, 2);
});

test("resource user sync keeps persistence untouched when remote paging fails", async () => {
  let completeCalls = 0;
  const sync = createResourceUserSync({
    remote: { async getUsers() { throw new Error("第 2 页超时"); } },
    snapshots: {
      async replaceComplete() { completeCalls += 1; },
      async replaceCheckpoint() { throw new Error("not used"); }
    }
  });

  await assert.rejects(() => sync.syncComplete({ oltId: "olt-1", oltIp: "192.0.2.1", gridRank: "grid-1", session: {} }), /第 2 页超时/);
  assert.equal(completeCalls, 0);
  assert.deepEqual(sync.progressFor("olt-1").running, false);
  assert.match(sync.progressFor("olt-1").error, /第 2 页超时/);
});

test("resource user sync rejects a duplicate request for the same OLT", async () => {
  const waiting = deferred();
  const sync = createResourceUserSync({
    remote: { async getUsers() { return waiting.promise; } },
    snapshots: {
      async replaceComplete(input) { return { count: input.rows.length }; },
      async replaceCheckpoint() { throw new Error("not used"); }
    }
  });

  const first = sync.syncComplete({ oltId: "olt-1", oltIp: "192.0.2.1", gridRank: "grid-1", session: {} });
  await assert.rejects(() => sync.syncComplete({ oltId: "olt-1", oltIp: "192.0.2.1", gridRank: "grid-1", session: {} }), { message: "当前 OLT 正在同步用户信息。", status: 409 });
  waiting.resolve([]);
  await first;
});

test("resource user checkpoint keeps its partial result separate from complete snapshots", async () => {
  const checkpoints = [];
  const sync = createResourceUserSync({
    remote: {
      async getUsers({ maxPages, onProgress }) {
        assert.equal(maxPages, 3);
        onProgress({ phase: "syncing-pages", total: 100, pages: 5, completedPages: 3, received: 60, workers: 3 });
        return [{ onuIndexName: "1/1/1:1" }];
      }
    },
    snapshots: {
      async replaceComplete() { throw new Error("not used"); },
      async replaceCheckpoint(input) { checkpoints.push(input); return { count: input.rows.length, expectedTotal: input.expectedTotal, completedPages: input.completedPages }; }
    }
  });

  const result = await sync.saveCheckpoint({ oltId: "olt-1", oltIp: "192.0.2.1", gridRank: "grid-1", session: {}, maxPages: 3 });
  assert.equal(result.partial, true);
  assert.deepEqual(checkpoints[0].expectedTotal, 100);
  assert.deepEqual(checkpoints[0].completedPages, 3);
});
