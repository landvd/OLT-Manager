import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createFeishuQueryApplication, judgePonSamples, sampleOpticalComparison } from "../src/feishu/application.mjs";
import { emptyFeishuState } from "../src/feishu/state.mjs";

const require = createRequire(import.meta.url);
const { renderReply } = require("../src/feishu/production-runtime.cjs");

test("多户抽测判断：多数变差为光路问题，少数变差为用户侧，只有 1 户为样本不足", () => {
  assert.deepEqual(judgePonSamples([]), { judgement: "no-history", compared: 0, degraded: 0 });
  assert.equal(judgePonSamples([-0.5, 0.3, -1.9]).judgement, "normal");
  assert.equal(judgePonSamples([-3]).judgement, "single-degraded");
  assert.equal(judgePonSamples([-3, -2.5, -2.2, -0.4, -2.1]).judgement, "pon-degraded");
  assert.equal(judgePonSamples([-3, -2.5, -2.2, -0.4, -0.1]).judgement, "pon-degraded");
  assert.equal(judgePonSamples([-4, -0.2, 0.1, -0.5, -0.3]).judgement, "user-side");
  assert.equal(judgePonSamples([-4, -0.2]).judgement, "user-side");
});

test("抽测用户的“之前”取 24 小时以前历史的中位数，避开断纤期间与刚抢修的读数", () => {
  const sample = { liveStatus: { observedAt: "2026-10-10T08:00:00.000Z", status: { rxPower: "-24 dBm" } } };
  const history = { source: "oss-ngb", rows: [
    { reportTime: "2026-10-10T06:00:00.000Z", rxOptical: -24.1 },
    { reportTime: "2026-10-09T05:00:00.000Z", rxOptical: -20 },
    { reportTime: "2026-10-08T05:00:00.000Z", rxOptical: -20.4 },
    { reportTime: "2026-10-07T05:00:00.000Z", rxOptical: -35 }
  ] };
  const comparison = sampleOpticalComparison(sample, history);
  assert.equal(comparison.historicalMethod, "median-24h");
  // 24 小时以前有 -20、-20.4、-35 三条，中位数 -20.4，偶发的 -35 异常读数不影响结果。
  assert.equal(comparison.historical, -20.4);
  assert.equal(comparison.difference, -3.6);
  const recentOnly = sampleOpticalComparison(sample, { rows: [{ reportTime: "2026-10-10T06:00:00.000Z", rxOptical: -21 }] });
  assert.equal(recentOnly.historicalMethod, "latest");
  assert.equal(recentOnly.historical, -21);
});

function store() {
  let value = { ...emptyFeishuState(), enabled: true };
  return { async read() { return structuredClone(value); }, async write(next) { value = structuredClone(next); } };
}

// 一个 PON 口，6 个在线用户；currentByOnu 决定各户当前收光，之前统一为 -20 dBm。
function runVillage(currentByOnu) {
  const sampleCalls = [];
  const sent = [];
  const done = new Promise((resolve) => {
    const gateway = {
      async listOlts() { return [{ oltId: "olt-1", name: "OLT 1", enabled: true }]; },
      async queryUsers() { return { authorizedCount: 0, candidates: [] }; },
      async queryPons() { return { authorizedCount: 0, candidates: [] }; },
      async queryVillagePons(request) {
        return { total: 1, authorizedCount: 1, offset: request.offset, limit: 5, hasMore: false,
          candidates: [{ candidateId: "pon-1", oltId: "olt-1", oltName: "OLT 1", address: "示例光交", pon: { chassis: "1", board: "2", pon: "3" } }] };
      },
      async sampleVillagePonOnlineUser(request) {
        sampleCalls.push(request);
        const excluded = new Set(request.excludeOnuIds || []);
        const onuId = Object.keys(currentByOnu).find((id) => !excluded.has(id));
        if (!onuId) return { candidate: null, liveStatus: null, ponStatus: { status: "has-online" } };
        return {
          candidate: { candidateId: `u-${onuId}`, oltId: "olt-1", name: `用户${onuId}`, phone: "", address: "示例村", loid: "", mac: "",
            onu: { chassis: "1", board: "2", pon: "3", onuId } },
          liveStatus: { oltId: "olt-1", onu: { chassis: "1", board: "2", pon: "3", onuId },
            status: { phase: "online", rxPower: `${currentByOnu[onuId]} dBm` }, observedAt: "2026-10-10T08:00:00.000Z" },
          ponStatus: { status: "has-online" }
        };
      },
      async readOnuHistoricalOptical() {
        return { source: "oss-ngb", rows: [{ reportTime: "2026-10-09T05:00:00.000Z", rxOptical: -20 }] };
      }
    };
    const app = createFeishuQueryApplication({
      stateStore: store(), gateway,
      interpret: async () => { throw new Error("应由本地规则识别"); },
      now: () => "2026-10-10T08:00:00.000Z",
      send: async (_chatId, reply) => { sent.push(reply); if (reply.kind === "village-pon-summary") resolve(reply); }
    });
    void app.handleMessage({ eventId: `multi-${Object.values(currentByOnu).join("_")}`, openId: "ou-1", chatId: "oc-1", text: "查示例村抢修情况" });
  });
  return done.then((summary) => ({ summary, sampleCalls }));
}

test("多户抽测：第 1 户没超过 2 dB 就结束，不再加测", async () => {
  const { summary, sampleCalls } = await runVillage({ 1: -20.2, 2: -26, 3: -26, 4: -26, 5: -26, 6: -26 });
  assert.equal(sampleCalls.length, 1);
  assert.equal(summary.repairVerdict, "pass");
});

test("多户抽测：第 1 户超过 2 dB 才加测到 5 户，多数变差判为光路 / 熔接问题", async () => {
  const { summary, sampleCalls } = await runVillage({ 1: -23, 2: -20.1, 3: -22.6, 4: -23.4, 5: -22.9, 6: -20 });
  assert.equal(sampleCalls.length, 5);
  assert.equal(summary.repairVerdict, "warning");
  assert.match(summary.repairVerdictText, /1 个 PON 口多数抽测用户同时比之前差 2 dB 以上/);
  const finding = summary.findings[0];
  assert.equal(finding.sampling.judgement, "pon-degraded");
  assert.equal(finding.sampling.comparedCount, 5);
  assert.equal(finding.sampling.degradedCount, 4);
  const card = JSON.stringify(renderReply({ ...summary, view: "pons" }).content);
  assert.match(card, /抽测 5 户，4 户比之前差 2 dB 以上/);
  assert.match(card, /多数变差，疑似光路/);
});

test("多户抽测：只有个别用户变差判为用户侧原因，不要求重熔", async () => {
  const { summary } = await runVillage({ 1: -25, 2: -20.1, 3: -20.3, 4: -19.9, 5: -20.4, 6: -20 });
  assert.equal(summary.repairVerdict, "isolated");
  assert.match(summary.repairVerdictText, /多半是用户侧原因/);
  assert.equal(summary.findings[0].classification, "user");
  assert.equal(summary.abnormalCount, 0);
  assert.equal(summary.userSideCount, 1);
  assert.deepEqual(summary.degradedSamples, []);
  assert.match(JSON.stringify(renderReply(summary).content), /1 个口只有个别用户变差（用户侧）/);
});
