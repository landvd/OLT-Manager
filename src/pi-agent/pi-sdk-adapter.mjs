/**
 * 官方 Pi SDK 可选适配层。
 *
 * 该模块不直接导入 SDK，便于在 SDK 未安装或 Electron 打包环境不兼容时安全回退。
 * SDK 可用时只注册本文件定义的自定义只读工具，并使用内存 session；不会启用
 * bash/read/edit/write，也不会发现项目或用户目录中的 Pi 上下文。
 */

import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { matchOltCandidate } from "./olt-command-matcher.mjs";
import { queryKnowledgeBase } from "./knowledge-base.mjs";

export const PI_SDK_PACKAGE_NAME = "@earendil-works/pi-coding-agent";
export const PI_SDK_READONLY_TOOL_NAMES = Object.freeze([
  "olt_read_snapshot",
  "olt_query_onus",
  "olt_read_unregistered",
  "olt_search_commands",
  "olt_match_candidate"
]);

const SENSITIVE_KEYS = /(?:host|ip|community|password|secret|token|cookie|authorization|username|phone|address|loid|serial|sn)/i;

function text(value) {
  return String(value ?? "").trim();
}

function redactText(value) {
  return text(value)
    .replace(/\u001b\[[0-?]*[ -\/]*[@-~]/g, "")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[REDACTED_IP]")
    .replace(/\b(?:password|community|token|cookie|secret|credential|username|login)\s*(?:[:=]\s*|\s+)[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/\b(?:sn|serial|loid)\s*[:=]?\s*[A-Za-z0-9_-]{6,}/gi, "$1=[REDACTED]");
}

export function sanitizeTerminalContext(value, maxLength = 3000) {
  const raw = typeof value === "string"
    ? value
    : JSON.stringify(stripSensitive(value));
  return redactText(raw).slice(-Math.max(0, Number(maxLength) || 0));
}

function safeScope(value = {}) {
  const scope = value && typeof value === "object" ? value : {};
  const oltIds = Array.isArray(scope.oltIds)
    ? scope.oltIds.map((item) => text(item)).filter(Boolean)
    : [];
  return { oltIds: [...new Set(oltIds)] };
}

export function requireExplicitOltScope(args = {}, context = {}) {
  const oltId = text(args.oltId || context.oltId);
  const scope = safeScope(args.scope || context.readonlyScope || context.scope);
  if (!oltId) throw new Error("Pi SDK 只读工具必须显式提供 oltId。");
  if (scope.oltIds.length === 0) throw new Error("Pi SDK 只读工具必须显式提供非空 readonlyScope.oltIds。");
  if (!scope.oltIds.includes(oltId)) throw new Error("oltId 不在显式 readonlyScope.oltIds 中。");
  return { oltId, scope };
}

export function requirePiChatScope(context = {}) {
  const scope = safeScope(context.readonlyScope || context.scope);
  if (scope.oltIds.length === 0) {
    throw new Error("Pi SDK 对话必须显式提供非空 readonlyScope.oltIds。");
  }
  const oltId = text(context.oltId);
  if (oltId && !scope.oltIds.includes(oltId)) {
    throw new Error("当前 oltId 不在显式 readonlyScope.oltIds 中。");
  }
  return { oltId, scope };
}

export function projectPiContext(context = {}) {
  const scope = safeScope(context.readonlyScope || context.scope);
  return {
    oltId: text(context.oltId),
    vendor: text(context.vendor),
    model: text(context.model),
    version: text(context.version),
    deviceProfile: text(context.deviceProfile),
    coordinate: context.coordinate && typeof context.coordinate === "object"
      ? {
          chassis: text(context.coordinate.chassis),
          board: text(context.coordinate.board || context.coordinate.slot),
          pon: text(context.coordinate.pon),
          onuId: text(context.coordinate.onuId)
        }
      : null,
    readonlyScope: scope,
    terminalContext: sanitizeTerminalContext(context.terminalContext)
  };
}

function stripSensitive(value, key = "") {
  if (SENSITIVE_KEYS.test(key)) return undefined;
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map((item) => stripSensitive(item)).filter((item) => item !== undefined);
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    const projected = stripSensitive(childValue, childKey);
    if (projected !== undefined) result[childKey] = projected;
  }
  return result;
}

function toolResult(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(stripSensitive(value)) }],
    details: { readOnly: true }
  };
}

function schema(properties, required = []) {
  return { type: "object", properties, required, additionalProperties: false };
}

function makeTool(sdk, definition) {
  if (typeof sdk?.defineTool === "function") return sdk.defineTool(definition);
  return definition;
}

