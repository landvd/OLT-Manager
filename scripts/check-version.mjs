import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const version = packageJson.version;
const expectedTag = `v${version}`;
const errors = [];

function fail(message) {
  errors.push(message);
}

function assertIncludes(text, needle, file) {
  if (!text.includes(needle)) fail(`${file} must include: ${needle}`);
}

if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  fail(`package.json version must be semver-like, got: ${version}`);
}

const changelog = await readFile(new URL("../CHANGELOG.md", import.meta.url), "utf8");
const changelogMatch = changelog.match(/^##\s+([0-9]+\.[0-9]+\.[0-9][^\s]*)\s*$/m);
if (!changelogMatch) {
  fail("CHANGELOG.md must have a top-level version heading like ## 1.0.6");
} else if (changelogMatch[1] !== version) {
  fail(`CHANGELOG.md top version ${changelogMatch[1]} must match package.json ${version}`);
}

if (changelogMatch) {
  const start = changelogMatch.index + changelogMatch[0].length;
  const nextMatch = changelog.slice(start).match(/\n##\s+/);
  const section = changelog.slice(start, nextMatch ? start + nextMatch.index : undefined);
  const bullets = section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "));
  if (/\bTODO\b/i.test(section)) fail(`CHANGELOG.md ${version} section must not contain TODO`);
  if (bullets.length === 0) fail(`CHANGELOG.md ${version} section must include at least one change bullet`);
}

const server = await readFile(new URL("../src/server.mjs", import.meta.url), "utf8");
if (/\/api\/bootstrap[\s\S]{0,300}version:\s*["']\d+\.\d+\.\d+/.test(server)) {
  fail("src/server.mjs /api/bootstrap must not hardcode the application version");
}

const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
if (/state\.version\s*\|\|\s*["'](?!0\.0\.0["'])\d+\.\d+\.\d+/.test(main)) {
  fail("src/main.js must not hardcode a real application version as the display fallback");
}

const releaseWorkflow = await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
assertIncludes(releaseWorkflow, "pnpm run check:version", ".github/workflows/release.yml");

const ciWorkflow = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
assertIncludes(ciWorkflow, "pnpm run check:version", ".github/workflows/ci.yml");

if (process.env.GITHUB_REF_TYPE === "tag" && process.env.GITHUB_REF_NAME !== expectedTag) {
  fail(`GitHub release tag ${process.env.GITHUB_REF_NAME} must match package.json ${expectedTag}`);
}

if (errors.length > 0) {
  console.error("Version check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Version check passed: ${version}`);
