import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

function parseArgs(argv) {
  const options = {
    dataDir: join(root, "data"),
    seedDir: join(root, "data"),
    yes: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--data-dir") options.dataDir = argv[++index];
    else if (arg === "--seed-dir") options.seedDir = argv[++index];
    else if (arg === "--yes" || arg === "-y") options.yes = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`未知参数：${arg}`);
  }
  return options;
}

async function removeRuntimeFiles(dataDir) {
  await mkdir(dataDir, { recursive: true });
  const entries = await readdir(dataDir, { withFileTypes: true });
  await Promise.all(entries
    .filter((entry) => {
      const name = entry.name;
      return name === "olts.json"
        || name === "pon-ports.json"
        || name.endsWith(".sqlite")
        || name.includes(".sqlite-");
    })
    .map((entry) => rm(join(dataDir, entry.name), { recursive: true, force: true })));
}

async function copySeedFile(seedDir, dataDir, seedName, targetName) {
  await copyFile(join(seedDir, seedName), join(dataDir, targetName));
}

export async function resetData({ dataDir = join(root, "data"), seedDir = join(root, "data"), yes = false } = {}) {
  if (!yes) {
    throw new Error("重置本地数据需要传入 --yes 确认。");
  }
  await mkdir(dataDir, { recursive: true });
  await removeRuntimeFiles(dataDir);
  await copySeedFile(seedDir, dataDir, "olts.example.json", "olts.json");
  await copySeedFile(seedDir, dataDir, "pon-ports.example.json", "pon-ports.json");
  return {
    ok: true,
    dataDir,
    files: ["olts.json", "pon-ports.json"]
  };
}

function printHelp() {
  console.log(`Usage: node scripts/${basename(fileURLToPath(import.meta.url))} --yes [--data-dir data] [--seed-dir data]

重置本地调试数据：
- 删除 data 目录中的 olts.json、pon-ports.json 和 *.sqlite 运行库
- 从 seed 目录复制 olts.example.json 与 pon-ports.example.json
- 不连接 OLT，不执行 SNMP/Telnet 命令`);
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      printHelp();
    } else {
      const result = await resetData(options);
      console.log(`已重置本地数据：${result.files.join(", ")}`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
