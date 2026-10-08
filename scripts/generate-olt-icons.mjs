// OLT Manager 图标生成器：同一组几何图元同时生成各尺寸 PNG、Windows ICO、macOS ICNS 和界面用 SVG。
// 纯 Node 确定性光栅化（4x4 / 3x3 超采样），相同输入始终得到相同像素，便于测试比对。
// 设计：一个 OLT PON 口经 1:N 分光接入多个 ONU（光源点 + 扇形 4 路光纤）。
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
export const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256];
const ICNS_SIZES = [16, 32, 64, 128, 256, 512, 1024];

const FAN_Y = [64, 109, 147, 192];
// 图元坐标基于 256×256；maxSize/minSize 用于小尺寸加粗加亮，保证 16px 任务栏也能辨认。
export const ICON_SHAPES = [
  { type: "rect", x: 12, y: 12, w: 232, h: 232, r: 54, fill: "#3b82f6", fill2: "#1d4ed8", gradient: [12, 12, 244, 244] },
  ...FAN_Y.map((y) => ({ type: "line", x1: 92, y1: 128, x2: 196, y2: y, w: 14, fill: "#a5f3fc", minSize: 33 })),
  ...FAN_Y.map((y) => ({ type: "line", x1: 92, y1: 128, x2: 196, y2: y, w: 22, fill: "#e0f2fe", maxSize: 32 })),
  { type: "line", x1: 48, y1: 128, x2: 92, y2: 128, w: 16, fill: "#ffffff", minSize: 33 },
  { type: "line", x1: 44, y1: 128, x2: 92, y2: 128, w: 24, fill: "#ffffff", maxSize: 32 },
  { type: "circle", cx: 92, cy: 128, r: 20, fill: "#ffffff", minSize: 33 },
  { type: "circle", cx: 92, cy: 128, r: 26, fill: "#ffffff", maxSize: 32 },
  { type: "circle", cx: 92, cy: 128, r: 8, fill: "#2563eb", minSize: 48 },
  ...FAN_Y.map((y) => ({ type: "circle", cx: 200, cy: y, r: 15, fill: "#ffffff", minSize: 33 })),
  ...FAN_Y.map((y) => ({ type: "circle", cx: 200, cy: y, r: 21, fill: "#ffffff", maxSize: 32 }))
];

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body), 0);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  return Buffer.concat([length, body, checksum]);
}

export function encodePng(width, pixels) {
  const rows = [];
  for (let y = 0; y < width; y += 1) rows.push(Buffer.from([0]), pixels.subarray(y * width * 4, (y + 1) * width * 4));
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

const hexColor = (value) => [1, 3, 5].map((index) => Number.parseInt(value.slice(index, index + 2), 16));

function insideShape(shape, x, y) {
  if (shape.type === "rect") {
    if (x < shape.x || x > shape.x + shape.w || y < shape.y || y > shape.y + shape.h) return false;
    const nearestX = Math.max(shape.x + shape.r, Math.min(x, shape.x + shape.w - shape.r));
    const nearestY = Math.max(shape.y + shape.r, Math.min(y, shape.y + shape.h - shape.r));
    return (x - nearestX) ** 2 + (y - nearestY) ** 2 <= shape.r ** 2;
  }
  if (shape.type === "circle") return (x - shape.cx) ** 2 + (y - shape.cy) ** 2 <= shape.r ** 2;
  const dx = shape.x2 - shape.x1;
  const dy = shape.y2 - shape.y1;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? Math.max(0, Math.min(1, ((x - shape.x1) * dx + (y - shape.y1) * dy) / lengthSquared)) : 0;
  return Math.hypot(x - (shape.x1 + t * dx), y - (shape.y1 + t * dy)) <= shape.w / 2;
}

function shapeColor(shape, x, y) {
  if (!shape.gradient) return hexColor(shape.fill);
  const [x1, y1, x2, y2] = shape.gradient;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
  const from = hexColor(shape.fill);
  const to = hexColor(shape.fill2);
  return from.map((value, index) => value + (to[index] - value) * t);
}

export function shapesForSize(size) {
  return ICON_SHAPES.filter((shape) => (!shape.minSize || size >= shape.minSize) && (!shape.maxSize || size <= shape.maxSize));
}

export function renderIconPixels(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const scale = 256 / size;
  const samples = size >= 128 ? 3 : 4;
  const sampleCount = samples * samples;
  const shapes = shapesForSize(size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const gx = (x + (sx + 0.5) / samples) * scale;
          const gy = (y + (sy + 0.5) / samples) * scale;
          let pr = 0;
          let pg = 0;
          let pb = 0;
          let pa = 0;
          for (const shape of shapes) {
            if (!insideShape(shape, gx, gy)) continue;
            const color = shapeColor(shape, gx, gy);
            pr = color[0];
            pg = color[1];
            pb = color[2];
            pa = 1;
          }
          red += pr;
          green += pg;
          blue += pb;
          alpha += pa;
        }
      }
      const offset = (y * size + x) * 4;
      if (alpha > 0) {
        pixels[offset] = Math.round(red / alpha);
        pixels[offset + 1] = Math.round(green / alpha);
        pixels[offset + 2] = Math.round(blue / alpha);
      }
      pixels[offset + 3] = Math.round((alpha / sampleCount) * 255);
    }
  }
  return pixels;
}