export function createPiReadonlyTools({ sdk = {}, executeTool, getOltSnapshot, verifiedCommands = [] } = {}) {
  if (typeof executeTool !== "function") throw new TypeError("executeTool is required");
  const runScoped = async (name, params, context = {}) => {
    const scope = requireExplicitOltScope(params, context);
    return executeTool(name, { ...params, oltId: scope.oltId }, { ...context, oltId: scope.oltId, readonlyScope: scope.scope });
  };
  return [
    makeTool(sdk, {
      name: "olt_read_snapshot",
      label: "读取 OLT 只读快照",
      description: "读取已授权 OLT 的厂商、型号、版本、设备 profile 和明确的只读能力摘要，不返回管理 IP 或凭据。",
      parameters: schema({ oltId: { type: "string" }, scope: schema({ oltIds: { type: "array", items: { type: "string" } } }, ["oltIds"]) }, ["oltId", "scope"]),
      execute: async (_toolCallId, params) => {
        try {
          const { oltId } = requireExplicitOltScope(params);
          const snapshot = await getOltSnapshot(oltId);
          return toolResult(snapshot);
        } catch (error) {
          return toolResult({ status: "rejected", error: error.message });
        }
      }
    }),
    makeTool(sdk, {
      name: "olt_query_onus",
      label: "读取 ONU 只读状态",
      description: "只读查询显式授权 OLT 的 ONU 状态；不执行任何终端、SNMP 写或配置命令。",
      parameters: schema({
        oltId: { type: "string" },
        scope: schema({ oltIds: { type: "array", items: { type: "string" } } }, ["oltIds"]),
        board: { type: "string" },
        pon: { type: "string" },
        q: { type: "string" }
      }, ["oltId", "scope"]),
      execute: async (_toolCallId, params) => {
        try {
          return toolResult(await runScoped("query_onus", params));
        } catch (error) {
          return toolResult({ status: "rejected", error: error.message });
        }
      }
    }),
    makeTool(sdk, {
      name: "olt_read_unregistered",
      label: "读取未注册 ONU",
      description: "只读读取显式授权 OLT 的未注册 ONU/ONT 列表。",
      parameters: schema({
        oltId: { type: "string" },
        scope: schema({ oltIds: { type: "array", items: { type: "string" } } }, ["oltIds"])
      }, ["oltId", "scope"]),
      execute: async (_toolCallId, params) => {
        try {
          return toolResult(await runScoped("get_unregistered_onus", params));
        } catch (error) {
          return toolResult({ status: "rejected", error: error.message });
        }
      }
    }),
    makeTool(sdk, {
      name: "olt_search_commands",
      label: "检索已验证 OLT 命令",
      description: "按当前 OLT 的厂商、型号、分类或关键词检索本地已验证且只读的命令目录；结果只能用于预览，不能自动执行。",
      parameters: schema({
        oltId: { type: "string" },
        scope: schema({ oltIds: { type: "array", items: { type: "string" } } }, ["oltIds"]),
        category: { type: "string" },
        keyword: { type: "string" }
      }, ["oltId", "scope"]),
      execute: async (_toolCallId, params) => {
        try {
          const { oltId } = requireExplicitOltScope(params);
          const snapshot = await getOltSnapshot(oltId);
          const entries = queryKnowledgeBase({
            vendor: snapshot.vendor,
            model: snapshot.deviceProfile || snapshot.model,
            category: params.category,
            keyword: params.keyword
          }).filter((entry) => entry.verified && entry.readOnly).slice(0, 12);
          return toolResult({ oltId, count: entries.length, entries });
        } catch (error) {
          return toolResult({ status: "rejected", error: error.message });
        }
      }
    }),
    makeTool(sdk, {
      name: "olt_match_candidate",
      label: "匹配外部候选方案",
      description: "使用确定性匹配器将外部候选命令与现网快照和本地已验证命令表比较；候选内容不能直接成为执行命令。",
      parameters: schema({
        oltId: { type: "string" },
        scope: schema({ oltIds: { type: "array", items: { type: "string" } } }, ["oltIds"]),
        candidate: { type: "object" },
      }, ["oltId", "scope", "candidate"]),
      execute: async (_toolCallId, params) => {
        try {
          const { oltId } = requireExplicitOltScope(params);
          const snapshot = await getOltSnapshot(oltId);
          return toolResult(matchOltCandidate({
            candidate: params.candidate,
            snapshot,
            verifiedCommands
          }));
        } catch (error) {
          return toolResult({ status: "rejected", error: error.message });
        }
      }
    })
  ];
}

async function loadDefaultSdk() {
  try {
    return await import(PI_SDK_PACKAGE_NAME);
  } catch (error) {
    return { unavailable: true, reason: `官方 Pi SDK 不可用：${error?.code || error?.message || "import failed"}` };
  }
}

