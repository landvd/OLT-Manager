import test from "node:test";
import assert from "node:assert/strict";
import { createServerDataAccess, SERVER_DATA_ACCESS_METHODS } from "../src/server-data-access.mjs";

test("server data access exposes only the explicit SQLite method contract", () => {
  const database = Object.fromEntries(SERVER_DATA_ACCESS_METHODS.map((name) => [name, () => name]));
  database.query = () => "must-not-expose";
  const access = createServerDataAccess(database);

  assert.deepEqual(Object.keys(access), [...SERVER_DATA_ACCESS_METHODS]);
  assert.equal(Object.hasOwn(access, "query"), false);
  assert.equal(Object.isFrozen(access), true);
  assert.equal(access.getOlts(), "getOlts");
});

test("server data access fails closed when the database contract is incomplete", () => {
  assert.throws(() => createServerDataAccess({}), /SQLite 数据访问接口缺少方法：addProjectOnu/);
});
