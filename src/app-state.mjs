function localDateValue(value) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Create a fresh, credential-free application state tree.
 *
 * The caller is responsible for wrapping the result in Vue's reactive().
 * Keeping this factory free of browser, network, timer, and credential
 * dependencies makes the initial state easy to test and prevents instances
 * from sharing nested mutable values.
 */
export function createInitialAppState({ now = Date.now() } = {}) {
  return {
    version: "0.0.0",
    authenticated: false,
    authSetupRequired: false,
    authRequired: true,
    authPassword: "",
    authError: "",
    authLoading: false,
    authToggleLoading: false,
    activeView: "dashboard",
    olts: [],
    ponPorts: [],
    selectedOltId: "",
    status: { alarms: [] },
    unregisteredRows: [],
    configTemplates: [],
    installMessage: "",
    onuRows: [],
    onuConfig: { visible: false, loading: false, data: null },
    onuDetail: { visible: false, loading: false, data: null },
    configPlan: {
      visible: false,
      loading: false,
      row: null,
      templateId: "zte-self-operated-internet",
      ethPorts: ["eth_0/1"],
      customVlan: undefined,
      result: null
    },
    terminal: { visible: false, sessionId: "", status: "未连接", pasting: false },
    filters: { search: "", chassis: "", slot: "", pon: "" },
    sort: { field: "", direction: "asc" },
    adminOlts: [],
    resource: {
      config: { serverUrl: "", username: "", password: "", migrationMasterPassword: "" },
      loggedIn: false,
      configLoading: false,
      loginLoading: false,
      vlanSyncing: false,
      search: "",
      pageSize: 20,
      userPage: 1,
      users: []
    },
    mergedOnu: {
      syncing: false,
      sources: {
        network: { synced: false, revision: "", count: 0, updatedAt: "" },
        nmse: { synced: false, revision: "", count: 0, updatedAt: "" }
      },
      dataset: {
        synced: false,
        revision: "",
        updatedAt: "",
        lastCompletedAt: "",
        snapshotCount: 0,
        lastConflictCount: 0
      },
      progress: {
        running: false,
        operation: "",
        status: "idle",
        phase: "idle",
        totalOlts: 0,
        completedOlts: 0,
        networkRows: 0,
        nmseRows: 0,
        nmseTotal: 0,
        nmsePages: 0,
        nmseCompletedPages: 0,
        nmseWorkers: 0,
        nmseAttempt: 0,
        mergedRows: 0,
        conflicts: 0,
        error: ""
      },
      error: ""
    },
    oss: {
      config: { authBaseUrl: "", ngbBaseUrl: "", username: "", organizationName: "", roomName: "" },
      password: "",
      migrationMasterPassword: "",
      credentialConfigured: false,
      autoLoginAvailable: false,
      autoLoginConfigured: false,
      rememberPassword: false,
      loggedIn: false,
      configLoading: false,
      loginLoading: false,
      olts: [],
      historyLoading: false,
      historyRows: [],
      historyError: "",
      dateRange: [
        localDateValue(now - 30 * 24 * 60 * 60 * 1000),
        localDateValue(now)
      ]
    },
    resourceSchedule: {
      tasks: [],
      loading: false,
      saving: false,
      cancelingId: "",
      deletingId: "",
      form: { operation: "full", runAt: "", repeatEnabled: false, repeatDays: 5 }
    },
    feishu: {
      appId: "",
      appSecret: "",
      enabled: false,
      configured: false,
      credentialConfigured: false,
      languageProvider: "production",
      languageProviderName: "",
      languageEndpoint: "",
      languageModel: "",
      languageFormat: "chat-completions",
      languageApiKey: "",
      languageApiKeyConfigured: false,
      languageProviderReady: false,
      connection: { state: "stopped", lastError: null },
      error: "",
      saving: false,
      credentialSaving: false,
      languageSaving: false
    },
    projects: [],
    projectSearch: "",
    projectDialog: {
      visible: false,
      loading: false,
      form: { id: "", name: "", vlan: 100, address: "", contactName: "", contactPhone: "", contactNote: "" }
    },
    projectDetail: {
      loading: false,
      project: null,
      onus: [],
      selectedOnu: null,
      loadedProjectId: ""
    },
    projectLoading: {
      visible: false,
      title: "正在刷新 ONU 台账",
      message: "正在连接本地台账与当前 OLT 状态...",
      step: "准备读取",
      percent: 0
    },
    onuLoading: {
      visible: false,
      title: "正在查询 ONU 数据",
      message: "正在准备查询条件...",
      step: "准备查询",
      percent: 0
    },
    ponAdminSearch: "",
    loading: { status: false, install: false, onus: false, admin: false, vlan: false }
  };
}
