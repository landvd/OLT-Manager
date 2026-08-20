function requireFetch(fetcher) {
  if (typeof fetcher !== "function") throw new TypeError("local auth API requires fetch");
  return fetcher;
}

async function json(response) {
  return response.json();
}

async function checkedJson(response, fallback) {
  const data = await json(response);
  if (!response.ok) throw new Error(data.error || data.message || fallback);
  return data;
}

function bearerHeaders(token, headers = {}) {
  return token ? { ...headers, authorization: `Bearer ${token}` } : headers;
}

export function createLocalAuthApi({ fetch }) {
  const request = requireFetch(fetch);
  return {
    session(token) {
      return request("/api/auth/session", token ? { headers: bearerHeaders(token) } : undefined).then(json);
    },
    updateRequirement(enabled, token) {
      return request("/api/auth/settings", {
        method: "POST",
        headers: bearerHeaders(token, { "content-type": "application/json" }),
        body: JSON.stringify({ enabled: enabled !== false })
      }).then((response) => checkedJson(response, "登录保护设置失败。"));
    },
    authenticate({ setupRequired, password }) {
      const endpoint = setupRequired ? "/api/auth/setup" : "/api/auth/login";
      return request(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password })
      }).then((response) => checkedJson(response, "登录失败。"));
    },
    bootstrap() {
      return request("/api/bootstrap").then(json);
    }
  };
}
