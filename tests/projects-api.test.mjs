import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.OLT_MANAGER_DATA_DIR = await mkdtemp(join(tmpdir(), "olt-manager-projects-"));
const fakeSnmpBin = join(await mkdtemp(join(tmpdir(), "olt-manager-snmp-")), "snmpbulkwalk");
await writeFile(fakeSnmpBin, `#!/bin/sh
oid="$6"
case "$oid" in
  1.3.6.1.4.1.3902.1012.3.28.1.1.3.268569088)
    printf '%s\\n' '1.3.6.1.4.1.3902.1012.3.28.1.1.3.268569088.4 = STRING: "ONU-4"'
    ;;
  1.3.6.1.4.1.3902.1012.3.28.1.1.5.268569088)
    printf '%s\\n' '1.3.6.1.4.1.3902.1012.3.28.1.1.5.268569088.4 = Hex-STRING: 5A 54 45 47 00 11 22 33'
    ;;
  1.3.6.1.4.1.3902.1012.3.28.2.1.4.268569088)
    printf '%s\\n' '1.3.6.1.4.1.3902.1012.3.28.2.1.4.268569088.4 = INTEGER: 3'
    ;;
  1.3.6.1.4.1.3902.1012.3.28.1.1.4.268569088)
    printf '%s\\n' '1.3.6.1.4.1.3902.1012.3.28.1.1.4.268569088.4 = INTEGER: 12850'
    ;;
  1.3.6.1.4.1.3902.1012.3.28.1.1.6.268569088)
    printf '%s\\n' '1.3.6.1.4.1.3902.1012.3.28.1.1.6.268569088.4 = INTEGER: 1200'
    ;;
esac
`);
await chmod(fakeSnmpBin, 0o755);
process.env.OLT_MANAGER_SNMPBULKWALK_BIN = fakeSnmpBin;

const { startServer } = await import("../src/server.mjs");
const { addProjectOnu, getProjectOnus } = await import("../src/db.mjs");

async function requestJson(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  const data = await response.json();
  return { response, data };
}

test("project can be created and retrieved through the admin API", async (t) => {
  const started = await startServer({ port: 0 });
  t.after(() => started.server.close());

  const create = await requestJson(started.url, "/api/admin/projects", {
    method: "POST",
    body: JSON.stringify({
      name: "厚街中学",
      vlan: 123,
      address: "",
      contactName: "王工",
      contactPhone: "13800138000",
      contactNote: "现场联系人"
    })
  });

  assert.equal(create.response.status, 200);
  assert.equal(create.data.ok, true);
  assert.equal(create.data.project.name, "厚街中学");
  assert.equal(create.data.project.vlan, 123);

  const list = await requestJson(started.url, "/api/admin/projects");

  assert.equal(list.response.status, 200);
  assert.deepEqual(list.data.rows.map((project) => project.name), ["厚街中学"]);
  assert.equal(list.data.rows[0].contactName, "王工");
});

test("project name is globally unique", async (t) => {
  const started = await startServer({ port: 0 });
  t.after(() => started.server.close());

  const body = {
    name: "CaseProject",
    vlan: 321
  };
  const first = await requestJson(started.url, "/api/admin/projects", {
    method: "POST",
    body: JSON.stringify(body)
  });
  const duplicate = await requestJson(started.url, "/api/admin/projects", {
    method: "POST",
    body: JSON.stringify(body)
  });
  const duplicateWithDifferentCase = await requestJson(started.url, "/api/admin/projects", {
    method: "POST",
    body: JSON.stringify({ name: "caseproject", vlan: 322 })
  });

  assert.equal(first.response.status, 200);
  assert.equal(duplicate.response.status, 400);
  assert.match(duplicate.data.error, /项目名称.*唯一|已存在/);
  assert.equal(duplicateWithDifferentCase.response.status, 400);
  assert.match(duplicateWithDifferentCase.data.error, /项目名称.*唯一|已存在/);
});

test("project VLAN must be a single VLAN in the valid range", async (t) => {
  const started = await startServer({ port: 0 });
  t.after(() => started.server.close());

  const missing = await requestJson(started.url, "/api/admin/projects", {
    method: "POST",
    body: JSON.stringify({ name: "缺 VLAN 项目" })
  });
  const outOfRange = await requestJson(started.url, "/api/admin/projects", {
    method: "POST",
    body: JSON.stringify({ name: "超范围 VLAN 项目", vlan: 4095 })
  });

  assert.equal(missing.response.status, 400);
  assert.match(missing.data.error, /VLAN/);
  assert.equal(outOfRange.response.status, 400);
  assert.match(outOfRange.data.error, /1-4094/);
});

