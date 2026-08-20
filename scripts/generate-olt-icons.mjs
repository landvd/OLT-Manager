import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
export const ICON_SIZES = [16, 32, 48, 64, 128, 256];

const clamp = (value) => Math.max(0, Math.min(255, Math.round(value)));

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuffer, data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body), 0);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  return Buffer.concat([length, body, checksum]);
}

export function encodePng(width, pixels) {
  const rows = [];
  for (let y = 0; y < width; y += 1) {
    rows.push(Buffer.from([0]), pixels.subarray(y * width * 4, (y + 1) * width * 4));
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(width, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function paintPixel(pixels, width, x, y, color) {
  if (x < 0 || y < 0 || x >= width || y >= width) return;
  const offset = (y * width + x) * 4;
  pixels[offset] = clamp(color[0]);
  pixels[offset + 1] = clamp(color[1]);
  pixels[offset + 2] = clamp(color[2]);
  pixels[offset + 3] = clamp(color[3] ?? 255);
}

function insideRoundedRect(x, y, left, top, right, bottom, radius) {
  const nearestX = Math.max(left + radius, Math.min(x, right - radius));
  const nearestY = Math.max(top + radius, Math.min(y, bottom - radius));
  return (x - nearestX) ** 2 + (y - nearestY) ** 2 <= radius ** 2;
}

function insideCircle(x, y, centerX, centerY, radius) {
  return (x - centerX) ** 2 + (y - centerY) ** 2 <= radius ** 2;
}

function distanceToSegment(x, y, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  const projection = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / lengthSquared));
  const nearestX = x1 + projection * dx;
  const nearestY = y1 + projection * dy;
  return Math.hypot(x - nearestX, y - nearestY);
}

function drawShape(size, sampleScale) {
  const width = size * sampleScale;
  const pixels = Buffer.alloc(width * width * 4);
  const scale = (value) => value * size / 256;

  for (let y = 0; y < width; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const px = (x + 0.5) / sampleScale;
      const py = (y + 0.5) / sampleScale;
      if (!insideRoundedRect(px, py, scale(12), scale(12), scale(244), scale(244), scale(52))) continue;
      const gradient = Math.max(0, Math.min(1, (px + py) / size / 1.8));
      paintPixel(pixels, width, x, y, [37 - gradient * 22, 99 - gradient * 39, 235 - gradient * 77, 255]);
    }
  }

  const lineSegments = [
    [scale(128), scale(61), scale(128), scale(100)],
    [scale(76), scale(155), scale(128), scale(100)],
    [scale(128), scale(100), scale(180), scale(155)]
  ];
  const lineRadius = scale(9);
  const circleNodes = [
    [scale(76), scale(171)],
    [scale(128), scale(171)],
    [scale(180), scale(171)]
  ];

  for (let y = 0; y < width; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const px = (x + 0.5) / sampleScale;
      const py = (y + 0.5) / sampleScale;
      if (lineSegments.some(([x1, y1, x2, y2]) => distanceToSegment(px, py, x1, y1, x2, y2) <= lineRadius)) {
        paintPixel(pixels, width, x, y, [181, 246, 255, 255]);
      }
      if (insideRoundedRect(px, py, scale(73), scale(42), scale(183), scale(84), scale(21))) {
        paintPixel(pixels, width, x, y, [255, 255, 255, 255]);
      }
      if (lineSegments.length && (distanceToSegment(px, py, scale(96), scale(63), scale(160), scale(63)) <= scale(5))) {
        const gap = px > scale(120) && px < scale(136);
        if (!gap) paintPixel(pixels, width, x, y, [37, 99, 235, 255]);
      }
      for (const [centerX, centerY] of circleNodes) {
        if (insideCircle(px, py, centerX, centerY, scale(25))) paintPixel(pixels, width, x, y, [255, 255, 255, 255]);
        if (insideCircle(px, py, centerX, centerY, scale(9))) paintPixel(pixels, width, x, y, [14, 165, 233, 255]);
      }
    }
  }

  if (sampleScale === 1) return pixels;
  const output = Buffer.alloc(size * size * 4);
  const samples = sampleScale * sampleScale;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sums = [0, 0, 0, 0];
      for (let sy = 0; sy < sampleScale; sy += 1) {
        for (let sx = 0; sx < sampleScale; sx += 1) {
          const offset = (((y * sampleScale + sy) * width) + x * sampleScale + sx) * 4;
          for (let channel = 0; channel < 4; channel += 1) sums[channel] += pixels[offset + channel];
        }
      }
      const outputOffset = (y * size + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) output[outputOffset + channel] = clamp(sums[channel] / samples);
    }
  }
  return output;
}

export function renderIcon(size) {
  return encodePng(size, drawShape(size, size < 256 ? 8 : 2));
}

export function buildIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + pngs.length * 16;
  for (const { size, data } of pngs) {
    const entry = Buffer.alloc(16);
    entry[0] = size === 256 ? 0 : size;
    entry[1] = size === 256 ? 0 : size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += data.length;
  }
  return Buffer.concat([header, ...entries, ...pngs.map(({ data }) => data)]);
}

export async function generateIcons(outputDirectory = join(root, "assets", "generated")) {
  await mkdir(outputDirectory, { recursive: true });
  const pngs = [];
  for (const size of ICON_SIZES) {
    const data = renderIcon(size);
    pngs.push({ size, data });
    await writeFile(join(outputDirectory, `olt-manager-${size}.png`), data);
  }
  await writeFile(join(outputDirectory, "olt-manager.ico"), buildIco(pngs));
  return pngs.map(({ size }) => size);
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file://").href) {
  await generateIcons();
  console.log(`已生成 OLT Manager 图标：${ICON_SIZES.join(", ")}`);
}
