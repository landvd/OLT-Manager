export function createRemoteSessionState() {
  let nmseSession = null;
  let nmseMigrationMasterPassword = "";
  let ossNgbSession = null;

  return Object.freeze({
    getNmseSession: () => nmseSession,
    setNmseSession: (session) => { nmseSession = session || null; return nmseSession; },
    clearNmseSession: () => { nmseSession = null; },
    getNmseMigrationMasterPassword: () => nmseMigrationMasterPassword,
    setNmseMigrationMasterPassword: (password) => {
      nmseMigrationMasterPassword = typeof password === "string" ? password : "";
    },
    clearNmseMigrationMasterPassword: () => { nmseMigrationMasterPassword = ""; },
    getOssNgbSession: () => ossNgbSession,
    setOssNgbSession: (session) => { ossNgbSession = session || null; return ossNgbSession; },
    clearOssNgbSession: () => { ossNgbSession = null; },
    clearAll: () => {
      nmseSession = null;
      nmseMigrationMasterPassword = "";
      ossNgbSession = null;
    }
  });
}
