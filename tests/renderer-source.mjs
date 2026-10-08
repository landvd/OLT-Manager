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

// 按函数名截取完整函数体（大括号配对），用于只针对某个函数的源码断言。
export function extractFunctionSource(source, name) {
  const start = source.search(new RegExp(`(?:async\\s+)?function ${name}\\(`));
  if (start === -1) return "";
  let depth = 0;
  for (let index = source.indexOf("{", start); index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  return source.slice(start);
}
