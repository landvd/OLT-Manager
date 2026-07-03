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
  1.3.6.1.4.1.3902.1012.3.28.1.1.3.268569344)
    printf '%s\\n' '1.3.6.1.4.1.3902.1012.3.28.1.1.3.268569344.6 = STRING: "ONU-6"'
    ;;
  1.3.6.1.4.1.3902.1012.3.28.1.1.5.268569088)
    printf '%s\\n' '1.3.6.1.4.1.3902.1012.3.28.1.1.5.268569088.4 = Hex-STRING: 5A 54 45 47 00 11 22 33'
    ;;
  1.3.6.1.4.1.3902.1012.3.28.1.1.5.268569344)
    printf '%s\\n' '1.3.6.1.4.1.3902.1012.3.28.1.1.5.268569344.6 = Hex-STRING: 5A 54 45 47 66 77 88 99'
    ;;
  1.3.6.1.4.1.3902.1012.3.28.2.1.4.268569088)
    printf '%s\\n' '1.3.6.1.4.1.3902.1012.3.28.2.1.4.268569088.4 = INTEGER: 3'
    ;;
  1.3.6.1.4.1.3902.1012.3.28.2.1.4.268569344)
    printf '%s\\n' '1.3.6.1.4.1.3902.1012.3.28.2.1.4.268569344.6 = INTEGER: 3'
    ;;
  1.3.6.1.4.1.3902.1012.3.28.1.1.4.268569088)
    printf '%s\\n' '1.3.6.1.4.1.3902.1012.3.28.1.1.4.268569088.4 = INTEGER: 12850'
    ;;
  1.3.6.1.4.1.3902.1012.3.28.1.1.4.268569344)
    printf '%s\\n' '1.3.6.1.4.1.3902.1012.3.28.1.1.4.268569344.6 = INTEGER: 18900'
    ;;
  1.3.6.1.4.1.3902.1012.3.50.12.1.1.10.268569344)
    printf '%s\\n' '1.3.6.1.4.1.3902.1012.3.50.12.1.1.10.268569344.6 = INTEGER: 5550'
    ;;
  1.3.6.1.4.1.3902.1012.3.28.1.1.6.268569088)
    printf '%s\\n' '1.3.6.1.4.1.3902.1012.3.28.1.1.6.268569088.4 = INTEGER: 1200'
    ;;
  1.3.6.1.4.1.3902.1012.3.28.1.1.6.268569344)
    printf '%s\\n' '1.3.6.1.4.1.3902.1012.3.28.1.1.6.268569344.6 = INTEGER: 800'
    ;;
  1.3.6.1.4.1.3902.1012.3.11.4.1.2.268569344)
    printf '%s\\n' '1.3.6.1.4.1.3902.1012.3.11.4.1.2.268569344.6 = INTEGER: 800'
    ;;
  1.3.6.1.2.1.31.1.1.1.1)
    printf '%s\\n' '1.3.6.1.2.1.31.1.1.1.1.4194312192 = STRING: "GPON 0/10/7"'
    ;;
  1.3.6.1.4.1.2011.6.128.1.1.2.45.1.4.4194312192)
    printf '%s\\n' '1.3.6.1.4.1.2011.6.128.1.1.2.45.1.4.4194312192.15 = STRING: "ONT-15"'
    ;;
  1.3.6.1.4.1.2011.6.128.1.1.2.46.1.30.4194312192)
    printf '%s\\n' '1.3.6.1.4.1.2011.6.128.1.1.2.46.1.30.4194312192.15 = Hex-STRING: 5A 54 45 47 00 11 22 33'
    ;;
  1.3.6.1.4.1.2011.6.128.1.1.2.46.1.15.4194312192)
    printf '%s\\n' '1.3.6.1.4.1.2011.6.128.1.1.2.46.1.15.4194312192.15 = INTEGER: 1'
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

