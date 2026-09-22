import { choice, noul, TypeSafeClient } from "@typesafe-ai/sdk";
import {
  isValidLanguageInterpretationInput,
  isValidLanguageInterpretationOutput,
  LANGUAGE_INTERPRETATION_CONTRACT_VERSION
} from "./language-interpretation.mjs";
import { localInterpretation, residualLanguageValue } from "./production-language-provider.mjs";
import { clone } from "./clone.mjs";

const DEFAULT_MODEL = "jev-latest";
const DEFAULT_CLARIFICATION = "请补充姓名、电话、地址或 ONU 标识。";

function clarification(question = DEFAULT_CLARIFICATION) {
  return {
    type: "clarification",
    version: LANGUAGE_INTERPRETATION_CONTRACT_VERSION,
    question: String(question).trim() || DEFAULT_CLARIFICATION
  };
}

function isJevProviderName(value) {
  const name = String(value ?? "").trim().toLowerCase();
  return name === "jev" || name === "typesafe jev" || name === "typesafe-ai jev";
}

export { isJevProviderName };

function safeValueForIntent(input, intent, valueExtractor) {
  if (typeof valueExtractor === "function") {
    const value = valueExtractor({ ...input, intent });
    return typeof value === "string" && value.trim() ? value.trim() : "";
  }
  const local = localInterpretation({ ...input, allowedIntents: [intent] });
  return local?.intent === intent ? local.value : residualLanguageValue(input, intent);
}

function questionSet(allowedIntents) {
  return {
    intent: choice(
      "从允许的查询意图中选择最匹配的一项；无法确定时选择最接近的意图并由 needsClarification 标记需要澄清。",
      Object.fromEntries(allowedIntents.map((intent) => [intent, null]))
    ),
    needsClarification: noul(
      "用户输入是否缺少安全执行查询所需的明确对象或条件？"
    )
  };
}

export function createJevLanguageProvider({
  credentialReference = "",
  readSecret,
  client,
  evaluate,
  model = DEFAULT_MODEL,
  valueExtractor
} = {}) {
  if (!client && typeof evaluate !== "function" && typeof readSecret !== "function") {
    throw new TypeError("Jev language provider requires a client, evaluator, or secret reader.");
  }

  return async function interpret(input) {
    if (!isValidLanguageInterpretationInput(input)) {
      return clarification("请补充有效的查询内容。");
    }

    const local = localInterpretation(input);
    if (local) return clone(local);

    const state = {
      contractVersion: input.contractVersion,
      currentText: input.currentText,
      allowedIntents: [...input.allowedIntents]
    };
    let result;
    if (typeof evaluate === "function") {
      result = await evaluate({ state, questions: questionSet(input.allowedIntents), model });
    } else {
      const apiKey = String(await readSecret(String(credentialReference).trim()) ?? "").trim();
      if (!apiKey) return clarification();
      const resolvedClient = client || new TypeSafeClient({
        apiKey,
        defaultModel: model,
        logLevel: "off"
      });
      result = await resolvedClient.systemOne({
        state,
        questions: questionSet(input.allowedIntents),
        model
      });
    }

    const intentAnswer = result?.answers?.intent;
    const intent = intentAnswer?.choice;
    const confidence = Number(intentAnswer?.confidence);
    const needsClarification = Number(result?.answers?.needsClarification?.noul);
    if (!Number.isFinite(confidence) || confidence < 0.6 ||
        !Number.isFinite(needsClarification) || needsClarification >= 0.5 ||
        !input.allowedIntents.includes(intent)) {
      return clarification();
    }

    const value = safeValueForIntent(input, intent, valueExtractor);
    const query = {
      type: "query",
      version: LANGUAGE_INTERPRETATION_CONTRACT_VERSION,
      intent,
      value
    };
    if (!isValidLanguageInterpretationOutput(query, input.allowedIntents)) {
      return clarification();
    }
    return clone(query);
  };
}
