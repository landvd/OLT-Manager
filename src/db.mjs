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
  initializeNmseBossSyncState,
  resetNmseBossNameHistory,
  replaceNmseBossNameHistory,
  applyNmseBossIncrementalChanges,
  recordMergedOnuSourceSyncSuccess,
  getMergedOnuSnapshots,
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
  deleteLearnedMemory
} from "./db/agent.mjs";
export {
  exportDatabaseBackup,
  createDatabaseBackup,
  backupDatabaseBeforeSync,
  planDatabaseBackupCleanup,
  executeDatabaseBackupCleanup,
  validateDatabaseBackup,
  restoreDatabaseBackup
} from "./db/backup.mjs";
