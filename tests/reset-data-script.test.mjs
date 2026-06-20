import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resetData } from "../scripts/reset-data.mjs";

test("reset-data script replaces local data with example seed files", async () => {
  const root = await mkdtemp(join(tmpdir(), "olt-manager-reset-"));
  const dataDir = join(root, "data");
  const seedDir = join(root, "seed");
  await mkdir(dataDir, { recursive: true });
  await mkdir(seedDir, { recursive: true });
  await writeFile(join(dataDir, "olts.json"), JSON.stringify([{ id: "old" }]));
  await writeFile(join(dataDir, "olt-manager.sqlite"), "old sqlite");
  await writeFile(join(seedDir, "olts.example.json"), JSON.stringify([{ id: "seed-olt" }], null, 2));
  await writeFile(join(seedDir, "pon-ports.example.json"), JSON.stringify([{ ponPort: "1/1" }], null, 2));

  try {
    await resetData({ dataDir, seedDir, yes: true });

    assert.deepEqual(JSON.parse(await readFile(join(dataDir, "olts.json"), "utf8")), [{ id: "seed-olt" }]);
    assert.deepEqual(JSON.parse(await readFile(join(dataDir, "pon-ports.json"), "utf8")), [{ ponPort: "1/1" }]);
    await assert.rejects(readFile(join(dataDir, "olt-manager.sqlite"), "utf8"), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
