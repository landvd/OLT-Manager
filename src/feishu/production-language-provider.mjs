import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import {
  isValidLanguageInterpretationInput,
  isValidLanguageInterpretationOutput,
  LANGUAGE_INTERPRETATION_CONTRACT_VERSION
} from "./language-interpretation.mjs";
import { clone } from "./clone.mjs";

export const LANGUAGE_PROVIDER_FORMATS = Object.freeze(["chat-completions", "responses"]);

const FIELD_DEFINITIONS = Object.freeze([
  "find_by_name: 用户姓名；当输入只有 2-4 个中文姓名（例如 王柏权）时直接使用这个 intent",
  "find_by_phone: 11 位手机号码",
  "find_by_address: 用户装机地址",
  "find_by_sn: ONU/ONT 序列号，例如 ZTEG 开头或 16 位十六进制 SN",
  "find_by_device_number: ONU 设备号，例如 17-24 位数字或设备号标签后的字母数字值",
  "find_by_loid: ONU LOID",
  "find_by_mac: ONU MAC 地址",
  "find_by_onu_coordinate: ONU 坐标，例如 1/2/3:4 或 1/2/3/4",
  "find_pon_by_address: 村、楼栋、小区、道路、光交箱等安装区域，用于定位 PON 口",
  "read_live_status: 查询一个已唯一定位 ONU 的实时状态"
]);

function fail(message, code = "PRODUCTION_LANGUAGE_PROVIDER_ERROR") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

export function normalizeLanguageProviderEndpoint(value) {
  const raw = String(value ?? "").trim();
  if (!raw) fail("语言 provider 接口地址不能为空", "INVALID_LANGUAGE_PROVIDER_CONFIG");
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    fail("语言 provider 接口地址无效", "INVALID_LANGUAGE_PROVIDER_CONFIG");
  }
  const localHttp = parsed.protocol === "http:" &&
    ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname);
  if (!['https:', 'http:'].includes(parsed.protocol) || (parsed.protocol !== "https:" && !localHttp)) {
    fail("生产语言 provider 必须使用 HTTPS（本机 CC Switch 代理可使用 HTTP）", "INVALID_LANGUAGE_PROVIDER_CONFIG");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    fail("语言 provider 接口地址不得包含账号、密码或查询参数", "INVALID_LANGUAGE_PROVIDER_CONFIG");
  }
  return parsed.toString().replace(/\/$/, "");
}

export function normalizeLanguageProviderFormat(value) {
  const format = String(value ?? "chat-completions").trim().toLowerCase();
  if (format === "response" || format === "responses" || format === "responses-native") return "responses";
  if (["chat", "chat-completions", "chat_completions", "completions"].includes(format)) return "chat-completions";
  fail("不支持的语言 provider 上游格式", "INVALID_LANGUAGE_PROVIDER_CONFIG");
}

export function normalizeProviderFormat({ providerName = "", endpoint = "", model = "", format } = {}) {
  const normalizedFormat = normalizeLanguageProviderFormat(format);
  let host = "";
  try { host = new URL(String(endpoint || "http://invalid.local")).hostname; } catch { /* fall through */ }
  const identity = `${providerName} ${host} ${model}`.toLowerCase();
  if (identity.includes("minimax") || identity.includes("minimaxi.com")) return "chat-completions";
  return normalizedFormat;
}

function requiredText(value, label) {
  const text = String(value ?? "").trim();
  if (!text) fail(`${label} 不能为空`, "INVALID_LANGUAGE_PROVIDER_CONFIG");
  return text;
}

function endpointFor(endpoint, format) {
  const suffix = format === "responses" ? "/responses" : "/chat/completions";
  if (endpoint.endsWith(suffix)) return endpoint;
  return `${endpoint}${suffix}`;
}

function stripQueryWords(value) {
  let text = String(value ?? "").trim().replace(/\s+/g, "");
  for (let index = 0; index < 3; index += 1) {
    const next = text.replace(/^(?:请|麻烦|帮忙|帮我|帮查|查询一下|查询|查一下|查查|查找|查|找一下|找|搜索|定位|看一下|看看|看)[:：,，。-]*/i, "");
    if (next === text) break;
    text = next;
  }
  for (let index = 0; index < 3; index += 1) {
    const next = text.replace(/(?:的)?(?:ONU|ONT|用户|客户|光功率|状态|详情|信息|位置|端口|PON口|pon口|在线情况|在哪里|在哪儿|在哪|情况)[?？。！!,，、]*$/i, "");
    if (next === text) break;
    text = next;
  }
  return text.trim();
}

