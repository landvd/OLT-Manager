import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqliteRepository, splitSqlStatements, sqlQuote } from "../src/sqlite-repository.mjs";

async function withTempDir(run) {
  const dir = await mkdtemp(join(tmpdir(), "olt-sqlite-repo-"));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("SQLite repository quotes values and serializes query/exec calls", async () => {
  const calls = [];
  const repository = createSqliteRepository({
    dbPath: "/tmp/test.sqlite",
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
});

test("SQL splitter respects strings, comments, meta commands and trigger bodies", () => {
  assert.deepEqual(splitSqlStatements(`.bail on
BEGIN IMMEDIATE;
INSERT INTO t VALUES ('a;b', "c;d", [e;f]); -- 注释; 不拆分
/* 块注释; */ SELECT 'it''s';
CREATE TEMP TRIGGER tr AFTER INSERT ON t BEGIN UPDATE t SET v = 1; DELETE FROM t WHERE 0; END;
;
COMMIT;`), [
    "BEGIN IMMEDIATE;",
    `INSERT INTO t VALUES ('a;b', "c;d", [e;f]);`,
    "-- 注释; 不拆分\n/* 块注释; */ SELECT 'it''s';",
    "CREATE TEMP TRIGGER tr AFTER INSERT ON t BEGIN UPDATE t SET v = 1; DELETE FROM t WHERE 0; END;",
    "COMMIT;"
  ]);
  assert.deepEqual(splitSqlStatements("SELECT 1"), ["SELECT 1"]);
  assert.deepEqual(splitSqlStatements("  -- 只有注释\n"), []);
  assert.throws(() => splitSqlStatements(".import data.csv t"), /不支持的 SQLite 点命令/);
});

test("SQLite repository runs multi-statement scripts in process like the sqlite3 CLI", async () => {
  await withTempDir(async (dir) => {
    const repository = createSqliteRepository({ dbPath: join(dir, "main.sqlite") });
    await repository.exec(`PRAGMA journal_mode=WAL;
CREATE TABLE items (id TEXT PRIMARY KEY, qty INTEGER, note TEXT);`);
    const output = await repository.runSql(`.bail on
BEGIN IMMEDIATE;
INSERT INTO items VALUES ('a', 9007199254740993, NULL);
SELECT changes() AS persisted, id, note FROM items WHERE id = 'a';
COMMIT;`, { json: true });
    assert.deepEqual(JSON.parse(output), [{ persisted: 1, id: "a", note: null }]);
    assert.deepEqual(await repository.query("SELECT id FROM items WHERE note IS \"x\" OR id = \"a\";"), [{ id: "a" }]);
    assert.equal(await repository.runSql("PRAGMA integrity_check;"), "ok");
    assert.equal(await repository.runSql("SELECT id, note, 1 AS one FROM items;"), "a||1");
    assert.deepEqual(await repository.query("SELECT 1 WHERE 0;"), []);
    repository.closeDatabase();
  });
});

test("SQLite repository stops at the first failure and rolls back the open transaction", async () => {
  await withTempDir(async (dir) => {
    const repository = createSqliteRepository({ dbPath: join(dir, "main.sqlite") });
    await repository.exec("CREATE TABLE items (id TEXT PRIMARY KEY);");
    await assert.rejects(repository.exec(`.bail on
BEGIN IMMEDIATE;
INSERT INTO items VALUES ('a');
INSERT INTO missing_table VALUES ('b');
COMMIT;`), /missing_table/);
    assert.deepEqual(await repository.query("SELECT count(*) AS n FROM items;"), [{ n: 0 }]);
    await repository.exec("BEGIN; INSERT INTO items VALUES ('c'); COMMIT;");
    assert.deepEqual(await repository.query("SELECT id FROM items;"), [{ id: "c" }]);
    repository.closeDatabase();
  });
});

test("SQLite repository closes side databases and reopens the main file after replacement", async () => {
  await withTempDir(async (dir) => {
    const dbPath = join(dir, "main.sqlite");
    const sidePath = join(dir, "side.sqlite");
    const repository = createSqliteRepository({ dbPath });
    await repository.exec("PRAGMA journal_mode=WAL; CREATE TABLE marker (name TEXT); INSERT INTO marker VALUES ('old');");
    await repository.runSqlImmediate("PRAGMA journal_mode=WAL; CREATE TABLE marker (name TEXT); INSERT INTO marker VALUES ('new');", { databasePath: sidePath });
    assert.equal(await repository.runSqlImmediate("PRAGMA integrity_check;", { databasePath: sidePath }), "ok");
    assert.deepEqual((await readdir(dir)).filter((name) => name.startsWith("side")).sort(), ["side.sqlite"]);

    repository.closeDatabase();
    await rm(dbPath);
    await rm(`${dbPath}-wal`, { force: true });
    await rm(`${dbPath}-shm`, { force: true });
    await rename(sidePath, dbPath);
    assert.deepEqual(await repository.query("SELECT name FROM marker;"), [{ name: "new" }]);
    repository.closeDatabase();
  });
});
