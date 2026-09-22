import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);

function argument(name, fallback = "") {
  const index = args.indexOf(name);
  return index >= 0 ? String(args[index + 1] || "").trim() : fallback;
}

function usage(message = "") {
  if (message) console.error(`错误：${message}`);
  console.error("用法：node scripts/build-manual-update.mjs --base-app <上一版 resources/app> [--output <目录>] [--platform win32] [--arch x64]");
  process.exit(1);
}

const baseApp = argument("--base-app");
if (!baseApp) usage("必须提供上一版解压后的 resources/app 目录。");

const cwd = process.cwd();
const baseRoot = path.resolve(baseApp);
const packageJson = JSON.parse(await fs.readFile(path.join(cwd, "package.json"), "utf8"));
const basePackageJson = JSON.parse(await fs.readFile(path.join(baseRoot, "package.json"), "utf8"));
const version = String(packageJson.version || "").trim();
const baseVersion = String(basePackageJson.version || "").trim();
const currentParts = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
const baseParts = baseVersion.match(/^(\d+)\.(\d+)\.(\d+)$/);
if (!currentParts || !baseParts) usage("当前版本和上一版本必须是标准三段式版本号。");
if (currentParts[1] !== baseParts[1] || currentParts[2] !== baseParts[2] || Number(currentParts[3]) !== Number(baseParts[3]) + 1) {
  usage(`版本必须按补丁位递增：上一版 ${baseVersion}，当前版 ${version}。`);
}

const platform = argument("--platform", "win32");
const arch = argument("--arch", "x64");
const outputRoot = path.resolve(argument("--output", path.join("release", `manual-update-v${version}-from-${baseVersion}`)));
try {
  await fs.access(outputRoot);
  usage(`输出目录已存在，为避免覆盖旧包而停止：${outputRoot}`);
} catch {}

const roots = ["package.json", "electron", "src", "dist", "assets", "build/feishu-runtime", "bin/win32"];
try {
  const names = await fs.readdir(path.join(cwd, "data"));
  roots.push(...names.filter((name) => name.endsWith(".example.json")).map((name) => `data/${name}`));
} catch {}

async function walk(root, relative) {
  const current = path.join(root, relative);
  const stat = await fs.lstat(current);
  if (stat.isFile()) return [relative.replaceAll(path.sep, "/")];
  if (!stat.isDirectory()) return [];
  const files = [];
  for (const entry of await fs.readdir(current, { withFileTypes: true })) {
    if (entry.name === ".DS_Store") continue;
    files.push(...await walk(root, path.join(relative, entry.name)));
  }
  return files;
}

const currentFiles = (await Promise.all(roots.map(async (root) => {
  try { return await walk(cwd, root); } catch { return []; }
}))).flat().sort();
const currentSet = new Set(currentFiles);
const changed = [];

for (const relative of currentFiles) {
  const currentPath = path.join(cwd, relative);
  const basePath = path.join(baseRoot, relative);
  let same = false;
  try {
    const [currentBytes, baseBytes] = await Promise.all([fs.readFile(currentPath), fs.readFile(basePath)]);
    same = Buffer.compare(currentBytes, baseBytes) === 0;
  } catch {}
  if (same) continue;
  const target = path.join(outputRoot, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(currentPath, target);
  const bytes = await fs.readFile(currentPath);
  changed.push({ path: relative, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
}

const oldFiles = [];
for (const root of roots) {
  try { oldFiles.push(...await walk(baseRoot, root)); } catch {}
}
const remove = oldFiles.filter((relative) => !currentSet.has(relative)).sort();
const manifest = {
  format: "olt-manager/update/v1",
  version,
  artifacts: [{
    platform,
    arch,
    mode: "incremental",
    baseVersion,
    version,
    files: changed,
    remove,
    releaseNotes: `手动增量更新：${baseVersion} → ${version}`
  }]
};

await fs.mkdir(outputRoot, { recursive: true });
await fs.writeFile(path.join(outputRoot, "latest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
const sums = changed.map((file) => `${file.sha256}  ${file.path}`);
sums.push(`${createHash("sha256").update(await fs.readFile(path.join(outputRoot, "latest.json"))).digest("hex")}  latest.json`);
await fs.writeFile(path.join(outputRoot, "SHA256SUMS.txt"), `${sums.join("\n")}\n`);
console.log(`已生成手动增量包：${outputRoot}`);
console.log(`基线：${baseVersion} → ${version}；变化文件：${changed.length}；删除文件：${remove.length}`);