test("project can be edited and searched by project fields", async (t) => {
  const started = await startServer({ port: 0 });
  t.after(() => started.server.close());

  const create = await requestJson(started.url, "/api/admin/projects", {
    method: "POST",
    body: JSON.stringify({ name: "可编辑项目", vlan: 200 })
  });
  const update = await requestJson(started.url, `/api/admin/projects/${create.data.project.id}`, {
    method: "PUT",
    body: JSON.stringify({
      name: "可编辑项目",
      vlan: 201,
      address: "厚街镇教育园",
      contactName: "李工",
      contactPhone: "13900139000",
      contactNote: "白天联系"
    })
  });
  const search = await requestJson(started.url, "/api/admin/projects?q=教育园");

  assert.equal(update.response.status, 200);
  assert.equal(update.data.project.vlan, 201);
  assert.equal(update.data.project.address, "厚街镇教育园");
  assert.deepEqual(search.data.rows.map((project) => project.name), ["可编辑项目"]);
});

test("project can be deleted from the local project list", async (t) => {
  const started = await startServer({ port: 0 });
  t.after(() => started.server.close());

  const create = await requestJson(started.url, "/api/admin/projects", {
    method: "POST",
    body: JSON.stringify({ name: "待删除项目", vlan: 202 })
  });
  await addProjectOnu(create.data.project.id, {
    oltId: "olt-a",
    chassis: "1",
    board: "2",
    pon: "3",
    onuId: "4",
    serial: "ZTEG00112233",
    address: "本地快照地址",
    vlan: "202",
    note: "本地关联备注"
  });
  const remove = await requestJson(started.url, `/api/admin/projects/${create.data.project.id}`, {
    method: "DELETE"
  });
  const list = await requestJson(started.url, "/api/admin/projects?q=待删除项目");
  const onus = await getProjectOnus(create.data.project.id);

  assert.equal(remove.response.status, 200);
  assert.equal(remove.data.ok, true);
  assert.deepEqual(list.data.rows, []);
  assert.deepEqual(onus, []);
});

test("registered ONU can be added to a project and shown in ONU query results", async (t) => {
  const started = await startServer({ port: 0 });
  t.after(() => started.server.close());

  const adminOlts = await requestJson(started.url, "/api/admin/olts");
  const zteOlt = adminOlts.data.find((olt) => olt.vendor === "zte");
  assert.ok(zteOlt);
  const create = await requestJson(started.url, "/api/admin/projects", {
    method: "POST",
    body: JSON.stringify({ name: "归集项目", vlan: 300 })
  });
  const add = await requestJson(started.url, `/api/admin/projects/${create.data.project.id}/onus`, {
    method: "POST",
    body: JSON.stringify({
      oltId: zteOlt.id,
      chassis: "1",
      board: "2",
      pon: "10",
      onuId: "4",
      serial: "ZTEG00112233",
      address: "Example ZTE field sample chassis 1 board 2 PON 10",
      vlan: "300"
    })
  });
  const onus = await requestJson(started.url, `/api/onus?oltId=${encodeURIComponent(zteOlt.id)}&board=2&pon=10`);
  const localAssociations = await getProjectOnus(create.data.project.id);

  assert.equal(add.response.status, 200);
  assert.equal(add.data.ok, true);
  assert.equal(add.data.onu.projectId, create.data.project.id);
  assert.equal(localAssociations.length, 1);
  assert.equal(localAssociations[0].oltId, zteOlt.id);
  assert.equal(onus.response.status, 200);
  assert.equal(onus.data.length, 1);
  assert.deepEqual(onus.data[0].project, {
    id: create.data.project.id,
    name: "归集项目",
    vlan: 300
  });
});

test("registered ONU cannot be assigned to more than one project", async (t) => {
  const started = await startServer({ port: 0 });
  t.after(() => started.server.close());

  const adminOlts = await requestJson(started.url, "/api/admin/olts");
  const zteOlt = adminOlts.data.find((olt) => olt.vendor === "zte");
  assert.ok(zteOlt);
  const firstProject = await requestJson(started.url, "/api/admin/projects", {
    method: "POST",
    body: JSON.stringify({ name: "原项目", vlan: 301 })
  });
  const secondProject = await requestJson(started.url, "/api/admin/projects", {
    method: "POST",
    body: JSON.stringify({ name: "新项目", vlan: 302 })
  });
  const payload = {
    oltId: zteOlt.id,
    chassis: "1",
    board: "2",
    pon: "10",
    onuId: "5",
    serial: "ZTEG00445566",
    address: "项目归属冲突样例",
    vlan: "301"
  };
  const firstAdd = await requestJson(started.url, `/api/admin/projects/${firstProject.data.project.id}/onus`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
  const duplicate = await requestJson(started.url, `/api/admin/projects/${secondProject.data.project.id}/onus`, {
    method: "POST",
    body: JSON.stringify({ ...payload, vlan: "302" })
  });
  const firstOnus = await getProjectOnus(firstProject.data.project.id);
  const secondOnus = await getProjectOnus(secondProject.data.project.id);

  assert.equal(firstAdd.response.status, 200);
  assert.equal(duplicate.response.status, 400);
  assert.match(duplicate.data.error, /已属于项目「原项目」|先从原项目移除/);
  assert.equal(firstOnus.length, 1);
  assert.equal(secondOnus.length, 0);
});
