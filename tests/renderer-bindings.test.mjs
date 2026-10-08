import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileTemplate, parse } from "vue/compiler-sfc";

const srcDir = fileURLToPath(new URL("../src/", import.meta.url));
const require = createRequire(import.meta.url);

function rendererComponents() {
  return [
    join(srcDir, "App.vue"),
    ...["views", "dialogs"].flatMap((dir) => readdirSync(join(srcDir, dir))
      .filter((name) => name.endsWith(".vue"))
      .map((name) => join(srcDir, dir, name)))
  ].map((file) => {
    const { descriptor } = parse(readFileSync(file, "utf8"), { filename: file });
    return { file, name: basename(file, ".vue"), descriptor };
  });
}

function appContextKeys() {
  const app = readFileSync(join(srcDir, "App.vue"), "utf8");
  const body = app.slice(app.indexOf("    const appContext = {\n"), app.indexOf("    provide(APP_CONTEXT_KEY"));
  return new Set([...body.matchAll(/^ {6}(\w+),?$/gm)].map((match) => match[1]));
}

// 子组件 setup 约定只有两种返回形式：直接返回共享上下文，或 `return { ...ctx, 本地名... };`。
function providedNames(name, script, contextKeys) {
  if (name === "App" || /return useAppContext\(\);/.test(script)) return contextKeys;
  const spread = script.match(/return \{ \.\.\.ctx,?([\s\S]*?)\};/);
  assert.ok(spread, `${name} 的 setup 返回值不符合约定`);
  return new Set([...contextKeys, ...spread[1].split(",").map((item) => item.trim()).filter(Boolean)]);
}

test("渲染端模板只引用组件 setup 提供的名字", () => {
  const contextKeys = appContextKeys();
  const missing = [];
  for (const { file, name, descriptor } of rendererComponents()) {
    const provided = providedNames(name, descriptor.script.content, contextKeys);
    const { code, errors } = compileTemplate({
      source: descriptor.template.content,
      filename: file,
      id: name,
      compilerOptions: { prefixIdentifiers: true, mode: "module" }
    });
    assert.deepEqual(errors, [], `${name} 模板编译失败`);
    const used = new Set([...code.matchAll(/_ctx\.(\w+)/g)].map((match) => match[1]));
    // 字符串模板 ref 只有在 setupState 中存在同名 ref 时才会被绑定。
    for (const match of code.matchAll(/ref: "(\w+)"/g)) used.add(match[1]);
    for (const identifier of used) {
      if (!identifier.startsWith("$") && !provided.has(identifier)) missing.push(`${name}: ${identifier}`);
    }
  }
  assert.deepEqual(missing, []);
});

test("渲染端脚本没有未定义的标识符", (t) => {
  let tsc;
  try {
    tsc = require.resolve("typescript/bin/tsc");
  } catch {
    t.skip("未安装 typescript，跳过未定义标识符检查");
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "olt-renderer-check-"));
  try {
    for (const { name, descriptor } of rendererComponents()) writeFileSync(join(dir, `${name}.js`), descriptor.script.content);
    for (const file of ["main.js", "app-context.js", "renderer-services.js"]) {
      writeFileSync(join(dir, file), readFileSync(join(srcDir, file), "utf8"));
    }
    let output = "";
    try {
      output = execFileSync(process.execPath, [
        tsc, "--allowJs", "--checkJs", "--noEmit", "--skipLibCheck",
        "--target", "es2022", "--module", "esnext", "--moduleResolution", "bundler", "--lib", "es2022,dom",
        ...readdirSync(dir).map((file) => join(dir, file))
      ], { encoding: "utf8" });
    } catch (error) {
      output = String(error.stdout || "");
    }
    // 只关心“找不到名字”类错误；类型推断和 .vue 模块解析问题不在本检查范围。
    const undefinedNames = output.split("\n")
      .filter((line) => /error TS(2304|2552)/.test(line))
      .map((line) => line.replace(`${dir}/`, ""));
    assert.deepEqual(undefinedNames, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
