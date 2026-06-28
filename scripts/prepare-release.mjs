import { readFile, writeFile } from "node:fs/promises";

const nextVersion = process.argv[2];

if (!nextVersion || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(nextVersion)) {
  console.error("Usage: pnpm run release:prepare <version>");
  console.error("Example: pnpm run release:prepare 1.0.6");
  process.exit(1);
}

const packageUrl = new URL("../package.json", import.meta.url);
const changelogUrl = new URL("../CHANGELOG.md", import.meta.url);

const packageJson = JSON.parse(await readFile(packageUrl, "utf8"));
packageJson.version = nextVersion;
await writeFile(packageUrl, `${JSON.stringify(packageJson, null, 2)}\n`);

const changelog = await readFile(changelogUrl, "utf8");
const versionHeading = `## ${nextVersion}`;

if (!new RegExp(`^##\\s+${nextVersion.replaceAll(".", "\\.")}\\s*$`, "m").test(changelog)) {
  const firstVersionMatch = changelog.match(/^##\s+\d+\.\d+\.\d+[^\n]*$/m);
  if (!firstVersionMatch) {
    console.error("CHANGELOG.md does not contain an existing version heading.");
    process.exit(1);
  }

  const entry = `${versionHeading}

### Changed

- TODO: 填写本版本用户可见变化。

`;
  const updatedChangelog = `${changelog.slice(0, firstVersionMatch.index)}${entry}${changelog.slice(firstVersionMatch.index)}`;
  await writeFile(changelogUrl, updatedChangelog);
}

console.log(`Prepared release version ${nextVersion}.`);
console.log("Next: replace the CHANGELOG TODO, then run pnpm run check:version and pnpm test.");
