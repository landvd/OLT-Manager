import { clone } from "./clone.mjs";

export const LANGUAGE_INTERPRETATION_CONTRACT_VERSION = "1";
export const SYNTHETIC_DATASET_ATTESTATION_REQUIRED = "SYNTHETIC_DATASET_ATTESTATION_REQUIRED";

function fail(message, code = "INVALID_LANGUAGE_INTERPRETATION") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

export function isValidLanguageInterpretationInput(input) {
  return input && input.contractVersion === LANGUAGE_INTERPRETATION_CONTRACT_VERSION &&
    typeof input.currentText === "string" && input.currentText.trim().length > 0 &&
    Array.isArray(input.allowedIntents) && input.allowedIntents.length > 0 &&
    input.allowedIntents.every((intent) => typeof intent === "string" && intent.length > 0);
}

export function isValidLanguageInterpretationOutput(value, allowedIntents) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      value.version !== LANGUAGE_INTERPRETATION_CONTRACT_VERSION) return false;
  if (value.type === "query") {
    return Object.keys(value).sort().join(",") === "intent,type,value,version" &&
      allowedIntents.includes(value.intent) && typeof value.value === "string" && value.value.trim().length > 0;
  }
  return Object.keys(value).sort().join(",") === "question,type,version" &&
    value.type === "clarification" && typeof value.question === "string" && value.question.trim().length > 0;
}

function matches(rule, text) {
  if (!rule || typeof rule !== "object") return false;
  if (typeof rule.match === "string") return text.includes(rule.match);
  if (rule.match instanceof RegExp) {
    rule.match.lastIndex = 0;
    return rule.match.test(text);
  }
  return false;
}

function isAttested(attestation, datasetRevision) {
  return Boolean(attestation &&
    (attestation.state === undefined || attestation.state === "confirmed") &&
    typeof attestation.datasetRevision === "string" &&
    attestation.datasetRevision === datasetRevision);
}

export function createSyntheticLanguageProvider({
  datasetRevision,
  readAttestation,
  rules = []
}) {
  if (typeof datasetRevision !== "function" || typeof readAttestation !== "function") {
    throw new TypeError("Synthetic language provider requires dataset and attestation readers.");
  }
  if (!Array.isArray(rules)) throw new TypeError("Synthetic language provider rules must be an array.");

  return async function interpret(input) {
    if (!isValidLanguageInterpretationInput(input)) fail("Invalid Language Interpretation input");
    const currentRevision = String(await datasetRevision() ?? "").trim();
    const attestation = await readAttestation();
    if (!currentRevision || !isAttested(attestation, currentRevision)) {
      fail("Synthetic Dataset Attestation is required", SYNTHETIC_DATASET_ATTESTATION_REQUIRED);
    }
    const rule = rules.find((candidate) => matches(candidate, input.currentText));
    const result = rule?.result ?? {
      type: "clarification",
      version: LANGUAGE_INTERPRETATION_CONTRACT_VERSION,
      question: "请补充姓名、电话、地址或 ONU 标识。"
    };
    if (!isValidLanguageInterpretationOutput(result, input.allowedIntents)) fail("Invalid synthetic Language Interpretation result");
    return clone(result);
  };
}