test("config templates include local project templates with project name and VLAN", async (t) => {
  const started = await startServer({ port: 0 });
  t.after(() => started.server.close());

  const create = await requestJson(started.url, "/api/admin/projects", {
    method: "POST",
    body: JSON.stringify({ name: "项目模板学校", vlan: 1234 })
  });
  const templates = await requestJson(started.url, "/api/config-templates");
  const projectTemplates = templates.data.rows.filter((template) => template.projectId === create.data.project.id);

  assert.equal(templates.response.status, 200);
  assert.equal(projectTemplates.length, 2);
  assert.deepEqual(projectTemplates.map((template) => template.name), [
    "项目:项目模板学校(VLAN号:1234)",
    "项目:项目模板学校(VLAN号:1234)"
  ]);
  assert.deepEqual(projectTemplates.map((template) => template.deviceProfiles), [["zte-c300"], ["huawei-ma5800"]]);
  assert.deepEqual(projectTemplates.map((template) => template.vlan), [1234, 1234]);
});

test("ZTE project template generates preview commands with the project VLAN", async (t) => {
  const started = await startServer({ port: 0 });
  t.after(() => started.server.close());

  const adminOlts = await requestJson(started.url, "/api/admin/olts");
  const zteOlt = adminOlts.data.find((olt) => olt.vendor === "zte" && olt.deviceProfile === "zte-c300");
  assert.ok(zteOlt);
  const create = await requestJson(started.url, "/api/admin/projects", {
    method: "POST",
    body: JSON.stringify({ name: "ZTE 项目模板", vlan: 1234 })
  });
  const plan = await requestJson(started.url, "/api/unregistered-onus/ZTEG030C0914/config-plan", {
    method: "POST",
    body: JSON.stringify({
      oltId: zteOlt.id,
      chassis: "1",
      board: "2",
      pon: "10",
      serial: "ZTEG030C0914",
      templateId: `project:${create.data.project.id}:zte`,
      ethPorts: ["eth_0/1", "eth_0/4"]
    })
  });

  assert.equal(plan.response.status, 200);
  assert.equal(plan.data.ok, true);
  assert.equal(plan.data.blocked, false);
  assert.equal(plan.data.id, `project:${create.data.project.id}:zte`);
  assert.equal(plan.data.name, "项目:ZTE 项目模板(VLAN号:1234)");
  assert.equal(plan.data.businessType, "project");
  assert.equal(plan.data.variables.projectId, create.data.project.id);
  assert.equal(plan.data.variables.projectName, "ZTE 项目模板");
  assert.equal(plan.data.variables.projectVlan, "1234");
  assert.equal(plan.data.variables.innerVlan, "1234");
  assert.match(plan.data.commands, /sn-bind disable/);
  assert.match(plan.data.commands, /service-port 1 vport 1 user-vlan 1234 vlan 1234/);
  assert.match(plan.data.commands, /vlan port eth_0\/4 mode hybrid def-vlan 1234/);
  assert.doesNotMatch(plan.data.commands, /svlan/);
});

test("Huawei project template generates preview commands with the project VLAN", async (t) => {
  const started = await startServer({ port: 0 });
  t.after(() => started.server.close());

  const adminOlts = await requestJson(started.url, "/api/admin/olts");
  const huaweiOlt = adminOlts.data.find((olt) => olt.vendor === "huawei" && olt.deviceProfile === "huawei-ma5800");
  assert.ok(huaweiOlt);
  const create = await requestJson(started.url, "/api/admin/projects", {
    method: "POST",
    body: JSON.stringify({ name: "Huawei 项目模板", vlan: 2345 })
  });
  const plan = await requestJson(started.url, "/api/unregistered-onus/ZTEG-030C0914/config-plan", {
    method: "POST",
    body: JSON.stringify({
      oltId: huaweiOlt.id,
      chassis: "0",
      board: "10",
      pon: "7",
      serial: "ZTEG-030C0914",
      templateId: `project:${create.data.project.id}:huawei`,
      ethPorts: ["eth1", "eth3"]
    })
  });

  assert.equal(plan.response.status, 200);
  assert.equal(plan.data.ok, true);
  assert.equal(plan.data.blocked, false);
  assert.equal(plan.data.id, `project:${create.data.project.id}:huawei`);
  assert.equal(plan.data.name, "项目:Huawei 项目模板(VLAN号:2345)");
  assert.equal(plan.data.businessType, "project");
  assert.equal(plan.data.variables.projectId, create.data.project.id);
  assert.equal(plan.data.variables.projectName, "Huawei 项目模板");
  assert.equal(plan.data.variables.projectVlan, "2345");
  assert.equal(plan.data.variables.innerVlan, "2345");
  assert.equal(plan.data.variables.actualOntId, "16");
  assert.match(plan.data.commands, /ont add 7 sn-auth 5A544547030C0914/);
  assert.match(plan.data.commands, /ont port native-vlan 7 16 eth1 vlan 2345 priority 0/);
  assert.match(plan.data.commands, /ont port native-vlan 7 16 eth3 vlan 2345 priority 0/);
  assert.match(plan.data.commands, /service-port vlan 2345 gpon 0\/10\/7 ont 16 gemport 0 multi-service user-vlan 2345 tag-transform translate/);
  assert.match(plan.data.warnings.join("\n"), /不会执行或下发到 OLT/);
});

