import test from "node:test";
import assert from "node:assert/strict";
import { createSqliteRepository, sqlQuote } from "../src/sqlite-repository.mjs";

test("SQLite repository quotes values and serializes query/exec calls", async () => {
  const calls = [];
  const repository = createSqliteRepository({
    dbPath: "/tmp/test.sqlite",
    sqliteBin: "/tmp/sqlite3",
    missingToolMessage: (name) => `missing ${name}`,
    executeImmediate: async (sql, options) => {
      calls.push({ sql, options });
      return options.json ? JSON.stringify([{ value: 1 }]) : "";
    }
  });

  assert.equal(sqlQuote(null), "NULL");
  assert.equal(sqlQuote("O'Reilly"), "'O''Reilly'");
  assert.deepEqual(await repository.query("SELECT 1"), [{ value: 1 }]);
  await repository.exec("UPDATE test SET value = 1");
  assert.deepEqual(calls.map((call) => call.sql), ["SELECT 1", "UPDATE test SET value = 1"]);
  assert.equal(calls[0].options.json, true);
  assert.equal(calls[1].options.json, false);
});

test("SQLite repository keeps queued tasks ordered after a failure", async () => {
  const calls = [];
  const repository = createSqliteRepository({
    dbPath: "/tmp/test.sqlite",
    sqliteBin: "/tmp/sqlite3",
    missingToolMessage: () => "missing sqlite3",
    executeImmediate: async (sql) => {
      calls.push(sql);
      if (sql === "FAIL") throw new Error("expected");
      return "";
    }
  });

  await assert.rejects(repository.runSql("FAIL"), /expected/);
  await repository.runSql("AFTER");
  assert.deepEqual(calls, ["FAIL", "AFTER"]);
});

test("SQLite repository rejects incomplete construction", () => {
  assert.throws(() => createSqliteRepository(), /数据库路径/);
  assert.throws(() => createSqliteRepository({ dbPath: "/tmp/a", sqliteBin: "/tmp/sqlite3" }), /工具缺失提示/);
});
