import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

function parseArgs(argv) {
  const options = {
    dbPath: join(root, "data", "olt-manager.sqlite"),
    outDir: join(root, "data", "sample-seed"),
    oltLimit: 3,
    ponLimit: 20,
    sqliteBin: process.env.OLT_MANAGER_SQLITE_BIN || "sqlite3"
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--db") options.dbPath = argv[++index];
    else if (arg === "--out-dir") options.outDir = argv[++index];
    else if (arg === "--olts") options.oltLimit = Number(argv[++index]);
    else if (arg === "--pon-ports") options.ponLimit = Number(argv[++index]);
    else if (arg === "--sqlite-bin") options.sqliteBin = argv[++index];
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`未知参数：${arg}`);
  }
  return options;
}

function runSqliteJson({ sqliteBin, dbPath, sql }) {
  return new Promise((resolve, reject) => {
    const child = spawn(sqliteBin, ["-readonly", "-json", dbPath, sql]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(stderr || `sqlite3 exited with ${code}`));
      else resolve(stdout.trim() ? JSON.parse(stdout) : []);
    });
  });
}

function sqlQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sanitizeOlts(rows) {
  return rows.map((row, index) => {
    const vendor = String(row.vendor || "olt").toLowerCase();
    const host = `192.0.2.${10 + index}`;
    return {
      id: `${vendor}-sample-${index + 1}`,
      name: `${String(row.vendor || "OLT").toUpperCase()} sample ${index + 1}`,
      vendor: row.vendor,
      model: row.model,
      version: row.version || "unknown",
      host,
      snmpPort: Number(row.snmp_port || 161),
      readCommunity: "public",
      telnetPort: Number(row.telnet_port || 23),
      telnetUsername: "",
      telnetPassword: "",
      enabled: Boolean(row.enabled)
    };
  });
}

function sanitizePonPorts(rows, sanitizedOlts) {
  const hostMap = new Map();
  rows.forEach((row, index) => {
    if (!hostMap.has(row.olt_ip)) {
      const mapped = sanitizedOlts[hostMap.size]?.host || `192.0.2.${50 + hostMap.size}`;
      hostMap.set(row.olt_ip, mapped);
    }
  });
  return rows.map((row, index) => ({
    oltIp: hostMap.get(row.olt_ip),
    ponPort: row.pon_port,
    outerVlan: row.outer_vlan || "",
    address: `Sample address ${index + 1}`
  }));
}

export async function exportSeedSample({
  dbPath = join(root, "data", "olt-manager.sqlite"),
  outDir = join(root, "data", "sample-seed"),
  oltLimit = 3,
  ponLimit = 20,
  sqliteBin = process.env.OLT_MANAGER_SQLITE_BIN || "sqlite3"
} = {}) {
  const oltRows = await runSqliteJson({
    sqliteBin,
    dbPath,
    sql: `SELECT * FROM olts ORDER BY random() LIMIT ${Math.max(1, Number(oltLimit) || 1)};`
  });
  const oltHosts = oltRows.map((row) => row.host).filter(Boolean);
  const ponRows = oltHosts.length
    ? await runSqliteJson({
        sqliteBin,
        dbPath,
        sql: `SELECT olt_ip, pon_port, outer_vlan, address
FROM pon_ports
WHERE olt_ip IN (${oltHosts.map(sqlQuote).join(", ")})
ORDER BY random()
LIMIT ${Math.max(1, Number(ponLimit) || 1)};`
      })
    : [];

  const olts = sanitizeOlts(oltRows);
  const ponPorts = sanitizePonPorts(ponRows, olts);
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "olts.example.json"), `${JSON.stringify(olts, null, 2)}\n`);
  await writeFile(join(outDir, "pon-ports.example.json"), `${JSON.stringify(ponPorts, null, 2)}\n`);
  return { ok: true, outDir, counts: { olts: olts.length, ponPorts: ponPorts.length } };
}

function printHelp() {
  console.log(`Usage: node scripts/export-seed-sample.mjs [--db data/olt-manager.sqlite] [--out-dir data/sample-seed] [--olts 3] [--pon-ports 20]

从当前 SQLite 只读随机抽取 OLT 和 PON 台账，输出脱敏 seed：
- 输出 olts.example.json 和 pon-ports.example.json
- 不删除、不更新源数据库
- 默认脱敏 IP、community、Telnet 凭据和地址`);
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      printHelp();
    } else {
      const result = await exportSeedSample(options);
      console.log(`已导出脱敏 seed：${result.outDir}`);
      console.log(`OLT: ${result.counts.olts}, PON 台账: ${result.counts.ponPorts}`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
