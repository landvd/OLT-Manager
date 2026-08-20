import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE_LAYOUT_CONTRACT = "olt-manager/package-layout/v1";

// These are the targets passed to Electron's path-based dynamic import helper.
// Keep this list explicit: the verifier must not execute or discover package code.
export const DYNAMIC_MODULES = Object.freeze([
  "src/server.mjs",
  "src/runtime-lifecycle.mjs",
  "src/db.mjs",
  "src/feishu/subsystem.mjs",
  "src/feishu/gateway-contract.mjs",
  "src/feishu/application.mjs",
  "src/feishu/production-language-provider.mjs",
  "src/telnet-client.mjs"
]);

export const STATIC_FILES = Object.freeze([
  "package.json",
  "electron/main.cjs",
  "electron/preload.cjs",
  "src/feishu/production-runtime.cjs",
  "assets/generated/olt-manager-16.png",
  "assets/generated/olt-manager.ico"
]);

const FEISHU_ENTRY_PACKAGE = "@larksuiteoapi/node-sdk";

function absolutePath(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${name} must be a non-empty path`);
  }
  return path.resolve(value);
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function isAsarArchiveRoot(root) {
  return path.basename(root).toLowerCase() === "app.asar";
}

function uniquePaths(paths) {
  return [...new Set(paths.map((value) => path.resolve(value)))];
}

function fileCheck(id, candidate, { root, location, required = true } = {}) {
  const resolved = path.resolve(candidate);
  const insideRoot = root ? isInside(root, resolved) : true;
  let exists = false;
  let isFile = false;
  let realPath = null;
  try {
    const stat = fs.statSync(resolved);
    exists = true;
    isFile = stat.isFile();
    realPath = fs.realpathSync.native(resolved);
  } catch {
    // The report is deliberately data-only; inaccessible paths are failures.
  }
  const ok = insideRoot && exists && isFile;
  return {
    id,
    required,
    ok,
    location,
    path: resolved,
    realPath,
    reason: ok ? "present" : (!insideRoot ? "outside-root" : (!exists ? "missing" : "not-a-file"))
  };
}

function anyFileCheck(id, candidates, { root, location, required = true } = {}) {
  const checks = candidates.map((candidate) => fileCheck(id, candidate, { root, location, required }));
  const passed = checks.find((check) => check.ok);
  return {
    id,
    required,
    ok: Boolean(passed),
    location,
    path: passed?.path || checks[0]?.path || null,
    candidates: checks,
    reason: passed ? "present" : "no-candidate-present"
  };
}

function directoryCheck(id, candidate, { location, required = true } = {}) {
  const resolved = path.resolve(candidate);
  let exists = false;
  let isDirectory = false;
  let realPath = null;
  try {
    const stat = fs.statSync(resolved);
    exists = true;
    isDirectory = stat.isDirectory();
    realPath = fs.realpathSync.native(resolved);
  } catch {
    // Missing directories are reported below.
  }
  return {
    id,
    required,
    ok: exists && isDirectory,
    location,
    path: resolved,
    realPath,
    reason: exists && isDirectory ? "present" : (!exists ? "missing" : "not-a-directory")
  };
}

function dynamicRoots(appRoot, resourcesPath) {
  if (isAsarArchiveRoot(appRoot)) {
    return uniquePaths([
      path.join(path.dirname(appRoot), "app.asar.unpacked"),
      path.join(resourcesPath, "app.asar.unpacked"),
      resourcesPath
    ]);
  }
  return uniquePaths([
    appRoot,
    path.join(resourcesPath, "app.asar.unpacked"),
    resourcesPath
  ]);
}

function dynamicModuleCheck(appRoot, resourcesPath, relativePath) {
  const roots = dynamicRoots(appRoot, resourcesPath);
  const candidates = roots.map((root) => path.join(root, relativePath));
  return anyFileCheck(`dynamic:${relativePath}`, candidates, {
    location: "dynamic-module",
    required: true
  });
}

function readLocalDistReferences(indexPath) {
  let html;
  try {
    html = fs.readFileSync(indexPath, "utf8");
  } catch {
    return [];
  }
  const references = [];
  const attributePattern = /(?:src|href)\s*=\s*["']([^"']+)["']/gi;
  for (const match of html.matchAll(attributePattern)) {
    const raw = match[1].split(/[?#]/, 1)[0];
    if (!raw || raw.startsWith("data:") || raw.startsWith("http:") || raw.startsWith("https:") || raw.startsWith("//") || raw.startsWith("#")) continue;
    const relative = raw.startsWith("/") ? raw.slice(1) : raw.replace(/^\.\//, "");
    if (relative && !relative.includes("\\")) references.push(relative);
  }
  return [...new Set(references)];
}

function distChecks(appRoot) {
  const distRoot = path.join(appRoot, "dist");
  const indexPath = path.join(distRoot, "index.html");
  const checks = [fileCheck("static:dist/index.html", indexPath, { root: appRoot, location: "static-dist" })];
  for (const relative of readLocalDistReferences(indexPath)) {
    checks.push(fileCheck(`static:dist/${relative}`, path.join(distRoot, relative), {
      root: distRoot,
      location: "static-dist"
    }));
  }
  return checks;
}

export function verifyPackageLayout({ appRoot, resourcesPath, platform = process.platform } = {}) {
  const resolvedAppRoot = absolutePath(appRoot, "appRoot");
  const resolvedResourcesPath = absolutePath(resourcesPath, "resourcesPath");
  const checks = [
    directoryCheck("root:appRoot", resolvedAppRoot, { location: "root" }),
    directoryCheck("root:resourcesPath", resolvedResourcesPath, { location: "root" }),
    ...STATIC_FILES.map((relativePath) => fileCheck(`static:${relativePath}`, path.join(resolvedAppRoot, relativePath), {
      root: resolvedAppRoot,
      location: "static-app"
    })),
    ...distChecks(resolvedAppRoot),
    ...DYNAMIC_MODULES.map((relativePath) => dynamicModuleCheck(resolvedAppRoot, resolvedResourcesPath, relativePath)),
    anyFileCheck("resource:feishu-runtime", [
      path.join(resolvedResourcesPath, "feishu-runtime", "node_modules", ...FEISHU_ENTRY_PACKAGE.split("/"), "package.json"),
      path.join(resolvedAppRoot, "build", "feishu-runtime", "node_modules", ...FEISHU_ENTRY_PACKAGE.split("/"), "package.json")
    ], {
      location: "feishu-runtime",
      required: true
    })
  ];

  if (platform === "win32") {
    checks.push(anyFileCheck("resource:win32-sqlite", [
      path.join(resolvedAppRoot, "bin", "win32", "sqlite3.exe"),
      path.join(resolvedResourcesPath, "bin", "win32", "sqlite3.exe")
    ], {
      location: "win32-runtime",
      required: true
    }));
  }

  const failures = checks.filter((check) => check.required && !check.ok);
  return {
    contract: PACKAGE_LAYOUT_CONTRACT,
    ok: failures.length === 0,
    platform,
    appRoot: resolvedAppRoot,
    resourcesPath: resolvedResourcesPath,
    dynamicRoots: dynamicRoots(resolvedAppRoot, resolvedResourcesPath),
    checks,
    failures
  };
}

export function assertPackageLayout(options) {
  const report = verifyPackageLayout(options);
  if (!report.ok) {
    const details = report.failures.map((failure) => `${failure.id}: ${failure.reason}`).join("; ");
    throw new Error(`Package layout verification failed: ${details}`);
  }
  return report;
}

function cli() {
  const [, , appRoot, resourcesPath, platform = process.platform] = process.argv;
  if (!appRoot || !resourcesPath) {
    console.error("Usage: node scripts/verify-package-layout.mjs <appRoot> <resourcesPath> [platform]");
    process.exitCode = 2;
    return;
  }
  try {
    const report = verifyPackageLayout({ appRoot, resourcesPath, platform });
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.ok ? 0 : 1;
  } catch (error) {
    console.error(error.message || String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) cli();
