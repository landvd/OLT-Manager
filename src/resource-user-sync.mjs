function idleProgress() {
  return { running: false, total: 0, pages: 0, completedPages: 0, received: 0, workers: 0 };
}

function syncingError() {
  const error = new Error("当前 OLT 正在同步用户信息。");
  error.status = 409;
  return error;
}

export function createResourceUserSync({ remote, snapshots } = {}) {
  if (!remote?.getUsers || !snapshots?.replaceComplete || !snapshots?.replaceCheckpoint) {
    throw new Error("用户同步 module 缺少 remote 或 snapshots adapter。");
  }

  const progressByOlt = new Map();

  function progressFor(oltId) {
    return progressByOlt.get(String(oltId || "")) || idleProgress();
  }

  function begin(oltId) {
    const key = String(oltId || "");
    if (progressFor(key).running) throw syncingError();
    progressByOlt.set(key, {
      running: true,
      phase: "fetching-total",
      total: 0,
      pages: 0,
      completedPages: 0,
      received: 0,
      workers: 0,
      attempt: 0,
      maxAttempts: 3
    });
    return key;
  }

  function report(oltId, next) {
    progressByOlt.set(oltId, { running: true, ...next });
  }

  function fail(oltId, error) {
    progressByOlt.set(oltId, { ...progressFor(oltId), running: false, error: error.message || "用户信息同步失败。" });
  }

  async function readRows({ oltId, session, gridRank, maxPages }) {
    const key = begin(oltId);
    try {
      const rows = await remote.getUsers({
        session,
        gridRank,
        maxPages,
        onProgress: (next) => report(key, next)
      });
      return { key, rows };
    } catch (error) {
      fail(key, error);
      throw error;
    }
  }

  async function syncComplete({ oltId, oltIp, gridRank, session } = {}) {
    const { key, rows } = await readRows({ oltId, session, gridRank });
    try {
      const result = await snapshots.replaceComplete({ oltIp, gridRank, rows });
      const completed = progressFor(key);
      progressByOlt.set(key, {
        ...completed,
        running: false,
        total: completed.total || rows.length,
        received: rows.length,
        completedPages: completed.pages || completed.completedPages || 1,
        completedAt: new Date().toISOString()
      });
      return result;
    } catch (error) {
      fail(key, error);
      throw error;
    }
  }

  async function saveCheckpoint({ oltId, oltIp, gridRank, session, maxPages } = {}) {
    const { key, rows } = await readRows({ oltId, session, gridRank, maxPages });
    try {
      const completed = progressFor(key);
      const result = await snapshots.replaceCheckpoint({
        oltIp,
        gridRank,
        expectedTotal: completed.total,
        completedPages: completed.completedPages,
        rows
      });
      progressByOlt.set(key, {
        ...completed,
        running: false,
        total: completed.total || rows.length,
        received: rows.length,
        completedAt: new Date().toISOString()
      });
      return { ...result, partial: result.count < result.expectedTotal };
    } catch (error) {
      fail(key, error);
      throw error;
    }
  }

  return { progressFor, syncComplete, saveCheckpoint };
}
