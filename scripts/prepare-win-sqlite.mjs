import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { cp, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));

export const SQLITE_LEGACY_TOOLS_URL = "https://sqlite.org/2023/sqlite-tools-win32-x86-3410000.zip";
export const SQLITE_LEGACY_TOOLS_SHA3_256 = "94c8e42e1cc9cb92a3781dbbcd36d3a3227e94ebea6e0ff7aa12fce78a745210";
export const SQLITE_LEGACY_SQLITE3_SHA3_256 = "92846ef3b826b6764b0c18643a353162a2289e944670de9da956ba6589ed6c37";

function parseArgs(argv) {
  const options = {
    outDir: join(root, "bin", "win32"),
    cacheDir: join(root, ".cache", "sqlite-win32"),
    url: SQLITE_LEGACY_TOOLS_URL,
    sha3: SQLITE_LEGACY_TOOLS_SHA3_256,
    sqliteSha3: SQLITE_LEGACY_SQLITE3_SHA3_256
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out-dir") options.outDir = argv[++index];
    else if (arg === "--cache-dir") options.cacheDir = argv[++index];
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`未知参数：${arg}`);
  }
  return options;
}

async function download(url, target) {
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`下载 SQLite tools 失败：${response.status} ${response.statusText}`);
  }
  await pipeline(response.body, createWriteStream(target));
}

async function sha3File(path) {
  const hash = createHash("sha3-256");
  hash.update(await readFile(path));
  return hash.digest("hex");
}

async function findFile(dir, name) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isFile() && entry.name === name) return path;
    if (entry.isDirectory()) {
      const nested = await findFile(path, name);
      if (nested) return nested;
    }
  }
  return "";
}

export async function prepareWinSqlite({
  outDir = join(root, "bin", "win32"),
  cacheDir = join(root, ".cache", "sqlite-win32"),
  url = SQLITE_LEGACY_TOOLS_URL,
  sha3 = SQLITE_LEGACY_TOOLS_SHA3_256,
  sqliteSha3 = SQLITE_LEGACY_SQLITE3_SHA3_256
} = {}) {
  await mkdir(outDir, { recursive: true });
  const existingSqlite = join(outDir, "sqlite3.exe");
  try {
    const existingSha3 = await sha3File(existingSqlite);
    if (existingSha3 === sqliteSha3) {
      return {
        ok: true,
        sqlitePath: existingSqlite,
        source: "existing",
        sha3: sqliteSha3
      };
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await rm(cacheDir, { recursive: true, force: true });
  await mkdir(cacheDir, { recursive: true });
  const zipPath = join(cacheDir, "sqlite-tools-win32-x86.zip");
  await download(url, zipPath);
  const actualSha3 = await sha3File(zipPath);
  if (actualSha3 !== sha3) {
    throw new Error(`SQLite tools SHA3-256 mismatch: expected ${sha3}, got ${actualSha3}`);
  }
  await execFileAsync("unzip", ["-o", "-q", zipPath, "-d", cacheDir]);
  const sqliteExe = await findFile(cacheDir, "sqlite3.exe");
  if (!sqliteExe) throw new Error("SQLite tools ZIP 中未找到 sqlite3.exe");
  await cp(sqliteExe, existingSqlite);
  const sqliteActualSha3 = await sha3File(existingSqlite);
  if (sqliteActualSha3 !== sqliteSha3) {
    throw new Error(`sqlite3.exe SHA3-256 mismatch: expected ${sqliteSha3}, got ${sqliteActualSha3}`);
  }
  return {
    ok: true,
    sqlitePath: existingSqlite,
    source: url,
    sha3: sqliteSha3
  };
}

function printHelp() {
  console.log(`Usage: node scripts/prepare-win-sqlite.mjs [--out-dir bin/win32]

下载并校验 Win7 兼容的 SQLite CLI：
- source: ${SQLITE_LEGACY_TOOLS_URL}
- output: bin/win32/sqlite3.exe
- uses SHA3-256 verification before copying`);
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      printHelp();
    } else {
      const result = await prepareWinSqlite(options);
      console.log(`已准备 Win7 SQLite CLI：${result.sqlitePath}`);
      console.log(`SHA3-256：${result.sha3}`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
