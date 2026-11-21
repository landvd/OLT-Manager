// 飞书卡片按钮令牌落库（ADR-094）：程序重启后，定额卡片 3 天内、用户查询卡片 1 天内仍能点。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildPriceBookWorkbook, buildTemplateWorkbook } from "./fixtures/quota-fixtures.mjs";

process.env.OLT_MANAGER_DATA_DIR = await mkdtemp(join(tmpdir(), "olt-card-bindings-"));

const db = await import("../src/db.mjs");
const { CardBindings } = await import("../src/feishu/card-bindings.mjs");
const { createFeishuQueryApplication } = await import("../src/feishu/application.mjs");
const { createQuotaService } = await import("../src/quota/quota-service.mjs");
const { emptyFeishuState } = await import("../src/feishu/state.mjs");

await db.initDb();
const cardStore = { save: db.saveCardBinding, load: db.getCardBinding, purge: db.purgeExpiredCardBindings };

test("令牌写进数据库：重启后读回来，集合还原，处理中标记清空；过期的读不到也会被删除", async () => {
  let now = "2026-11-10T00:00:00.000Z";
  const first = new CardBindings({ store: cardStore, scope: "query", now: () => now });
  first.set("tok-1", {
    type: "candidate-set", chatId: "oc-1", expiresAt: "2026-11-11T00:00:00.000Z",
    candidates: [{ name: "用户" }], usedIndexes: new Set([1]), processingIndexes: new Set([0]), processing: true
  });
  first.set("tok-old", { type: "candidate-set", expiresAt: "2026-11-10T00:00:01.000Z" });
  await first.flush();

  const restarted = new CardBindings({ store: cardStore, scope: "query", now: () => now });
  assert.equal(restarted.get("tok-1"), undefined);
  const value = await restarted.hydrate("tok-1");
  assert.deepEqual(value.candidates, [{ name: "用户" }]);
  assert.deepEqual([...value.usedIndexes], [1]);
  assert.deepEqual([...value.processingIndexes], []);
  assert.equal(value.processing, undefined);
  assert.equal(restarted.get("tok-1"), value);
  // 别的范围（定额）读不到查询卡片的令牌
  assert.equal(await new CardBindings({ store: cardStore, scope: "quota", now: () => now }).hydrate("tok-1"), undefined);

  // 改动写回去
  value.usedIndexes.add(0);
  await restarted.persist("tok-1");
  const again = await new CardBindings({ store: cardStore, scope: "query", now: () => now }).hydrate("tok-1");
  assert.deepEqual([...again.usedIndexes].sort(), [0, 1]);

  now = "2026-11-10T00:00:02.000Z";
  assert.equal(await new CardBindings({ store: cardStore, scope: "query", now: () => now }).hydrate("tok-old"), undefined);
  await db.purgeExpiredCardBindings({ now });
  assert.equal(await db.getCardBinding({ token: "tok-old", scope: "query", now: "2000-01-01T00:00:00.000Z" }), null);
});

function queryApp(now) {
  let state = { ...emptyFeishuState(), enabled: true };
  return createFeishuQueryApplication({
    stateStore: { read: async () => structuredClone(state), write: async (next) => { state = structuredClone(next); } },
    gateway: {
      async listOlts() { return [{ oltId: "olt-1", name: "OLT 1", vendor: "zte", model: "C300", enabled: true }]; },
      async queryUsers() {
        return { authorizedCount: 2, candidates: [1, 2].map((index) => ({
          candidateId: `olt-1:1/7/8:${index}`, oltId: "olt-1", name: `用户${index}`, phone: "", address: "地址",
          primaryAddress: "一级地址", loid: "", mac: "", onu: { chassis: "1", board: "7", pon: "8", onuId: String(index) }, snapshotAt: null
        })) };
      },
      async queryPons() { return { authorizedCount: 0, candidates: [] }; },
      async readOnuDetail(request) {
        return {
          oltId: "olt-1", onu: request.coordinate, observedAt: "2026-11-10T00:00:01.000Z", unsupportedFields: [],
          status: { phase: "online", rxPower: "-20 dBm", distance: "1 km", serial: "SN-1", name: "用户" },
          detail: { interface: "1/7/8/1", name: "用户", phaseState: "在线", serialNumber: "SN-1", opticalRxPower: "-20 dBm", distance: "1 km", lastOnlineTime: null, lastOfflineTime: null, lastOfflineCause: null, lastOfflineCauseCode: null }
        };
      }
    },
    interpret: async () => ({ type: "query", version: "1", intent: "find_by_name", value: "用户" }),
    cardBindingStore: cardStore,
    now: () => now.value
  });
}

