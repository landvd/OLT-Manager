import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { emptyFeishuState, normalizeFeishuState } from "./state.mjs";
import { clone as cloneJson } from "./clone.mjs";

const LEGACY_STATE_FILE = "local-administration.json";

function text(value) {
  return String(value ?? "").trim();
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function clone(value) {
  return cloneJson(value);
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function legacyFingerprint(value) {
  return digest(JSON.stringify(value));
}

function migrationMarker(state, sourceFingerprint) {
  return state.auditArchive.find((record) =>
    record?.eventType === "legacy-feishu-migration" &&
    record?.sourceFingerprint === sourceFingerprint
  );
}

function normalizeLegacyState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("旧 Feishu 状态必须是 JSON 对象。");
  }
  return value;
}

function normalizeLegacyChat(value) {
  const chatId = text(value?.chatId);
  if (!chatId) return null;
  return {
    chatId,
    type: value?.type === "group" ? "group" : "direct",
    remark: text(value?.remark),
    enabled: value?.enabled !== false
  };
}

function normalizeLegacyOperator(value) {
  const openId = text(value?.openId);
  if (!openId || !Array.isArray(value?.oltIds)) return null;
  return {
    openId,
    remark: text(value?.remark),
    oltIds: [...new Set(value.oltIds.map(text).filter(Boolean))],
    enabled: value?.enabled !== false
  };
}

function normalizeLegacyRequest(value) {
  const openId = text(value?.openId);
  const chatId = text(value?.chatId);
  if (!openId || !chatId) return null;
  const requestedAt = text(value?.lastRequestedAt || value?.requestedAt) || new Date(0).toISOString();
  return {
    requestId: `legacy:${digest(`${openId}\0${chatId}`).slice(0, 24)}`,
    openId,
    chatId,
    requestedAt,
    status: "pending"
  };
}

function publicPlan(plan) {
  return {
    sourceFingerprint: plan.sourceFingerprint,
    sourceFile: LEGACY_STATE_FILE,
    alreadyApplied: plan.alreadyApplied,
    counts: plan.counts,
    credentialBindings: plan.credentialBindings,
    warnings: plan.warnings,
    conflicts: plan.conflicts,
    requiresConfirmation: !plan.alreadyApplied && plan.conflicts.length === 0
  };
}