function buildPrompt(messages, context) {
  const safeMessages = (Array.isArray(messages) ? messages : [])
    .filter((message) => message && (message.role === "user" || message.role === "assistant"))
    .slice(-8)
    .map((message) => ({ role: message.role, content: redactText(message.content).slice(0, 4000) }));
  return [
    "你是 OLT Manager 的只读网络助手。只使用提供的自定义只读工具。",
    "忘记命令或遇到型号/版本差异时，先调用 olt_read_snapshot，再调用 olt_search_commands；外部候选命令只能作为参考，必须再调用 olt_match_candidate；matched 之外不得称为已验证。",
    "不得生成或执行 snmpset、配置下发、注册/删除/重启/保存配置、Telnet/SSH 输入或任意 shell/文件操作。命令只能预览和复制。",
    `显式只读上下文：${JSON.stringify(projectPiContext(context))}`,
    projectPiContext(context).terminalContext ? `最近终端输出（已脱敏，仅作诊断线索）：\n${projectPiContext(context).terminalContext}` : "",
    `对话：${JSON.stringify(safeMessages)}`
  ].join("\n\n");
}

async function createConfiguredModelRuntime({ sdk, languageConfig }) {
  if (!languageConfig?.model || !languageConfig?.apiKey || !(languageConfig.endpoint || languageConfig.baseUrl)) return null;
  const endpoint = new URL(String(languageConfig.baseUrl || languageConfig.endpoint));
  if (endpoint.username || endpoint.password || endpoint.search) throw new Error("模型 endpoint 不得包含内嵌凭据。");
  endpoint.username = "";
  endpoint.password = "";
  endpoint.pathname = endpoint.pathname.replace(/\/chat\/completions\/?$/i, "").replace(/\/+$/, "") || "/";
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "olt-manager-pi-runtime-"));
  const providerId = "olt-manager";
  const modelId = String(languageConfig.model).split("/").at(-1);
  const api = String(languageConfig.format || "chat-completions").toLowerCase() === "responses"
    ? "openai-responses"
    : "openai-completions";
  try {
    await fs.writeFile(path.join(root, "models.json"), JSON.stringify({
      providers: {
        [providerId]: {
          baseUrl: endpoint.toString().replace(/\/$/, ""),
          api,
          ...(api === "openai-completions"
            ? { compat: { supportsDeveloperRole: false, supportsReasoningEffort: false } }
            : {}),
          models: [{ id: modelId, name: modelId, reasoning: false, input: ["text"], contextWindow: 32768, maxTokens: 4096 }]
        }
      }
    }));
    await fs.writeFile(path.join(root, "auth.json"), "{}\n");
    await fs.writeFile(path.join(root, "models-store.json"), "{}\n");
    const modelRuntime = await sdk.ModelRuntime.create({
      allowModelNetwork: false,
      refreshOnCreate: false,
      authPath: path.join(root, "auth.json"),
      modelsPath: path.join(root, "models.json"),
      modelsStorePath: path.join(root, "models-store.json")
    });
    await modelRuntime.setRuntimeApiKey(providerId, String(languageConfig.apiKey));
    const model = modelRuntime.getModel(providerId, modelId);
    if (!model) throw new Error("Pi SDK 未能加载程序配置的模型。");
    return { modelRuntime, model, root };
  } catch (error) {
    await fs.rm(root, { recursive: true, force: true });
    throw error;
  }
}

async function createIsolatedSession({ sdk, customTools, systemPrompt, model, modelRuntime }) {
  const settingsManager = typeof sdk.SettingsManager?.inMemory === "function"
    ? sdk.SettingsManager.inMemory({ compaction: { enabled: false } })
    : undefined;
  const isolatedRoot = path.join(os.tmpdir(), "olt-manager-pi-sdk-empty-context");
  const isolatedModelRuntime = modelRuntime || (typeof sdk.ModelRuntime?.create === "function"
    ? await sdk.ModelRuntime.create({
        allowModelNetwork: false,
        authPath: path.join(isolatedRoot, "auth.json"),
        modelsPath: path.join(isolatedRoot, "models.json"),
        modelsStorePath: path.join(isolatedRoot, "models-store.json")
      })
    : undefined);
  const resourceLoader = typeof sdk.DefaultResourceLoader === "function"
    ? new sdk.DefaultResourceLoader({
        cwd: isolatedRoot,
        agentDir: isolatedRoot,
        settingsManager,
        systemPromptOverride: () => systemPrompt
      })
    : undefined;
  if (resourceLoader && typeof resourceLoader.reload === "function") await resourceLoader.reload();
  return sdk.createAgentSession({
    ...(model ? { model } : {}),
    ...(isolatedModelRuntime ? { modelRuntime: isolatedModelRuntime } : {}),
    noTools: "all",
    customTools,
    resourceLoader,
    settingsManager,
    sessionManager: sdk.SessionManager.inMemory()
  });
}

