// 飞书查询日志与自我学习：记录每条提问的结果，从日志里发现村名别名和常用说法，
// 生成候选给管理员审核；审核通过后飞书立即按别名改写提问、按说法直接识别，不再等大模型。
// 只读写本地 SQLite，不访问 OLT。

const ALIAS_WINDOW_MS = 5 * 60 * 1000;
const CACHE_MS = 60 * 1000;
const QUERY_PREFIX = /^(?:请|麻烦|帮忙|帮我)?(?:查查|查询|查找|查一下|查看|看看|看下|查)?/u;
const ALIAS_TEXT = /^[一-鿿·0-9A-Za-z]{2,16}$/u;
// 能说明“地名查到了”的查询类型：只有这些成功时才学习别名，避免把人名错字学成别名。
const PLACE_QUERY_TYPES = new Set([
  "find_pons_by_village", "village_pon_summary", "village_region_menu", "village_pon_retest", "weak_light"
]);
const NO_RESULT_KINDS = new Set(["village-pon-empty", "loid-no-match"]);

/** 一条提问的结果：answered / no-result / help / denied / error。 */
export function feishuQueryOutcome(entry = {}) {
  if (entry.decision === "error" || entry.replyKind === "error" || entry.replyKind === "retry-later") return "error";
  if (NO_RESULT_KINDS.has(entry.replyKind)) return "no-result";
  if (entry.replyKind === "help") return entry.replyTopic === "no-result" ? "no-result" : "help";
  if (entry.decision === "denied") return "denied";
  if (entry.resultCount === 0) return "no-result";
  return "answered";
}

function core(text) {
  return String(text || "").trim().replace(/\s+/g, "").replace(QUERY_PREFIX, "");
}

/**
 * 别名候选：同一人先问 A 没查到、紧接着问 B 查到了，取两句不同的部分，
 * 向两侧各带一个相同的字作为上下文（如“厚接村” → “厚街村”）。
 */
export function aliasCandidate(failedText, successText) {
  const a = core(failedText);
  const b = core(successText);
  if (!a || !b || a === b) return null;
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix += 1;
  if (prefix + suffix < 2) return null;
  const left = Math.min(prefix, 1);
  const inner = a.length - suffix - prefix;
  const right = inner + left >= 2 ? 0 : Math.min(suffix, 1);
  const from = a.slice(prefix - left, a.length - suffix + right);
  const to = b.slice(prefix - left, b.length - suffix + right);
  if (!ALIAS_TEXT.test(from) || !ALIAS_TEXT.test(to) || from === to) return null;
  return { from, to };
}

/** 大模型解析成功的说法：把查询值换成 {value} 得到说法模板；只有查询值本身时不算说法。 */
export function phraseTemplate(text, value) {
  const sentence = String(text || "").trim().replace(/\s+/g, " ");
  const target = String(value || "").trim();
  if (!sentence || !target) return null;
  const index = sentence.indexOf(target);
  if (index < 0 || sentence.indexOf(target, index + target.length) >= 0) return null;
  const template = `${sentence.slice(0, index)}{value}${sentence.slice(index + target.length)}`;
  if (template.replace("{value}", "").trim().length < 1 || template.length > 40) return null;
  return template;
}

export function createFeishuLearningService({
  recordFeishuQueryLog,
  markFeishuQueryNegative,
  getPreviousFeishuQuery,
  upsertFeishuLearningSuggestion,
  getFeishuLearningSuggestions,
  now = () => new Date(),
  log = () => {}
} = {}) {
  let cache = { at: 0, aliases: [], phrases: [] };

  async function learn(row) {
    if (!row || row.outcome !== "answered") return;
    if (row.source === "llm" && row.intent) {
      const template = phraseTemplate(row.text, row.value);
      if (template) await upsertFeishuLearningSuggestion({ kind: "phrase", key: template, target: row.intent, example: row.value });
    }
    if (PLACE_QUERY_TYPES.has(row.queryType) && typeof getPreviousFeishuQuery === "function") {
      const since = new Date(Date.parse(row.occurredAt) - ALIAS_WINDOW_MS).toISOString();
      const previous = await getPreviousFeishuQuery({ openId: row.openId, chatId: row.chatId, beforeId: row.id, since });
      if (previous?.outcome === "no-result") {
        const alias = aliasCandidate(previous.text, row.text);
        if (alias) await upsertFeishuLearningSuggestion({ kind: "alias", key: alias.from, target: alias.to, example: `${previous.text} → ${row.text}` });
      }
    }
  }

  async function record(entry = {}) {
    try {
      const row = await recordFeishuQueryLog({ ...entry, outcome: feishuQueryOutcome(entry) });
      await learn(row);
      return row;
    } catch (error) {
      log(`[feishu-learning] 记录提问失败：${error?.message || error}`);
      return null;
    }
  }

  async function markNegative({ openId, chatId } = {}) {
    try {
      await markFeishuQueryNegative({ openId, chatId, now: now().toISOString() });
    } catch (error) {
      log(`[feishu-learning] 标记反馈失败：${error?.message || error}`);
    }
  }

  async function active() {
    if (Date.now() - cache.at < CACHE_MS) return cache;
    const rows = await getFeishuLearningSuggestions({ status: "active" });
    cache = {
      at: Date.now(),
      // 长的别名先替换，避免短别名截断长别名。
      aliases: rows.filter((row) => row.kind === "alias").map((row) => ({ from: row.key, to: row.target })).sort((left, right) => right.from.length - left.from.length),
      phrases: rows.filter((row) => row.kind === "phrase").map((row) => ({ template: row.key, intent: row.target }))
    };
    return cache;
  }

  return Object.freeze({
    record,
    markNegative,
    async activeAliases() {
      return (await active()).aliases;
    },
    async activePhraseRules() {
      return (await active()).phrases;
    },
    /** 审核后立即生效，不等缓存过期。 */
    invalidate() {
      cache = { at: 0, aliases: [], phrases: [] };
    }
  });
}
