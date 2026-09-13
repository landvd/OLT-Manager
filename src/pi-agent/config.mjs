/**
 * Pi Agent 配置持久化与运行时管理
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { dataRoot } from "../runtime-paths.mjs";

const DEFAULT_ANYSEARCH_API_KEY = "as_sk_e073d907a118c3bbba1ce741a5aa3e75";
const CONFIG_FILE_NAME = "pi-agent-config.json";

let memoryConfig = null;

function getConfigFilePath() {
  return join(dataRoot, CONFIG_FILE_NAME);
}

/**
 * 遮罩显示 API Key
 */
export function maskApiKey(key) {
  const str = String(key || "").trim();
  if (!str) return "";
  if (str.length <= 12) return str.slice(0, 4) + "****" + str.slice(-2);
  return str.slice(0, 8) + "..." + str.slice(-6);
}

/**
 * 读取当前 Pi Agent 配置
 */
export function getPiAgentConfig() {
  if (memoryConfig) {
    return { ...memoryConfig };
  }

  const filePath = getConfigFilePath();
  let fileConfig = {};

  try {
    if (existsSync(filePath)) {
      const raw = readFileSync(filePath, "utf8");
      fileConfig = JSON.parse(raw) || {};
    }
  } catch (err) {
    console.warn(`[pi-agent-config] 读取配置文件失败: ${err.message}`);
  }

  const anysearchApiKey = (
    fileConfig.anysearchApiKey ||
    process.env.ANYSEARCH_API_KEY ||
    DEFAULT_ANYSEARCH_API_KEY
  ).trim();

  memoryConfig = {
    anysearchApiKey,
    updatedAt: fileConfig.updatedAt || new Date().toISOString()
  };

  return { ...memoryConfig };
}

/**
 * 更新并持久化 Pi Agent 配置
 */
export function updatePiAgentConfig(patch = {}) {
  const current = getPiAgentConfig();
  const nextKey = typeof patch.anysearchApiKey === "string"
    ? patch.anysearchApiKey.trim()
    : current.anysearchApiKey;

  const nextConfig = {
    ...current,
    anysearchApiKey: nextKey,
    updatedAt: new Date().toISOString()
  };

  const filePath = getConfigFilePath();
  try {
    if (!existsSync(dataRoot)) {
      mkdirSync(dataRoot, { recursive: true });
    }
    writeFileSync(filePath, JSON.stringify(nextConfig, null, 2), "utf8");
  } catch (err) {
    if (err.code !== "EPERM" && err.code !== "EROFS") {
      console.warn(`[pi-agent-config] 持久化配置文件降级: ${err.message}`);
    }
  }

  memoryConfig = nextConfig;
  return { ...nextConfig };
}
