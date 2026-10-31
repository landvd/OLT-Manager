#!/usr/bin/env node
// 把正式版增量包发布到更新服务器（ADR-093）：先传 ZIP，最后原子替换签名的 channel.json。
//   node scripts/publish-update.mjs --zip release/OLT-Manager-<版本>-incremental.zip [--dry-run]
// 服务器连接信息不进仓库，放在 ~/.config/olt-manager/publish.json：
//   { "ssh": "admin@host", "identityFile": "~/.ssh/key", "remoteDir": "/opt/xxx/public" }
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { CHANNEL_FORMAT, parseSignedChannel, signChannel } = require("../electron/update-manager.cjs");
const { UPDATE_PUBLIC_KEY } = require("../electron/update-public-key.cjs");

const home = (value) => String(value).replace(/^~(?=\/)/, os.homedir());

/** 由增量包和打包报告生成版本清单；测试包、版本不一致的包一律拒绝。 */
export function buildChannel({ zipPath, zipBytes, report, packageVersion, publishedAt = new Date().toISOString() }) {
  const file = path.basename(zipPath);
  if (/-test\b/i.test(file)) throw new Error("测试包不能发布到更新服务器。");
  if (report.version !== packageVersion) throw new Error(`打包报告版本 ${report.version} 和 package.json ${packageVersion} 不一致。`);
  const sha256 = crypto.createHash("sha256").update(zipBytes).digest("hex");
  if (report.zipSha256 !== sha256) throw new Error("增量包和打包报告的 SHA-256 不一致，请重新打包。");
  const bases = report.bases.map((base) => base.baseVersion);
  if (!bases.length) throw new Error("增量包没有可升级的基线版本。");
  return { format: CHANNEL_FORMAT, version: report.version, file, size: zipBytes.length, sha256, bases, targets: report.targets, publishedAt };
}

function main(args) {
  const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
  const zipPath = option("--zip");
  if (!zipPath) throw new Error("用法：node scripts/publish-update.mjs --zip <增量包.zip> [--dry-run]");
  const privateKey = fs.readFileSync(home(option("--key", "~/.config/olt-manager/update-signing-key.pem")));
  const report = JSON.parse(fs.readFileSync(zipPath.replace(/\.zip$/, ".report.json"), "utf8"));
  const { version: packageVersion } = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const channel = buildChannel({ zipPath, zipBytes: fs.readFileSync(zipPath), report, packageVersion });
  const signed = JSON.stringify(signChannel(channel, privateKey));
  parseSignedChannel(signed, UPDATE_PUBLIC_KEY); // 私钥和客户端内置公钥不配对时在这里就报错
  console.log(`v${channel.version}：${channel.file}，${channel.size} 字节，可从 ${channel.bases.join("、")} 升级`);
  if (args.includes("--dry-run")) return;

  const target = JSON.parse(fs.readFileSync(home(option("--config", "~/.config/olt-manager/publish.json")), "utf8"));
  const sshOptions = ["-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", "-i", home(target.identityFile)];
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "olt-publish-"));
  try {
    const channelPath = path.join(temp, "channel.json");
    fs.writeFileSync(channelPath, signed);
    execFileSync("scp", [...sshOptions, zipPath, `${target.ssh}:${target.remoteDir}/${channel.file}`], { stdio: "inherit" });
    execFileSync("scp", [...sshOptions, channelPath, `${target.ssh}:${target.remoteDir}/.channel.json.tmp`], { stdio: "inherit" });
    execFileSync("ssh", [...sshOptions, target.ssh, `mv ${target.remoteDir}/.channel.json.tmp ${target.remoteDir}/channel.json`], { stdio: "inherit" });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
  console.log("已发布。现场客户端下次启动时自动更新。");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
