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
    update: {
      currentVersion: "0.0.0",
      platform: "",
      arch: "",
      selecting: false,
      installing: false,
      available: false,
      version: "",
      mode: "",
      releaseNotes: "",
      error: ""
    },
    olts: [],
    ponPorts: [],
    selectedOltId: "",
    status: { alarms: [] },
    unregisteredRows: [],
    unregisteredOltSummaries: [],
    configTemplates: [],
    installMessage: "",
    installFilterOltHost: "",
    installSearchKeyword: "",
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
    templateEditor: {
      loading: false,
      templates: [],
      variables: [],
      filterVendor: "",
      filterProfile: "",
      searchKeyword: "",
      selectedId: "",
      form: {
        id: "",
        name: "",
        vendor: "zte",
        deviceProfiles: ["zte-c300"],
        businessType: "self-operated-internet",
        portMode: "single",
        defaultParams: {
          innerVlan: "3301",
          defaultPort: "eth_0/1"
        },
        commandTemplate: "",
        remark: "",
        isBuiltin: false
      },
      testParams: {
        chassis: "1",
        board: "3",
        pon: "8",
        onuId: "12",
        actualOntId: "12",
        serial: "ZTEG99887766",
        outerVlan: "1050",
        innerVlan: "3301",
        ethPort: "eth_0/1"
      },
      previewCommands: ""
    },
    terminal: {
      visible: false,
      sessionId: "",
      recentOutput: "",
      status: "未连接",
      pasting: false,
      showAssistant: true,
      assistantMessages: [],
      assistantInput: "",
      assistantLoading: false,
      assistantWidth: 440,
      resizing: false,
      pendingCommand: "",
      pendingCommands: []
    },
    filters: { search: "", chassis: "", slot: "", pon: "" },
    sort: { field: "", direction: "asc" },
    adminOlts: [],
    resource: {
      config: { serverUrl: "http://172.18.254.7:9000", username: "", password: "" },
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
      bossSync: {
        running: false, status: "idle", count: 0, watermark: "", window: null, error: "",
        nameHistoryStart: "", nameHistoryEnd: "", nameHistoryCompletedAt: "",
        nameHistoryCount: 0, nameHistorySkippedCount: 0, nameHistoryConflictCount: 0
      },
      syncing: false,
      sources: {
        network: { synced: false, revision: "", count: 0, updatedAt: "", snapshotAt: "" },
        nmse: { synced: false, revision: "", count: 0, updatedAt: "", coverageThrough: "" }
      },
      dataset: {
        synced: false,
        revision: "",
        updatedAt: "",
        lastCompletedAt: "",
        mergedAt: "",
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
    mergedConflictDialog: {
      visible: false,
      loading: false,
      rows: [],
      selectedReason: "all",
      selectedOltIp: "",
      searchKeyword: "",
      activeGuideKey: "network_coordinate_duplicate",
      page: 1,
      pageSize: 15
    },
    oss: {
      config: { authBaseUrl: "http://10.205.136.199:18140", ngbBaseUrl: "http://10.205.137.22:8080", username: "", organizationName: "", roomName: "" },
      password: "",
      credentialConfigured: false,
      autoLoginAvailable: false,
      autoLoginConfigured: false,
      rememberPassword: false,
      loggedIn: false,
      configLoading: false,
      loginLoading: false,
      roomsLoading: false,
      discoveredOrgs: [],
      discoveredRooms: [],
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
      piAgentLanguageProviderName: "",
      piAgentLanguageEndpoint: "",
      piAgentLanguageModel: "",
      piAgentLanguageFormat: "chat-completions",
      piAgentLanguageApiKey: "",
      piAgentLanguageApiKeyConfigured: false,
      connection: { state: "stopped", lastError: null },
      error: "",
      saving: false,
      credentialSaving: false,
      languageSaving: false,
      piAgentLanguageSaving: false
    },
    anysearch: {
      apiKey: "as_sk_e073d907a118c3bbba1ce741a5aa3e75",
      maskedKey: "as_sk_e073...3e75",
      loading: false,
      saving: false,
      dialogVisible: false
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
    ponImportPreview: {
      visible: false,
      loading: false,
      fileName: "",
      totalRaw: 0,
      validCount: 0,
      emptyCount: 0,
      invalidRows: [],
      overrideCount: 0,
      newCount: 0,
      validRows: []
    },
    loading: { status: false, install: false, onus: false, admin: false, vlan: false },
    wizardDismissed: (() => {
      try {
        return typeof localStorage !== "undefined" && localStorage.getItem("olt_wizard_dismissed") === "true";
      } catch (_) {
        return false;
      }
    })(),
    wizard: {
      currentStep: 1,
      completed: (() => {
        try {
          return typeof localStorage !== "undefined" && localStorage.getItem("olt_wizard_completed") === "true";
        } catch (_) {
          return false;
        }
      })(),
      resourceTestStatus: "idle",
      resourceTestMessage: "",
      ossTestStatus: "idle",
      ossTestMessage: "",
      ossOltsLoading: false,
      selectedOssOlts: [],
      batchCredentials: {
        community: "public",
        telnetUser: "admin",
        telnetPassword: ""
      },
      oltDrafts: [],
      savingOlts: false,
      ponLedgerSummary: { totalCount: 0, distinctOlts: 0 },
      vlanSyncing: false,
      vlanResults: [],
      vlanSummary: "",
      savingAiConfig: false,
      aiTestStatus: "idle",
      aiTestMessage: ""
    },
    dashboardWorkdesk: {
      loading: false,
      roomName: "",
      organizationName: "",
      summary: {
        totalOlts: 0,
        onlineOlts: 0,
        totalOnus: 0,
        onlineOnus: 0,
        onlineRate: "100%",
        totalPonPorts: 0,
        activePonPorts: 0,
        abnormalPortCount: 0,
        weakCount: 0,
        repeatLoidCount: 0,
        conflictCount: 0
      },
      donutCharts: null,
      oltMatrix: [],
      topAlertPorts: [],
      olts: [],
      selectedOltFilter: "",
      alertFilter: "all"
    },
    oltAlertsDialog: {
      visible: false,
      olt: null,
      ports: []
    },
    weakUsersDialog: {
      visible: false,
      ponPort: "",
      fullPortDisplay: "",
      primaryArea: "",
      oltIp: "",
      users: []
    }
  };
}
