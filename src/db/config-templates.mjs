// 配置方案模板。
import { BUILTIN_CONFIG_TEMPLATES, checkConfigTemplate, normalizeTemplateInputs } from "../config-plan-engine.mjs";
import { exec, query, sqlQuote } from "./core.mjs";

function parseJsonSafe(text, fallback) {
  try {
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
}

function mapConfigTemplateRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    vendor: row.vendor,
    deviceProfiles: parseJsonSafe(row.device_profiles_json, []),
    businessType: row.business_type,
    portMode: row.port_mode || "single",
    defaultParams: parseJsonSafe(row.default_params_json, {}),
    commandTemplate: row.command_template || "",
    inputParams: normalizeTemplateInputs(parseJsonSafe(row.input_params_json, [])),
    remark: row.remark || "",
    isBuiltin: Boolean(row.is_builtin),
    sortOrder: Number(row.sort_order || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function builtinColumns(tpl) {
  return {
    name: tpl.name,
    vendor: tpl.vendor,
    device_profiles_json: JSON.stringify(tpl.deviceProfiles || []),
    business_type: tpl.businessType,
    port_mode: tpl.portMode || "single",
    default_params_json: JSON.stringify(tpl.defaultParams || {}),
    command_template: tpl.commandTemplate || "",
    input_params_json: JSON.stringify(tpl.inputParams || []),
    remark: tpl.remark || ""
  };
}

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

/**
 * 内置方案只读，启动时与代码中的出厂版本保持一致。
 * 旧版本允许直接改内置方案：若本地改过（updated_at 与 created_at 不同且内容和出厂版本不一致），
 * 先把改过的内容另存为一份自定义方案再同步，避免丢失现场改动。
 */
export async function seedConfigTemplates() {
  // 清理废弃或未经验证的内置方案
  await exec("DELETE FROM config_templates WHERE id IN ('zte-hotel-quad-play', 'zte-c600-hotel-quad-play', 'huawei-hotel-quad-play');");

  for (let i = 0; i < BUILTIN_CONFIG_TEMPLATES.length; i++) {
    const tpl = BUILTIN_CONFIG_TEMPLATES[i];
    const columns = builtinColumns(tpl);
    const [existing] = await query(`SELECT * FROM config_templates WHERE id = ${sqlQuote(tpl.id)} LIMIT 1;`);
    if (!existing) {
      await exec(`INSERT INTO config_templates (
        id, name, vendor, device_profiles_json, business_type, port_mode, default_params_json, command_template, input_params_json, remark, is_builtin, sort_order
      ) VALUES (
        ${sqlQuote(tpl.id)},
        ${Object.values(columns).map((value) => sqlQuote(value)).join(",\n        ")},
        1,
        ${(i + 1) * 10}
      );`);
      continue;
    }
    const differs = Object.entries(columns).some(([key, value]) => String(existing[key] ?? "") !== value);
    if (!differs) continue;
    const editedLocally = String(existing.updated_at || "") !== String(existing.created_at || "") && (
      String(existing.command_template || "") !== columns.command_template ||
      String(existing.default_params_json || "{}") !== columns.default_params_json
    );
    if (editedLocally) {
      const backupId = `custom-backup-${tpl.id}`;
      const [backup] = await query(`SELECT id FROM config_templates WHERE id = ${sqlQuote(backupId)} LIMIT 1;`);
      if (!backup) {
        await exec(`INSERT INTO config_templates (
          id, name, vendor, device_profiles_json, business_type, port_mode, default_params_json, command_template, input_params_json, remark, is_builtin, sort_order
        ) VALUES (
          ${sqlQuote(backupId)},
          ${sqlQuote(`${existing.name}（本地修改备份）`)},
          ${sqlQuote(existing.vendor)},
          ${sqlQuote(existing.device_profiles_json || "[]")},
          ${sqlQuote(existing.business_type || "custom")},
          ${sqlQuote(existing.port_mode || "single")},
          ${sqlQuote(existing.default_params_json || "{}")},
          ${sqlQuote(existing.command_template || "")},
          '[]',
          ${sqlQuote("内置方案改为只读前，本机对该内置方案的修改。")},
          0,
          999
        );`);
      }
    }
    await exec(`UPDATE config_templates
      SET ${Object.entries(columns).map(([key, value]) => `${key} = ${sqlQuote(value)}`).join(",\n          ")},
          is_builtin = 1,
          updated_at = created_at
      WHERE id = ${sqlQuote(tpl.id)};`);
  }
}

export async function listConfigTemplates(options = {}) {
  const vendor = String(options.vendor || "").trim().toLowerCase();
  const profile = String(options.deviceProfile || options.profile || "").trim().toLowerCase();
  const q = String(options.q || "").trim().toLowerCase();

  const rows = await query("SELECT * FROM config_templates ORDER BY sort_order ASC, is_builtin DESC, id ASC;");
  let templates = rows.map(mapConfigTemplateRow);

  if (vendor) {
    templates = templates.filter((t) => t.vendor.toLowerCase() === vendor);
  }
  if (profile) {
    templates = templates.filter((t) => !t.deviceProfiles.length || t.deviceProfiles.some((p) => p.toLowerCase() === profile));
  }
  if (q) {
    templates = templates.filter((t) =>
      t.name.toLowerCase().includes(q) ||
      t.id.toLowerCase().includes(q) ||
      t.remark.toLowerCase().includes(q) ||
      t.commandTemplate.toLowerCase().includes(q)
    );
  }
  return templates;
}

export async function getConfigTemplate(id) {
  const templateId = String(id || "").trim();
  const rows = await query(`SELECT * FROM config_templates WHERE id = ${sqlQuote(templateId)} LIMIT 1;`);
  return rows.length ? mapConfigTemplateRow(rows[0]) : null;
}

export async function saveConfigTemplate(input = {}) {
  const name = String(input.name || "").trim();
  if (!name) throw badRequest("方案名称不能为空。");
  const vendor = String(input.vendor || "zte").trim().toLowerCase();
  if (!["zte", "huawei"].includes(vendor)) {
    const error = new Error("厂商必须为 zte 或 huawei。");
    error.status = 400;
    throw error;
  }
  const portMode = input.portMode === "multi" ? "multi" : "single";
  const businessType = String(input.businessType || (portMode === "multi" ? "multi-service" : "custom")).trim();
  const deviceProfiles = Array.isArray(input.deviceProfiles) ? input.deviceProfiles : [];
  const defaultParams = typeof input.defaultParams === "object" && input.defaultParams !== null ? input.defaultParams : {};
  const commandTemplate = String(input.commandTemplate || "").trim();
  const inputParams = normalizeTemplateInputs(input.inputParams);
  const remark = String(input.remark || "").trim();
  const check = checkConfigTemplate({ vendor, commandTemplate, inputParams });
  if (!check.ok) throw badRequest(check.errors[0].message);

  let id = String(input.id || "").trim();
  const isExisting = Boolean(id);
  if (!id) {
    id = `custom-${vendor}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  }

  const existingRow = isExisting ? await query(`SELECT id, is_builtin, sort_order FROM config_templates WHERE id = ${sqlQuote(id)} LIMIT 1;`) : [];
  if (existingRow.length && Number(existingRow[0].is_builtin) === 1) {
    throw badRequest("系统内置方案只读；请点“复制为我的方案”后再修改。");
  }
  const sortOrder = existingRow.length ? Number(existingRow[0].sort_order) : 999;

  if (existingRow.length) {
    await exec(`UPDATE config_templates
      SET name = ${sqlQuote(name)},
          vendor = ${sqlQuote(vendor)},
          device_profiles_json = ${sqlQuote(JSON.stringify(deviceProfiles))},
          business_type = ${sqlQuote(businessType)},
          port_mode = ${sqlQuote(portMode)},
          default_params_json = ${sqlQuote(JSON.stringify(defaultParams))},
          command_template = ${sqlQuote(commandTemplate)},
          input_params_json = ${sqlQuote(JSON.stringify(inputParams))},
          remark = ${sqlQuote(remark)},
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ${sqlQuote(id)};`);
  } else {
    await exec(`INSERT INTO config_templates (
      id, name, vendor, device_profiles_json, business_type, port_mode, default_params_json, command_template, input_params_json, remark, is_builtin, sort_order
    ) VALUES (
      ${sqlQuote(id)},
      ${sqlQuote(name)},
      ${sqlQuote(vendor)},
      ${sqlQuote(JSON.stringify(deviceProfiles))},
      ${sqlQuote(businessType)},
      ${sqlQuote(portMode)},
      ${sqlQuote(JSON.stringify(defaultParams))},
      ${sqlQuote(commandTemplate)},
      ${sqlQuote(JSON.stringify(inputParams))},
      ${sqlQuote(remark)},
      0,
      ${sortOrder}
    );`);
  }

  const [row] = await query(`SELECT * FROM config_templates WHERE id = ${sqlQuote(id)};`);
  return mapConfigTemplateRow(row);
}

export async function deleteConfigTemplate(id) {
  const templateId = String(id || "").trim();
  const rows = await query(`SELECT id, is_builtin, name FROM config_templates WHERE id = ${sqlQuote(templateId)} LIMIT 1;`);
  if (!rows.length) {
    const error = new Error("方案不存在。");
    error.status = 404;
    throw error;
  }
  const existing = rows[0];
  if (Number(existing.is_builtin) === 1) {
    const error = new Error("系统内置方案不能删除；若有修改可点击“恢复出厂默认”。");
    error.status = 400;
    throw error;
  }
  await exec(`DELETE FROM config_templates WHERE id = ${sqlQuote(templateId)};`);
  return { ok: true, id: templateId, name: existing.name };
}

export async function resetBuiltinConfigTemplate(id) {
  const templateId = String(id || "").trim();
  const builtin = BUILTIN_CONFIG_TEMPLATES.find((t) => t.id === templateId);
  if (!builtin) {
    const error = new Error("该方案不是系统内置方案，无法执行恢复出厂默认。");
    error.status = 400;
    throw error;
  }
  await exec(`UPDATE config_templates
    SET name = ${sqlQuote(builtin.name)},
        vendor = ${sqlQuote(builtin.vendor)},
        device_profiles_json = ${sqlQuote(JSON.stringify(builtin.deviceProfiles || []))},
        business_type = ${sqlQuote(builtin.businessType)},
        port_mode = ${sqlQuote(builtin.portMode || "single")},
        default_params_json = ${sqlQuote(JSON.stringify(builtin.defaultParams || {}))},
        command_template = ${sqlQuote(builtin.commandTemplate || "")},
        input_params_json = ${sqlQuote(JSON.stringify(builtin.inputParams || []))},
        remark = ${sqlQuote(builtin.remark || "")},
        updated_at = created_at
    WHERE id = ${sqlQuote(templateId)};`);

  const [row] = await query(`SELECT * FROM config_templates WHERE id = ${sqlQuote(templateId)};`);
  return mapConfigTemplateRow(row);
}
