import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const appRoot = process.env.OLT_MANAGER_APP_ROOT || fileURLToPath(new URL("..", import.meta.url));
export const staticRoot = process.env.OLT_MANAGER_STATIC_DIR || "";
export const dataRoot = process.env.OLT_MANAGER_DATA_DIR || join(appRoot, "data");
export const seedRoot = process.env.OLT_MANAGER_SEED_DIR || join(appRoot, "data");

const toolEnvNames = {
  sqlite3: "OLT_MANAGER_SQLITE_BIN",
  snmpget: "OLT_MANAGER_SNMPGET_BIN",
  snmpwalk: "OLT_MANAGER_SNMPWALK_BIN",
  snmpbulkwalk: "OLT_MANAGER_SNMPBULKWALK_BIN"
};

function withPlatformExtension(name) {
  return process.platform === "win32" && !name.endsWith(".exe") ? `${name}.exe` : name;
}

function bundledToolCandidates(name) {
  const exe = withPlatformExtension(name);
  const candidates = [];
  if (process.env.OLT_MANAGER_BIN_DIR) candidates.push(join(process.env.OLT_MANAGER_BIN_DIR, exe));
  if (process.resourcesPath) {
    candidates.push(join(process.resourcesPath, "bin", process.platform, exe));
    candidates.push(join(process.resourcesPath, "bin", exe));
  }
  if (process.platform === "darwin" && name === "sqlite3") candidates.push("/usr/bin/sqlite3");
  candidates.push(exe);
  return candidates;
}

export function resolveTool(name) {
  const envName = toolEnvNames[name];
  const configured = envName ? process.env[envName] : "";
  if (configured) return configured;
  return bundledToolCandidates(name).find((candidate) => !candidate.includes("/") || existsSync(candidate)) || withPlatformExtension(name);
}

export function missingToolMessage(name) {
  const envName = toolEnvNames[name];
  const exe = withPlatformExtension(name);
  const hint = envName ? `可通过环境变量 ${envName} 指定工具路径。` : "";
  if (process.platform === "win32") {
    return `未找到 ${exe}。Windows 发行包需要内置该工具，或将工具加入 PATH。${hint}`;
  }
  return `未找到 ${name}。请安装系统依赖，或配置工具路径。${hint}`;
}
