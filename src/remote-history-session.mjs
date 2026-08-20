export const DEFAULT_REMOTE_HISTORY_SESSION_LEASE_MS = 10 * 60 * 1000;

function requiredFunction(value, label) {
  if (typeof value !== "function") throw new TypeError(`${label} must be a function.`);
  return value;
}

/**
 * Owns the short-lived, on-demand OSS/NGB session used by historical optical reads.
 * The remote protocol has no verified logout endpoint in this adapter; clearing the
 * in-memory session releases the cookie-bearing client and is the existing logout boundary.
 */
export function createRemoteHistorySession({
  getSession,
  login,
  clearSession,
  now = () => Date.now(),
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
  leaseMs = DEFAULT_REMOTE_HISTORY_SESSION_LEASE_MS
} = {}) {
  requiredFunction(getSession, "getSession");
  requiredFunction(login, "login");
  requiredFunction(clearSession, "clearSession");
  if (!Number.isFinite(Number(leaseMs)) || Number(leaseMs) <= 0) {
    throw new TypeError("leaseMs must be a positive number.");
  }

  let managed = null;
  let loginPromise = null;

  function disarm(expectedSession) {
    if (!managed || (expectedSession && managed.session !== expectedSession)) return null;
    const previous = managed;
    managed = null;
    if (previous.timer) clearTimeoutImpl(previous.timer);
    return previous;
  }

  async function clearManagedSession(expectedSession) {
    const previous = disarm(expectedSession);
    if (!previous) return false;
    if (getSession() !== previous.session) return false;
    await clearSession(previous.session);
    return true;
  }

  function arm(session) {
    const expiresAt = Number(now()) + Number(leaseMs);
    const timer = setTimeoutImpl(() => {
      void clearManagedSession(session).catch(() => {});
    }, Number(leaseMs));
    timer?.unref?.();
    managed = { session, expiresAt, timer };
    return session;
  }

  async function ensure() {
    const current = getSession();
    if (managed && managed.session !== current) disarm();
    if (current && managed && managed.expiresAt > Number(now())) return current;
    if (current && !managed) return current;
    if (managed?.session === current && managed.expiresAt <= Number(now())) {
      await clearManagedSession(current);
    }
    if (loginPromise) return loginPromise;
    const pending = (async () => arm(await login({ autoLogin: true })))();
    loginPromise = pending;
    try {
      return await pending;
    } finally {
      if (loginPromise === pending) loginPromise = null;
    }
  }

  async function invalidate(expectedSession = getSession()) {
    if (managed && (!expectedSession || managed.session === expectedSession)) {
      return clearManagedSession(expectedSession);
    }
    if (expectedSession && getSession() === expectedSession) {
      await clearSession(expectedSession);
      return true;
    }
    return false;
  }

  async function close() {
    const current = getSession();
    disarm();
    if (!current) return false;
    await clearSession(current);
    return true;
  }

  return Object.freeze({ ensure, invalidate, close });
}
