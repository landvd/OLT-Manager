// 专线项目与项目 ONU。
import { exec, query, sqlQuote } from "./core.mjs";

function projectId() {
  return `project-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function mapProjectRow(row) {
  return {
    id: row.id,
    name: row.name,
    vlan: Number(row.vlan),
    address: row.address || "",
    contactName: row.contact_name || "",
    contactPhone: row.contact_phone || "",
    contactNote: row.contact_note || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeProjectInput(input = {}) {
  const name = String(input.name || "").trim();
  const rawVlan = String(input.vlan ?? "").trim();
  const vlan = Number(rawVlan);
  if (!name) {
    const error = new Error("项目名称不能为空。");
    error.status = 400;
    throw error;
  }
  if (!/^\d+$/.test(rawVlan) || !Number.isInteger(vlan) || vlan < 1 || vlan > 4094) {
    const error = new Error("项目 VLAN 必须是 1-4094 范围内的单个 VLAN。");
    error.status = 400;
    throw error;
  }
  return {
    name,
    vlan,
    address: String(input.address || "").trim(),
    contactName: String(input.contactName || "").trim(),
    contactPhone: String(input.contactPhone || "").trim(),
    contactNote: String(input.contactNote || "").trim()
  };
}

export async function getProjects(options = {}) {
  const keyword = String(options.q || options.search || "").trim().toLowerCase();
  const where = keyword
    ? `WHERE lower(name) LIKE ${sqlQuote(`%${keyword}%`)}
      OR lower(address) LIKE ${sqlQuote(`%${keyword}%`)}
      OR lower(contact_name) LIKE ${sqlQuote(`%${keyword}%`)}
      OR lower(contact_phone) LIKE ${sqlQuote(`%${keyword}%`)}
      OR lower(contact_note) LIKE ${sqlQuote(`%${keyword}%`)}
      OR CAST(vlan AS TEXT) LIKE ${sqlQuote(`%${keyword}%`)}`
    : "";
  const rows = await query(`SELECT * FROM projects ${where} ORDER BY name COLLATE NOCASE, id;`);
  return rows.map(mapProjectRow);
}

export async function getProject(id) {
  const projectIdValue = String(id || "").trim();
  const rows = await query(`SELECT * FROM projects WHERE id = ${sqlQuote(projectIdValue)} LIMIT 1;`);
  return rows.length ? mapProjectRow(rows[0]) : null;
}

export async function createProject(input = {}) {
  const project = normalizeProjectInput(input);
  const duplicate = await query(`SELECT id FROM projects WHERE lower(name) = lower(${sqlQuote(project.name)}) LIMIT 1;`);
  if (duplicate.length) {
    const error = new Error("项目名称已存在，项目名称必须全局唯一。");
    error.status = 400;
    throw error;
  }
  const id = projectId();
  await exec(`BEGIN;
INSERT INTO projects (id, name, vlan, address, contact_name, contact_phone, contact_note)
VALUES (${sqlQuote(id)}, ${sqlQuote(project.name)}, ${Number(project.vlan)}, ${sqlQuote(project.address)}, ${sqlQuote(project.contactName)}, ${sqlQuote(project.contactPhone)}, ${sqlQuote(project.contactNote)});
INSERT INTO admin_events (action, source, detail) VALUES ('create_project', 'admin', ${sqlQuote(project.name)});
COMMIT;`);
  const rows = await query(`SELECT * FROM projects WHERE id = ${sqlQuote(id)};`);
  return mapProjectRow(rows[0]);
}

export async function updateProject(id, input = {}) {
  const projectIdValue = String(id || "").trim();
  const project = normalizeProjectInput(input);
  const existing = await query(`SELECT id FROM projects WHERE id = ${sqlQuote(projectIdValue)} LIMIT 1;`);
  if (!existing.length) {
    const error = new Error("项目不存在。");
    error.status = 404;
    throw error;
  }
  const duplicate = await query(`SELECT id FROM projects WHERE lower(name) = lower(${sqlQuote(project.name)}) AND id <> ${sqlQuote(projectIdValue)} LIMIT 1;`);
  if (duplicate.length) {
    const error = new Error("项目名称已存在，项目名称必须全局唯一。");
    error.status = 400;
    throw error;
  }
  await exec(`BEGIN;
UPDATE projects
SET name = ${sqlQuote(project.name)},
    vlan = ${Number(project.vlan)},
    address = ${sqlQuote(project.address)},
    contact_name = ${sqlQuote(project.contactName)},
    contact_phone = ${sqlQuote(project.contactPhone)},
    contact_note = ${sqlQuote(project.contactNote)},
    updated_at = CURRENT_TIMESTAMP
WHERE id = ${sqlQuote(projectIdValue)};
INSERT INTO admin_events (action, source, detail) VALUES ('update_project', 'admin', ${sqlQuote(project.name)});
COMMIT;`);
  const rows = await query(`SELECT * FROM projects WHERE id = ${sqlQuote(projectIdValue)};`);
  return mapProjectRow(rows[0]);
}

export async function deleteProject(id) {
  const projectIdValue = String(id || "").trim();
  const existing = await query(`SELECT name FROM projects WHERE id = ${sqlQuote(projectIdValue)} LIMIT 1;`);
  if (!existing.length) {
    const error = new Error("项目不存在。");
    error.status = 404;
    throw error;
  }
  await exec(`BEGIN;
DELETE FROM project_onus WHERE project_id = ${sqlQuote(projectIdValue)};
DELETE FROM projects WHERE id = ${sqlQuote(projectIdValue)};
INSERT INTO admin_events (action, source, detail) VALUES ('delete_project', 'admin', ${sqlQuote(existing[0].name)});
COMMIT;`);
  return { ok: true };
}

function mapProjectOnuRow(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name || "",
    projectVlan: row.project_vlan == null ? undefined : Number(row.project_vlan),
    oltId: row.olt_id,
    chassis: row.chassis,
    board: row.board,
    slot: row.board,
    pon: row.pon,
    onuId: row.onu_id,
    serial: row.serial || "",
    address: row.address || "",
    vlan: row.vlan || "",
    note: row.note || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function addProjectOnu(projectId, input = {}) {
  const projectIdValue = String(projectId || "").trim();
  const identity = {
    oltId: String(input.oltId || "").trim(),
    chassis: String(input.chassis || "").trim(),
    board: String(input.board || input.slot || "").trim(),
    pon: String(input.pon || "").trim(),
    onuId: String(input.onuId || "").trim()
  };
  if (!projectIdValue) {
    const error = new Error("项目不存在。");
    error.status = 404;
    throw error;
  }
  if (!identity.oltId || !identity.chassis || !identity.board || !identity.pon || !identity.onuId) {
    const error = new Error("缺少 OLT、槽、板卡、PON 或 ONU ID，不能加入项目。");
    error.status = 400;
    throw error;
  }
  const project = await query(`SELECT id FROM projects WHERE id = ${sqlQuote(projectIdValue)} LIMIT 1;`);
  if (!project.length) {
    const error = new Error("项目不存在。");
    error.status = 404;
    throw error;
  }
  const existing = await query(`
SELECT po.project_id, p.name AS project_name
FROM project_onus po
JOIN projects p ON p.id = po.project_id
WHERE po.olt_id = ${sqlQuote(identity.oltId)}
  AND po.chassis = ${sqlQuote(identity.chassis)}
  AND po.board = ${sqlQuote(identity.board)}
  AND po.pon = ${sqlQuote(identity.pon)}
  AND po.onu_id = ${sqlQuote(identity.onuId)}
LIMIT 1;`);
  if (existing.length) {
    const error = new Error(`该 ONU 已属于项目「${existing[0].project_name}」，请先从原项目移除后再添加。`);
    error.status = 400;
    throw error;
  }
  await exec(`INSERT INTO project_onus (project_id, olt_id, chassis, board, pon, onu_id, serial, address, vlan, note)
VALUES (${sqlQuote(projectIdValue)}, ${sqlQuote(identity.oltId)}, ${sqlQuote(identity.chassis)}, ${sqlQuote(identity.board)}, ${sqlQuote(identity.pon)}, ${sqlQuote(identity.onuId)}, ${sqlQuote(input.serial || "")}, ${sqlQuote(input.address || "")}, ${sqlQuote(input.vlan || "")}, ${sqlQuote(input.note || "")});
INSERT INTO admin_events (action, source, detail) VALUES ('add_project_onu', 'admin', ${sqlQuote(`${projectIdValue} ${identity.oltId}/${identity.chassis}/${identity.board}/${identity.pon}/${identity.onuId}`)});`);
  const rows = await query(`
SELECT po.*, p.name AS project_name, p.vlan AS project_vlan
FROM project_onus po
JOIN projects p ON p.id = po.project_id
WHERE po.project_id = ${sqlQuote(projectIdValue)}
ORDER BY po.id DESC
LIMIT 1;`);
  return mapProjectOnuRow(rows[0]);
}

export async function getProjectOnus(projectId) {
  const rows = await query(`SELECT * FROM project_onus WHERE project_id = ${sqlQuote(projectId)} ORDER BY id;`);
  return rows.map(mapProjectOnuRow);
}

export async function updateProjectOnuNote(projectId, onuAssociationId, input = {}) {
  const projectIdValue = String(projectId || "").trim();
  const associationId = Number(onuAssociationId);
  if (!projectIdValue || !Number.isInteger(associationId) || associationId <= 0) {
    const error = new Error("项目 ONU 关联不存在。");
    error.status = 404;
    throw error;
  }
  const existing = await query(`
SELECT po.*, p.name AS project_name, p.vlan AS project_vlan
FROM project_onus po
JOIN projects p ON p.id = po.project_id
WHERE po.project_id = ${sqlQuote(projectIdValue)} AND po.id = ${associationId}
LIMIT 1;`);
  if (!existing.length) {
    const error = new Error("项目 ONU 关联不存在。");
    error.status = 404;
    throw error;
  }
  const note = String(input.note || "").trim();
  await exec(`BEGIN;
UPDATE project_onus SET note = ${sqlQuote(note)}, updated_at = CURRENT_TIMESTAMP WHERE project_id = ${sqlQuote(projectIdValue)} AND id = ${associationId};
INSERT INTO admin_events (action, source, detail) VALUES ('update_project_onu_note', 'admin', ${sqlQuote(`${projectIdValue} ${associationId}`)});
COMMIT;`);
  const rows = await query(`
SELECT po.*, p.name AS project_name, p.vlan AS project_vlan
FROM project_onus po
JOIN projects p ON p.id = po.project_id
WHERE po.project_id = ${sqlQuote(projectIdValue)} AND po.id = ${associationId}
LIMIT 1;`);
  return mapProjectOnuRow(rows[0]);
}

export async function deleteProjectOnu(projectId, onuAssociationId) {
  const projectIdValue = String(projectId || "").trim();
  const associationId = Number(onuAssociationId);
  if (!projectIdValue || !Number.isInteger(associationId) || associationId <= 0) {
    const error = new Error("项目 ONU 关联不存在。");
    error.status = 404;
    throw error;
  }
  const existing = await query(`SELECT id FROM project_onus WHERE project_id = ${sqlQuote(projectIdValue)} AND id = ${associationId} LIMIT 1;`);
  if (!existing.length) {
    const error = new Error("项目 ONU 关联不存在。");
    error.status = 404;
    throw error;
  }
  await exec(`BEGIN;
DELETE FROM project_onus WHERE project_id = ${sqlQuote(projectIdValue)} AND id = ${associationId};
INSERT INTO admin_events (action, source, detail) VALUES ('delete_project_onu', 'admin', ${sqlQuote(`${projectIdValue} ${associationId}`)});
COMMIT;`);
  return { ok: true };
}

export async function getProjectOnuAssignments(options = {}) {
  const oltId = String(options.oltId || "").trim();
  const where = oltId ? `WHERE po.olt_id = ${sqlQuote(oltId)}` : "";
  const rows = await query(`
SELECT po.*, p.name AS project_name, p.vlan AS project_vlan
FROM project_onus po
JOIN projects p ON p.id = po.project_id
${where}
ORDER BY po.id;`);
  return rows.map(mapProjectOnuRow);
}
