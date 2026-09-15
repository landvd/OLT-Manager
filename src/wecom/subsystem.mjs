import { WECOM_STATE_FORMAT, emptyWecomState, normalizeWecomState } from "./state.mjs";
import { clone } from "./clone.mjs";

function requiredText(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new TypeError(`${label} is required.`);
  return normalized;
}

export function createWecomSubsystem({
  stateStore,
  runtimeFactory = () => ({
    async start() {},
    async stop() {},
    status() { return { state: "stopped", lastError: null }; }
  }),
  gateway,
  now = () => new Date().toISOString()
}) {
  if (!stateStore || typeof stateStore.read !== "function" ||
      typeof stateStore.write !== "function") {
    throw new TypeError("WeCom stateStore with read/write is required.");
  }
  if (!gateway || typeof gateway.status !== "function") {
    throw new TypeError("WeCom subsystem requires an OltDataGateway.");
  }

  let state = emptyWecomState();
  let runtime = null;
  let runtimeStatus = { state: "stopped", lastError: null };
  let initialized = false;

  async function persist() {
    state = normalizeWecomState(state);
    await stateStore.write(clone(state));
  }

  async function readState() {
    const stored = await stateStore.read();
    state = stored ? normalizeWecomState(stored) : emptyWecomState();
    return clone(state);
  }

  async function startRuntime() {
    if (!state.enabled) {
      runtimeStatus = { state: "stopped", lastError: null };
      return runtimeStatus;
    }
    if (!state.bot.botId || !state.bot.credentialReference) {
      runtimeStatus = { state: "faulted", lastError: "WeCom 智能机器人配置不完整" };
      return runtimeStatus;
    }
    try {
      const gatewayStatus = await gateway.status();
      runtime = runtime ?? runtimeFactory({ gateway, stateStore });
      await runtime.start({
        botId: state.bot.botId,
        credentialReference: state.bot.credentialReference,
        welcomeEnabled: state.welcomeEnabled,
        datasetRevision: gatewayStatus.datasetRevision
      });
      runtimeStatus = runtime.status?.() ?? { state: "connected", lastError: null };
      runtimeStatus = {
        state: runtimeStatus.state ?? "connected",
        lastError: runtimeStatus.lastError ?? null,
        datasetRevision: gatewayStatus.datasetRevision,
        startedAt: now()
      };
    } catch (error) {
      runtimeStatus = {
        state: "faulted",
        lastError: String(error?.message || "WeCom 子系统连接失败"),
        datasetRevision: null,
        failedAt: now()
      };
    }
    return { ...runtimeStatus };
  }

  function getStatus() {
    const liveRuntimeStatus = state.enabled && runtime?.status?.();
    return {
      enabled: state.enabled,
      configured: Boolean(state.bot.botId && state.bot.credentialReference),
      welcomeEnabled: state.welcomeEnabled !== false,
      connection: liveRuntimeStatus
        ? { ...runtimeStatus, ...liveRuntimeStatus }
        : { ...runtimeStatus },
      state: clone(state)
    };
  }

  return Object.freeze({
    status() {
      return getStatus();
    },

    async initialize() {
      await readState();
      initialized = true;
      if (state.enabled) await startRuntime();
      return getStatus();
    },

    async reload() {
      try {
        await runtime?.stop?.();
      } finally {
        runtime = null;
        runtimeStatus = { state: "stopped", lastError: null };
        await readState();
        if (state.enabled) await startRuntime();
      }
      return getStatus();
    },

    async enable({ botId, credentialReference, welcomeEnabled }) {
      if (!initialized) await readState();
      state = {
        ...state,
        format: WECOM_STATE_FORMAT,
        enabled: true,
        bot: {
          botId: requiredText(botId, "WeCom botId"),
          credentialReference: requiredText(credentialReference, "WeCom credentialReference")
        },
        welcomeEnabled: welcomeEnabled !== false
      };
      await persist();
      return { ...(await startRuntime()), enabled: true };
    },

    async configure({ botId, credentialReference, welcomeEnabled }) {
      if (!initialized) await readState();
      state = {
        ...state,
        format: WECOM_STATE_FORMAT,
        bot: {
          botId: requiredText(botId, "WeCom botId"),
          credentialReference: requiredText(credentialReference, "WeCom credentialReference")
        },
        welcomeEnabled: welcomeEnabled !== false
      };
      await persist();
      return getStatus();
    },

    async stop() {
      if (!initialized) await readState();
      try {
        await runtime?.stop?.();
      } finally {
        runtimeStatus = { state: "stopped", lastError: null, stoppedAt: now() };
        state = { ...state, enabled: false };
        await persist();
      }
      return getStatus();
    }
  });
}
