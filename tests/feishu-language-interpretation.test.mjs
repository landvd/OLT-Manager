import test from "node:test";
import assert from "node:assert/strict";
import { createFeishuQueryApplication } from "../src/feishu/application.mjs";
import {
  createSyntheticLanguageProvider,
  SYNTHETIC_DATASET_ATTESTATION_REQUIRED,
  isFeishuHelpRequest,
  FEISHU_HELP_MESSAGE
} from "../src/feishu/language-interpretation.mjs";
import { emptyFeishuState } from "../src/feishu/state.mjs";

function stateStore(language = {}) {
  let value = {
    ...emptyFeishuState(),
    enabled: true,
    operators: [{ openId: "ou-1", oltIds: ["olt-1"] }],
    authorizedChats: [{ chatId: "oc-1", type: "direct" }],
    language: { provider: "synthetic", syntheticDatasetAttestation: null, ...language }
  };
  return {
    async read() { return structuredClone(value); },
    async write(next) { value = structuredClone(next); },
    value() { return structuredClone(value); }
  };
}

function gateway() {
  return {
    async status() { return { contractVersion: "1", readOnly: true, datasetRevision: "rev-1" }; },
    async listOlts() {
      return [{ oltId: "olt-1", name: "OLT 1", vendor: "zte", model: "C300", enabled: true }];
    },
    async queryUsers(request) {
      return {
        authorizedCount: 1,
        candidates: [{
          candidateId: "olt-1:1/7/8:1", oltId: request.oltIds[0], name: "陈日良",
          phone: "18925718632", address: "保和圩村前路25号", loid: "", mac: "",
          onu: { chassis: "1", board: "7", pon: "8", onuId: "1" }, snapshotAt: "2026-08-05T00:00:00.000Z"
        }]
      };
    },
    async queryPons() { return { authorizedCount: 0, candidates: [] }; }
  };
}

function attestation() {
  return { state: "confirmed", datasetRevision: "rev-1", confirmedAt: "2026-08-05T00:00:00.000Z" };
}

test("Feishu help matcher recognizes help commands without treating query text as help", () => {
  assert.equal(isFeishuHelpRequest("帮助"), true);
  assert.equal(isFeishuHelpRequest("help!"), true);
  assert.equal(isFeishuHelpRequest("查询帮助。"), true);
  assert.equal(isFeishuHelpRequest("帮助王柏权"), false);
  assert.match(FEISHU_HELP_MESSAGE, /ONU 设备号/);
});

test("synthetic provider interprets only attested text rules", async () => {
  const provider = createSyntheticLanguageProvider({
    datasetRevision: async () => "rev-1",
    readAttestation: async () => attestation(),
    rules: [
      { match: "查陈日良", result: { type: "query", version: "1", intent: "find_by_name", value: "陈日良" } }
    ]
  });
  assert.deepEqual(await provider({
    contractVersion: "1", currentText: "查陈日良", allowedIntents: ["find_by_name"]
  }), { type: "query", version: "1", intent: "find_by_name", value: "陈日良" });
  assert.deepEqual(await provider({
    contractVersion: "1", currentText: "没有配置规则", allowedIntents: ["find_by_name"]
  }), { type: "clarification", version: "1", question: "请补充姓名、电话、地址或 ONU 标识。" });
});

test("synthetic provider fails closed when dataset attestation changes", async () => {
  const provider = createSyntheticLanguageProvider({
    datasetRevision: async () => "rev-2",
    readAttestation: async () => attestation(),
    rules: []
  });
  await assert.rejects(
    () => provider({ contractVersion: "1", currentText: "查陈日良", allowedIntents: ["find_by_name"] }),
    (error) => error.code === SYNTHETIC_DATASET_ATTESTATION_REQUIRED
  );
});

test("synthetic provider rejects output outside the versioned contract", async () => {
  const provider = createSyntheticLanguageProvider({
    datasetRevision: async () => "rev-1",
    readAttestation: async () => attestation(),
    rules: [{
      match: "越权",
      result: { type: "query", version: "1", intent: "find_by_name", value: "用户", secret: "不要返回" }
    }]
  });
  await assert.rejects(
    () => provider({ contractVersion: "1", currentText: "越权", allowedIntents: ["find_by_name"] }),
    /Invalid synthetic Language Interpretation result/
  );
});

test("attested synthetic text query reaches the application and returns a candidate set", async () => {
  const store = stateStore({ syntheticDatasetAttestation: attestation() });
  const provider = createSyntheticLanguageProvider({
    datasetRevision: async () => "rev-1",
    readAttestation: async () => store.value().language.syntheticDatasetAttestation,
    rules: [
      { match: "查陈日良", result: { type: "query", version: "1", intent: "find_by_name", value: "陈日良" } }
    ]
  });
  const replies = [];
  const app = createFeishuQueryApplication({
    stateStore: store,
    gateway: gateway(),
    interpret: provider,
    send: async (_chatId, reply) => replies.push(reply)
  });
  const result = await app.handleMessage({
    eventId: "evt-attested", openId: "ou-1", chatId: "oc-1", text: "查陈日良"
  });
  assert.equal(result.kind, "candidate-set");
  assert.equal(replies[0].candidates[0].name, "陈日良");
});

test("synthetic query is rejected before interpretation when attestation is missing", async () => {
  const store = stateStore();
  let interpretationCalls = 0;
  const app = createFeishuQueryApplication({
    stateStore: store,
    gateway: gateway(),
    interpret: async () => { interpretationCalls += 1; return null; }
  });
  const result = await app.handleMessage({
    eventId: "evt-unattested", openId: "ou-1", chatId: "oc-1", text: "查陈日良"
  });
  assert.equal(result.kind, "attestation-required");
  assert.equal(interpretationCalls, 0);
});

test("attested synthetic query returns no-match without inventing candidates", async () => {
  const store = stateStore({ syntheticDatasetAttestation: attestation() });
  const app = createFeishuQueryApplication({
    stateStore: store,
    gateway: {
      ...gateway(),
      async queryUsers() { return { authorizedCount: 0, candidates: [] }; }
    },
    interpret: createSyntheticLanguageProvider({
      datasetRevision: async () => "rev-1",
      readAttestation: async () => attestation(),
      rules: [{ match: "查不存在", result: { type: "query", version: "1", intent: "find_by_name", value: "不存在" } }]
    })
  });
  const result = await app.handleMessage({
    eventId: "evt-no-match", openId: "ou-1", chatId: "oc-1", text: "查不存在"
  });
  assert.deepEqual(result, { kind: "no-match", message: "没有找到匹配项" });
});
