import test from "node:test";
import assert from "node:assert/strict";
import { NmseClient, parseNmsePonText } from "../src/nmse-client.mjs";

test("NMSE ponText uses PON string keys rather than array indexes", () => {
  const rows = parseNmsePonText(JSON.stringify({
    slot1: [{ "2": "1062", "10": "1070" }],
    slot12: [{ "1": 1061 }]
  }));
  assert.deepEqual(rows, [
    { board: "1", pon: "2", svlan: "1062" },
    { board: "1", pon: "10", svlan: "1070" },
    { board: "12", pon: "1", svlan: "1061" }
  ]);
});

test("NMSE ponText invalid values are ignored", () => {
  assert.deepEqual(parseNmsePonText("not-json"), []);
  assert.deepEqual(parseNmsePonText({ slot1: [{ "2": "not-a-vlan" }] }), []);
});

test("NMSE user pagination uses no more than eight isolated concurrent workers", async () => {
  let activePages = 0;
  let maxActivePages = 0;
  const pageSizes = [];
  const response = (data = {}) => ({ ok: true, headers: { get: () => null }, json: async () => ({ header: { opCode: "1" }, body: { data } }) });
  const fetchImpl = async (url) => {
    const request = new URL(url);
    if (request.pathname === "/config/ConfigurationManagement") return response();
    if (request.pathname !== "/onu/getOnuListByGridRank") throw new Error(`Unexpected path ${request.pathname}`);
    const page = Number(request.searchParams.get("page"));
    pageSizes.push(Number(request.searchParams.get("pageSize")));
    if (page > 0) {
      activePages += 1;
      maxActivePages = Math.max(maxActivePages, activePages);
      await new Promise((resolve) => setTimeout(resolve, 5));
      activePages -= 1;
    }
    return response({ TotalCount: 180, list: [{ onuIndexName: `onu-${page}` }] });
  };
  const client = new NmseClient({ serverUrl: "http://nmse.test", fetchImpl });
  const progress = [];
  const rows = await client.getUsers({ phone: "tester", token: "token", userId: "user", userType: "False" }, "grid", { onProgress: (item) => progress.push(item) });
  assert.equal(rows.length, 9);
  assert.equal(maxActivePages, 8);
  assert.deepEqual(pageSizes, Array(9).fill(20));
  assert.deepEqual(progress.at(-1), { phase: "syncing-pages", total: 180, pages: 9, completedPages: 9, received: 9, workers: 8 });
});

test("NMSE user first page gets a longer timeout and two transient retries", async () => {
  let firstPageAttempts = 0;
  const response = (data = {}) => ({ ok: true, headers: { get: () => null }, json: async () => ({ header: { opCode: "1" }, body: { data } }) });
  const fetchImpl = async (url) => {
    const request = new URL(url);
    if (request.pathname === "/config/ConfigurationManagement") return response();
    if (request.pathname !== "/onu/getOnuListByGridRank") throw new Error(`Unexpected path ${request.pathname}`);
    firstPageAttempts += 1;
    if (firstPageAttempts < 3) throw new Error("资源管理服务器请求超时，请稍后重试。");
    return response({ TotalCount: 1, list: [{ onuIndexName: "onu-1" }] });
  };
  const progress = [];
  const client = new NmseClient({ serverUrl: "http://nmse.test", fetchImpl, retryDelayMs: 0 });
  const rows = await client.getUsers({ phone: "tester", token: "token", userId: "user", userType: "False" }, "grid", { onProgress: (item) => progress.push(item) });
  assert.equal(rows.length, 1);
  assert.equal(firstPageAttempts, 3);
  assert.deepEqual(progress.slice(0, 3).map(({ phase, attempt, maxAttempts }) => ({ phase, attempt, maxAttempts })), [
    { phase: "fetching-total", attempt: 1, maxAttempts: 3 },
    { phase: "fetching-total", attempt: 2, maxAttempts: 3 },
    { phase: "fetching-total", attempt: 3, maxAttempts: 3 }
  ]);
});

test("NMSE client reports a bounded timeout instead of waiting forever", async () => {
  const fetchImpl = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("aborted")));
  });
  const client = new NmseClient({ serverUrl: "http://nmse.test", fetchImpl, requestTimeoutMs: 5 });
  await assert.rejects(
    () => client.login("tester", "password"),
    /登录超时/
  );
});
