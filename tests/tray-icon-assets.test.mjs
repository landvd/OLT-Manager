import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { ICON_SIZES, renderIcon } from "../scripts/generate-olt-icons.mjs";

const root = join(fileURLToPath(new URL("..", import.meta.url)));

function decodeGeneratedRgbaPng(png, size) {
  assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const idat = [];
  let offset = 8;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString("ascii");
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      assert.equal(data.readUInt32BE(0), size);
      assert.equal(data.readUInt32BE(4), size);
      assert.equal(data[8], 8);
      assert.equal(data[9], 6);
    }
    if (type === "IDAT") idat.push(data);
    offset += 12 + length;
    if (type === "IEND") break;
  }
  const rows = inflateSync(Buffer.concat(idat));
  const rowBytes = size * 4;
  assert.equal(rows.length, size * (rowBytes + 1));
  const pixels = Buffer.alloc(size * rowBytes);
  for (let y = 0; y < size; y += 1) {
    const rowOffset = y * (rowBytes + 1);
    assert.equal(rows[rowOffset], 0, "generated icons must use the stable PNG filter 0");
    rows.copy(pixels, y * rowBytes, rowOffset + 1, rowOffset + 1 + rowBytes);
  }
  return pixels;
}

test("tray PNG assets contain the designed mark at every Windows tray size", async () => {
  for (const size of ICON_SIZES) {
    const expected = decodeGeneratedRgbaPng(renderIcon(size), size);
    const actual = decodeGeneratedRgbaPng(await readFile(join(root, "assets", "generated", `olt-manager-${size}.png`)), size);
    assert.deepEqual(actual, expected, `${size}px icon pixels must match the shared design`);
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
