import { spawn } from "node:child_process";

export function sqlQuote(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function createSqliteRepository({
  dbPath,
  sqliteBin,
  missingToolMessage,
  spawnProcess = spawn,
  executeImmediate
} = {}) {
  if (!dbPath || !sqliteBin) throw new TypeError("SQLite 仓储需要数据库路径和 sqlite3 路径。");
  if (typeof missingToolMessage !== "function") throw new TypeError("SQLite 仓储需要工具缺失提示函数。");
  let sqlQueue = Promise.resolve();

  async function runSqlImmediate(sql, { json = false, databasePath = dbPath } = {}) {
    if (typeof executeImmediate === "function") return executeImmediate(sql, { json, databasePath });
    return new Promise((resolve, reject) => {
      const args = ["-batch", "-cmd", ".timeout 10000"];
      if (json) args.push("-json");
      args.push(databasePath);
      const child = spawnProcess(sqliteBin, args);
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("error", (error) => {
        if (error.code === "ENOENT") reject(new Error(missingToolMessage("sqlite3")));
        else reject(error);
      });
      child.on("close", (code) => {
        if (code !== 0) {
          const detail = [
            stderr || `sqlite3 exited with ${code}`,
            `sqlite3: ${sqliteBin}`,
            `args: ${args.join(" ")}`
          ].join("\n");
          reject(new Error(detail));
        } else resolve(stdout.trim());
      });
      child.stdin.end(sql);
    });
  }

  function runSql(sql, options = {}) {
    const task = sqlQueue.then(() => runSqlImmediate(sql, options));
    sqlQueue = task.catch(() => {});
    return task;
  }

  function queueDatabaseTask(task) {
    const queued = sqlQueue.then(task);
    sqlQueue = queued.catch(() => {});
    return queued;
  }

  async function query(sql) {
    const out = await runSql(sql, { json: true });
    return out ? JSON.parse(out) : [];
  }

  async function exec(sql) {
    await runSql(sql);
  }

  return Object.freeze({ runSqlImmediate, runSql, queueDatabaseTask, query, exec, sqlQuote });
}
