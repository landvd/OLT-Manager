const AUTH_TOKEN_STORAGE_KEY = "olt-manager-auth-token";

function defaultStorage() {
  return typeof globalThis.sessionStorage === "undefined" ? null : globalThis.sessionStorage;
}

export function createLocalAuthClient({ fetchImpl = globalThis.fetch?.bind(globalThis), storage = defaultStorage() } = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function");

  let token = storage?.getItem(AUTH_TOKEN_STORAGE_KEY) || "";

  function getToken() {
    return token;
  }

  function setToken(value) {
    token = String(value || "");
    if (token) storage?.setItem(AUTH_TOKEN_STORAGE_KEY, token);
    else storage?.removeItem(AUTH_TOKEN_STORAGE_KEY);
  }

  function clearToken() {
    setToken("");
  }

  function request(input, options = {}) {
    const headers = new Headers(options.headers || {});
    const path = String(input);
    if (token && path.startsWith("/api/") && !path.startsWith("/api/auth/")) {
      headers.set("authorization", `Bearer ${token}`);
    }
    return fetchImpl(input, { ...options, headers });
  }

  return { getToken, setToken, clearToken, fetch: request };
}
