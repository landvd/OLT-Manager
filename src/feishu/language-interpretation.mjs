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
  "📱 【现场装维查询指南】\n\n" +
  "一、查用户资料\n" +
  "• 查张三\n" +
  "• 查13800138000\n" +
  "• 查阳光花园8号楼\n" +
  "• 查 ZTEG030C0914 / LOID-xxxx / 00:11:22:33:44:55\n" +
  "• 查设备号 1523001222900197753\n\n" +
  "二、查光功率和在线状态\n" +
  "• 查张三最近7天历史光功率\n" +
  "• 查张三光功率趋势\n" +
  "• 查双岗村弱光数量\n" +
  "• 查阳光花园整口状态\n\n" +
  "三、村级抢修查询\n" +
  "• 查双岗村所有PON口\n" +
  "• 查双岗村抢修情况\n" +
  "• 查该区域哪些用户在线\n" +
  "• 查同一PON口其他用户判断光路\n\n" +
  "四、现场判断规则\n" +
  "• 用户在线但没有历史光功率：自动抽查同一PON口其他在线用户。\n" +
  "• 同一PON口全部用户离线：显示“整口断纤风险”。\n" +
  "• 只有资料不足、设备没有返回数据时，才显示“未完成”。\n\n" +
  "五、忘记命令怎么办\n" +
  "• 直接描述问题，例如：怎么查看光功率？怎么查未注册设备？终端报错怎么处理？\n\n" +
  "直接发送自然语言即可查询；输入“帮助”或“help”可再次查看本说明。"
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
