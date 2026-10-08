// 把后端/远端网管返回的原始错误整理成一线人员能看懂的提示：
// 去掉 traceId、请求编号等排障字段（服务端日志仍保留原文），并对常见情况补充处理建议。
const TRACE_FIELD = /[\s,，;；(（]*(?:trace[-_ ]?id|request[-_ ]?id|x-request-id)\s*[:=：]\s*[\w-]+[)）]?/gi;

const HINTS = [
  [/验证码/, "二期网管要求输入验证码，当前无法自动登录。请稍后重试，或先在网管网页端登录一次。"],
  [/ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|timeout|超时/i, "连接超时或被拒绝，请检查本机到该服务器的网络是否可达。"]
];

export function friendlyErrorMessage(message, fallback = "请求失败") {
  const original = String(message || "").trim();
  if (!original) return fallback;
  const cleaned = original.replace(TRACE_FIELD, "").replace(/\s{2,}/g, " ").trim() || fallback;
  const hint = HINTS.find(([pattern]) => pattern.test(cleaned));
  return hint && !cleaned.includes(hint[1]) ? `${cleaned}。${hint[1]}`.replace(/。。/g, "。") : cleaned;
}
