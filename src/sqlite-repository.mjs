import { DatabaseSync } from "node:sqlite";

const BUSY_TIMEOUT_MS = 10_000;
// 兼容历史 sqlite3 CLI 脚本里出现的点命令；它们在进程内驱动中没有意义。
const IGNORED_META_COMMANDS = new Set([".bail", ".timeout"]);

export function sqlQuote(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function isWordStart(char) {
  return /[A-Za-z_]/.test(char);
}

function isWordChar(char) {
  return /[A-Za-z0-9_$]/.test(char);
}

function skipQuoted(sql, index, close) {
  let cursor = index + 1;
  while (cursor < sql.length) {
    if (sql[cursor] === close) {
      // '' 和 "" 是转义引号，继续留在字符串内。
      if (close !== "]" && sql[cursor + 1] === close) cursor += 2;
      else return cursor + 1;
    } else cursor += 1;
  }
  return cursor;
}

// 按 sqlite3_complete 的规则拆分多语句脚本：跳过字符串、标识符和注释，
// CREATE TRIGGER 主体内的分号要到 END; 才算语句结束。node:sqlite 的 prepare
// 只编译第一条语句并静默丢弃其余部分，因此必须先拆分再逐条执行。
export function splitSqlStatements(sql) {
  const text = String(sql ?? "");
  const statements = [];
  let start = 0;
  let index = 0;
  let words = [];
  let lastWord = "";
  let atLineStart = true;

  const reset = (next) => {
    start = next;
    words = [];
    lastWord = "";
  };

  while (index < text.length) {
    const char = text[index];
    if (atLineStart && words.length === 0 && char === ".") {
      const lineEnd = text.indexOf("\n", index);
      const line = text.slice(index, lineEnd === -1 ? text.length : lineEnd).trim();
      const command = line.split(/\s+/)[0];
      if (!IGNORED_META_COMMANDS.has(command)) throw new Error(`不支持的 SQLite 点命令：${command}`);
      index = lineEnd === -1 ? text.length : lineEnd + 1;
      reset(index);
      atLineStart = true;
      continue;
    }
    if (char === "\n") {
      atLineStart = true;
      index += 1;
      continue;
    }
    if (char === " " || char === "\t" || char === "\r") {
      index += 1;
      continue;
    }
    atLineStart = false;
    if (char === "-" && text[index + 1] === "-") {
      const lineEnd = text.indexOf("\n", index);
      index = lineEnd === -1 ? text.length : lineEnd;
    } else if (char === "/" && text[index + 1] === "*") {
      const commentEnd = text.indexOf("*/", index + 2);
      index = commentEnd === -1 ? text.length : commentEnd + 2;
    } else if (char === "'" || char === "\"" || char === "`") {
      index = skipQuoted(text, index, char);
      words.push("");
      lastWord = "";
    } else if (char === "[") {
      index = skipQuoted(text, index, "]");
      words.push("");
      lastWord = "";
    } else if (isWordStart(char)) {
      let end = index + 1;
      while (end < text.length && isWordChar(text[end])) end += 1;
      lastWord = text.slice(index, end).toUpperCase();
      words.push(lastWord);
      index = end;
    } else if (char === ";") {
      const leading = words.slice(0, 3).filter((word) => word !== "TEMP" && word !== "TEMPORARY");
      const isTrigger = leading[0] === "CREATE" && leading[1] === "TRIGGER";
      index += 1;
      if (words.length === 0) {
        reset(index);
      } else if (!isTrigger || lastWord === "END") {
        statements.push(text.slice(start, index).trim());
        reset(index);
      } else {
        lastWord = "";
      }
    } else {
      words.push("");
      lastWord = "";
      index += 1;
    }
  }
  if (words.length) statements.push(text.slice(start).trim());
  return statements;
}

function normalizeValue(value) {
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Uint8Array) return Buffer.from(value).toString("utf8");
  return value;
}

