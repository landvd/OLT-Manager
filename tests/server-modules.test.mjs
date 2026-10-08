import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const srcDir = fileURLToPath(new URL("../src/", import.meta.url));
const require = createRequire(import.meta.url);

// server.mjs 与 db.mjs 已拆成门面 + 子模块；迁移函数时漏掉的导入/依赖只会在运行到该分支时才报错，
// 这里用 tsc 的“找不到名字”诊断在测试阶段提前发现。
test("服务端与数据库模块没有未定义的标识符", (t) => {
  let tsc;
  try {
    tsc = require.resolve("typescript/bin/tsc");
  } catch {
    t.skip("未安装 typescript，跳过未定义标识符检查");
    return;
  }
  const files = [
    join(srcDir, "server.mjs"),
    join(srcDir, "db.mjs"),
    ...["server", "db"].flatMap((dir) => readdirSync(join(srcDir, dir)).filter((name) => name.endsWith(".mjs")).map((name) => join(srcDir, dir, name)))
  ];
  let output = "";
  try {
    output = execFileSync(process.execPath, [
      tsc, "--allowJs", "--checkJs", "--noEmit", "--skipLibCheck",
      "--target", "es2022", "--module", "esnext", "--moduleResolution", "bundler", "--lib", "es2022,dom", "--types", "node",
      ...files
    ], { encoding: "utf8" });
  } catch (error) {
    output = String(error.stdout || "");
  }
  const undefinedNames = output.split("\n").filter((line) => /error TS(2304|2552)/.test(line));
  assert.deepEqual(undefinedNames, []);
});
