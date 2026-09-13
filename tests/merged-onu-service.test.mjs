import test from "node:test";
import assert from "node:assert/strict";
import {
  createMergedOnuService,
  projectNmseMergeRows,
  selectMergedNmseTargets,
  selectMergedOnuTargets
} from "../src/merged-onu-service.mjs";

test("merged ONU target selection keeps mapping and existing errors", () => {
  const olts = [
    { id: "olt-a", host: "192.0.2.10", enabled: true },
    { id: "olt-b", host: "192.0.2.11", enabled: false }
  ];
  assert.deepEqual(
    selectMergedOnuTargets(olts, [{ oltIp: "192.0.2.10", resourceIp: "198.51.100.10" }]),
    [{ target: olts[0], mapping: { oltIp: "192.0.2.10", resourceIp: "198.51.100.10" } }]
  );
  assert.throws(
    () => selectMergedOnuTargets(olts, []),
    (error) => error.status === 409 && error.message === "以下 OLT 缺少网管二期 IP 映射：olt-a"
  );
  assert.throws(
    () => selectMergedNmseTargets([{ id: "olt-a", enabled: false }]),
    (error) => error.status === 409 && error.message === "没有可同步的已启用 OLT。"
  );

  // 验证：已存在部分映射时，新增第 8 台 OLT 会智能自动推导，不抛出 409
  const withEighthOlt = [
    { id: "olt-7", host: "172.19.106.51", enabled: true },
    { id: "olt-8", host: "172.19.106.52", enabled: true }
  ];
  const derived = selectMergedOnuTargets(withEighthOlt, [
    { oltIp: "172.19.106.51", resourceIp: "22.0.6.51" }
  ]);
  assert.equal(derived.length, 2);
  assert.equal(derived[0].mapping.resourceIp, "22.0.6.51");
  assert.equal(derived[1].mapping.resourceIp, "22.0.6.52");
  assert.equal(derived[1].mapping.source, "auto-derived");
});

test("NMSE projection keeps only the merge-row fields", () => {
  assert.deepEqual(projectNmseMergeRows([{
    onuIndexName: "1/2/3:4",
    loid: "L-1",
    username: "用户",
    userPhone: "电话",
    installationAddress: "地址",
    mac: "must-not-pass",
    token: "must-not-pass"
  }], "192.0.2.10"), [{
    oltIp: "192.0.2.10",
    onuIndex: "1/2/3:4",
    loid: "L-1",
    username: "用户",
    userPhone: "电话",
    installationAddress: "地址"
  }]);
});

test("injected local-user reader is called once per OLT and projected", async () => {
  const calls = [];
  const service = createMergedOnuService({
    readLocalUsers: async ({ oltIp }) => {
      calls.push(oltIp);
      return [{ onuIndex: "1/2/3:4", username: `用户-${oltIp}`, raw: "drop" }];
    }
  });
  const rows = await service.readLocalUsersAsMergeRows([
    { oltIp: "192.0.2.10", rows: [] },
    { oltIp: "192.0.2.11", rows: [] }
  ]);
  assert.deepEqual(calls, ["192.0.2.10", "192.0.2.11"]);
  assert.deepEqual(rows, [
    { oltIp: "192.0.2.10", onuIndex: "1/2/3:4", loid: "", username: "用户-192.0.2.10", userPhone: "", installationAddress: "" },
    { oltIp: "192.0.2.11", onuIndex: "1/2/3:4", loid: "", username: "用户-192.0.2.11", userPhone: "", installationAddress: "" }
  ]);
});
