export function createEncryptedBackupState() {
  return {
    password: "",
    confirmation: "",
    exporting: false,
    importing: false
  };
}

export function clearEncryptedBackupPasswords(state) {
  return {
    ...state,
    password: "",
    confirmation: ""
  };
}

export function validateEncryptedBackupPassword(password, confirmation = password) {
  const value = typeof password === "string" ? password : "";
  const repeated = typeof confirmation === "string" ? confirmation : "";
  if (value.length < 8) return { valid: false, reason: "too-short" };
  if (value !== repeated) return { valid: false, reason: "mismatch" };
  return { valid: true, reason: "ok" };
}

export function isEncryptedBackupFile({ name = "", type = "" } = {}) {
  return String(name).toLowerCase().endsWith(".sqlite.enc")
    || String(type).toLowerCase() === "application/vnd.olt-manager.encrypted-backup";
}
