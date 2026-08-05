import { FEISHU_STATE_FORMAT, emptyFeishuState, normalizeFeishuState } from "./state.mjs";

function requiredText(value, label) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new TypeError(`${label} is required.`);
  return normalized;
}

export function createFeishuSubsystem({
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
    throw new TypeError("Feishu stateStore with read/write is required.");
  }
  if (!gateway || typeof gateway.status !== "function") {
    throw new TypeError("Feishu subsystem requires an OltDataGateway.");
  }

  let state = emptyFeishuState();
  let runtime = null;
  let runtimeStatus = { state: "stopped", lastError: null };
  let initialized = false;

  async function persist() {
    state = normalizeFeishuState(state);
    await stateStore.write(structuredClone(state));
  }

  async function readState() {
    const stored = await stateStore.read();
    state = stored ? normalizeFeishuState(stored) : emptyFeishuState();
    return structuredClone(state);
  }

  async function startRuntime() {
    if (!state.enabled) {
      runtimeStatus = { state: "stopped", lastError: null };
      return runtimeStatus;
    }
    if (!state.app.appId || !state.app.credentialReference) {
      runtimeStatus = { state: "faulted", lastError: "Feishu 应用配置不完整" };
      return runtimeStatus;
    }
    try {
      const gatewayStatus = await gateway.status();
      runtime = runtime ?? runtimeFactory({ gateway });
      await runtime.start({
        appId: state.app.appId,
        credentialReference: state.app.credentialReference,
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
        lastError: String(error?.message || "Feishu 子系统连接失败"),
        datasetRevision: null,
        failedAt: now()
      };
    }
    return { ...runtimeStatus };
  }

  return Object.freeze({
    async initialize() {
      await readState();
      initialized = true;
      if (state.enabled) await startRuntime();
      return this.status();
    },

    async enable({ appId, credentialReference }) {
      if (!initialized) await readState();
      state = {
        ...state,
        format: FEISHU_STATE_FORMAT,
        enabled: true,
        app: {
          appId: requiredText(appId, "Feishu appId"),
          credentialReference: requiredText(credentialReference, "Feishu credentialReference")
        }
      };
      await persist();
      return { ...(await startRuntime()), enabled: true };
    },

    async configure({ appId, credentialReference }) {
      if (!initialized) await readState();
      state = {
        ...state,
        format: FEISHU_STATE_FORMAT,
        app: {
          appId: requiredText(appId, "Feishu appId"),
          credentialReference: requiredText(credentialReference, "Feishu credentialReference")
        }
      };
      await persist();
      return this.status();
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
      return this.status();
    },

    status() {
      return {
        enabled: state.enabled,
        configured: Boolean(state.app.appId && state.app.credentialReference),
        connection: { ...runtimeStatus },
        state: structuredClone(state)
      };
    }
  });
}
