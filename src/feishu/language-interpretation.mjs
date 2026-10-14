import { clone } from "./clone.mjs";

export const LANGUAGE_INTERPRETATION_CONTRACT_VERSION = "1";
export const SYNTHETIC_DATASET_ATTESTATION_REQUIRED = "SYNTHETIC_DATASET_ATTESTATION_REQUIRED";
export const FEISHU_HELP_INTENT = "help";

const HELP_WORDS = "(?:help|帮助|使用帮助|命令帮助|查询帮助|指令|说明|使用说明)";
const HELP_TOPIC_WORDS = Object.freeze({
  repair: "(?:抢修|验收|断纤|熔接)",
  user: "(?:用户|查询|查用户|PON口|pon口|光功率)",
  feedback: "(?:纠错|纠正|反馈|答错)"
});

/** 识别帮助请求，返回主题：main / repair / user / feedback；不是帮助请求时返回 null。 */
export function feishuHelpTopic(value) {
  const text = String(value ?? "").trim().replace(/[。！？!！?？]+$/u, "").replace(/\s+/gu, " ");
  if (new RegExp(`^${HELP_WORDS}$`, "iu").test(text)) return "main";
  for (const [topic, words] of Object.entries(HELP_TOPIC_WORDS)) {
    if (new RegExp(`^${HELP_WORDS}\\s*[:：]?\\s*${words}$`, "iu").test(text)) return topic;
    if (new RegExp(`^${words}\\s*${HELP_WORDS}$`, "iu").test(text)) return topic;
  }
  return null;
}

export function isFeishuHelpRequest(value) {
  return feishuHelpTopic(value) !== null;
}