const click = (app, eventId, token, index) => app.handleCallback({
  eventId, kind: "callback", verifiedByTransport: true, openId: "ou-1", chatId: "oc-direct", binding: { token, index }
});

test("用户查询卡片：程序重启后 1 天内还能点，用过的候选仍记得，超过 1 天提示失效", async () => {
  const now = { value: "2026-11-10T08:00:00.000Z" };
  const morning = queryApp(now);
  const candidates = await morning.handleMessage({ eventId: "q-1", openId: "ou-1", chatId: "oc-direct", text: "查用户" });
  assert.equal(candidates.kind, "candidate-set");
  assert.equal(candidates.selection.expiresAt, "2026-11-11T08:00:00.000Z");
  assert.equal((await click(morning, "c-1", candidates.selection.token, 0)).kind, "onu-detail");
  await new Promise((resolve) => setTimeout(resolve, 50));

  // 晚上程序重启过：新实例从数据库读回令牌
  now.value = "2026-11-10T20:00:00.000Z";
  const evening = queryApp(now);
  assert.equal((await click(evening, "c-2", candidates.selection.token, 1)).kind, "onu-detail");
  assert.equal((await click(evening, "c-3", candidates.selection.token, 0)).kind, "duplicate-callback");

  now.value = "2026-11-11T08:00:01.000Z";
  const nextDay = queryApp(now);
  assert.equal((await click(nextDay, "c-4", candidates.selection.token, 1)).kind, "invalid-callback");
});

test("定额卡片：程序重启后 3 天内还能点，超过 3 天提示过期", async () => {
  const quotaService = createQuotaService({ repo: db, now: () => new Date(2026, 10, 10, 10, 0) });
  await quotaService.importTemplate({ fileName: "模板.xlsx", buffer: buildTemplateWorkbook() });
  await quotaService.importMaterials({ fileName: "单价.xlsx", buffer: buildPriceBookWorkbook() });
  let clock = Date.parse("2026-11-10T02:00:00.000Z");
  const makeApp = () => {
    let state = { ...emptyFeishuState(), enabled: true };
    return createFeishuQueryApplication({
      stateStore: { read: async () => structuredClone(state), write: async (next) => { state = structuredClone(next); } },
      gateway: { listOlts: async () => [], queryUsers: async () => ({ authorizedCount: 0, candidates: [] }), queryPons: async () => ({ authorizedCount: 0, candidates: [] }) },
      interpret: async () => ({ type: "clarification", version: 1, question: "请补充" }),
      quotaService,
      cardBindingStore: cardStore,
      now: () => new Date((clock += 3000)).toISOString()
    });
  };
  let counter = 0;
  const press = (app, reply, action, extra = {}) => app.handleCallback({
    eventId: `qc-${counter += 1}`, openId: "ou-1", chatId: "oc-1", messageId: "om-card", verifiedByTransport: true,
    binding: { token: reply.action.token, index: 0, action, expiresAt: reply.action.expiresAt }, ...extra
  });

  const first = makeApp();
  const home = await first.handleMessage({ eventId: "qm-1", openId: "ou-1", chatId: "oc-1", kind: "direct", text: "定额模式" });
  const form = await press(first, home, "quota-new");
  const summary = await press(first, form, "quota-create-submit", { formValue: { preset: form.presets[0].id, projectName: "隔天修改", location: "测试", preparer: "张三", reviewer: "李四" } });
  assert.equal(summary.kind, "quota-summary");
  // 测试时钟每取一次前进 3 秒，所以只核对约等于 3 天
  assert.ok(Math.abs(Date.parse(summary.action.expiresAt) - clock - 3 * 24 * 3600 * 1000) < 60000);
  await new Promise((resolve) => setTimeout(resolve, 50));
  // 同一张表单重启后再提交：仍记得已经提交过
  clock += 2 * 24 * 3600 * 1000;
  const restarted = makeApp();
  assert.match((await press(restarted, form, "quota-create-submit", { formValue: { preset: form.presets[0].id, projectName: "隔天修改", location: "测试", preparer: "张三", reviewer: "李四" } })).message, /已经提交过/);
  // 两天后清单卡片上的“＋人工”照样能用
  assert.equal((await press(restarted, summary, "quota-add-quota")).kind, "quota-picker");

  clock += 1 * 24 * 3600 * 1000 + 60000;
  const later = makeApp();
  assert.match((await press(later, summary, "quota-add-quota")).message, /已过期/);
});
