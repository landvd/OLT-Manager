// 数据库门面：按领域拆分到 src/db/*.mjs，对外 API 与拆分前保持一致。
export {
  query as rawQuery,
  exec as rawExec,
  sqlQuote,
  configureResourceManagementSecretProvider
} from "./db/core.mjs";
export {
  oltSchemaMigrationSql,
  initDb
} from "./db/schema.mjs";
export {
  oltInsertSql,
  normalizeOltVendor,
  mapOltRow,
  getOlts,
  replaceOlts,
  getPonPorts,
  replacePonPorts,
  updatePonPortVlans
} from "./db/olts.mjs";
export {
  getResourceManagementConfig,
  getBossQueryContent,
  getResourceManagementPassword,
  migrateResourceManagementCredential,
  saveResourceManagementConfig,
  getOssResourceConfig,
  getOssResourcePassword,
  getBotAiConfig,
  saveBotAiConfig,
  getOssResourceCredential,
  saveOssResourceCredential,
  saveOssResourceConfig,
  normalizeResourceOltIpMappings,
  getResourceOltIpMappings,
  replaceResourceOltIpMappings
} from "./db/resource-config.mjs";
export {
  getResourceSyncTasks,
  createResourceSyncTask,
  updateResourceSyncTask,
  deleteResourceSyncTask,
  getResourceUsers,
  recordOnuStatusHistory,
  getOnuStatusHistory,
  getResourceUserDatasetRevision,
  normalizeResourceInstallationAddress,
  cleanResourceInstallationAddresses,
  replaceResourceUsers,
  replaceResourceUsersBatch,
  replaceResourceUserCheckpoint,
  getResourceVlanSnapshot,
  replaceResourceVlans
} from "./db/resource-sync.mjs";
export {
  getMergedOnuNetworkSource,
  getMergedOnuNmseSource,
  getMergedOnuSourceStatus,
  replaceMergedOnuNetworkSource,
  replaceMergedOnuNmseSource,
  getNmseBossSyncState,
  getNmseBossEventKeys,
  initializeNmseBossSyncState,
  resetNmseBossNameHistory,
  replaceNmseBossNameHistory,
  applyNmseBossIncrementalChanges,
  recordMergedOnuSourceSyncSuccess,
  getMergedOnuSnapshots,
  getMergedOnuAddressIndex,
  getMergedOnuPonCoordinates,
  getMergedOnuConflicts,
  getMergedOnuSyncRuns,
  beginMergedOnuSyncRun,
  claimMergedOnuSyncLease,
  renewMergedOnuSyncLease,
  updateMergedOnuSyncRuntime,
  persistMergedOnuManifest,
  getMergedOnuSyncManifest,
  getLatestMergedOnuSourceManifest,
  listRecoverableMergedOnuSyncRuns,
  getMergedOnuDatasetRevision,
  getMergedOnuDatasetRevisionValue,
  getMergedOnuDatasetStatus,
  replaceMergedOnuDataset,
  recordMergedOnuSyncFailure,
  cleanupDuplicateSnapshotCoordinates
} from "./db/merged-onu.mjs";
export {
  getProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  addProjectOnu,
  getProjectOnus,
  updateProjectOnuNote,
  deleteProjectOnu,
  getProjectOnuAssignments
} from "./db/projects.mjs";
export {
  addSnmpProbe,
  getSnmpHistory,
  getAdminEvents
} from "./db/admin.mjs";
export {
  seedConfigTemplates,
  listConfigTemplates,
  getConfigTemplate,
  saveConfigTemplate,
  deleteConfigTemplate,
  resetBuiltinConfigTemplate
} from "./db/config-templates.mjs";
export {
  getOnuDigitalTwin,
  getPortExperience,
  saveLearnedMemory,
  queryLearnedMemories,
  incrementMemoryHitCount,
  getLearnedMemories,
  reviewLearnedMemory,
  deleteLearnedMemory,
  saveUserCorrection,
  getUserCorrection,
  getUserCorrections,
  getActiveUserCorrections,
  reviewUserCorrection,
  deleteUserCorrection
} from "./db/agent.mjs";
export {
  recordOpticalNightlySamples,
  getOpticalNightlySamples,
  getLatestOpticalSamples,
  beginOpticalBaselineRun,
  finishOpticalBaselineRun,
  getOpticalBaselineRuns,
  markInterruptedOpticalBaselineRuns,
  getOpticalBaselineSettings,
  saveOpticalBaselineSettings,
  getOpticalBaselineCoverage
} from "./db/optical-baseline.mjs";
export {
  getVillageRegions,
  getVillageRegionVillages,
  saveVillageRegionCandidates,
  createVillageRegion,
  updateVillageRegion,
  updateVillageRegionPons,
  deleteVillageRegion
} from "./db/village-regions.mjs";
export {
  getPlaceRules,
  createPlaceRule,
  updatePlaceRule,
  deletePlaceRule,
  getPlaceOverrides,
  savePlaceOverride,
  deletePlaceOverride,
  acceptPlaceRecommendations,
  getPortPlaceAssignments,
  savePortPlaceAssignment,
  savePortPlaceAssignments,
  ensurePlaceAssignments,
  getPlaceSummary,
  getPlaceUsers,
  getPlaceSuggestions,
  previewPlaceRule,
  getPonPlaceSummary
} from "./db/places.mjs";
export {
  recordConversationLog,
  getConversationLogs,
  getConversationLog,
  getConversationLogsForExport
} from "./db/conversation-logs.mjs";
export {
  saveBossRecentInstalls,
  getBossRecentInstallKeys,
  getBossRecentInstalls,
  recordBossRecentInstallRun,
  getBossRecentInstallRuns,
  getBossRecentInstallOverlay,
  overlayRecentInstalls
} from "./db/recent-installs.mjs";
export {
  getEditApprover,
  saveEditApprover,
  getFeishuKnownUsers,
  createEditRequest,
  getEditRequest,
  findPendingEditRequest,
  getEditRequests,
  updateEditRequestPrevious,
  decideEditRequest,
  getPonLedgerRows,
  findPonLedgerRowsByAddress,
  applyPrimaryAddressEdit,
  getOnuPlace,
  getKnownPlaces
} from "./db/edit-requests.mjs";
export {
  DATA_PACKAGE_CATEGORIES,
  exportDataPackage,
  inspectDataPackage,
  importDataPackage,
  pauseScheduledWorkForCopy
} from "./db/data-package.mjs";
export {
  recordOutageOccurrences,
  closeOutageOccurrences,
  getOutageOccurrences,
  recordRepairInspection,
  getRepairInspections,
  saveCableGroupCandidates,
  getCableGroups,
  reviewCableGroup,
  recordUnresolvedQuestion,
  getUnresolvedQuestions,
  updateUnresolvedQuestion
} from "./db/field-archive.mjs";
export {
  recordFeishuQueryLog,
  markFeishuQueryNegative,
  getPreviousFeishuQuery,
  getFeishuQueryLogs,
  getFeishuQueryStats,
  setFeishuUserName,
  upsertFeishuLearningSuggestion,
  getFeishuLearningSuggestions,
  reviewFeishuLearningSuggestion,
  deleteFeishuLearningSuggestion
} from "./db/feishu-learning.mjs";
export {
  exportDatabaseBackup,
  createDatabaseBackup,
  backupDatabaseBeforeSync,
  planDatabaseBackupCleanup,
  executeDatabaseBackupCleanup,
  validateDatabaseBackup,
  restoreDatabaseBackup
} from "./db/backup.mjs";
