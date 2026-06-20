import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { exportSeedSample } from "../scripts/export-seed-sample.mjs";

test("exportSeedSample writes sanitized seed files without modifying source database", async () => {
  const root = await mkdtemp(join(tmpdir(), "olt-manager-sample-"));
  const dbPath = join(root, "source.sqlite");
  const outDir = join(root, "seed");
  const fakeSqlitePath = join(root, "fake-sqlite.mjs");
  const sqliteLogPath = join(root, "sqlite-calls.jsonl");

  try {
    await writeFile(fakeSqlitePath, `
import { appendFile } from "node:fs/promises";

const args = process.argv.slice(2);
await appendFile(process.env.FAKE_SQLITE_LOG, JSON.stringify(args) + "\\n");
const sql = args.at(-1) || "";

if (sql.includes("FROM olts")) {
  console.log(JSON.stringify([
    { id: "real-zte", name: "Real ZTE 172.19.104.98", vendor: "zte", model: "C300", version: "V2.1", host: "172.19.104.98", snmp_port: 161, read_community: "bdw0256", telnet_port: 23, telnet_username: "HouJie", telnet_password: "HJcatv2021#", enabled: 1 }
  ]));
} else if (sql.includes("FROM pon_ports")) {
  console.log(JSON.stringify([
    { olt_ip: "172.19.104.98", pon_port: "2/10", outer_vlan: "1068", address: "真实小区地址A" }
  ]));
} else {
  console.error("Unexpected SQL: " + sql);
  process.exitCode = 1;
}
`);

    process.env.FAKE_SQLITE_LOG = sqliteLogPath;
    const result = await exportSeedSample({
      dbPath,
      outDir,
      oltLimit: 1,
      ponLimit: 1,
      sqliteBin: process.execPath,
      sqliteArgs: [fakeSqlitePath]
    });
    assert.equal(result.ok, true);

    const olts = JSON.parse(await readFile(join(outDir, "olts.example.json"), "utf8"));
    const ponPorts = JSON.parse(await readFile(join(outDir, "pon-ports.example.json"), "utf8"));
    const sqliteCalls = (await readFile(sqliteLogPath, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));

    assert.equal(sqliteCalls.length, 2);
    assert.ok(sqliteCalls.every((args) => args.includes("-readonly")));
    assert.equal(olts.length, 1);
    assert.equal(ponPorts.length, 1);
    assert.equal(ponPorts[0].oltIp, olts[0].host);
    assert.match(olts[0].host, /^192\.0\.2\./);
    assert.equal(olts[0].readCommunity, "public");
    assert.equal(olts[0].telnetUsername, "");
    assert.equal(olts[0].telnetPassword, "");
    assert.doesNotMatch(JSON.stringify(olts), /172\.19|bdw0256|HJcatv/);
    assert.match(ponPorts[0].oltIp, /^192\.0\.2\./);
    assert.match(ponPorts[0].address, /^Sample address /);
    assert.doesNotMatch(JSON.stringify(ponPorts), /真实小区地址|172\.19/);
  } finally {
    delete process.env.FAKE_SQLITE_LOG;
    await rm(root, { recursive: true, force: true });
  }
});
