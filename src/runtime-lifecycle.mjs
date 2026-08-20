const DEFAULT_CLOSE_TIMEOUT_MS = 1_000;

export const RUNTIME_LIFECYCLE_STATES = Object.freeze({
  STARTING: "starting",
  READY: "ready",
  CLOSING: "closing",
  CLOSED: "closed"
});

function serverFromHandle(handle) {
  return handle?.server || handle;
}

function isServerNotRunning(error) {
  return error?.code === "ERR_SERVER_NOT_RUNNING";
}

function waitForTimeout(setTimeoutImpl, clearTimeoutImpl, timeoutMs) {
  let timer;
  const promise = new Promise((resolve) => {
    timer = setTimeoutImpl(resolve, timeoutMs);
  });
  return {
    promise,
    clear: () => clearTimeoutImpl(timer)
  };
}

/**
 * Coordinates the lifecycle of a temporary/local HTTP runtime.
 * It deliberately knows only about an optional server-like handle.
 */
export function createRuntimeLifecycle({
  closeTimeoutMs = DEFAULT_CLOSE_TIMEOUT_MS,
  abortController = new AbortController(),
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout
} = {}) {
  let state = RUNTIME_LIFECYCLE_STATES.STARTING;
  let handle;
  let startPromise;
  let closePromise;
  let closeResult;

  function abort(reason = "shutdown") {
    if (!abortController.signal.aborted) abortController.abort(reason);
    return abortController.signal;
  }

  function snapshot() {
    return {
      state,
      handle,
      signal: abortController.signal,
      abortReason: abortController.signal.reason
    };
  }

  async function closeServer(server, { force, timeoutMs }) {
    if (!server || typeof server.close !== "function") {
      return { closed: false, forced: false, timedOut: false };
    }

    if (force) server.closeAllConnections?.();

    let settled = false;
    let resolveClose;
    let rejectClose;
    const closeCall = new Promise((resolve, reject) => {
      resolveClose = resolve;
      rejectClose = reject;
    });
    try {
      server.close((error) => {
        if (settled) return;
        settled = true;
        if (error && !isServerNotRunning(error)) rejectClose(error);
        else resolveClose();
      });
    } catch (error) {
      settled = true;
      if (isServerNotRunning(error)) resolveClose();
      else rejectClose(error);
    }

    const timeout = waitForTimeout(setTimeoutImpl, clearTimeoutImpl, timeoutMs);
    const winner = await Promise.race([
      closeCall.then(() => ({ closed: true, forced: force, timedOut: false })),
      timeout.promise.then(() => ({ closed: true, forced: true, timedOut: true }))
    ]);
    timeout.clear();
    if (winner.timedOut) server.closeAllConnections?.();
    return winner;
  }

  async function performClose({ force, shouldAbort, reason, timeoutMs }) {
    state = RUNTIME_LIFECYCLE_STATES.CLOSING;
    if (shouldAbort) abort(reason);
    let result;
    let closeError;
    try {
      result = await closeServer(serverFromHandle(handle), {
        force,
        timeoutMs: Math.max(0, Number(timeoutMs) || 0)
      });
    } catch (error) {
      closeError = error;
      result = { closed: false, forced: force, timedOut: false };
    } finally {
      state = RUNTIME_LIFECYCLE_STATES.CLOSED;
      closeResult = { ...result, ...snapshot() };
    }
    if (closeError) throw closeError;
    return closeResult;
  }

  async function close({ force = false, abort: shouldAbort = true, reason = "shutdown", timeoutMs = closeTimeoutMs } = {}) {
    if (closePromise) return closePromise;
    if (state === RUNTIME_LIFECYCLE_STATES.CLOSED) return closeResult || snapshot();

    closePromise = (async () => {
      if (state === RUNTIME_LIFECYCLE_STATES.STARTING && startPromise) {
        if (shouldAbort) abort(reason);
        try {
          await startPromise;
        } catch {
          // Startup owns its original error; shutdown still needs to finish.
        }
        if (state === RUNTIME_LIFECYCLE_STATES.CLOSED) return closeResult || snapshot();
        return performClose({ force, shouldAbort: false, reason, timeoutMs });
      }
      return performClose({ force, shouldAbort, reason, timeoutMs });
    })();
    return closePromise;
  }

  async function start(startFn) {
    if (typeof startFn !== "function") throw new TypeError("startFn must be a function");
    if (state === RUNTIME_LIFECYCLE_STATES.READY) return handle;
    if (state !== RUNTIME_LIFECYCLE_STATES.STARTING) {
      throw new Error(`runtime cannot start from ${state}`);
    }
    if (startPromise) return startPromise;
    startPromise = (async () => {
      try {
        const nextHandle = await startFn({ signal: abortController.signal });
        if (nextHandle !== undefined) handle = nextHandle;
        if (abortController.signal.aborted) {
          const error = new Error("runtime startup aborted");
          error.name = "AbortError";
          throw error;
        }
        state = RUNTIME_LIFECYCLE_STATES.READY;
        return handle;
      } catch (error) {
        try {
          await performClose({ force: true, shouldAbort: true, reason: "startup-failed", timeoutMs: closeTimeoutMs });
        } catch {
          // Preserve the startup error; shutdown diagnostics belong to the host.
        }
        throw error;
      } finally {
        startPromise = undefined;
      }
    })();
    return startPromise;
  }

  return {
    abort,
    close,
    getHandle: () => handle,
    getState: () => state,
    get signal() { return abortController.signal; },
    snapshot,
    start
  };
}
