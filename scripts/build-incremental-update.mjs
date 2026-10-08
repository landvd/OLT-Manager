#!/usr/bin/env node
/**
 * 多基线手动增量包生成器。
 *
 * 取代按版本手工维护文件列表的一次性脚本（create-win11-update-*.mjs）。
 * 旧做法只复制“最近一次改动”的文件，却在清单里声明支持更早的基线，
 * 导致从较旧版本升级时缺少中间版本改动过的文件。
 *
 * 本脚本对每一个声明支持的基线单独计算文件差异：
 * - 有 git tag（vX.Y.Z）的基线：按 tag 的真实文件树逐文件比对 SHA-256，只下发变化的文件；
 * - 没有 tag、或列在 UNTRUSTED_TAG_BASES 中（事后补打 tag）、只通过历史增量包发布过的基线：
 *   无法精确知道现场文件树（历史增量包可能不完整），
 *   因此下发全部受管文件（src/electron/assets/bin/win32/package.json/示例数据），保证升级后一致；
 * - dist/ 每次全量下发（文件名带内容哈希，旧资源残留不影响运行）；
 * - 基线的 package.json 依赖或 Electron 版本与当前版本不同的，拒绝作为增量基线（需要整体包）。
 *
 * 用法：
 *   node scripts/build-incremental-update.mjs [--targets win32-x64,darwin-arm64]
 *     [--bases 1.2.16,1.2.15] [--output release/manual-update-v<版本>]
 *     [--zip release/OLT-Manager-<版本>-incremental.zip] [--release-dir release]
 *
 * 前置条件：已执行 pnpm build（dist/ 为当前源码构建结果）；系统可用 git、unzip、zip。
 * 脚本不会覆盖已有输出目录或 zip。
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const UPDATE_FORMAT = "olt-manager/update/v1";
// 这些版本当年只通过旧的一次性脚本以增量包发布，现场文件树可能不完整；
// 即使事后补打了 git tag，也不能按 tag 精确差异，必须下发全量受管文件。
export const UNTRUSTED_TAG_BASES = new Set(["1.2.13", "1.2.14", "1.2.15", "1.2.16", "1.2.17"]);

export function exactTagBaseAllowed(version) {
  return !UNTRUSTED_TAG_BASES.has(String(version || "").trim());
}
const MANAGED_DIRS = ["src/", "electron/", "assets/", "bin/win32/"];

export function isManagedPath(relativePath) {
  const p = String(relativePath || "").replaceAll("\\", "/");
  if (!p || p.split("/").includes(".DS_Store") || p.endsWith("/.DS_Store") || p === ".DS_Store") return false;
  if (p === "package.json") return true;
  if (/^data\/[^/]+\.example\.json$/.test(p)) return true;
  return MANAGED_DIRS.some((dir) => p.startsWith(dir));
}

export function parseVersion(value) {
  const match = String(value || "").trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  return match ? match.slice(1, 4).map(Number) : null;
}

export function compareVersions(left, right) {
  const a = parseVersion(left) || [0, 0, 0];
  const b = parseVersion(right) || [0, 0, 0];
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** 运行时兼容性指纹：依赖或 Electron 版本变化时增量包无法更新 node_modules / 可执行文件。 */
export function runtimeFingerprint(packageJson = {}) {
  const sorted = (object = {}) => Object.fromEntries(Object.entries(object || {}).sort(([a], [b]) => a.localeCompare(b)));
  return JSON.stringify({
    dependencies: sorted(packageJson.dependencies),
    electron: packageJson.devDependencies?.electron || "",
    electronBuilder: packageJson.devDependencies?.["electron-builder"] || ""
  });
}

/**
 * 计算单个基线的下发文件与删除列表。
 * @param {Map<string,string>} targetTree 目标受管文件 path -> sha256（不含 dist）
 * @param {Map<string,string>|null} baseTree 基线受管文件树；null 表示未知，需全量下发
 * @param {string[]} distPaths 目标 dist 文件
 * @param {Set<string>} knownHistoricalPaths 历史上出现过的受管文件（用于清理）
 */
