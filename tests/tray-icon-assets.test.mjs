import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ICON_SIZES, renderIcon } from "../scripts/generate-olt-icons.mjs";

const root = join(fileURLToPath(new URL("..", import.meta.url)));

test("tray PNG assets contain the designed mark at every Windows tray size", async () => {
  for (const size of ICON_SIZES) {
    const expected = renderIcon(size);
    const actual = await readFile(join(root, "assets", "generated", `olt-manager-${size}.png`));
    assert.deepEqual(actual, expected, `${size}px icon must be generated from the shared design`);
    const colors = new Set();
    for (let index = 0; index < actual.length; index += 4) {
      colors.add(actual.subarray(index, index + 4).toString("hex"));
      if (colors.size > 3) break;
    }
    assert.ok(colors.size > 3, `${size}px icon must not be a solid-color square`);
  }
});

test("Windows ICO is a multi-size PNG icon", async () => {
  const ico = await readFile(join(root, "assets", "generated", "olt-manager.ico"));
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), ICON_SIZES.length);
});
