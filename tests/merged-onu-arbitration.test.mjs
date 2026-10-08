import test from "node:test";
import assert from "node:assert/strict";
import {
  scoreNmseCandidate,
  arbitrateNmseCandidates,
  mergeOnuDatasets
} from "../src/merged-onu-sync.mjs";

test("scoreNmseCandidate awards high score for matching OLT coordinates and active phones", () => {
  const networkRow = {
    oltIp: "192.168.1.1",
    chassis: "1",
    board: "2",
    pon: "5",
    onuId: "3",
    username: "张三",
    loid: "LOID-001"
  };

  const perfectMatch = {
    oltIp: "192.168.1.1",
    coordinate: { chassis: "1", board: "2", pon: "5", onuId: "3" },
    username: "张三",
    userPhone: "13800138000",
    installationAddress: "厚街镇厚街村东路15号",
    loid: "LOID-001"
  };

  const outdatedCancelRow = {
    oltIp: "192.168.1.1",
    coordinate: { chassis: "1", board: "2", pon: "5", onuId: "3" },
    username: "张三(已销户测试)",
    userPhone: "",
    installationAddress: "历史作废地址",
    loid: "LOID-001"
  };

  const score1 = scoreNmseCandidate(perfectMatch, networkRow);
  const score2 = scoreNmseCandidate(outdatedCancelRow, networkRow);

  assert.ok(score1.score > 100);
  assert.ok(score1.reasons.some((r) => r.includes("坐标完全一致")));
  assert.ok(score1.reasons.some((r) => r.includes("11位手机号")));
  assert.ok(score2.reasons.some((r) => r.includes("包含销户/测试标记")));
  assert.ok(score1.score > score2.score);
});

test("arbitrateNmseCandidates autonomously selects best candidate without human intervention", () => {
  const networkRow = {
    oltIp: "10.0.0.1",
    chassis: "1",
    board: "1",
    pon: "1",
    onuId: "1",
    loid: "LOID-DUP",
    username: "李"
  };

  const candidates = [
    {
      oltIp: "10.0.0.99",
      coordinate: { chassis: "1", board: "8", pon: "8", onuId: "8" },
      username: "李明",
      userPhone: "13911112222",
      installationAddress: "新村路10号",
      loid: "LOID-DUP"
    },
    {
      oltIp: "10.0.0.1",
      coordinate: { chassis: "1", board: "1", pon: "1", onuId: "1" },
      username: "李先生",
      userPhone: "13900001111",
      installationAddress: "厚街村中路1号",
      loid: "LOID-DUP"
    },
    {
      oltIp: "10.0.0.2",
      coordinate: { chassis: "1", board: "2", pon: "2", onuId: "2" },
      username: "王五(销户)",
      userPhone: "",
      installationAddress: "",
      loid: "LOID-DUP"
    }
  ];

  const arbitrated = arbitrateNmseCandidates(networkRow, candidates, { matchType: "loid" });
  assert.equal(arbitrated.winner.username, "李先生");
  assert.equal(arbitrated.winner.userPhone, "13900001111");
  assert.ok(arbitrated.strategy.includes("坐标完全一致"));
});

test("mergeOnuDatasets autonomously resolves LOID duplicate conflicts and populates merged row", () => {
  const networkRows = [
    {
      oltIp: "172.19.10.51",
      onuIndex: "1/2/5:3",
      loid: "ZTEG030C0914",
      username: "王"
    }
  ];

  const nmseRows = [
    {
      oltIp: "172.19.10.99",
      onuIndex: "1/1/1:1",
      loid: "ZTEG030C0914",
      username: "旧用户(已停机)",
      userPhone: "0769-88888888",
      installationAddress: "旧机房地址"
    },
    {
      oltIp: "172.19.10.51",
      onuIndex: "1/2/5:3",
      loid: "ZTEG030C0914",
      username: "王建国",
      userPhone: "13822223333",
      installationAddress: "厚街双岗村东路88号"
    }
  ];

  const result = mergeOnuDatasets(networkRows, nmseRows);

  // 1. 数据行成功合并，采纳了胜出的王建国
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].username, "王建国");
  assert.equal(result.rows[0].userPhone, "13822223333");
  assert.equal(result.rows[0].installationAddress, "厚街双岗村东路88号");
  assert.equal(result.rows[0].usernameSource, "nmse");

  // 2. 冲突审计记录明确写明已自主裁决，无须人工介入
  const dupConflict = result.conflicts.find((c) => c.reason === "nmse_loid_duplicate" && c.detail.includes("自主裁决采纳"));
  assert.ok(dupConflict);
  assert.match(dupConflict.detail, /王建国/);
  assert.match(dupConflict.detail, /无须人工介入/);
});

test("mergeOnuDatasets autonomously resolves ambiguous coordinates when LOID is missing", () => {
  const networkRows = [
    {
      oltIp: "172.19.10.51",
      onuIndex: "1/3/2:1",
      loid: "",
      username: "陈"
    }
  ];

  const nmseRows = [
    {
      oltIp: "172.19.10.51",
      onuIndex: "1/3/2:1",
      loid: "",
      username: "陈志强",
      userPhone: "13799998888",
      installationAddress: "厚街陈家坊2号"
    },
    {
      oltIp: "172.19.10.51",
      onuIndex: "1/3/2:1",
      loid: "",
      username: "测试用户(历史拆机)",
      userPhone: "",
      installationAddress: ""
    }
  ];

  const result = mergeOnuDatasets(networkRows, nmseRows);

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].username, "陈志强");
  assert.equal(result.rows[0].userPhone, "13799998888");
  assert.equal(result.rows[0].installationAddress, "厚街陈家坊2号");

  const ambConflict = result.conflicts.find((c) => c.reason === "nmse_coordinate_ambiguous" && c.detail.includes("自主裁决采纳"));
  assert.ok(ambConflict);
  assert.match(ambConflict.detail, /陈志强/);
});
