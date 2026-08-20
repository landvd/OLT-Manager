import fs from "node:fs";
import path from "node:path";

export const ASAR_UNPACK_PATTERNS = Object.freeze([
  "src/server.mjs",
  "src/runtime-lifecycle.mjs",
  "src/db.mjs",
  "src/feishu/**/*.mjs",
  "src/feishu/production-runtime.cjs",
  "src/telnet-client.mjs",
  "src/huawei-telnet.mjs",
  "src/zte-telnet.mjs",
  "bin/win32/sqlite3.exe",
  "build/feishu-runtime/**/*"
]);

export const ASAR_EVIDENCE_KINDS = Object.freeze([
  "layout",
  "dynamic-modules",
  "feishu-runtime",
  "sqlite-runtime",
  "renderer-runtime",
  "windows-runtime"
]);

export function evaluateAsarMigration({
  packageConfig = {},
  layoutReport = null,
  runtimeReport = null,
  windowsReport = null,
  platform = process.platform
} = {}) {
  const asarEnabled = packageConfig?.build?.asar === true;
  const blockers = [];
  if (!asarEnabled) blockers.push("当前发行配置仍为 asar:false");
  if (!layoutReport) blockers.push("尚未提供实际目录包布局报告");
  else if (layoutReport.ok !== true) blockers.push("目录包布局契约未通过");
  if (!runtimeReport || runtimeReport.ok !== true) blockers.push("动态模块、Feishu runtime、SQLite 子进程、renderer 和用户数据升级路径仍需真实打包回归");
  if (!windowsReport || windowsReport.ok !== true) blockers.push("Windows 7 x64 实机或等价 CI 尚未验证");
  if (platform === "win32" && windowsReport?.platform !== "win32") blockers.push("Windows 7 证据的平台标记不匹配");
  return Object.freeze({
    ready: blockers.length === 0,
    asarEnabled,
    platform,
    evidenceKinds: ASAR_EVIDENCE_KINDS,
    unpackPatterns: ASAR_UNPACK_PATTERNS,
    blockers: Object.freeze(blockers)
  });
}

function cli() {
  const packagePath = path.resolve(process.argv[2] || "package.json");
  const packageConfig = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  console.log(JSON.stringify(evaluateAsarMigration({ packageConfig }), null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) cli();