export function createFeishuMigrationService({
  legacyDirectory,
  stateStore,
  gateway,
  exportBackup,
  now = () => new Date().toISOString()
}) {
  if (!legacyDirectory || !stateStore?.read || !stateStore?.write || !gateway?.listOlts) {
    throw new TypeError("Feishu migration service is incompletely configured.");
  }

  async function readLegacy() {
    let serialized;
    try {
      serialized = await readFile(path.join(legacyDirectory, LEGACY_STATE_FILE), "utf8");
    } catch (error) {
      if (error.code === "ENOENT") throw new Error(`未找到旧项目状态文件：${LEGACY_STATE_FILE}。`);
      throw new Error("读取旧 Feishu 状态失败。", { cause: error });
    }
    let value;
    try {
      value = normalizeLegacyState(JSON.parse(serialized));
    } catch (error) {
      throw new Error("旧 Feishu 状态不是有效 JSON。", { cause: error });
    }
    return { value, sourceFingerprint: legacyFingerprint(value) };
  }

  async function createPlan(legacy, sourceFingerprint, credentialReferenceMap = {}) {
    const current = normalizeFeishuState(await stateStore.read());
    const availableOltIds = new Set((await gateway.listOlts()).map((olt) => text(olt.oltId)));
    const warnings = [];
    const conflicts = [];
    const operators = [];
    const chats = [];
    const accessRequests = [];
    const credentialBindings = [];

    const existingMarker = migrationMarker(current, sourceFingerprint);
    if (existingMarker) {
      return {
        sourceFingerprint,
        alreadyApplied: true,
        warnings: ["该旧状态指纹已经迁移过，重复执行不会覆盖现有授权。"],
        conflicts: [],
        credentialBindings: [],
        counts: existingMarker.counts ?? {},
        nextState: current
      };
    }

    for (const rawOperator of legacy.operators ?? []) {
      const operator = normalizeLegacyOperator(rawOperator);
      if (!operator) {
        warnings.push("跳过一条字段不完整的旧 Operator。");
        continue;
      }
      const validOltIds = operator.oltIds.filter((oltId) => availableOltIds.has(oltId));
      const invalidOltIds = operator.oltIds.filter((oltId) => !availableOltIds.has(oltId));
      if (invalidOltIds.length) warnings.push(`Operator ${operator.openId} 的未知 OLT Scope 已跳过：${invalidOltIds.join(", ")}。`);
      if (!validOltIds.length) {
        warnings.push(`Operator ${operator.openId} 没有可迁移的有效 OLT Scope，已跳过。`);
        continue;
      }
      const candidate = { ...operator, oltIds: validOltIds };
      const existing = current.operators.find((item) => item.openId === candidate.openId);
      if (existing && !sameJson(existing, candidate)) {
        conflicts.push(`Operator ${candidate.openId} 已存在且内容不同。`);
      } else if (!existing) {
        operators.push(candidate);
      }
    }

    for (const rawChat of legacy.authorizedChats ?? []) {
      const chat = normalizeLegacyChat(rawChat);
      if (!chat) {
        warnings.push("跳过一条字段不完整的旧 Authorized Chat。");
        continue;
      }
      const existing = current.authorizedChats.find((item) => item.chatId === chat.chatId);
      if (existing && !sameJson(existing, chat)) {
        conflicts.push(`Authorized Chat ${chat.chatId} 已存在且内容不同。`);
      } else if (!existing) {
        chats.push(chat);
      }
    }

    for (const rawRequest of legacy.operatorAccessRequests ?? []) {
      const request = normalizeLegacyRequest(rawRequest);
      if (!request) {
        warnings.push("跳过一条字段不完整的旧访问申请。");
        continue;
      }
      const existing = current.accessRequests.find((item) => item.requestId === request.requestId);
      if (existing && !sameJson(existing, request)) {
        conflicts.push(`访问申请 ${request.requestId} 已存在且内容不同。`);
      } else if (!existing) {
        accessRequests.push(request);
      }
    }

    const oldApp = legacy.feishu && typeof legacy.feishu === "object" ? legacy.feishu : {};
    const oldAppId = text(oldApp.appId);
    const oldReference = text(oldApp.credentialReference);
    const mappedReference = oldReference ? text(credentialReferenceMap[oldReference]) : "";
    const currentReference = text(current.app.credentialReference);
    let app = clone(current.app);
    if (oldAppId) {
      if (app.appId && app.appId !== oldAppId) {
        warnings.push(`旧 Feishu App ID 与当前 OLT Manager 配置不同，保留当前 App ID ${app.appId}。`);
      } else if (!app.appId) {
        app.appId = oldAppId;
      }
    }
    if (oldReference) {
      if (mappedReference) {
        app.credentialReference = mappedReference;
        credentialBindings.push({ oldReference, newReference: mappedReference, method: "explicit-map" });
      } else if (currentReference) {
        credentialBindings.push({ oldReference, newReference: currentReference, method: "reuse-current" });
      } else {
        warnings.push("旧 Feishu App Secret 只有旧 Keychain 引用，未自动读取或复制；请先在 OLT Manager 配置新 App Secret，再重新预览迁移。");
        app.credentialReference = "";
        credentialBindings.push({ oldReference, newReference: "", method: "manual-rebind-required" });
      }
    }

    if (legacy.syntheticDatasetAttestation) {
      warnings.push("旧 Synthetic Dataset Attestation 未迁移，需在当前 OLT Manager 数据集上重新确认。");
    }
    if ((legacy.authorizationAuditReferences ?? []).length) {
      warnings.push("旧授权审计仅保存为脱敏引用摘要；旧 Keychain 审计密文不会被读取或复制。");
    }
    if (current.enabled) {
      warnings.push("迁移会保持 Feishu 停用，需人工完成验证后再启用。");
    }

    const migratedAudit = (legacy.authorizationAuditReferences ?? []).map((reference) => ({
      occurredAt: now(),
      eventType: "legacy-feishu-audit-reference",
      decision: "imported-reference",
      source: "legacy-local-administration",
      referenceDigest: digest(text(reference))
    }));
    const counts = {
      operators: operators.length,
      authorizedChats: chats.length,
      accessRequests: accessRequests.length,
      auditReferences: migratedAudit.length
    };
    const nextState = normalizeFeishuState({
      ...current,
      enabled: false,
      app,
      operators: [...current.operators, ...operators],
      authorizedChats: [...current.authorizedChats, ...chats],
      accessRequests: [...current.accessRequests, ...accessRequests],
      auditArchive: [
        ...current.auditArchive,
        ...migratedAudit,
        {
          occurredAt: now(),
          eventType: "legacy-feishu-migration",
          decision: "allowed",
          source: "legacy-local-administration",
          sourceFingerprint,
          counts
        }
      ].slice(-1000)
    });
    return {
      sourceFingerprint,
      alreadyApplied: false,
      warnings,
      conflicts,
      credentialBindings,
      counts,
      nextState
    };
  }

  async function preview({ credentialReferenceMap = {} } = {}) {
    const { value, sourceFingerprint } = await readLegacy();
    return publicPlan(await createPlan(value, sourceFingerprint, credentialReferenceMap));
  }

  async function apply({ confirmed = false, credentialReferenceMap = {} } = {}) {
    if (confirmed !== true) throw new Error("旧 Feishu 状态迁移必须先完成人工确认。");
    const { value, sourceFingerprint } = await readLegacy();
    const plan = await createPlan(value, sourceFingerprint, credentialReferenceMap);
    if (plan.alreadyApplied) return { ...publicPlan(plan), applied: false };
    if (plan.conflicts.length) throw new Error(`迁移存在冲突：${plan.conflicts.join("；")}`);
    const backupBefore = typeof exportBackup === "function" ? await exportBackup() : null;
    await stateStore.write(plan.nextState);
    let backupAfter = null;
    const backupWarnings = [];
    if (typeof exportBackup === "function") {
      try {
        backupAfter = await exportBackup();
      } catch {
        backupWarnings.push("迁移已写入，但迁移后组合备份导出失败，请立即手动导出备份。");
      }
    }
    return {
      ...publicPlan({ ...plan, warnings: [...plan.warnings, ...backupWarnings] }),
      applied: true,
      backupBefore: backupBefore ? new Uint8Array(backupBefore) : null,
      backupAfter: backupAfter ? new Uint8Array(backupAfter) : null
    };
  }

  return Object.freeze({ preview, apply });
}
