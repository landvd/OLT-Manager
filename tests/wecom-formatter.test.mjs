import test from "node:test";
import assert from "node:assert/strict";
import {
  formatOpticalPower,
  formatTelLink,
  renderWelcomeText,
  renderHelpMarkdown,
  renderOnuDetailMarkdown,
  renderPonStatusMarkdown,
  renderVillageReportMarkdown,
  renderCandidatesMarkdown,
  renderPiAgentAnswerMarkdown
} from "../src/wecom/formatter.mjs";

test("formatOpticalPower categorizes optical power into normal, warning, danger", () => {
  assert.equal(formatOpticalPower(-19.5).level, "good");
  assert.match(formatOpticalPower(-19.5).text, /🟢/);
  assert.equal(formatOpticalPower(-25.2).level, "warning");
  assert.match(formatOpticalPower(-25.2).text, /🟠/);
  assert.equal(formatOpticalPower(-28.5).level, "danger");
  assert.match(formatOpticalPower(-28.5).text, /🔴/);
  assert.equal(formatOpticalPower(null).level, "unknown");
});

test("formatTelLink wraps valid phone in tel link", () => {
  assert.equal(formatTelLink("13800138000"), "[13800138000](tel:13800138000)");
  assert.equal(formatTelLink("未提供"), "未提供");
});

test("renderWelcomeText returns friendly guidance", () => {
  const text = renderWelcomeText();
  assert.match(text, /日常查单/);
  assert.match(text, /双岗村所有pon口/);
  assert.match(text, /门限速查/);
});

test("renderOnuDetailMarkdown formats user profile, live status and badges", () => {
  const md = renderOnuDetailMarkdown({
    user: { name: "陈仲华", phone: "13800138000", address: "厚街镇双岗村", oltIp: "172.19.104.99" },
    coordinate: "1/5/16:2",
    liveStatus: { online: true, rxPower: -19.5, distance: 1200 }
  });
  assert.match(md, /陈仲华/);
  assert.match(md, /tel:13800138000/);
  assert.match(md, /🟢 在线工作/);
  assert.match(md, /19\.50 dBm/);
  assert.match(md, /1200 米/);
});

test("renderVillageReportMarkdown gives green pass verdict when no degraded PONs", () => {
  const md = renderVillageReportMarkdown("双岗村", {
    totalPons: 36,
    completeCount: 36,
    degradedPons: []
  });
  assert.match(md, /主干熔接质量优秀/);
  assert.match(md, /放心封盒/);
});

test("renderVillageReportMarkdown warns when degraded PONs exist", () => {
  const md = renderVillageReportMarkdown("双岗村", {
    totalPons: 36,
    completeCount: 35,
    degradedPons: [
      { oltIp: "172.19.104.101", slot: "3", pon: "4", currentRx: -26.5, delta: -3.5, area: "双岗南" }
    ]
  });
  assert.match(md, /抢修光衰突变恶化/);
  assert.match(md, /3\.50 dB/);
});

test("renderCandidatesMarkdown renders list of multiple matches", () => {
  const md = renderCandidatesMarkdown([
    { name: "张三", phone: "13800000001", address: "三屯1号", oltIp: "172.19.104.99" },
    { name: "张三", phone: "13800000002", address: "三屯2号", oltIp: "172.19.104.100" }
  ]);
  assert.match(md, /找到 2 条匹配结果/);
  assert.match(md, /三屯1号/);
  assert.match(md, /三屯2号/);
});
