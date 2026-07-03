import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const readText = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("project MVP API, database, sequence, architecture and changelog docs stay in sync", async () => {
  const [api, database, sequence, architecture, changelog] = await Promise.all([
    readText("docs/design/api.md"),
    readText("docs/design/database.md"),
    readText("docs/design/sequence.md"),
    readText("ARCHITECTURE.md"),
    readText("CHANGELOG.md")
  ]);

  const requiredApiSections = [
    "### GET `/api/admin/projects`",
    "### POST `/api/admin/projects`",
    "### PUT `/api/admin/projects/:id`",
    "### DELETE `/api/admin/projects/:id`",
    "### POST `/api/admin/projects/:id/onus`",
    "### GET `/api/admin/projects/:id/onus`",
    "### PUT `/api/admin/projects/:id/onus/:onuAssociationId`",
    "### DELETE `/api/admin/projects/:id/onus/:onuAssociationId`",
    "### POST `/api/unregistered-onus/:id/config-plan`"
  ];
  for (const section of requiredApiSections) {
    assert.match(api, new RegExp(section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.match(api, /项目模板 `templateId` 格式为 `project:<projectId>:(zte|huawei)`/);
  assert.match(api, /只返回命令预览，不登录、不粘贴、不执行、不保存到 OLT/);
  assert.match(api, /同一个 ONU 已属于其它项目时返回 `400`/);
  assert.match(api, /只删除本地项目-ONU 关联/);
  assert.match(api, /只更新本地 SQLite `project_onus\.note`/);

  assert.match(database, /## 表：projects/);
  assert.match(database, /## 表：project_onus/);
  assert.match(database, /`olt_id \+ chassis \+ board \+ pon \+ onu_id` 唯一/);
  assert.match(database, /加入项目时保存的序列号快照/);
  assert.match(database, /项目详情移除 ONU 只删除本地 `project_onus` 单条关联/);
  assert.match(database, /项目详情刷新状态失败时保留/);

  assert.match(sequence, /## 项目管理流程/);
  assert.match(sequence, /## ONU 加入项目流程/);
  assert.match(sequence, /## 项目详情刷新流程/);
  assert.match(sequence, /## 未注册 ONU 配置方案生成/);
  assert.match(sequence, /项目模板由本地项目动态生成/);

  assert.match(architecture, /项目管理：维护本地项目、项目 VLAN、联系人和后续项目-ONU 关联/);
  assert.match(architecture, /项目管理只读写本地 SQLite 项目资料和项目-ONU 关联/);
  assert.match(architecture, /ZTE 项目模板/);
  assert.match(architecture, /Huawei 项目模板/);

  assert.match(changelog, /项目管理基础功能/);
  assert.match(changelog, /ONU 数据查询支持显示所属项目/);
  assert.match(changelog, /项目详情支持查看项目 ONU 列表/);
  assert.match(changelog, /ONU 安装查询配置方案支持项目模板/);
});