export function createPiSdkAdapter({
  sdkLoader = loadDefaultSdk,
  sessionFactory = createIsolatedSession,
  executeTool,
  getOlts = async () => [],
  verifiedCommands = [],
  enabled = false,
  model = null,
  getLanguageConfig = async () => null,
  modelRuntimeFactory = createConfiguredModelRuntime
} = {}) {
  let sdkPromise;
  const loadSdk = async () => {
    sdkPromise ??= Promise.resolve().then(() => sdkLoader());
    return sdkPromise;
  };

  async function getOltSnapshot(oltId) {
    const olts = await getOlts();
    const olt = olts.find((item) => String(item.id) === String(oltId));
    if (!olt) throw new Error("未找到指定 OLT。");
    return {
      oltId: String(olt.id),
      vendor: text(olt.vendor),
      model: text(olt.model),
      version: text(olt.version),
      deviceProfile: text(olt.deviceProfile),
      capabilities: olt.capabilities && typeof olt.capabilities === "object"
        ? stripSensitive(olt.capabilities)
        : {}
    };
  }

  return {
    async chat({ messages = [], context = {} } = {}) {
      const shouldEnable = enabled || context.piSdk === true || process.env.OLT_PI_SDK_ENABLED === "1";
      if (!shouldEnable) return null;
      let scope;
      try {
        scope = requirePiChatScope(context);
      } catch (error) {
        return { reply: `Pi SDK 已拒绝本次请求：${error.message}`, source: "pi-sdk-rejected", toolsUsed: [] };
      }

      const sdk = await loadSdk();
      if (!sdk || sdk.unavailable || typeof sdk.createAgentSession !== "function") return null;
      const systemPrompt = buildPrompt(messages, { ...context, readonlyScope: scope.scope });
      const customTools = createPiReadonlyTools({ sdk, executeTool, getOltSnapshot, verifiedCommands });
      let runtime;
      let configured;
      try {
        const languageConfig = await getLanguageConfig();
        if (!languageConfig?.model || !languageConfig?.apiKey || !(languageConfig.endpoint || languageConfig.baseUrl)) return null;
        configured = await modelRuntimeFactory({ sdk, languageConfig });
        runtime = await sessionFactory({
          sdk,
          customTools,
          systemPrompt,
          model: configured?.model || model,
          modelRuntime: configured?.modelRuntime
        });
        const session = runtime?.session || runtime;
        if (!session || typeof session.prompt !== "function") throw new Error("Pi SDK session 不完整。");
        const chunks = [];
        const toolsUsed = [];
        const unsubscribe = typeof session.subscribe === "function"
          ? session.subscribe((event) => {
              if (event?.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") chunks.push(event.assistantMessageEvent.delta);
              if (event?.type === "tool_execution_start" && event.toolName) toolsUsed.push({ name: event.toolName });
            })
          : null;
        await session.prompt(systemPrompt);
        if (typeof unsubscribe === "function") unsubscribe();
        const reply = chunks.join("").trim() || [...(session.messages || [])].reverse().find((item) => item.role === "assistant")?.content || "";
        if (!reply) throw new Error("Pi SDK 未返回文本结果。");
        return { reply: text(reply), source: "pi-sdk-agent", toolsUsed };
      } catch (error) {
        try { runtime?.session?.dispose?.(); } catch { /* best effort */ }
        return { reply: `Pi SDK 暂不可用：${error.message}`, source: "pi-sdk-error", toolsUsed: [] };
      } finally {
        try { runtime?.session?.dispose?.(); } catch { /* best effort */ }
        try { runtime?.modelRuntime?.dispose?.(); } catch { /* best effort */ }
        try { await configured?.cleanup?.(); } catch { /* best effort */ }
        if (configured?.root) {
          try { await fs.rm(configured.root, { recursive: true, force: true }); } catch { /* best effort */ }
        }
      }
    },
    getStatus: async () => {
      const sdk = await loadSdk();
      return {
        package: PI_SDK_PACKAGE_NAME,
        available: Boolean(sdk && !sdk.unavailable && typeof sdk.createAgentSession === "function"),
        tools: [...PI_SDK_READONLY_TOOL_NAMES],
        sessionPersistence: "memory-only",
        builtInTools: "disabled"
      };
    }
  };
}
