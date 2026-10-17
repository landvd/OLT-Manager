// 未解决问题的文本处理：外勤的否定反馈判断、问题去重用的规范化。供飞书记录未解决问题和 Gd 知识召回共用。

const NEGATIVE_FEEDBACK = /^(?:不对|错了|不是这个|不是这样|没用|答非所问|不准|不正确|乱说)/u;

/** 外勤对上一轮回答的否定反馈，例如“不对”“没用”。 */
export function isNegativeFeedback(text) {
  return NEGATIVE_FEEDBACK.test(String(text || "").trim());
}

/** 未解决问题去重用的规范化文本：去掉空白、标点和常见口头前缀。 */
export function normalizeQuestion(text) {
  return String(text || "")
    .replace(/[\s，。！？、,.!?;；：:“”"'（）()【】]/gu, "")
    .replace(/^(?:请问|请|麻烦|帮我|帮忙|查查|查询|查一下|查)/u, "")
    .slice(0, 120);
}
