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
  "查询顺序：姓名 → 手机 → LOID → 设备号 → 地址\n\n" +
  "💡 【OLT 智能装维与排障指南】\n\n" +
  "📌 场景一：日常装维查单（查用户）\n" +
  "• 姓名/手机：张三 / 13800138000\n" +
  "• 装机地址：阳光花园8号楼 或 示例广场\n" +
  "• 硬件标识：ZTEG030C0914 / LOID-xxxx / 00:11:22:33:44:55\n" +
  "• ONU 设备号：设备号 123456 或 1523001222900197753\n" +
  "• 逻辑坐标：1/7/8:1（机框/槽位/PON口:ONU编号）\n\n" +
  "🚨 场景二：网管告警与工单定位（查光交箱/PON）\n" +
  "• 逆向查光交箱：172.19.104.101 3/4 或 192.0.2.1 7/12（直接定位一级地址与全口概况）\n" +
  "• 区域整口状态：阳光花园 PON / 示例广场 PON\n" +
  "• 村级抢修验收：陈各庄村所有PON口（熔接质量定界与最差Top3弱光）\n\n" +
  "🤖 场景三：Pi 智能专家问答（查命令与方案）\n" +
  "• 常用命令：中兴怎么查光功率 / 华为MA5800查看未注册\n" +
  "• 报错定位：终端报错 20202 怎么回事（机框编号三段式避坑）\n" +
  "• 方案生成：酒店全光网多业务方案 / 不同OLT之间MDU互联\n\n" +
  "📊 【现场装维指标速查表】\n" +
  "• 接收光 (Rx)：-8 ~ -24 dBm (良好) | -25 ~ -27 dBm (预警弱光) | < -28 dBm (严重弱光)\n" +
  "• ⚡ DyingGasp：用户拔电或停电，切勿盲目上门翻光纤\n" +
  "• ✂️ LOS/断纤：物理光缆受损，需带红光笔与熔接机排查\n\n" +
  "直接发送查询条件即可秒查；输入“帮助”或“help”可再次查看本说明。"
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