export function planBaseArtifact({ targetTree, baseTree, distPaths, knownHistoricalPaths }) {
  const files = [];
  for (const [p, hash] of targetTree) {
    if (!baseTree || baseTree.get(p) !== hash) files.push(p);
  }
  files.push(...distPaths);
  const removeSource = baseTree ? new Set(baseTree.keys()) : knownHistoricalPaths;
  const remove = [...removeSource].filter((p) => isManagedPath(p) && !targetTree.has(p)).sort();
  return { files: [...new Set(files)].sort(), remove, exact: Boolean(baseTree) };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { maxBuffer: 512 * 1024 * 1024, ...options });
  if (result.error) throw new Error(`${command} 无法执行：${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} 失败：${String(result.stderr || "").trim()}`);
  }
  return result.stdout;
}

function gitTagVersions(cwd) {
  return String(run("git", ["tag", "--list", "v*"], { cwd }))
    .split(/\r?\n/)
    .map((tag) => tag.trim())
    .filter((tag) => parseVersion(tag.slice(1)))
    .map((tag) => tag.slice(1));
}

/** 读取 git tag 的受管文件树（path -> sha256）以及 package.json。 */
function readTagTree(cwd, version) {
  const tag = `v${version}`;
  const names = String(run("git", ["ls-tree", "-r", "-z", "--name-only", tag], { cwd }))
    .split("\0")
    .filter((name) => name && isManagedPath(name));
  const input = names.map((name) => `${tag}:${name}`).join("\n") + "\n";
  const out = run("git", ["cat-file", "--batch"], { cwd, input });
  const tree = new Map();
  let packageJson = {};
  let offset = 0;
  for (const name of names) {
    const headerEnd = out.indexOf(10, offset);
    const header = out.subarray(offset, headerEnd).toString("utf8");
    const size = Number(header.split(" ")[2]);
    if (!Number.isSafeInteger(size)) throw new Error(`git cat-file 解析失败：${header}`);
    const content = out.subarray(headerEnd + 1, headerEnd + 1 + size);
    tree.set(name, sha256(content));
    if (name === "package.json") packageJson = JSON.parse(content.toString("utf8"));
    offset = headerEnd + 1 + size + 1;
  }
  return { tree, packageJson };
}

/** 读取历史增量包：清单、package.json 和其中出现的受管文件路径。 */
function readIncrementalZip(zipPath) {
  const entries = String(run("unzip", ["-Z1", zipPath])).split(/\r?\n/).filter(Boolean);
  const manifestEntry = entries.find((entry) => entry === "latest.json" || entry.endsWith("/latest.json"));
  if (!manifestEntry) return null;
  const prefix = manifestEntry.slice(0, -"latest.json".length);
  const manifest = JSON.parse(String(run("unzip", ["-p", zipPath, manifestEntry])));
  const packageEntry = `${prefix}package.json`;
  const packageJson = entries.includes(packageEntry)
    ? JSON.parse(String(run("unzip", ["-p", zipPath, packageEntry])))
    : null;
  const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : [manifest];
  const paths = new Set();
  for (const artifact of artifacts) {
    for (const file of artifact.files || []) if (isManagedPath(file.path)) paths.add(file.path);
    for (const removed of artifact.remove || []) if (isManagedPath(removed)) paths.add(removed);
  }
  return { version: String(manifest.version || artifacts[0]?.version || ""), packageJson, paths };
}

async function walkFiles(root, relative) {
  const current = path.join(root, relative);
  const stat = await fs.lstat(current);
  if (stat.isFile()) return [relative.replaceAll(path.sep, "/")];
  if (!stat.isDirectory()) return [];
  const files = [];
  for (const entry of await fs.readdir(current, { withFileTypes: true })) {
    if (entry.name === ".DS_Store") continue;
    files.push(...await walkFiles(root, path.join(relative, entry.name)));
  }
  return files;
}

function argument(args, name, fallback = "") {
  const index = args.indexOf(name);
  return index >= 0 ? String(args[index + 1] || "").trim() : fallback;
}

async function exists(target) {
  try { await fs.access(target); return true; } catch { return false; }
}