test("project template remains blocked for unsupported device profiles", async (t) => {
  const started = await startServer({ port: 0 });
  t.after(() => started.server.close());

  const adminOlts = await requestJson(started.url, "/api/admin/olts");
  const zteC600 = {
    ...adminOlts.data.find((olt) => olt.vendor === "zte"),
    id: "zte-c600-project-template",
    name: "ZTE C600 unsupported",
    model: "C600",
    deviceProfile: "zte-c600",
    host: "192.0.2.30"
  };
  await requestJson(started.url, "/api/admin/olts", {
    method: "PUT",
    body: JSON.stringify({ olts: [...adminOlts.data, zteC600] })
  });
  const create = await requestJson(started.url, "/api/admin/projects", {
    method: "POST",
    body: JSON.stringify({ name: "C600 项目模板阻止", vlan: 3456 })
  });
  const plan = await requestJson(started.url, "/api/unregistered-onus/ZTEG030C0914/config-plan", {
    method: "POST",
    body: JSON.stringify({
      oltId: zteC600.id,
      chassis: "1",
      board: "2",
      pon: "10",
      serial: "ZTEG030C0914",
      templateId: `project:${create.data.project.id}:zte`,
      ethPorts: ["eth_0/1"]
    })
  });

  assert.equal(plan.response.status, 200);
  assert.equal(plan.data.ok, true);
  assert.equal(plan.data.blocked, true);
  assert.equal(plan.data.id, `project:${create.data.project.id}:zte`);
  assert.match(plan.data.warnings.join("\n"), /暂未配置可用的配置方案模板|已阻止生成/);
  assert.equal(plan.data.commands, "");
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

test("project detail lists project ONU with refreshed current status", async (t) => {
  const started = await startServer({ port: 0 });
  t.after(() => started.server.close());

  const adminOlts = await requestJson(started.url, "/api/admin/olts");
  const zteOlt = adminOlts.data.find((olt) => olt.vendor === "zte");
  assert.ok(zteOlt);
  const create = await requestJson(started.url, "/api/admin/projects", {
    method: "POST",
    body: JSON.stringify({ name: "详情项目", vlan: 303 })
  });
  await requestJson(started.url, `/api/admin/projects/${create.data.project.id}/onus`, {
    method: "POST",
    body: JSON.stringify({
      oltId: zteOlt.id,
      chassis: "1",
      board: "2",
      pon: "11",
      onuId: "6",
      serial: "SNAPSHOT-SN",
      address: "快照地址",
      vlan: "303",
      note: "初始备注"
    })
  });

  const detail = await requestJson(started.url, `/api/admin/projects/${create.data.project.id}/onus`);

  assert.equal(detail.response.status, 200);
  assert.equal(detail.data.ok, true);
  assert.equal(detail.data.rows.length, 1);
  assert.equal(detail.data.rows[0].oltId, zteOlt.id);
  assert.equal(detail.data.rows[0].oltName, zteOlt.name);
  assert.equal(detail.data.rows[0].serial, "ZTEG66778899");
  assert.equal(detail.data.rows[0].phase, "working");
  assert.equal(detail.data.rows[0].rxPower, "-18.90 dBm");
  assert.equal(detail.data.rows[0].distance, "0.80 km");
  assert.notEqual(detail.data.rows[0].address, "快照地址");
  assert.equal(detail.data.rows[0].vlan, "303");
  assert.equal(detail.data.rows[0].note, "初始备注");
  assert.equal(detail.data.rows[0].refreshError, "");
});

test("project ONU note can be edited from project detail API", async (t) => {
  const started = await startServer({ port: 0 });
  t.after(() => started.server.close());

  const adminOlts = await requestJson(started.url, "/api/admin/olts");
  const zteOlt = adminOlts.data.find((olt) => olt.vendor === "zte");
  assert.ok(zteOlt);
  const create = await requestJson(started.url, "/api/admin/projects", {
    method: "POST",
    body: JSON.stringify({ name: "备注项目", vlan: 304 })
  });
  const add = await requestJson(started.url, `/api/admin/projects/${create.data.project.id}/onus`, {
    method: "POST",
    body: JSON.stringify({
      oltId: zteOlt.id,
      chassis: "1",
      board: "2",
      pon: "12",
      onuId: "7",
      serial: "NOTE-SN",
      address: "备注地址",
      vlan: "304",
      note: "旧备注"
    })
  });

  const update = await requestJson(started.url, `/api/admin/projects/${create.data.project.id}/onus/${add.data.onu.id}`, {
    method: "PUT",
    body: JSON.stringify({ note: "迁移到教学楼三层" })
  });
  const detail = await requestJson(started.url, `/api/admin/projects/${create.data.project.id}/onus`);

  assert.equal(update.response.status, 200);
  assert.equal(update.data.ok, true);
  assert.equal(update.data.onu.note, "迁移到教学楼三层");
  assert.equal(detail.data.rows[0].note, "迁移到教学楼三层");
});

test("project ONU can be removed from project detail without deleting the project", async (t) => {
  const started = await startServer({ port: 0 });
  t.after(() => started.server.close());

  const adminOlts = await requestJson(started.url, "/api/admin/olts");
  const zteOlt = adminOlts.data.find((olt) => olt.vendor === "zte");
  assert.ok(zteOlt);
  const create = await requestJson(started.url, "/api/admin/projects", {
    method: "POST",
    body: JSON.stringify({ name: "移除 ONU 项目", vlan: 305 })
  });
  const add = await requestJson(started.url, `/api/admin/projects/${create.data.project.id}/onus`, {
    method: "POST",
    body: JSON.stringify({
      oltId: zteOlt.id,
      chassis: "1",
      board: "2",
      pon: "13",
      onuId: "8",
      serial: "REMOVE-SN",
      address: "移除地址",
      vlan: "305"
    })
  });

  const remove = await requestJson(started.url, `/api/admin/projects/${create.data.project.id}/onus/${add.data.onu.id}`, {
    method: "DELETE"
  });
  const detail = await requestJson(started.url, `/api/admin/projects/${create.data.project.id}/onus`);
  const projects = await requestJson(started.url, "/api/admin/projects?q=移除 ONU 项目");

  assert.equal(remove.response.status, 200);
  assert.equal(remove.data.ok, true);
  assert.deepEqual(detail.data.rows, []);
  assert.equal(projects.data.rows.length, 1);
});

test("project detail keeps ONU snapshot when current status cannot be refreshed", async (t) => {
  const started = await startServer({ port: 0 });
  t.after(() => started.server.close());

  const adminOlts = await requestJson(started.url, "/api/admin/olts");
  const zteOlt = adminOlts.data.find((olt) => olt.vendor === "zte");
  assert.ok(zteOlt);
  const create = await requestJson(started.url, "/api/admin/projects", {
    method: "POST",
    body: JSON.stringify({ name: "离线快照项目", vlan: 306 })
  });
  await requestJson(started.url, `/api/admin/projects/${create.data.project.id}/onus`, {
    method: "POST",
    body: JSON.stringify({
      oltId: zteOlt.id,
      chassis: "1",
      board: "2",
      pon: "99",
      onuId: "9",
      serial: "SNAPSHOT-ONLY",
      address: "快照保留地址",
      vlan: "306",
      note: "离线保留"
    })
  });

  const detail = await requestJson(started.url, `/api/admin/projects/${create.data.project.id}/onus`);

  assert.equal(detail.response.status, 200);
  assert.equal(detail.data.rows.length, 1);
  assert.equal(detail.data.rows[0].serial, "SNAPSHOT-ONLY");
  assert.equal(detail.data.rows[0].address, "快照保留地址");
  assert.equal(detail.data.rows[0].vlan, "306");
  assert.equal(detail.data.rows[0].note, "离线保留");
  assert.match(detail.data.rows[0].refreshError, /未读取到|读取失败|快照/);
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
