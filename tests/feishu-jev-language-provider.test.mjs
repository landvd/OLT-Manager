import test from "node:test";
import assert from "node:assert/strict";
import { createJevLanguageProvider } from "../src/feishu/jev-language-provider.mjs";

const input = (currentText, allowedIntents = ["find_by_name", "find_by_address"]) => ({
  contractVersion: "1",
  currentText,
  allowedIntents
});

test("Jev provider keeps the local deterministic fast path", async () => {
  let evaluated = false;
  const provider = createJevLanguageProvider({
    readSecret: async () => { throw new Error("must not read the API key"); },
    evaluate: async () => { evaluated = true; throw new Error("must not evaluate"); }
  });

  assert.deepEqual(await provider(input("查张三")), {
    type: "query", version: "1", intent: "find_by_name", value: "张三"
  });
  assert.equal(evaluated, false);
});

test("Jev intent is projected to the existing query contract", async () => {
  let request;
  const provider = createJevLanguageProvider({
    model: "jev-test",
    evaluate: async (value) => {
      request = value;
      return { answers: {
        intent: { choice: "find_by_address", confidence: 0.96 },
        needsClarification: { noul: 0.02 }
      } };
    },
    valueExtractor: ({ intent }) => intent === "find_by_address" ? "阳光花园" : ""
  });

  assert.deepEqual(await provider(input("帮我看看阳光花园那一片")), {
    type: "query", version: "1", intent: "find_by_address", value: "阳光花园"
  });
  assert.deepEqual(request.state, {
    contractVersion: "1",
    currentText: "帮我看看阳光花园那一片",
    allowedIntents: ["find_by_name", "find_by_address"]
  });
  assert.equal(Object.hasOwn(request.state, "apiKey"), false);
});

test("Jev clarification answer is returned as clarification", async () => {
  const provider = createJevLanguageProvider({
    evaluate: async () => ({ answers: {
      intent: { choice: "find_by_name", confidence: 0.95 },
      needsClarification: { noul: 0.9 }
    } })
  });

  assert.deepEqual(await provider(input("帮我查一下")), {
    type: "clarification", version: "1", question: "请补充姓名、电话、地址或 ONU 标识。"
  });
});

test("Jev rejects an out-of-scope intent and an unsafe missing value", async () => {
  const outOfScope = createJevLanguageProvider({
    evaluate: async () => ({ answers: {
      intent: { choice: "find_by_loid", confidence: 0.95 },
      needsClarification: { noul: 0.01 }
    } })
  });
  const noValue = createJevLanguageProvider({
    evaluate: async () => ({ answers: {
      intent: { choice: "find_by_address", confidence: 0.95 },
      needsClarification: { noul: 0.01 }
    } }),
    valueExtractor: () => ""
  });

  for (const provider of [outOfScope, noValue]) {
    assert.deepEqual(await provider(input("无法确定的查询")), {
      type: "clarification", version: "1", question: "请补充姓名、电话、地址或 ONU 标识。"
    });
  }
});

test("Jev uses a bounded residual address value without a value extractor", async () => {
  const provider = createJevLanguageProvider({
    evaluate: async () => ({ answers: {
      intent: { choice: "find_by_address", confidence: 0.91 },
      needsClarification: { noul: 0.04 }
    } })
  });

  assert.deepEqual(await provider(input("帮我看看阳光花园那一片最近7天状态")), {
    type: "query", version: "1", intent: "find_by_address", value: "阳光花园那一片"
  });
});

test("Jev fails closed when the intent confidence is missing or low", async () => {
  for (const confidence of [undefined, 0.2]) {
    const provider = createJevLanguageProvider({
      evaluate: async () => ({ answers: {
        intent: confidence === undefined
          ? { choice: "find_by_address" }
          : { choice: "find_by_address", confidence },
        needsClarification: { noul: 0.01 }
      } })
    });
    assert.deepEqual(await provider(input("帮我看看阳光花园那一片")), {
      type: "clarification", version: "1", question: "请补充姓名、电话、地址或 ONU 标识。"
    });
  }
});
