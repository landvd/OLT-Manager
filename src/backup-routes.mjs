export async function handleBackupRoutes(req, res, url, {
  exportDatabaseBackup,
  restoreDatabaseBackup,
  validateDatabaseBackup,
  createEncryptedBackupContainer,
  decryptEncryptedBackupContainer,
  readEncryptedBackupPasswordBody,
  readEncryptedBackupContainer,
  readBinaryBody,
  encryptedBackupError,
  encryptedBackupPasswordHeader,
  backupCleanupRuntime,
  readBody,
  json,
  clearRemoteSessions
} = {}) {
  if (req.method === "POST" && url.pathname === "/api/admin/backup/encrypted") {
    try {
      const password = await readEncryptedBackupPasswordBody(req);
      const backup = await exportDatabaseBackup();
      const container = createEncryptedBackupContainer(backup, password, { purpose: "sqlite-full" });
      res.writeHead(200, {
        "content-type": "application/vnd.olt-manager.encrypted-backup",
        "content-disposition": `attachment; filename=olt-manager-backup-${new Date().toISOString().slice(0, 10)}.sqlite.enc`,
        "content-length": container.length,
        "cache-control": "no-store"
      });
      res.end(container);
      return true;
    } catch (error) {
      const status = error?.status === 413 ? 413 : 400;
      await json(res, status, { ok: false, code: error?.code === "BACKUP_PASSWORD_REQUIRED" ? error.code : "ENCRYPTED_BACKUP_INVALID", error: status === 413 ? "加密备份请求过大。" : "加密备份请求无效。" });
      return true;
    }
  }
  if (req.method === "POST" && url.pathname === "/api/admin/restore-encrypted") {
    try {
      const password = req.headers[encryptedBackupPasswordHeader];
      if (typeof password !== "string" || !password) throw encryptedBackupError("BACKUP_PASSWORD_REQUIRED");
      const container = await readEncryptedBackupContainer(req);
      const backup = decryptEncryptedBackupContainer(container, password);
      await validateDatabaseBackup(backup);
      await restoreDatabaseBackup(backup);
      clearRemoteSessions();
      await json(res, 200, { ok: true });
      return true;
    } catch (error) {
      const status = error?.status === 413 ? 413 : 400;
      await json(res, status, { ok: false, code: error?.code === "BACKUP_PASSWORD_REQUIRED" ? error.code : "ENCRYPTED_BACKUP_INVALID", error: status === 413 ? "加密备份请求过大。" : "加密备份请求无效。" });
      return true;
    }
  }
  if (req.method === "GET" && url.pathname === "/api/admin/backup") {
    const backup = await exportDatabaseBackup();
    res.writeHead(200, {
      "content-type": "application/vnd.sqlite3",
      "content-disposition": `attachment; filename=olt-manager-backup-${new Date().toISOString().slice(0, 10)}.sqlite`,
      "content-length": backup.length
    });
    res.end(backup);
    return true;
  }
  if (req.method === "GET" && url.pathname === "/api/admin/backup/cleanup/status") {
    await json(res, 200, { ok: true, ...backupCleanupRuntime.status() });
    return true;
  }
  if (req.method === "POST" && url.pathname === "/api/admin/backup/cleanup/trigger") {
    try {
      const body = await readBody(req);
      const result = await backupCleanupRuntime.trigger({ confirmed: body.confirmed === true });
      await json(res, 200, { ok: true, ...result });
    } catch (error) {
      await json(res, error.status || 400, { ok: false, code: error.code || "BACKUP_CLEANUP_FAILED", error: error.message || "备份清理失败。" });
    }
    return true;
  }
  if (req.method === "POST" && url.pathname === "/api/admin/restore") {
    try {
      await restoreDatabaseBackup(await readBinaryBody(req));
      clearRemoteSessions();
      await json(res, 200, { ok: true });
      return true;
    } catch (error) {
      await json(res, error.status || 400, { ok: false, error: error.message || "备份还原失败。" });
      return true;
    }
  }
  return false;
}