export async function buildIncrementalUpdate({ cwd = process.cwd(), args = [] } = {}) {
  const log = (message) => console.log(message);
  const packageJson = JSON.parse(await fs.readFile(path.join(cwd, "package.json"), "utf8"));
  const version = String(packageJson.version || "").trim();
  if (!parseVersion(version)) throw new Error(`package.json 版本号无效：${version}`);
  const fingerprint = runtimeFingerprint(packageJson);

  const releaseDir = path.resolve(cwd, argument(args, "--release-dir", "release"));
  const outputDir = path.resolve(cwd, argument(args, "--output", path.join("release", `manual-update-v${version}`)));
  const zipPath = path.resolve(cwd, argument(args, "--zip", path.join("release", `OLT-Manager-${version}-incremental.zip`)));
  const targets = argument(args, "--targets", "win32-x64,darwin-arm64")
    .split(",").map((item) => item.trim()).filter(Boolean)
    .map((item) => { const [platform, arch] = item.split("-"); return { platform, arch }; });
  if (await exists(outputDir)) throw new Error(`输出目录已存在，为避免覆盖旧包而停止：${outputDir}`);
  if (await exists(zipPath)) throw new Error(`增量包已存在，为避免覆盖旧包而停止：${zipPath}`);

  // 1. 目标文件树：git 跟踪 + 未忽略的新文件，排除工作区已删除的文件；dist 单独全量。
  log("[1/5] 读取目标版本文件树...");
  const listed = String(run("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd }))
    .split("\0").filter((name) => name && isManagedPath(name));
  const targetTree = new Map();
  for (const name of [...new Set(listed)].sort()) {
    const full = path.join(cwd, name);
    if (!(await exists(full))) continue;
    targetTree.set(name, sha256(await fs.readFile(full)));
  }
  if (!targetTree.has("package.json") || !targetTree.has("electron/main.cjs") || !targetTree.has("src/server.mjs")) {
    throw new Error("目标文件树不完整，请在项目根目录运行。");
  }
  const distPaths = (await exists(path.join(cwd, "dist", "index.html")))
    ? (await walkFiles(cwd, "dist")).sort()
    : [];
  if (!distPaths.length) throw new Error("缺少 dist/index.html，请先执行 pnpm build。");
  const rendererSources = ["src/main.js", "src/styles.css", "index.html", ...(await walkFiles(cwd, "src")).filter((p) => p.endsWith(".vue"))];
  const newestSource = Math.max(...await Promise.all(rendererSources.map(async (p) => (await fs.stat(path.join(cwd, p))).mtimeMs)));
  if ((await fs.stat(path.join(cwd, "dist", "index.html"))).mtimeMs < newestSource) {
    throw new Error("dist/ 早于前端源码修改时间，请先执行 pnpm build。");
  }

  // 2. 基线候选：git tag 精确树；仅以增量包发布的版本使用全量受管文件。
  log("[2/5] 解析可支持的基线版本...");
  const knownHistoricalPaths = new Set(targetTree.keys());
  const bases = new Map();
  const skipped = [];
  for (const baseVersion of gitTagVersions(cwd)) {
    if (compareVersions(baseVersion, version) >= 0) continue;
    const { tree, packageJson: basePackage } = readTagTree(cwd, baseVersion);
    for (const p of tree.keys()) knownHistoricalPaths.add(p);
    if (!exactTagBaseAllowed(baseVersion)) continue; // 交给下方历史增量包分支按全量受管文件处理
    if (runtimeFingerprint(basePackage) !== fingerprint) {
      skipped.push({ version: baseVersion, reason: "依赖或 Electron 版本不同，需要整体包" });
      continue;
    }
    bases.set(baseVersion, { version: baseVersion, tree, source: `git tag v${baseVersion}（精确差异）` });
  }
  let zipNames = [];
  try { zipNames = (await fs.readdir(releaseDir)).filter((name) => name.endsWith(".zip") && /incremental/i.test(name)); } catch {}
  const zipVersions = new Map();
  for (const name of zipNames.sort()) {
    let info;
    try { info = readIncrementalZip(path.join(releaseDir, name)); } catch { continue; }
    if (!info || !parseVersion(info.version)) continue;
    for (const p of info.paths) knownHistoricalPaths.add(p);
    const entry = zipVersions.get(info.version) || { version: info.version, packageJson: null, zips: [] };
    entry.zips.push(name);
    entry.packageJson ||= info.packageJson;
    zipVersions.set(info.version, entry);
  }
  for (const entry of zipVersions.values()) {
    if (bases.has(entry.version) || skipped.some((item) => item.version === entry.version)) continue;
    if (compareVersions(entry.version, version) >= 0) continue;
    if (!entry.packageJson || runtimeFingerprint(entry.packageJson) !== fingerprint) {
      skipped.push({ version: entry.version, reason: entry.packageJson ? "依赖或 Electron 版本不同，需要整体包" : "历史增量包缺少 package.json，无法确认运行时兼容性" });
      continue;
    }
    bases.set(entry.version, { version: entry.version, tree: null, source: `历史增量包 ${entry.zips.join("、")}（全量受管文件）` });
  }
  const requested = argument(args, "--bases", "");
  let selected = [...bases.values()];
  if (requested) {
    const wanted = requested.split(",").map((item) => item.trim()).filter(Boolean);
    const missing = wanted.filter((item) => !bases.has(item));
    if (missing.length) throw new Error(`以下基线无法支持：${missing.join("、")}`);
    selected = wanted.map((item) => bases.get(item));
  }
  selected.sort((a, b) => compareVersions(b.version, a.version));
  if (!selected.length) throw new Error("没有可支持的基线版本。");

  // 3. 逐基线计算差异。
  log("[3/5] 逐基线计算差异...");
  const plans = selected.map((base) => ({
    base,
    ...planBaseArtifact({ targetTree, baseTree: base.tree, distPaths, knownHistoricalPaths })
  }));
  const allFiles = [...new Set(plans.flatMap((plan) => plan.files))].sort();

  // 4. 写出文件、清单和校验值。
  log(`[4/5] 写出 ${allFiles.length} 个文件到 ${path.relative(cwd, outputDir)} ...`);
  const fileInfo = new Map();
  for (const relative of allFiles) {
    const source = path.join(cwd, relative);
    const bytes = await fs.readFile(source);
    if (targetTree.has(relative) && targetTree.get(relative) !== sha256(bytes)) {
      throw new Error(`文件在打包过程中被修改：${relative}`);
    }
    const target = path.join(outputDir, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes);
    fileInfo.set(relative, { path: relative, size: bytes.length, sha256: sha256(bytes) });
  }
  const releaseNotes = `OLT Manager ${version} 手动增量包（逐基线差异校验）`;
  const artifacts = [];
  for (const { platform, arch } of targets) {
    for (const plan of plans) {
      artifacts.push({
        platform,
        arch,
        mode: "incremental",
        version,
        baseVersion: plan.base.version,
        releaseNotes,
        files: plan.files.map((p) => fileInfo.get(p)),
        remove: plan.remove
      });
    }
  }
  const manifest = { format: UPDATE_FORMAT, version, releaseNotes, generatedAt: new Date().toISOString(), artifacts };
  await fs.writeFile(path.join(outputDir, "latest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const sums = [...fileInfo.values()].map((file) => `${file.sha256}  ${file.path}`).join("\n");
  await fs.writeFile(path.join(outputDir, "SHA256SUMS.txt"), `${sums}\n`);

  // 5. 压缩（latest.json 位于 zip 根目录）。
  log(`[5/5] 生成 ${path.relative(cwd, zipPath)} ...`);
  // 先在系统临时目录生成再复制，避免网络盘/同步盘上 zip 的临时文件改名失败留下半成品。
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "olt-update-"));
  const tempZip = path.join(tempDir, "package.zip");
  try {
    run("zip", ["-r", "-X", "-q", tempZip, "."], { cwd: outputDir });
    run("unzip", ["-tq", tempZip]);
    await fs.copyFile(tempZip, zipPath);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
  const zipBytes = await fs.readFile(zipPath);
  const report = {
    version,
    zip: path.relative(cwd, zipPath),
    zipSize: zipBytes.length,
    zipSha256: sha256(zipBytes),
    targets: targets.map((t) => `${t.platform}-${t.arch}`),
    bases: plans.map((plan) => ({
      baseVersion: plan.base.version,
      source: plan.base.source,
      exact: plan.exact,
      files: plan.files.length,
      nonDistFiles: plan.files.filter((p) => !p.startsWith("dist/")).length,
      remove: plan.remove
    })),
    skipped
  };
  await fs.writeFile(`${zipPath.replace(/\.zip$/, "")}.report.json`, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  try {
    const report = await buildIncrementalUpdate({ args: process.argv.slice(2) });
    console.log(`\n增量包：${report.zip}（${report.zipSize} 字节）\nSHA-256：${report.zipSha256}`);
    console.log("支持的基线：");
    for (const base of report.bases) {
      console.log(`  ${base.baseVersion} ← ${base.source}：下发 ${base.files} 个文件（非 dist ${base.nonDistFiles}），删除 ${base.remove.length} 个`);
    }
    if (report.skipped.length) {
      console.log("未支持的基线：");
      for (const item of report.skipped) console.log(`  ${item.version}：${item.reason}`);
    }
  } catch (error) {
    console.error(`错误：${error.message}`);
    process.exit(1);
  }
}