// 帮助内容按主题组织；卡片按 sections 分段渲染，纯文本兜底用 feishuHelpText。
export const FEISHU_HELP_TOPICS = Object.freeze({
  main: {
    title: "OLT 查询机器人 · 使用说明",
    template: "blue",
    sections: [
      { heading: "查用户", lines: [
        "直接发姓名、电话、装机地址、SN、LOID、MAC 或设备号，地址可以只写一部分。",
        "例：张三　13800138000　阳光花园8号楼　ZTEG030C0914",
        "卡片里可以看在线状态、当前和历史光功率、同 PON 口的其他用户。"
      ] },
      { heading: "查 PON 口", lines: [
        "例：双岗村所有PON口"
      ] },
      { heading: "整村抢修验收", lines: [
        "断纤修好后检查光功率有没有恢复、要不要重新熔接。",
        "例：厚街村抢修情况　厚街村向北抢修情况　万达广场抢修情况",
        "大村会先让你选小组。"
      ] },
      { heading: "弱光和断纤记录", lines: [
        "例：厚街村弱光用户　万达广场光衰情况（按昨晚采集，秒出结果）",
        "例：厚街村断纤记录　厚街村最近断过几次"
      ] },
      { heading: "直接提问", lines: [
        "例：C600 怎么查未注册 ONU？终端报错怎么处理？",
        "答错了回复“不对，应该是……”就能纠正。"
      ] }
    ],
    footer: "只读查询，不会改动设备 · 群里 @机器人 也能查 · 详细说明：发“帮助 抢修”“帮助 用户”“帮助 纠错”"
  },
  repair: {
    title: "整村抢修验收怎么看",
    template: "blue",
    sections: [
      { heading: "怎么发", lines: [
        "村名 + 抢修情况，例：厚街村抢修情况",
        "大村可以直接带小组：厚街村向北抢修情况，或只说小组名：万达广场抢修情况",
        "主要 PON 口超过 15 个的村会先出小组菜单，只检查选中小组的口；零星沾边的口默认折叠，可在卡片里点开。"
      ] },
      { heading: "怎么对比", lines: [
        "有夜间光功率基线的口：逐户对比现在和断纤前几晚的光功率。",
        "没有基线的口：先抽 1 户，比之前差 2 dB 以上才在同口加测，最多 5 户。"
      ] },
      { heading: "结论", lines: [
        "可以封盒：已全部恢复，没有用户比之前差 2 dB 以上。",
        "需复核熔接：同一个口多数用户比之前差 2 dB 以上，熔接点可能不理想。",
        "用户侧原因：只有个别用户变差，查入户皮线、接头或终端，不用重熔主干。",
        "整口离线：口上用户全部离线，光路还没通。"
      ] },
      { heading: "其他", lines: [
        "重新熔接后点卡片上的“复测这几个口”，只重测有问题的口，不用再查整村。",
        "同缆提示：历史上常和这些口一起断的口，建议一并检查。",
        "卡片底部灰字是用户资料同步时间，太久没同步时名单可能不准。"
      ] }
    ],
    footer: "发“帮助”回到总说明"
  },
  user: {
    title: "查用户和 PON 口",
    template: "blue",
    sections: [
      { heading: "可以用什么查", lines: [
        "姓名、电话、装机地址（可只写一部分）、ONU SN、LOID、MAC、设备号。",
        "结果多于一个时，在卡片里翻页选择。"
      ] },
      { heading: "今天刚装的用户", lines: [
        "发“今天新装”列出今天的装机工单；刚装好的用户直接发 LOID 或手机号查，台账里还没有时会自动从一期网管读取。"
      ] },
      { heading: "用户卡片里有什么", lines: [
        "在线状态、当前光功率、历史光功率记录，可继续查看同 PON 口的其他用户判断光路。"
      ] },
      { heading: "查 PON 口", lines: [
        "某村所有 PON 口：双岗村所有PON口"
      ] },
      { heading: "弱光和断纤记录", lines: [
        "某地的弱光用户：厚街村弱光用户（接收光功率 ≤ -27 dBm，按最近一晚夜间采集）",
        "某地的断纤记录：厚街村断纤记录（近 90 天，来自抢修档案）"
      ] },
      { heading: "查不到时", lines: [
        "换一种信息再查，比如姓名查不到就用电话或地址。",
        "地址里村名写法不一样（如“万达广场”归三屯村）时，请管理员在区域字典里设置。"
      ] }
    ],
    footer: "发“帮助”回到总说明"
  },
  feedback: {
    title: "答错了怎么办",
    template: "blue",
    sections: [
      { heading: "纠正回答", lines: [
        "直接回复“不对，应该是……”，机器人会结合上一轮回答改正（30 分钟内有效）。"
      ] },
      { heading: "用户资料有误", lines: [
        "回复正确的电话或地址，会生成资料修正，管理员审核后写入台账，以后同步也会保留。"
      ] },
      { heading: "一级地址、村 / 小组 / 小区不对", lines: [
        "在用户详情卡片上点“资料有误”，填正确的内容后提交；也可以直接说“君汇那个口的一级地址应该是顺景大厦”。",
        "申请发给审批人，审批人同意后系统自动修改，结果会通知你。"
      ] },
      { heading: "没有帮助", lines: [
        "回复“没用”或“答非所问”，问题会记下来，管理员补充答案后，下次有人问类似问题会直接用上。"
      ] }
    ],
    footer: "发“帮助”回到总说明"
  },
  "no-result": {
    title: "没有查到结果",
    template: "orange",
    sections: [
      { heading: "可以这样发", lines: [
        "查用户：张三　13800138000　阳光花园8号楼",
        "整村抢修：厚街村抢修情况",
        "直接提问：C600 怎么查未注册 ONU？"
      ] }
    ],
    footer: "发“帮助”查看完整说明"
  }
});

// 机器人自定义菜单的事件 key → 帮助主题（在飞书开发者后台配置菜单时填写这些 key）。
export const FEISHU_MENU_TOPICS = Object.freeze({
  help: "main",
  "help-repair": "repair",
  "help-user": "user",
  "help-feedback": "feedback"
});

/** 帮助内容的纯文本形式（卡片渲染失败或文本消息时使用）。 */
export function feishuHelpText(topic = "main") {
  const content = FEISHU_HELP_TOPICS[topic] || FEISHU_HELP_TOPICS.main;
  return [
    content.title,
    ...content.sections.map((section) => `\n${section.heading}\n${section.lines.map((line) => `• ${line}`).join("\n")}`),
    `\n${content.footer}`
  ].join("\n");
}

export const FEISHU_HELP_MESSAGE = Object.freeze(feishuHelpText("main"));

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
