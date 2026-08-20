import { clone } from "./clone.mjs";

export const LANGUAGE_INTERPRETATION_CONTRACT_VERSION = "1";
export const SYNTHETIC_DATASET_ATTESTATION_REQUIRED = "SYNTHETIC_DATASET_ATTESTATION_REQUIRED";
export const FEISHU_HELP_INTENT = "help";

const HELP_PATTERNS = Object.freeze([
  /^help$/iu,
  /^帮助$/u,
  /^使用帮助$/u,
  /^命令帮助$/u,
  /^查询帮助$/u,
  /^指令$/u
]);

export function isFeishuHelpRequest(value) {
  const text = String(value ?? "").trim().replace(/[。！？!！?？]+$/u, "");
  return HELP_PATTERNS.some((pattern) => pattern.test(text));
}

export const FEISHU_HELP_MESSAGE = Object.freeze(
  "查询顺序：姓名 → 手机 → LOID → 设备号 → 地址\n" +
  "可用查询：\n" +
  "• 姓名：王柏权\n" +
  "• 手机：13800138000\n" +
  "• 地址：汉邦六六广场\n" +
  "• ONU 序列号/SN：ZTEG030C0914\n" +
  "• ONU 设备号：设备号 123456\n" +
  "• LOID：LOID-xxxx\n" +
  "• MAC：00:11:22:33:44:55\n" +
  "• ONU 坐标：1/7/8:1\n" +
  "• PON 地址：查询汉邦六六广场 PON 状态\n\n" +
  "直接发送查询条件即可；唯一匹配会打开 ONU 详情，多条匹配可点击选择。\n" +
  "输入“帮助”或“help”可再次查看本说明。"
);

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