// 读取为普通对象（而非 null 原型对象），与旧 CLI JSON.parse 的结果形态一致。
// 整数先按 BigInt 读取再转 Number，超出安全整数范围时与旧实现一样损失精度而不是抛错。
function readStatement(prepared) {
  prepared.setReadBigInts(true);
  if (typeof prepared.setReturnArrays === "function" && typeof prepared.columns === "function") {
    const columns = prepared.columns().map((column) => column.name);
    prepared.setReturnArrays(true);
    return { columns, values: prepared.all().map((row) => row.map(normalizeValue)) };
  }
  const rows = prepared.all();
  const columns = rows.length ? Object.keys(rows[0]) : [];
  return { columns, values: rows.map((row) => columns.map((name) => normalizeValue(row[name]))) };
}

function toObject(columns, values) {
  const row = {};
  for (let index = 0; index < columns.length; index += 1) row[columns[index]] = values[index];
  return row;
}

export function openSqliteDatabase(databasePath) {
  // 与历史 sqlite3 CLI 的默认行为保持一致：不强制外键，允许双引号字符串字面量。
  const database = new DatabaseSync(databasePath, {
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true
  });
  database.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS};`);
  return database;
}

// 逐条执行脚本并收集所有产生结果行的语句输出。任一语句失败时停止执行并回滚
// 未提交事务，等价于旧 CLI 的 `.bail on` 加进程退出回滚。
// 默认返回行对象；listOutput 为 true 时按列声明顺序拼成 CLI list 模式文本，
// 用于 PRAGMA integrity_check 等只关心文本输出的调用。
export function executeSqlScript(database, sql, { listOutput = false } = {}) {
  const rows = [];
  const lines = [];
  try {
    for (const statement of splitSqlStatements(sql)) {
      const { columns, values } = readStatement(database.prepare(statement));
      for (const rowValues of values) {
        if (listOutput) lines.push(rowValues.map((value) => (value === null || value === undefined ? "" : String(value))).join("|"));
        else rows.push(toObject(columns, rowValues));
      }
    }
  } catch (error) {
    if (database.isTransaction !== false) {
      try {
        database.exec("ROLLBACK;");
      } catch {
        // 没有活动事务时 ROLLBACK 会失败，忽略即可。
      }
    }
    throw error;
  }
  return { rows, lines };
}

export function createSqliteRepository({
  dbPath,
  openDatabase = openSqliteDatabase,
  executeImmediate
} = {}) {
  if (!dbPath) throw new TypeError("SQLite 仓储需要数据库路径。");
  let sqlQueue = Promise.resolve();
  let mainDatabase = null;

  function runOnDatabase(databasePath, sql, options) {
    if (databasePath === dbPath) {
      mainDatabase ??= openDatabase(dbPath);
      return executeSqlScript(mainDatabase, sql, options);
    }
    // 备份校验、恢复候选等临时文件只短暂打开，执行后立即关闭以释放文件句柄。
    const database = openDatabase(databasePath);
    try {
      return executeSqlScript(database, sql, options);
    } finally {
      database.close();
    }
  }

  async function runSqlImmediate(sql, { json = false, databasePath = dbPath } = {}) {
    if (typeof executeImmediate === "function") return executeImmediate(sql, { json, databasePath });
    const { rows, lines } = runOnDatabase(databasePath, sql, { listOutput: !json });
    if (json) return rows.length ? JSON.stringify(rows) : "";
    return lines.join("\n");
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
    // 进程内执行时直接返回行对象，省去 JSON 序列化再解析的往返。
    if (typeof executeImmediate !== "function") {
      const task = sqlQueue.then(() => runOnDatabase(dbPath, sql, {}).rows);
      sqlQueue = task.catch(() => {});
      return task;
    }
    const out = await runSql(sql, { json: true });
    return out ? JSON.parse(out) : [];
  }

  async function exec(sql) {
    await runSql(sql);
  }

  // 重命名或替换主库文件前必须先关闭连接；下次执行 SQL 时会自动重新打开。
  function closeDatabase() {
    if (!mainDatabase) return;
    const database = mainDatabase;
    mainDatabase = null;
    database.close();
  }

  return Object.freeze({ runSqlImmediate, runSql, queueDatabaseTask, query, exec, sqlQuote, closeDatabase });
}
