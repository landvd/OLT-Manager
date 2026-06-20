import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { exportSeedSample } from "../scripts/export-seed-sample.mjs";

const execFileAsync = promisify(execFile);

test("exportSeedSample writes sanitized seed files without modifying source database", async () => {
  const root = await mkdtemp(join(tmpdir(), "olt-manager-sample-"));
  const dbPath = join(root, "source.sqlite");
  const outDir = join(root, "seed");

  try {
    await execFileAsync("sqlite3", [dbPath, `
CREATE TABLE olts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  vendor TEXT NOT NULL,
  model TEXT NOT NULL,
  version TEXT NOT NULL,
  host TEXT NOT NULL UNIQUE,
  snmp_port INTEGER NOT NULL DEFAULT 161,
  read_community TEXT NOT NULL,
  telnet_port INTEGER NOT NULL DEFAULT 23,
  telnet_username TEXT NOT NULL DEFAULT '',
  telnet_password TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE pon_ports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  olt_ip TEXT NOT NULL,
  pon_port TEXT NOT NULL,
  outer_vlan TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT ''
);
INSERT INTO olts VALUES ('real-zte', 'Real ZTE 172.19.104.98', 'zte', 'C300', 'V2.1', '172.19.104.98', 161, 'bdw0256', 23, 'HouJie', 'HJcatv2021#', 1);
INSERT INTO olts VALUES ('real-huawei', 'Real Huawei 172.19.104.102', 'huawei', 'MA5800', 'unknown', '172.19.104.102', 161, 'bdw0256', 23, 'HouJie', 'HJcatv2021#', 1);
INSERT INTO pon_ports (olt_ip, pon_port, outer_vlan, address) VALUES ('172.19.104.98', '2/10', '1068', '真实小区地址A');
INSERT INTO pon_ports (olt_ip, pon_port, outer_vlan, address) VALUES ('172.19.104.98', '9/16', '1070', '真实小区地址B');
INSERT INTO pon_ports (olt_ip, pon_port, outer_vlan, address) VALUES ('172.19.104.102', '1/0', '1064', '真实小区地址C');
`]);

    const result = await exportSeedSample({ dbPath, outDir, oltLimit: 1, ponLimit: 1 });
    assert.equal(result.ok, true);

    const olts = JSON.parse(await readFile(join(outDir, "olts.example.json"), "utf8"));
    const ponPorts = JSON.parse(await readFile(join(outDir, "pon-ports.example.json"), "utf8"));
    const [{ count }] = JSON.parse((await execFileAsync("sqlite3", ["-json", dbPath, "SELECT count(*) AS count FROM olts;"])).stdout);

    assert.equal(count, 2);
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
    await rm(root, { recursive: true, force: true });
  }
});
