import test from "node:test";
import assert from "node:assert/strict";
import {
  initDb,
  getBotAiConfig,
  saveBotAiConfig,
  saveResourceManagementConfig,
  getResourceManagementConfig,
  saveOssResourceConfig,
  getOssResourceConfig
} from "../src/db.mjs";

test("bot_ai_config stores and retrieves Feishu, Jev, Pi Agent, and AnySearch configurations in SQLite", async () => {
  await initDb();
  const initial = await getBotAiConfig();
  assert.equal(typeof initial.feishuEnabled, "boolean");
  assert.equal(typeof initial.feishuAppId, "string");
  assert.equal(typeof initial.jevApiKey, "string");
  assert.equal(typeof initial.piApiKey, "string");
  assert.equal(typeof initial.anysearchApiKey, "string");

  const saved = await saveBotAiConfig({
    feishuEnabled: true,
    feishuAppId: "cli_1234567890abcdef",
    feishuAppSecret: "secret_feishu_test",
    jevProviderName: "jev",
    jevEndpoint: "https://api.jev.ai/v1",
    jevModel: "jev-plus",
    jevFormat: "responses",
    jevApiKey: "sk-jev-123456",
    piProviderName: "openai-compatible",
    piEndpoint: "https://api.pi.ai/v1",
    piModel: "pi-chat",
    piFormat: "chat-completions",
    piApiKey: "sk-pi-654321",
    anysearchApiKey: "as_sk_test_key_888",
    anysearchEnabled: true,
    wecomEnabled: true,
    wecomBotId: "wecom_bot_test_001",
    wecomSecret: "wecom_secret_test_xyz"
  });

  assert.equal(saved.feishuEnabled, true);
  assert.equal(saved.feishuAppId, "cli_1234567890abcdef");
  assert.equal(saved.feishuAppSecret, "secret_feishu_test");
  assert.equal(saved.jevApiKey, "sk-jev-123456");
  assert.equal(saved.jevModel, "jev-plus");
  assert.equal(saved.piApiKey, "sk-pi-654321");
  assert.equal(saved.anysearchApiKey, "as_sk_test_key_888");
  assert.equal(saved.wecomEnabled, true);
  assert.equal(saved.wecomBotId, "wecom_bot_test_001");
  assert.equal(saved.wecomSecret, "wecom_secret_test_xyz");

  const readBack = await getBotAiConfig();
  assert.equal(readBack.feishuAppSecret, "secret_feishu_test");
  assert.equal(readBack.jevApiKey, "sk-jev-123456");
  assert.equal(readBack.piApiKey, "sk-pi-654321");
  assert.equal(readBack.anysearchApiKey, "as_sk_test_key_888");
  assert.equal(readBack.wecomEnabled, true);
  assert.equal(readBack.wecomBotId, "wecom_bot_test_001");
  assert.equal(readBack.wecomSecret, "wecom_secret_test_xyz");
});

test("NMSE and OSS resource configurations retain and echo passwords from SQLite", async () => {
  await saveResourceManagementConfig({
    serverUrl: "http://172.18.254.7:9000",
    username: "admin",
    password: "nmse_password_888"
  });

  const nmseConfig = await getResourceManagementConfig();
  assert.equal(nmseConfig.serverUrl, "http://172.18.254.7:9000");
  assert.equal(nmseConfig.username, "admin");
  assert.equal(nmseConfig.password, "nmse_password_888");
  assert.equal(nmseConfig.configured, true);

  await saveOssResourceConfig({
    authBaseUrl: "http://10.205.136.199:18140",
    ngbBaseUrl: "http://10.205.137.22:8080",
    username: "oss_operator",
    password: "oss_password_999",
    organizationName: "测试组织",
    roomName: "测试机房"
  });

  const ossConfig = await getOssResourceConfig();
  assert.equal(ossConfig.authBaseUrl, "http://10.205.136.199:18140");
  assert.equal(ossConfig.username, "oss_operator");
  assert.equal(ossConfig.password, "oss_password_999");
  assert.equal(ossConfig.configured, true);
});
