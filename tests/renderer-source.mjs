import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const srcDir = fileURLToPath(new URL("../src/", import.meta.url));

function vueFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return vueFiles(full);
    return entry.name.endsWith(".vue") ? [full] : [];
  }).sort();
}

// 渲染端已拆成 main.js 启动入口和若干单文件组件；源码断言需覆盖全部文件。
export function readRendererSource() {
  return [join(srcDir, "main.js"), ...vueFiles(srcDir)].map((file) => readFileSync(file, "utf8")).join("\n");
}
