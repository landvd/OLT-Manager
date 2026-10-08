// 数据库路径、进程内 SQLite 仓储与资源管理密钥提供器（唯一可变的模块级状态）。
import { join } from "node:path";
import { dataRoot } from "../runtime-paths.mjs";
import { createSecretProvider } from "../secret-provider.mjs";
import { createSqliteRepository } from "../sqlite-repository.mjs";

export const dataDir = dataRoot;

export const dbPath = join(dataDir, "olt-manager.sqlite");

// 通过 ES 模块实时绑定导出：configure 重新赋值后，其他模块读到的始终是最新提供器。
export let resourceManagementSecretProvider = createSecretProvider();

const sqliteRepository = createSqliteRepository({ dbPath });

export const { sqlQuote, runSqlImmediate, runSql, queueDatabaseTask, query, exec, closeDatabase } = sqliteRepository;

export function configureResourceManagementSecretProvider(provider) {
  if (!provider || typeof provider.seal !== "function" || typeof provider.open !== "function") {
    throw new Error("凭据提供器接口无效。");
  }
  resourceManagementSecretProvider = provider;
}

