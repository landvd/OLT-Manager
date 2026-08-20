async function readJson(response) {
  return response.json();
}

export function createBackupApi({ fetch } = {}) {
  if (typeof fetch !== "function") throw new TypeError("备份 API 需要注入 fetch。 ");

  return Object.freeze({
    async exportSqlite() {
      const response = await fetch("/api/admin/backup");
      if (!response.ok) throw new Error("导出备份失败");
      return response.blob();
    },

    async exportEncrypted(password) {
      const response = await fetch("/api/admin/backup/encrypted", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: String(password || "") })
      });
      if (!response.ok) throw new Error("加密备份导出失败");
      return response.blob();
    },

    async restoreEncrypted(file, password) {
      const response = await fetch("/api/admin/restore-encrypted", {
        method: "POST",
        headers: {
          "content-type": "application/vnd.olt-manager.encrypted-backup",
          "X-OLT-Manager-Backup-Password": String(password || "")
        },
        body: file
      });
      if (!response.ok) throw new Error("加密备份还原失败");
      return response;
    },

    async restoreSqlite(file) {
      const response = await fetch("/api/admin/restore", {
        method: "POST",
        headers: { "content-type": "application/vnd.sqlite3" },
        body: file
      });
      const data = await readJson(response);
      if (!response.ok) throw new Error(data.error || "备份还原失败");
      return data;
    }
  });
}
