import test from "node:test";
import assert from "node:assert/strict";
import {
  createProductionLanguageProvider,
  normalizeLanguageProviderEndpoint,
  normalizeProviderFormat
} from "../src/feishu/production-language-provider.mjs";

const input = {
  contractVersion: "1",
  currentText: "查询条件不明确",
  allowedIntents: ["find_by_name", "find_by_address"]
};

test("production language provider sends only the interpretation contract and parses Chat Completions", async () => {
  let request;
  const provider = createProductionLanguageProvider({
    endpoint: "https://provider.example/v1",
    model: "model-1",
    credentialReference: "feishu-provider-key-test",
    readSecret: async (reference) => {
      assert.equal(reference, "feishu-provider-key-test");
      return "api-secret-that-must-not-be-returned";
    },
    request: async (url, options) => {
      request = { url, options };
      return { choices: [{ message: { content: '{"type":"query","version":"1","intent":"find_by_name","value":"陈日良"}' } }] };
    }
  });
  const result = await provider(input);
  assert.deepEqual(result, { type: "query", version: "1", intent: "find_by_name", value: "陈日良" });
  assert.equal(request.url, "https://provider.example/v1/chat/completions");
  assert.equal(request.options.headers.authorization, "Bearer api-secret-that-must-not-be-returned");
  assert.equal(request.options.body.model, "model-1");
  assert.match(request.options.body.messages[0].content, /只允许返回/);
  assert.match(request.options.body.messages[0].content, /find_by_name: 用户姓名/);
  assert.match(request.options.body.messages[0].content, /王柏权/);
  assert.match(request.options.body.messages[1].content, /查询条件不明确/);
  assert.doesNotMatch(JSON.stringify(result), /api-secret/);
});

test("production language provider locally treats a bare Chinese name as a name query", async () => {
  let secretReads = 0;
  let requests = 0;
  const provider = createProductionLanguageProvider({
    endpoint: "https://provider.example/v1",
    model: "model-1",
    credentialReference: "feishu-provider-key-test",
    readSecret: async () => {
      secretReads += 1;
      return "api-secret";
    },
    request: async () => {
      requests += 1;
      return { choices: [{ message: { content: "{}" } }] };
    }
  });

  const result = await provider({
    contractVersion: "1",
    currentText: "王柏权",
    allowedIntents: ["find_by_name", "find_by_phone", "find_by_address"]
  });

  assert.deepEqual(result, { type: "query", version: "1", intent: "find_by_name", value: "王柏权" });
  assert.equal(secretReads, 0);
  assert.equal(requests, 0);
});

test("production language provider locally treats numbered Chinese addresses as PON address queries", async () => {
  let requests = 0;
  const provider = createProductionLanguageProvider({
    endpoint: "https://provider.example/v1",
    model: "model-1",
    credentialReference: "feishu-provider-key-test",
    readSecret: async () => "api-secret",
    request: async () => {
      requests += 1;
      return { choices: [{ message: { content: "{}" } }] };
    }
  });

  for (const currentText of ["公园街", "公园街6号", "中山路12号", "花园巷3栋"]) {
    const result = await provider({
      contractVersion: "1",
      currentText,
      allowedIntents: ["find_by_name", "find_by_address", "find_pon_by_address"]
    });
    assert.deepEqual(result, {
      type: "query",
      version: "1",
      intent: "find_pon_by_address",
      value: currentText
    });
  }

  assert.equal(requests, 0);
});

test("production language provider parses native Responses output and rejects extra fields", async () => {
  const provider = createProductionLanguageProvider({
    endpoint: "https://provider.example/v1",
    model: "model-2",
    format: "responses",
    credentialReference: "ref-2",
    readSecret: async () => "secret",
    request: async (url, options) => {
      assert.equal(url, "https://provider.example/v1/responses");
      assert.equal(options.body.store, false);
      return { output_text: '{"type":"clarification","version":"1","question":"请补充地址"}' };
    }
  });
  assert.deepEqual(await provider(input), { type: "clarification", version: "1", question: "请补充地址" });

  const invalid = createProductionLanguageProvider({
    endpoint: "https://provider.example/v1",
    model: "model-2",
    credentialReference: "ref-2",
    readSecret: async () => "secret",
    request: async () => ({ choices: [{ message: { content: '{"type":"query","version":"1","intent":"find_by_name","value":"用户","apiKey":"leak"}' } }] })
  });
  await assert.rejects(() => invalid(input), /超出约定结构/);
});

test("production language provider coerces MiniMax to Chat Completions", async () => {
  let requestUrl = "";
  let requestBody = null;
  const provider = createProductionLanguageProvider({
    providerName: "MiniMax",
    endpoint: "https://api.minimaxi.com/v1",
    model: "MiniMax-M2.7-highspeed",
    format: "responses",
    credentialReference: "ref-minimax",
    readSecret: async () => "secret",
    request: async (url, options) => {
      requestUrl = url;
      requestBody = options.body;
      return { choices: [{ message: { content: '{"type":"query","version":"1","intent":"find_by_address","value":"山仔村"}' } }] };
    }
  });

  assert.deepEqual(await provider({
    contractVersion: "1",
    currentText: "查询条件不明确",
    allowedIntents: ["find_by_address"]
  }), { type: "query", version: "1", intent: "find_by_address", value: "山仔村" });
  assert.equal(requestUrl, "https://api.minimaxi.com/v1/chat/completions");
  assert.ok(Array.isArray(requestBody.messages));
  assert.equal(requestBody.input, undefined);
  assert.equal(normalizeProviderFormat({
    providerName: "MiniMax",
    endpoint: "https://api.minimaxi.com/v1",
    model: "MiniMax-M2.7-highspeed",
    format: "responses"
  }), "chat-completions");
});

test("production language provider rejects unsafe endpoint URLs", () => {
  assert.equal(normalizeLanguageProviderEndpoint("http://127.0.0.1:15721/v1"), "http://127.0.0.1:15721/v1");
  assert.throws(() => normalizeLanguageProviderEndpoint("http://provider.example/v1"), /HTTPS/);
  assert.throws(() => normalizeLanguageProviderEndpoint("https://provider.example/v1?api_key=secret"), /查询参数/);
});
