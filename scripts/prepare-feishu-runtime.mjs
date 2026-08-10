import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const runtimeRoot = path.join(projectRoot, "..", "build", "feishu-runtime");
const runtimeNodeModules = path.join(runtimeRoot, "node_modules");
const entryPackage = "@larksuiteoapi/node-sdk";

function packageRoot(packageName, fromDirectory) {
  let directory = fromDirectory;
  while (true) {
    const candidate = path.join(directory, "node_modules", ...packageName.split("/"));
    const packageJsonPath = path.join(candidate, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
      if (packageJson.name === packageName) {
        return { directory: fs.realpathSync(candidate), packageJson };
      }
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error(`无法定位 Feishu runtime package：${packageName}`);
}

function targetPath(packageName) {
  return path.join(runtimeNodeModules, ...packageName.split("/"));
}

fs.rmSync(runtimeRoot, { recursive: true, force: true });
fs.mkdirSync(runtimeNodeModules, { recursive: true });

const queue = [{ packageName: entryPackage, fromDirectory: projectRoot }];
const copied = new Map();

while (queue.length > 0) {
  const { packageName, fromDirectory } = queue.shift();
  if (packageName.startsWith("@types/")) continue;
  const resolved = packageRoot(packageName, fromDirectory);
  const existing = copied.get(packageName);
  if (existing) {
    if (existing.packageJson.version !== resolved.packageJson.version) {
      throw new Error(`Feishu runtime dependency has conflicting versions：${packageName}`);
    }
    continue;
  }

  const destination = targetPath(packageName);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(resolved.directory, destination, {
    recursive: true,
    dereference: true,
    filter: (source) => path.basename(source) !== "node_modules"
  });
  copied.set(packageName, resolved);

  for (const dependencyName of Object.keys(resolved.packageJson.dependencies || {})) {
    queue.push({ packageName: dependencyName, fromDirectory: resolved.directory });
  }
}

console.log(`已准备 Feishu runtime 依赖：${copied.size} 个包`);
console.log(`输出目录：${runtimeRoot}`);
