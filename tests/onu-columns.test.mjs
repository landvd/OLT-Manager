import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const mainSource = readFileSync(fileURLToPath(new URL("../src/main.js", import.meta.url)), "utf8");

test("ONU 查询列保持序列号配置与 LOID 详情的独立入口", () => {
  const serialColumn = mainSource.match(/<el-table-column prop="serial" label="ONU 序列号"[\s\S]*?<\/el-table-column>/)?.[0];
  const loidColumn = mainSource.match(/<el-table-column prop="loid" label="LOID"[\s\S]*?<\/el-table-column>/)?.[0];

  assert.ok(serialColumn, "应存在 ONU 序列号列");
  assert.ok(loidColumn, "应存在 LOID 列");
  assert.match(serialColumn, /@click="openOnuConfig\(row\)"/);
  assert.match(loidColumn, /@click="openOnuDetail\(row\)"/);
  assert.match(mainSource, /v-model="state\.onuConfig\.visible"[\s\S]*?title="ONU 已配置数据"/);
  assert.match(mainSource, /servicePortCli\(state\.onuConfig\.data\)/);
  assert.match(mainSource, /onuMgmtCli\(state\.onuConfig\.data\)/);
});

test("ONU 详情内置网管二期历史光功率读取入口", () => {
  assert.match(mainSource, /网管二期历史光功率配置/);
  assert.match(mainSource, /本机自动登录会使用操作系统加密存储/);
  assert.match(mainSource, /\/api\/admin\/oss-resource\/login/);
  assert.match(mainSource, /\/api\/onus\/historical-optical/);
  assert.match(mainSource, /读取历史光功率/);
  assert.match(mainSource, /只读取已保存的历史记录，不触发光功率刷新/);
});
