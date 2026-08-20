const ALLOWED_SNMP_OPERATIONS = new Set(["get", "walk"]);
const DANGEROUS_OPERATION_PATTERN = /\b(set|clear|erase|undo|delete|no|load|reboot|reset|reload|restart|shutdown|save|write|commit|format|factory|restore)\b/i;

export async function handleSnmpAdminRoutes(req, res, url, {
  readBody,
  json,
  olts = [],
  defaultOlt,
  publicOidProfiles,
  snmpGet,
  snmpWalk,
  addSnmpProbe,
  getSnmpHistory,
  getAdminEvents
} = {}) {
  if (req.method === "GET" && url.pathname === "/api/admin/oid-profiles") {
    await json(res, 200, publicOidProfiles());
    return true;
  }
  if (req.method === "POST" && url.pathname === "/api/admin/snmp-test") {
    const body = await readBody(req);
    const targetOlt = olts.find((item) => item.id === body.oltId) || defaultOlt;
    const started = Date.now();
    const operation = String(body.operation || "").trim().toLowerCase();
    if (!ALLOWED_SNMP_OPERATIONS.has(operation) || DANGEROUS_OPERATION_PATTERN.test(operation)) {
      await json(res, 400, {
        ok: false,
        error: "危险操作已被禁止。系统只允许只读 SNMP get/walk，不允许 set/clear/erase/undo/delete/no/load/reboot/reset/shutdown/write 等会修改或影响 OLT 的命令。"
      });
      return true;
    }
    if (!/^\d+(\.\d+)+$/.test(String(body.oid || "").trim())) {
      await json(res, 400, { ok: false, error: "OID 格式无效，只允许数字点分格式。" });
      return true;
    }
    const oid = String(body.oid).trim();
    const result = operation === "walk"
      ? await snmpWalk(targetOlt, oid, "-On", 10000)
      : await snmpGet(targetOlt, oid, 6000);
    const durationMs = Date.now() - started;
    const rawOutput = operation === "walk" ? result.rows.map((row) => `${row.oid} = ${row.value}`).join("\n") : result.value;
    const summary = result.ok
      ? operation === "walk" ? `${result.rows.length} rows` : result.value.slice(0, 160)
      : result.error || "SNMP failed";
    await addSnmpProbe({ oltId: targetOlt.id, operation, oid, ok: result.ok, durationMs, summary, rawOutput });
    await json(res, 200, { ok: result.ok, operation, oid, durationMs, summary, rawOutput, rows: result.rows || [] });
    return true;
  }
  if (req.method === "GET" && url.pathname === "/api/admin/snmp-history") {
    await json(res, 200, await getSnmpHistory(Number(url.searchParams.get("limit") || 80)));
    return true;
  }
  if (req.method === "GET" && url.pathname === "/api/admin/events") {
    await json(res, 200, await getAdminEvents(Number(url.searchParams.get("limit") || 80)));
    return true;
  }
  return false;
}