function localInterpretation(input) {
  const allowed = new Set(input.allowedIntents);
  const original = String(input.currentText || "").trim();
  const cleaned = stripQueryWords(original);
  const compact = original.replace(/\s+/g, "");
  const phone = compact.match(/1\d{10}/)?.[0];
  if (phone && allowed.has("find_by_phone")) {
    return { type: "query", version: LANGUAGE_INTERPRETATION_CONTRACT_VERSION, intent: "find_by_phone", value: phone };
  }
  const labeledDeviceNumber = original.match(/(?:ONU\s*)?(?:设备号|设备编号|设备号码|设备ID)\s*(?:查询|是|为|[:：=])?\s*([A-Za-z0-9][A-Za-z0-9._-]{2,})/iu)?.[1];
  if (labeledDeviceNumber && allowed.has("find_by_device_number")) {
    return { type: "query", version: LANGUAGE_INTERPRETATION_CONTRACT_VERSION, intent: "find_by_device_number", value: labeledDeviceNumber };
  }
  if (/^\d{17,24}$/.test(cleaned) && allowed.has("find_by_device_number")) {
    return { type: "query", version: LANGUAGE_INTERPRETATION_CONTRACT_VERSION, intent: "find_by_device_number", value: cleaned };
  }
  if (/^(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(cleaned) && allowed.has("find_by_mac")) {
    return { type: "query", version: LANGUAGE_INTERPRETATION_CONTRACT_VERSION, intent: "find_by_mac", value: cleaned };
  }
  if (/^\d+\/\d+\/\d+(?::|\/)\d+$/.test(cleaned) && allowed.has("find_by_onu_coordinate")) {
    const value = cleaned.replace(/\/(\d+)$/, ":$1");
    return { type: "query", version: LANGUAGE_INTERPRETATION_CONTRACT_VERSION, intent: "find_by_onu_coordinate", value };
  }
  if (/^LOID[-_A-Z0-9]+$/i.test(cleaned) && allowed.has("find_by_loid")) {
    return { type: "query", version: LANGUAGE_INTERPRETATION_CONTRACT_VERSION, intent: "find_by_loid", value: cleaned };
  }
  if (/^(?:[A-Z]{4}[-_]?[0-9A-F]{8}|[0-9A-F]{16})$/i.test(cleaned) && allowed.has("find_by_sn")) {
    return { type: "query", version: LANGUAGE_INTERPRETATION_CONTRACT_VERSION, intent: "find_by_sn", value: cleaned };
  }
  if (/^[\u4e00-\u9fff]{2,}[\u4e00-\u9fffA-Za-z0-9０-９#\-－_（）()]*(?:村|路|街|巷|小区|花园|公寓|广场|市场|学校|厂|栋|幢|座|号|光交箱|楼)$/u.test(cleaned) &&
      allowed.has("find_pon_by_address")) {
    return { type: "query", version: LANGUAGE_INTERPRETATION_CONTRACT_VERSION, intent: "find_pon_by_address", value: cleaned };
  }
  if (/^[\u4e00-\u9fff·]{2,4}$/u.test(cleaned) && allowed.has("find_by_name")) {
    return { type: "query", version: LANGUAGE_INTERPRETATION_CONTRACT_VERSION, intent: "find_by_name", value: cleaned };
  }
  return null;
}

function systemPrompt(allowedIntents) {
  return [
    "你是 OLT Manager 的只读 ONU 查询意图解析器。",
    `只允许返回版本为 ${LANGUAGE_INTERPRETATION_CONTRACT_VERSION} 的 JSON。`,
    "不得回答问题，不得补充用户资料，不得生成设备命令，不得返回 JSON 以外的文字。",
    `允许的 intent 只有：${allowedIntents.join(", ")}。`,
    `字段定义：${FIELD_DEFINITIONS.filter((item) => allowedIntents.includes(item.split(":")[0])).join("；")}。`,
    "如果用户只发送一个 2-4 个汉字的中文姓名，例如“王柏权”，必须返回 find_by_name，不要要求补充条件。",
    "如果用户发送村、小区、楼栋、道路或光交箱名称并询问 PON 口、整口状态或光功率，返回 find_pon_by_address，只保留地址短语。",
    '查询结果格式：{"type":"query","version":"1","intent":"...","value":"..."}。',
    '无法确定查询条件时格式：{"type":"clarification","version":"1","question":"..."}。'
  ].join("\n");
}

function requestJson(url, { headers, body, timeoutMs = 60_000 } = {}) {
  const parsed = new URL(url);
  const transport = parsed.protocol === "https:" ? https : http;
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = transport.request(parsed, {
      method: "POST",
      headers: {
        ...headers,
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload)
      }
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const status = response.statusCode ?? 0;
        let parsedBody = null;
        try { parsedBody = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* handled below */ }
        if (status < 200 || status >= 300) {
          const error = new Error(`语言 provider HTTP ${status}`);
          error.code = "LANGUAGE_PROVIDER_HTTP_ERROR";
          error.statusCode = status;
          reject(error);
          return;
        }
        if (!parsedBody) {
          const error = new Error("语言 provider 返回的不是 JSON");
          error.code = "LANGUAGE_PROVIDER_INVALID_RESPONSE";
          reject(error);
          return;
        }
        resolve(parsedBody);
      });
    });
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error("语言 provider 请求超时"));
    });
    request.on("error", (error) => {
      const wrapped = new Error("语言 provider 请求失败");
      wrapped.code = "LANGUAGE_PROVIDER_REQUEST_ERROR";
      wrapped.cause = error;
      reject(wrapped);
    });
    request.end(payload);
  });
}

function textFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((item) => typeof item === "string" ? item : item?.text ?? item?.value ?? "").join("");
}

function responseText(response, format) {
  if (format === "responses") {
    if (typeof response?.output_text === "string") return response.output_text;
    return (response?.output ?? []).flatMap((item) => item?.content ?? [])
      .map((item) => item?.text ?? item?.value ?? "").join("");
  }
  return textFromContent(response?.choices?.[0]?.message?.content);
}

function parseContract(response, allowedIntents) {
  const text = responseText(response, response.__format);
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) fail("语言 provider 未返回可解析的查询意图", "LANGUAGE_PROVIDER_INVALID_RESPONSE");
  let value;
  try { value = JSON.parse(text.slice(start, end + 1)); } catch {
    fail("语言 provider 返回的 JSON 无法解析", "LANGUAGE_PROVIDER_INVALID_RESPONSE");
  }
  if (!isValidLanguageInterpretationOutput(value, allowedIntents)) {
    fail("语言 provider 返回超出约定结构", "LANGUAGE_PROVIDER_INVALID_RESPONSE");
  }
  return clone(value);
}

export function createProductionLanguageProvider({
  providerName = "",
  endpoint,
  model,
  format = "chat-completions",
  credentialReference,
  readSecret,
  request = requestJson
}) {
  const normalizedEndpoint = normalizeLanguageProviderEndpoint(endpoint);
  const normalizedModel = requiredText(model, "语言 provider 模型");
  const normalizedFormat = normalizeProviderFormat({ providerName, endpoint: normalizedEndpoint, model: normalizedModel, format });
  if (typeof readSecret !== "function") throw new TypeError("Production language provider requires a secret reader.");
  if (typeof request !== "function") throw new TypeError("Production language provider requires a request function.");

  return async function interpret(input) {
    if (!isValidLanguageInterpretationInput(input)) fail("Invalid Language Interpretation input", "INVALID_LANGUAGE_INTERPRETATION");
    const local = localInterpretation(input);
    if (local) return local;
    const apiKey = requiredText(await readSecret(requiredText(credentialReference, "语言 provider 凭据引用")), "语言 provider API Key");
    const payload = normalizedFormat === "responses"
      ? {
          model: normalizedModel,
          input: [
            { role: "system", content: [{ type: "input_text", text: systemPrompt(input.allowedIntents) }] },
            { role: "user", content: [{ type: "input_text", text: JSON.stringify({ currentText: input.currentText, allowedIntents: input.allowedIntents }) }] }
          ],
          temperature: 0,
          max_output_tokens: 300,
          store: false
        }
      : {
          model: normalizedModel,
          messages: [
            { role: "system", content: systemPrompt(input.allowedIntents) },
            { role: "user", content: JSON.stringify({ currentText: input.currentText, allowedIntents: input.allowedIntents }) }
          ],
          temperature: 0,
          max_tokens: 300,
          stream: false
        };
    const response = await request(endpointFor(normalizedEndpoint, normalizedFormat), {
      headers: { authorization: `Bearer ${apiKey}` },
      body: payload
    });
    return parseContract({ ...response, __format: normalizedFormat }, input.allowedIntents);
  };
}