export function renderIcon(size) {
  return encodePng(size, renderIconPixels(size));
}

export function buildIco(pngs) {
  const header = Buffer.alloc(6 + pngs.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, png }, index) => {
    const entry = 6 + index * 16;
    header[entry] = size >= 256 ? 0 : size;
    header[entry + 1] = size >= 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...pngs.map(({ png }) => png)]);
}

// 界面（侧边栏 / 登录页）使用的 SVG，取大尺寸版本图元。
export function buildIconSvg(size = 256) {
  const shapes = shapesForSize(size);
  const defs = [];
  const body = shapes.map((shape, index) => {
    let fill = shape.fill;
    if (shape.gradient) {
      const [x1, y1, x2, y2] = shape.gradient;
      defs.push(`<linearGradient id="g${index}" gradientUnits="userSpaceOnUse" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"><stop stop-color="${shape.fill}"/><stop offset="1" stop-color="${shape.fill2}"/></linearGradient>`);
      fill = `url(#g${index})`;
    }
    if (shape.type === "rect") return `<rect x="${shape.x}" y="${shape.y}" width="${shape.w}" height="${shape.h}" rx="${shape.r}" fill="${fill}"/>`;
    if (shape.type === "circle") return `<circle cx="${shape.cx}" cy="${shape.cy}" r="${shape.r}" fill="${fill}"/>`;
    return `<line x1="${shape.x1}" y1="${shape.y1}" x2="${shape.x2}" y2="${shape.y2}" stroke="${fill}" stroke-width="${shape.w}" stroke-linecap="round"/>`;
  });
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256" role="img" aria-label="OLT Manager">',
    "  <title>OLT Manager</title>",
    `  <defs>${defs.join("")}</defs>`,
    ...body.map((line) => `  ${line}`),
    "</svg>",
    ""
  ].join("\n");
}

// macOS 图标需要系统自带 iconutil；非 macOS 环境跳过并保留已提交的 .icns。
async function buildIcns(outputFile) {
  if (process.platform !== "darwin") return false;
  const work = await mkdtemp(join(tmpdir(), "olt-icns-"));
  const iconset = join(work, "olt-manager.iconset");
  await mkdir(iconset);
  try {
    for (const size of ICNS_SIZES) {
      const png = renderIcon(size);
      if (size <= 512) await writeFile(join(iconset, `icon_${size}x${size}.png`), png);
      if (size >= 32) await writeFile(join(iconset, `icon_${size / 2}x${size / 2}@2x.png`), png);
    }
    const result = spawnSync("iconutil", ["-c", "icns", iconset, "-o", outputFile], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr || "iconutil 生成 icns 失败");
    return true;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

export async function generateIcons(outputDirectory = join(root, "assets", "generated")) {
  await mkdir(outputDirectory, { recursive: true });
  const pngs = [];
  for (const size of ICON_SIZES) {
    const png = renderIcon(size);
    pngs.push({ size, png });
    await writeFile(join(outputDirectory, `olt-manager-${size}.png`), png);
  }
  await writeFile(join(outputDirectory, "olt-manager.ico"), buildIco(pngs));
  const icns = await buildIcns(join(outputDirectory, "olt-manager.icns"));
  await writeFile(join(root, "assets", "olt-manager-icon.svg"), buildIconSvg());
  console.log(`已生成 OLT Manager 图标：PNG ${ICON_SIZES.join(", ")}、ICO${icns ? "、ICNS" : "（非 macOS，跳过 ICNS）"}、SVG`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await generateIcons();
}
