import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { discoverCCSwitchProviders, safeProviderConfig } from "../electron/cc-switch-provider-discovery.cjs";

const testFile = fileURLToPath(import.meta.url);

test("CC Switch discovery returns only non-sensitive provider metadata", () => {
  const providers = discoverCCSwitchProviders({
    databasePath: testFile,
    queryRunner: (_sqlite, _database, query) => query.includes("FROM providers")
      ? [{
          id: "provider-1", app_type: "codex", name: "Example", website_url: "https://example.com",
          settings_config: JSON.stringify({ config: JSON.stringify({ base_url: "https://example.com/v1", model: "model-1", wire_api: "responses", api_key: "must-not-leak" }) })
        }]
      : [{ provider_id: "provider-1", app_type: "codex", url: "https://example.com/v1" }]
  });
  assert.deepEqual(providers, [{
    id: "provider-1",
    appType: "codex",
    name: "Example",
    endpoint: "https://example.com/v1",
    model: "model-1",
    format: "responses",
    source: "CC Switch"
  }]);
  assert.doesNotMatch(JSON.stringify(providers), /must-not-leak|api_key/i);
});

test("CC Switch config sanitizer ignores credential-shaped keys", () => {
  const result = safeProviderConfig({
    endpoint: "https://example.com/v1",
    model: "model-1",
    apiKey: "secret",
    auth: { token: "secret" },
    format: "Responses（原生）"
  });
  assert.deepEqual(result, { endpoint: "https://example.com/v1", model: "model-1", format: "responses" });
});

test("CC Switch discovery coerces MiniMax providers to Chat Completions", () => {
  const providers = discoverCCSwitchProviders({
    databasePath: testFile,
    queryRunner: (_sqlite, _database, query) => query.includes("FROM providers")
      ? [{
          id: "provider-minimax", app_type: "codex", name: "MiniMax",
          settings_config: JSON.stringify({ base_url: "https://api.minimaxi.com/v1", model: "MiniMax-M2.7-highspeed", wire_api: "responses" })
        }]
      : [{ provider_id: "provider-minimax", app_type: "codex", url: "https://api.minimaxi.com/v1" }]
  });

  assert.equal(providers[0].format, "chat-completions");
});
