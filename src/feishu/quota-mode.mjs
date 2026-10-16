// 飞书“定额模式”（ADR-092）：进入后这个会话里说的话按人工（表二定额）/ 材料（表四甲供）/ 管道解析，
// 每次录入先发确认卡片，确认后记入预算。只读写本地预算数据，不访问 OLT。卡片渲染见 quota-cards.cjs。
import { randomBytes } from "node:crypto";
import { textMatchScore, unitFactor } from "../quota/quota-parser.mjs";
import { commonMaterialGroups, materialShortLabel, sheetLabel, sheetMaterials } from "../quota/quota-catalog.mjs";
import { PIPE_ROADS, PIPE_WELLS } from "../quota/quota-calc.mjs";
import { OA_NOTICE } from "../quota/quota-service.mjs";

export const QUOTA_MENU_KEY = "quota-mode";
const SESSION_TTL_MS = 30 * 60 * 1000;
const PENDING_TTL_MS = 30 * 60 * 1000;
const HISTORY_LIMIT = 20;
const ENTRY_PATTERN = /^(进入)?定额(模式|预算)?$|^(开始)?做预算$|^预算模式$/;

const money = (value) => Number(value || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (value) => String(Math.round(Number(value || 0) * 1000) / 1000);
const SECTION_LABEL = { quota: "人工", material: "材料", pipe: "管道" };
// 表单下拉最多列这么多项（飞书卡片大小有限）；更多的请直接说
const FORM_OPTION_LIMIT = 100;
const MATERIAL_USES = ["架空用", "管道用", "直埋用", "墙壁用", "入户用"];
const WELL_ROADS = [...PIPE_ROADS.map((road) => road.key).filter((road) => road !== "普通开挖"), "普通土"];
const tierLabel = (group, tier) => `${group.name}${tier.detail ? ` ${tier.detail}` : ""}`;
const materialLabel = (item) => `${item.name} ${materialShortLabel(item, 20)} · ${money(item.maxPrice)}元/${item.unit}`;
/** 表单里填的数字：允许“300”“300米”“0.3千米”；千米的人工一律按米填。 */
function formNumber(value) {
  const match = String(value ?? "").replace(/[,，\s]/g, "").match(/^(\d+(?:\.\d+)?)(千米|公里|km|米|m)?/i);
  if (!match) return null;
  const number = Number(match[1]);
  return number > 0 ? { number, kilo: /千米|公里|km/i.test(match[2] || "") } : null;
}

export const QUOTA_HELP_LINES = Object.freeze([
  "**人工**：3个光缆端开缆、架空敷设24芯光缆200米、24芯熔接24芯、架空光缆200米利旧",
  "**材料**：24芯光缆800米 架空用、1分8光分路器6个；分不清时前面加“材料”",
  "**一次说几条**：用逗号隔开，例如“人工：4端开缆，架空光缆300米；材料：24芯光缆300米，接头盒2个”",
  "**管道**：开挖混凝土路面250mm以下30米、顶管2孔15米、单页井2个 混凝土路面250以下、直埋子管100米",
  "**改和删**：是300米不是4千米（改上一条）、上一步（撤销）、人工2改成5、删除材料1、清空管道",
  "**基础信息**：地区类别改成三类、施工单位改成××；说“清单”看人工和材料，“生成预算书”出文件，“退出”回到普通查询"
]);
const SHORT_HELP = QUOTA_HELP_LINES.slice(0, 3).join("\n");

export function isQuotaEntry(text) {
  return ENTRY_PATTERN.test(String(text ?? "").replace(/\s/g, ""));
}

export function createQuotaMode({ quotaService, send, now = () => new Date().toISOString(), askModel = null }) {
  if (!quotaService) throw new TypeError("定额模式需要 quotaService。");
  const sessions = new Map();
  const pendings = new Map();
  const time = () => Date.parse(now());
  const canAskModel = () => typeof askModel === "function";

  const sessionKey = (event) => event.quotaSessionKey || (event.kind === "group" ? `${event.chatId}|${event.openId}` : `p2p|${event.openId}`);

  // 按钮回调不带会话类型，所以卡片上记下发起时的会话键，回调时用它找会话
  function session(event, key = sessionKey(event)) {
    const entry = sessions.get(key);
    if (!entry) return null;
    if (time() - entry.at > SESSION_TTL_MS) {
      sessions.delete(key);
      return null;
    }
    entry.at = time();
    return entry;
  }

  function openSession(event, budgetId = null, key = sessionKey(event)) {
    const entry = { budgetId, at: time(), history: [] };
    sessions.set(key, entry);
    if (sessions.size > 500) sessions.delete(sessions.keys().next().value);
    return entry;
  }

  /** 记下一次录入，“上一步”按它撤销：lines 是新加的人工 / 材料行，pipeBefore 是改管道前的录入。 */
  function remember(current, step) {
    current.history = [...(current.history || []), step].slice(-HISTORY_LIMIT);
  }

  function binding(event, data) {
    for (const [token, item] of pendings) if (Date.parse(item.expiresAt) <= time()) pendings.delete(token);
    while (pendings.size > 1000) pendings.delete(pendings.keys().next().value);
    const token = randomBytes(18).toString("base64url");
    const expiresAt = new Date(time() + PENDING_TTL_MS).toISOString();
    pendings.set(token, { ...data, openId: event.openId, sessionKey: data.sessionKey || sessionKey(event), expiresAt, used: false });
    return { token, expiresAt };
  }

  async function reply(event, body, options) {
    await send(event.chatId, body, options);
    return body;
  }

  const text = (event, message, { title = "定额模式", template = "blue", options } = {}) => reply(event, { kind: "quota-text", title, template, message }, options);
  const replaceOptions = (event) => (event.messageId ? { messageId: event.messageId, replaceOriginal: true } : undefined);

  function totalsLine(totals) {
    return `人工 ${money(totals.table2Amount)}（含税 ${money(totals.table2TaxedAmount)}）· 材料 ${money(totals.table4Amount)}（含税 ${money(totals.table4TaxedAmount)}）`
      + ` · 监理费 ${money(totals.supervisionAmount)}（含税 ${money(totals.supervisionTaxedAmount)}）· 安全生产费 ${money(totals.safetyAmount)}（含税 ${money(totals.safetyTaxedAmount)}）· 合计含税 ${money(totals.taxedTotal)}`;
  }

  async function home(event, options, note = "") {
    const status = await quotaService.status();
    if (!status.template) return text(event, "还没有导入预算书模板，请先在桌面版“定额预算 → 模板与单价”里导入。", { template: "orange", options });
    const current = session(event) || openSession(event);
    const budgets = (await quotaService.listBudgets({ limit: 5 })).slice(0, 5);
    const action = binding(event, { type: "home", budgetIds: budgets.map((budget) => budget.id) });
    const currentBudget = current.budgetId ? budgets.find((budget) => budget.id === current.budgetId) : null;
    return reply(event, {
      kind: "quota-home",
      title: "定额模式",
      current: currentBudget ? currentBudget.name : "",
      note,
      budgets: budgets.map((budget) => ({ name: budget.name, location: budget.location, updatedAt: budget.updatedAt })),
      help: QUOTA_HELP_LINES,
      materialsReady: Boolean(status.materials),
      action
    }, options);
  }

  /** 清单卡片上的“删除预算”：先发确认卡片，确认后删除并回主菜单；取消回清单。 */
  async function deleteConfirm(event, budgetId, options) {
    const budget = (await quotaService.listBudgets({ limit: 200 })).find((entry) => entry.id === budgetId);
    if (!budget) return home(event, options, "这份预算已经不在了");
    const action = binding(event, { type: "deleteBudget", budgetId, name: budget.name });
    return reply(event, {
      kind: "quota-delete-confirm",
      title: "删除预算",
      name: budget.name,
      detail: `${budget.location} · 人工 ${budget.quotaCount ?? 0} 项 · 材料 ${budget.materialCount ?? 0} 项`,
      action
    }, options);
  }

  /** 基础信息修改表单：默认值就是这份预算现在的值（新建时取自模板），工程编号由规建部门填，不在表单里。 */
  async function infoForm(event, budgetId, options) {
    const view = await quotaService.budgetView(budgetId);
    const status = await quotaService.status();
    const fields = status.infoFields.filter((field) => !field.readOnly).map((field) => {
      const value = view.budget.info[field.key];
      return {
        key: field.key,
        label: field.type === "rate" ? `${field.label}（%）` : field.type === "date" ? `${field.label}（年-月-日）` : field.label,
        value: field.type === "rate" ? String(Math.round(Number(value || 0) * 10000) / 100) : String(value ?? ""),
        required: Boolean(field.required),
        options: field.key === "regionClass" ? status.regionClasses : field.key === "surveyByNational" ? ["是", "否"] : null
      };
    });
    const action = binding(event, { type: "infoForm", budgetId, keys: fields.map((field) => field.key) });
    return reply(event, { kind: "quota-info-form", title: `改基础信息 · ${view.budget.name}`, fields, action }, options);
  }

  async function submitInfoForm(pending, form) {
    const status = await quotaService.status();
    const patch = {};
    for (const field of status.infoFields) {
      if (!pending.keys.includes(field.key) || form[field.key] === undefined) continue;
      const value = String(form[field.key]).trim();
      if (field.type === "rate") {
        const number = Number(value.replace(/%$/, ""));
        if (!Number.isFinite(number) || number < 0 || number >= 100) return { error: `${field.label}请填 0～100 之间的数字，例如 9` };
        patch[field.key] = number / 100;
      } else {
        patch[field.key] = value;
      }
    }
    try {
      await quotaService.updateBudgetInfo(pending.budgetId, patch);
    } catch (error) {
      return { error: error?.message || "保存失败" };
    }
    return { note: "基础信息已保存" };
  }

  async function createForm(event, options) {
    const status = await quotaService.status();
    const presets = status.presets.map((preset) => ({ id: String(preset.id), name: preset.isDefault ? `${preset.name}（默认）` : preset.name, isDefault: preset.isDefault }));
    const action = binding(event, { type: "create" });
    return reply(event, {
      kind: "quota-create-form",
      title: "新建预算",
      presets,
      preparer: status.recentNames?.preparer?.[0] || "",
      reviewer: status.recentNames?.reviewer?.[0] || "",
      action
    }, options);
  }

  async function budgetList(event, options) {
    const budgets = (await quotaService.listBudgets({ limit: 8 })).slice(0, 8);
    if (!budgets.length) return createForm(event, options);
    const action = binding(event, { type: "home", budgetIds: budgets.map((budget) => budget.id) });
    return reply(event, {
      kind: "quota-home",
      title: "打开预算",
      current: "",
      budgets: budgets.map((budget) => ({ name: budget.name, location: budget.location, updatedAt: budget.updatedAt })),
      help: [],
      materialsReady: true,
      action
    }, options);
  }

  const quotaTitle = (line) => (line.item ? `${line.item.name}${line.item.detail ? ` ${line.item.detail}` : ""}` : line.code);

  async function summary(event, budgetId, options, note = "") {
    const view = await quotaService.budgetView(budgetId);
    const table2 = new Map(view.table2.filter((line) => line.lineIds.length === 1).map((line) => [line.lineIds[0], line]));
    const quotaRows = view.quotaLines.map((line, index) => {
      const calc = table2.get(line.id);
      return `${index + 1}. ${quotaTitle(line)} × ${qty(line.quantity)}${line.item?.unit || ""}${line.reuse ? "（利旧）" : ""}${calc ? ` = ${money(calc.amount)}` : ""}`;
    });
    const materialRows = view.materialLines.map((line, index) => {
      const calc = view.table4.find((entry) => entry.lineId === line.id);
      return `${index + 1}. ${line.name} ${line.spec} × ${qty(line.quantity)}${line.unit}${line.remark ? `（${line.remark}）` : ""}${calc ? ` = ${money(calc.taxedAmount)}（含税）` : ""}`;
    });
    // 卡片上每条分两行：名称一行，数量 · 金额一行（手机上不会挤成一团）
    const quotaItems = view.quotaLines.map((line, index) => {
      const calc = table2.get(line.id);
      return { title: `${index + 1}. ${quotaTitle(line)}`, detail: `${qty(line.quantity)}${line.item?.unit || ""}${line.reuse ? " · 利旧" : ""}${calc ? ` · ${money(calc.amount)} 元` : ""}` };
    });
    const materialItems = view.materialLines.map((line, index) => {
      const calc = view.table4.find((entry) => entry.lineId === line.id);
      return { title: `${index + 1}. ${line.name} ${String(line.spec || "").replace(/#/g, "")}`, detail: `${qty(line.quantity)}${line.unit}${line.remark ? ` · ${line.remark}` : ""}${calc ? ` · 含税 ${money(calc.taxedAmount)} 元` : ""}` };
    });
    const totals = view.totals;
    const totalsList = [
      ["人工", totals.table2Amount, totals.table2TaxedAmount],
      ["材料", totals.table4Amount, totals.table4TaxedAmount],
      ["监理费", totals.supervisionAmount, totals.supervisionTaxedAmount],
      ["安全生产费", totals.safetyAmount, totals.safetyTaxedAmount]
    ].map(([label, amount, taxed]) => `${label} ${money(amount)}（含税 ${money(taxed)}）`);
    const pipeRows = view.pipeLines.map((line) => `${quotaTitle(line)} × ${qty(line.quantity)}${line.item?.unit || ""}`);
    const rows = [...view.quotaLines.map((line) => ({ kind: "quota", id: line.id })), ...view.materialLines.map((line) => ({ kind: "material", id: line.id }))];
    const action = binding(event, { type: "summary", budgetId, rows });
    return reply(event, {
      kind: "quota-summary",
      title: `预算清单 · ${view.budget.name}`,
      note,
      infoLine: `${view.budget.info.location} · ${view.budget.info.regionClass} · 编制 ${view.budget.info.preparer} / 审核 ${view.budget.info.reviewer}`,
      quotaRows,
      quotaItems,
      pipeRows,
      materialRows,
      materialItems,
      totals: totalsLine(view.totals),
      totalsList,
      taxedTotal: money(totals.taxedTotal),
      oaNotice: view.oaNotice,
      warnings: view.warnings,
      action
    }, options);
  }

  async function infoCard(event, budgetId, options, note = "") {
    const view = await quotaService.budgetView(budgetId);
    const status = await quotaService.status();
    const lines = status.infoFields.map((field) => {
      let value = view.budget.info[field.key];
      if (field.type === "rate") value = `${Math.round(Number(value || 0) * 10000) / 100}%`;
      if (field.readOnly) value = "（由规建部门填写）";
      return `${field.label}：${value === "" || value === undefined ? "—" : value}`;
    });
    const action = binding(event, { type: "summary", budgetId });
    return reply(event, { kind: "quota-info", title: `基础信息 · ${view.budget.name}`, note, lines, action }, options);
  }

  async function exportFile(event, budgetId, options) {
    const { fileName, buffer, totals } = await quotaService.exportBudget(budgetId);
    await send(event.chatId, { kind: "quota-file", fileName, data: buffer });
    const action = binding(event, { type: "summary", budgetId });
    return reply(event, {
      kind: "quota-text",
      title: totals.needsOa ? "预算书已生成 · 需上 OA" : "预算书已生成",
      template: totals.needsOa ? "red" : "green",
      message: `已生成 ${fileName}\n${totalsLine(totals)}\n\n文件只往模板里填数据，格式不变；工程编号留给规建部门填写。`,
      // 红字提示单独一段，由卡片渲染成红色（消息正文里的 HTML 会被转义）
      alert: totals.needsOa ? `${OA_NOTICE}（人工 + 监理费 + 安全生产费含税 ${money(totals.oaAmount)}）` : "",
      action,
      buttons: [{ text: "返回清单", action: "quota-summary" }, { text: "主菜单", action: "quota-home" }]
    }, options);
  }

  /** 候选展示：人工 / 材料共用。 */
  function describeCandidates(interpreted) {
    const { parsed } = interpreted;
    const isQuota = interpreted.kind === "quota";
    return interpreted.candidates.slice(0, 4).map((entry) => {
      if (isQuota) {
        const { item } = entry;
        return {
          code: item.code,
          quantity: entry.quantity,
          title: `${item.name}${item.detail ? ` ${item.detail}` : ""}`,
          detail: `${item.code} · ${qty(entry.quantity)}${item.unit}${parsed.reuse ? " · 利旧 7 折" : ""}`,
          note: [entry.reason, entry.note].filter(Boolean).join("；")
        };
      }
      const { material } = entry;
      return {
        code: material.code,
        quantity: entry.quantity,
        title: `${material.name} ${material.spec}${material.attr ? ` ${material.attr}` : ""}`,
        detail: `${material.code} · ${qty(entry.quantity)}${material.unit} · 含税 ${money(material.maxPrice)}${material.common ? " · 常用" : ""}${material.contractEnd && material.contractEnd < new Date(time()).toISOString().slice(0, 10) ? " · 合同已过期" : ""}`,
        note: entry.note || ""
      };
    });
  }

  function candidateCard(event, budgetId, interpreted, utterance, options) {
    const { parsed } = interpreted;
    const isQuota = interpreted.kind === "quota";
    const candidates = describeCandidates(interpreted);
    const action = binding(event, {
      type: isQuota ? "quota" : "material", budgetId, candidates: candidates.map(({ code, quantity }) => ({ code, quantity })),
      reuse: parsed.reuse, remark: parsed.remark, utterance
    });
    return reply(event, {
      kind: "quota-confirm",
      title: isQuota ? "加入人工 · 请确认" : "加入材料 · 请确认",
      utterance,
      lines: [
        interpreted.modelNote || "",
        parsed.remark ? `备注：${parsed.remark}` : "",
        parsed.reuse && !isQuota ? "材料没有利旧打折，已忽略“利旧”" : ""
      ].filter(Boolean),
      candidates,
      action
    }, options);
  }

  function pipeCard(event, budgetId, interpreted, utterance, options) {
    const action = binding(event, { type: "pipe", budgetId, input: interpreted.input, utterance });
    return reply(event, {
      kind: "quota-confirm",
      title: "加入管道工程量 · 请确认",
      utterance,
      lines: [`按管道工程量计算器规则：${interpreted.summary}`, ...interpreted.notes],
      candidates: [{ title: interpreted.summary, detail: "确认后自动生成开挖、修复、土方等人工", note: "" }],
      action
    }, options);
  }

  /** 拿不准时问大模型；没有大模型或问完仍拿不准时返回原结果。 */
  async function resolveWithModel(budgetId, interpreted, utterance) {
    const unsure = interpreted.kind === "unknown" || ((interpreted.kind === "quota" || interpreted.kind === "material") && !interpreted.confident);
    if (!unsure || !canAskModel()) return interpreted;
    // 没有数字的话（闲聊、问号）不问大模型
    if (!/[0-9０-９]/.test(utterance) && interpreted.parsed?.quantity == null) return interpreted;
    return quotaService.interpretWithModel(budgetId, utterance, interpreted, askModel);
  }

  /** 本地规则拿不准时先发“正在理解”，问完大模型再把它换成确认卡片。 */
  async function askModelThenConfirm(event, budgetId, local, utterance) {
    let messageId = null;
    try {
      messageId = await send(event.chatId, { kind: "quota-text", title: "正在理解", template: "grey", message: `“${utterance}”本地规则拿不准，正在交给大模型理解……` });
    } catch {
      messageId = null;
    }
    const options = typeof messageId === "string" && messageId ? { messageId, replaceOriginal: true } : undefined;
    const interpreted = await resolveWithModel(budgetId, local, utterance);
    if ((interpreted.kind === "quota" || interpreted.kind === "material") && interpreted.candidates?.length) {
      if (interpreted.parsed.quantity === null) return text(event, "要多少？请连同数量再说一次。", { template: "orange", options });
      return candidateCard(event, budgetId, interpreted, utterance, options);
    }
    return text(event, `没听懂“${utterance}”。${interpreted.modelNote ? `${interpreted.modelNote}。` : ""}可以这样说：\n${SHORT_HELP}`, { title: "没听懂", template: "orange", options });
  }

  /** 一句话说了几条：逐段理解（拿不准的段一起问大模型），合成一张确认卡片。 */
  async function batchCard(event, budgetId, parts, utterance) {
    let messageId = null;
    const needModel = canAskModel() && parts.some((part) => part.kind === "unknown" || ((part.kind === "quota" || part.kind === "material") && !part.confident));
    if (needModel) {
      try {
        messageId = await send(event.chatId, { kind: "quota-text", title: "正在理解", template: "grey", message: `这句话有 ${parts.length} 条，正在逐条理解……` });
      } catch {
        messageId = null;
      }
    }
    const options = typeof messageId === "string" && messageId ? { messageId, replaceOriginal: true } : undefined;
    const resolved = await Promise.all(parts.map(async (part) => ({ text: part.text, ...(await resolveWithModel(budgetId, part, part.text)) })));
    const items = [];
    const skipped = [];
    for (const part of resolved) {
      if (part.kind === "pipe") {
        items.push({ type: "pipe", input: part.input, utterance: part.text, title: `管道：${part.summary}`, detail: part.notes.join("；") });
      } else if ((part.kind === "quota" || part.kind === "material") && part.candidates?.length && part.parsed.quantity !== null) {
        const [first] = describeCandidates(part);
        items.push({
          type: part.kind, code: first.code, quantity: first.quantity, reuse: part.kind === "quota" && part.parsed.reuse, remark: part.parsed.remark || "",
          utterance: part.text, title: `${SECTION_LABEL[part.kind]}：${first.title}`, detail: first.detail, note: [first.note, part.confident ? "" : "拿不准，请核对"].filter(Boolean).join("；")
        });
      } else {
        skipped.push(part.kind === "error" ? `${part.text}（${part.message}）` : part.parsed?.quantity === null && part.candidates?.length ? `${part.text}（没说数量）` : part.text);
      }
    }
    if (!items.length) return text(event, `没听懂“${utterance}”。可以这样说：\n${SHORT_HELP}`, { title: "没听懂", template: "orange", options });
    const action = binding(event, { type: "batch", budgetId, items: items.map(({ title, detail, note, ...item }) => item), utterance });
    return reply(event, {
      kind: "quota-batch",
      title: `一次加入 ${items.length} 条 · 请确认`,
      utterance,
      items: items.map(({ title, detail, note }) => ({ title, detail, note: note || "" })),
      skipped,
      action
    }, options);
  }

  /** 把确认的一条记入预算，返回新加的行（撤销用）。 */
  async function addItem(budgetId, item, openId, corrected = false) {
    if (item.type === "pipe") {
      await quotaService.mergePipe(budgetId, item.input);
      return null;
    }
    const line = item.type === "quota"
      ? await quotaService.addQuotaLine(budgetId, { code: item.code, quantity: item.quantity, reuse: item.reuse, remark: item.remark, utterance: item.utterance })
      : await quotaService.addMaterialLine(budgetId, { code: item.code, quantity: item.quantity, remark: item.remark, utterance: item.utterance });
    // 确认即学习（直接生效）：改选了别的候选说明推荐错了，标记为纠正
    try {
      await quotaService.learnPhrase({ text: item.utterance, kind: item.type, code: item.code, corrected, createdBy: openId });
    } catch {
      // 学习失败不影响已加入的预算
    }
    return { kind: item.type, id: line?.id };
  }

  async function undo(event, current) {
    const step = current.history?.pop();
    if (!step) return text(event, "这次进入定额模式后还没有录入，没有可以撤销的。说“清单”看看，或说“删除人工2”删指定的一条。", { template: "orange" });
    for (const line of step.lines || []) {
      if (!line.id) continue;
      if (line.kind === "quota") await quotaService.deleteQuotaLine(step.budgetId, line.id);
      else await quotaService.deleteMaterialLine(step.budgetId, line.id);
    }
    if (step.pipeBefore) await quotaService.savePipeInput(step.budgetId, step.pipeBefore);
    return summary(event, step.budgetId, undefined, `已撤销“${step.utterance}”`);
  }

  /** 找第 N 项：没说人工还是材料时，只有一边有第 N 项就用那边。 */
  function findNumbered(view, index, section) {
    const quota = view.quotaLines[index - 1];
    const material = view.materialLines[index - 1];
    if (section === "quota") return quota ? { kind: "quota", line: quota, label: `人工第 ${index} 项` } : { missing: `人工里没有第 ${index} 项` };
    if (section === "material") return material ? { kind: "material", line: material, label: `材料第 ${index} 项` } : { missing: `材料里没有第 ${index} 项` };
    if (quota && material) return { missing: `人工和材料都有第 ${index} 项，请说“人工${index}…”或“材料${index}…”` };
    if (quota) return { kind: "quota", line: quota, label: `人工第 ${index} 项` };
    if (material) return { kind: "material", line: material, label: `材料第 ${index} 项` };
    return { missing: `清单里没有第 ${index} 项` };
  }

  /** “是300米不是4千米”：说了名称就找最像的那条，没说就改上一条录入的。 */
  async function correct(event, current, budgetId, command) {
    const view = await quotaService.budgetView(budgetId);
    const lines = [
      ...view.quotaLines.map((line) => ({ kind: "quota", line, name: quotaTitle(line), unit: line.item?.unit || "" })),
      ...view.materialLines.map((line) => ({ kind: "material", line, name: `${line.name} ${line.spec}`, unit: line.unit }))
    ].filter((entry) => !command.section || entry.kind === command.section);
    let target = null;
    if (command.keywords) {
      const scored = lines.map((entry) => ({ entry, score: textMatchScore(command.keywords, entry.name) })).filter((item) => item.score >= 0.5);
      scored.sort((a, b) => b.score - a.score || b.entry.line.id - a.entry.line.id);
      target = scored[0]?.entry || null;
    }
    if (!target) {
      const last = [...(current.history || [])].reverse().find((step) => step.budgetId === budgetId && step.lines?.some((line) => line.id));
      const ref = last?.lines.filter((line) => line.id).at(-1);
      target = ref ? lines.find((entry) => entry.kind === ref.kind && entry.line.id === ref.id) || null : null;
    }
    if (!target) return text(event, "不知道要改哪一条。说“清单”看编号，再说“人工2改成300米”。", { template: "orange" });
    const factor = command.unit ? unitFactor(command.unit, target.unit) : 1;
    const quantity = factor === null ? command.quantity : Math.round(command.quantity * factor * 1e6) / 1e6;
    if (target.kind === "quota") await quotaService.updateQuotaLine(budgetId, target.line.id, { quantity });
    else await quotaService.updateMaterialLine(budgetId, target.line.id, { quantity });
    return summary(event, budgetId, undefined, `已把“${target.name}”改成 ${qty(quantity)}${target.unit}`);
  }

  // ---------------- 表单（外勤以点选为主） ----------------

  /** ＋人工：常用项一排按钮，下面是分类按钮；点了出表单。 */
  /** 已录的人工 / 材料简表，连续添加时显示在卡片上。 */
  async function addedLines(budgetId, section) {
    const view = await quotaService.budgetView(budgetId);
    const lines = section === "quota"
      ? view.quotaLines.map((line, index) => `${index + 1}. ${quotaTitle(line)} × ${qty(line.quantity)}${line.item?.unit || ""}${line.reuse ? "（利旧）" : ""}`)
      : view.materialLines.map((line, index) => `${index + 1}. ${line.name} ${line.spec} × ${qty(line.quantity)}${line.unit}${line.remark ? `（${line.remark}）` : ""}`);
    return { lines, oaNotice: view.oaNotice };
  }

  /** ＋人工：常用项一排按钮，下面是分类按钮；加完一项回到这里接着选，选好了点“下一步：选材料”。 */
  async function quotaPicker(event, budgetId, options, note = "") {
    const { quota } = await quotaService.catalog();
    const common = quota.common.slice(0, 8);
    const action = binding(event, { type: "quotaPicker", budgetId, groups: common, categories: quota.categories });
    const added = await addedLines(budgetId, "quota");
    return reply(event, { kind: "quota-picker", title: "添加人工", section: "quota", note, added: added.lines, oaNotice: added.oaNotice, common, categories: quota.categories, action }, options);
  }

  /** 人工表单：从常用项进来只列这一项的各档；从分类进来列这一类的全部档位（常用在前）。 */
  async function quotaForm(event, budgetId, { groupName = null, category = null }, options) {
    const { quota } = await quotaService.catalog();
    const groups = groupName ? quota.groups.filter((group) => group.name === groupName) : quota.groups.filter((group) => group.category === category)
      .sort((a, b) => Number(b.common) - Number(a.common) || b.uses - a.uses);
    const choices = groups.flatMap((group) => group.tiers.map((tier) => ({ code: tier.code, label: groupName ? tier.detail || tier.code : tierLabel(group, tier), unit: tier.unit, reusable: group.reusable })));
    if (!choices.length) return text(event, "这一类没有人工可选。", { template: "orange", options });
    const shown = choices.slice(0, FORM_OPTION_LIMIT);
    const action = binding(event, { type: "quotaForm", budgetId, choices: shown.map(({ code, unit, reusable }) => ({ code, unit, reusable })) });
    return reply(event, {
      kind: "quota-item-form",
      section: "quota",
      title: groupName ? `添加人工 · ${groupName}` : `添加人工 · ${category}`,
      itemLabel: groupName ? "档位" : "项目",
      options: shown.map(({ code, label, unit }) => ({ value: code, text: `${label} · ${unit}` })),
      initial: shown.length === 1 ? shown[0].code : "",
      unitHint: choices.some((choice) => choice.unit === "千米") ? "千米的项目按米填，例如 300（自动换成 0.3 千米）" : "",
      reusable: shown.some((choice) => choice.reusable),
      more: choices.length - shown.length,
      action
    }, options);
  }

  /** ＋材料：直接出常用材料表单，下面是其它分类按钮。 */
  /** ＋材料：加完一项回到同一张表单接着选，选好了点“材料选好了，看清单”。 */
  async function materialForm(event, budgetId, { sheet = null } = {}, options, note = "") {
    const { material } = await quotaService.catalog();
    if (!material.items.length) return text(event, "还没有导入材料单价表，请先在桌面版“定额预算 → 模板与单价”里导入。", { template: "orange", options });
    const items = sheet ? sheetMaterials(material, sheet) : commonMaterialGroups(material).flatMap((group) => group.items);
    const shown = items.slice(0, FORM_OPTION_LIMIT);
    const action = binding(event, { type: "materialForm", budgetId, sheet, codes: shown.map((item) => item.code) });
    return reply(event, {
      kind: "quota-item-form",
      section: "material",
      title: sheet ? `添加材料 · ${sheetLabel(sheet)}` : "添加材料 · 常用",
      itemLabel: "材料",
      options: shown.map((item) => ({ value: item.code, text: materialLabel(item) })),
      initial: "",
      uses: MATERIAL_USES,
      more: items.length - shown.length,
      fromSheet: Boolean(sheet),
      note,
      ...(({ lines, oaNotice }) => ({ added: lines, oaNotice }))(await addedLines(budgetId, "material")),
      action
    }, options);
  }

  /** 材料分类：常用材料 + 单价表各分表，点了出这一类的材料表单（表单卡片保持短，手机键盘弹出时不挡输入框）。 */
  async function materialSheets(event, budgetId, options) {
    const { material } = await quotaService.catalog();
    const action = binding(event, { type: "materialSheets", budgetId, sheets: material.categories });
    return reply(event, { kind: "quota-material-sheets", title: "添加材料 · 选分类", sheets: material.categories.map(sheetLabel), action }, options);
  }

  /** 清单上每行的“改”：人工可换档、改数量、利旧、备注；材料改数量、用途。删除在表单外。 */
  async function editForm(event, budgetId, row, options) {
    const view = await quotaService.budgetView(budgetId);
    const action = (data) => binding(event, { type: "edit", budgetId, row, ...data });
    if (row.kind === "quota") {
      const line = view.quotaLines.find((entry) => entry.id === row.id);
      if (!line) return summary(event, budgetId, options, "这条人工已经不在了");
      const { quota } = await quotaService.catalog();
      const group = quota.groups.find((entry) => entry.name === line.item?.name);
      const tiers = group ? group.tiers : [{ code: line.code, detail: line.item?.detail || "", unit: line.item?.unit || "" }];
      const unit = line.item?.unit || "";
      return reply(event, {
        kind: "quota-edit-form",
        section: "quota",
        title: `改人工 · ${quotaTitle(line)}`,
        options: tiers.map((tier) => ({ value: tier.code, text: `${tier.detail || tier.code} · ${tier.unit}` })),
        initial: line.code,
        quantity: unit === "千米" ? qty(line.quantity * 1000) : qty(line.quantity),
        unitHint: unit === "千米" ? "按米填" : unit,
        reusable: Boolean(group?.reusable),
        reuse: line.reuse,
        remark: line.remark === "利旧" ? "" : line.remark,
        action: action({ codes: tiers.map((tier) => tier.code) })
      }, options);
    }
    const line = view.materialLines.find((entry) => entry.id === row.id);
    if (!line) return summary(event, budgetId, options, "这条材料已经不在了");
    return reply(event, {
      kind: "quota-edit-form",
      section: "material",
      title: `改材料 · ${line.name} ${line.spec}`,
      quantity: qty(line.quantity),
      unitHint: line.unit,
      uses: MATERIAL_USES,
      remark: line.remark,
      action: action({})
    }, options);
  }

  async function pipeForm(event, budgetId, options) {
    const action = binding(event, { type: "pipeForm", budgetId });
    return reply(event, {
      kind: "quota-pipe-form",
      title: "管道开挖 / 顶管 / 做井",
      roads: PIPE_ROADS.map((road) => road.key),
      wells: Object.keys(PIPE_WELLS),
      wellRoads: WELL_ROADS,
      action
    }, options);
  }

  /** 表单提交：返回 { note } 或 { error }。 */
  async function submitQuotaForm(pending, form, current) {
    const choice = pending.choices.find((entry) => entry.code === String(form.item || ""));
    if (!choice) return { error: "请选一项人工" };
    const amount = formNumber(form.quantity);
    if (!amount) return { error: "请填数量" };
    const quantity = choice.unit === "千米" && !amount.kilo ? amount.number / 1000 : amount.number;
    const reuse = form.reuse === "是";
    if (reuse && !choice.reusable) return { error: "只有光缆敷设（不含皮线）可以利旧" };
    const line = await quotaService.addQuotaLine(pending.budgetId, { code: choice.code, quantity, reuse, remark: String(form.remark || "").trim(), utterance: "飞书表单" });
    remember(current, { budgetId: pending.budgetId, utterance: "表单添加的人工", lines: [{ kind: "quota", id: line.id }] });
    return { note: `已加入人工：${choice.code} × ${qty(quantity)}${choice.unit}${reuse ? "（利旧）" : ""}` };
  }

  async function submitMaterialForm(pending, form, current) {
    const code = String(form.item || "");
    if (!pending.codes.includes(code)) return { error: "请选一种材料" };
    const amount = formNumber(form.quantity);
    if (!amount) return { error: "请填数量" };
    const remark = String(form.remark || "").trim() || (MATERIAL_USES.includes(form.use) ? form.use : "");
    const line = await quotaService.addMaterialLine(pending.budgetId, { code, quantity: amount.number, remark, utterance: "飞书表单" });
    remember(current, { budgetId: pending.budgetId, utterance: "表单添加的材料", lines: [{ kind: "material", id: line.id }] });
    return { note: `已加入材料：${line.name} ${line.spec} × ${qty(amount.number)}${line.unit}${remark ? `（${remark}）` : ""}` };
  }

  async function submitEditForm(pending, form) {
    const amount = formNumber(form.quantity);
    if (!amount) return { error: "请填数量" };
    if (pending.row.kind === "quota") {
      const code = String(form.item || "");
      if (!pending.codes.includes(code)) return { error: "请选档位" };
      const view = await quotaService.budgetView(pending.budgetId);
      const unit = view.quotaLines.find((line) => line.id === pending.row.id)?.item?.unit || "";
      const quantity = unit === "千米" && !amount.kilo ? amount.number / 1000 : amount.number;
      await quotaService.updateQuotaLine(pending.budgetId, pending.row.id, { code, quantity, reuse: form.reuse === "是", remark: String(form.remark || "").trim() });
      return { note: "已保存这条人工" };
    }
    const remark = String(form.remark || "").trim() || (MATERIAL_USES.includes(form.use) ? form.use : "");
    await quotaService.updateMaterialLine(pending.budgetId, pending.row.id, { quantity: amount.number, remark });
    return { note: "已保存这条材料" };
  }

  /** 管道表单：每项都可空，填了的按计算器规则并入管道录入。 */
  async function submitPipeForm(pending, form, current) {
    const addition = {};
    const parts = [];
    const trench = formNumber(form.trenchLength);
    if (trench && form.trenchRoad) {
      addition.trench = { [form.trenchRoad]: trench.number * (trench.kilo ? 1000 : 1) };
      parts.push(`开挖${form.trenchRoad} ${qty(addition.trench[form.trenchRoad])} 米`);
    }
    const jacking = formNumber(form.jackingLength);
    if (jacking) {
      const holes = Math.min(9, Math.max(1, Number(form.jackingHoles) || 1));
      addition.jacking = { [holes]: jacking.number * (jacking.kilo ? 1000 : 1) };
      parts.push(`顶管 ${holes} 孔 ${qty(addition.jacking[holes])} 米`);
    }
    const wells = formNumber(form.wellCount);
    if (wells && form.wellType) {
      addition.wells = [{ type: form.wellType, road: form.wellRoad || "普通土", count: Math.round(wells.number) }];
      parts.push(`${form.wellType} ${Math.round(wells.number)} 个（${form.wellRoad || "普通土"}）`);
    }
    const subduct = formNumber(form.subductLength);
    if (subduct) {
      addition.subduct = { length: subduct.number * (subduct.kilo ? 1000 : 1), road: "普通土" };
      parts.push(`直埋子管 ${qty(addition.subduct.length)} 米`);
    }
    if (!parts.length) return { error: "至少填一项：开挖选路面并填长度、顶管填长度、做井选类型并填个数，或直埋子管填长度" };
    const before = (await quotaService.budgetView(pending.budgetId)).pipeInput || {};
    await quotaService.mergePipe(pending.budgetId, addition);
    remember(current, { budgetId: pending.budgetId, utterance: "表单添加的管道", pipeBefore: before });
    return { note: `已加入管道：${parts.join("，")}` };
  }

  async function handleCommand(event, current, interpreted) {
    const budgetId = current.budgetId;
    const command = interpreted.command;
    if (command === "list") return summary(event, budgetId);
    if (command === "export") return exportFile(event, budgetId);
    if (command === "info") return infoCard(event, budgetId);
    if (command === "undo") return undo(event, current);
    if (command === "correct") return correct(event, current, budgetId, interpreted);
    if (command === "clearPipe") {
      remember(current, { budgetId, utterance: "清空管道", pipeBefore: (await quotaService.budgetView(budgetId)).pipeInput || {} });
      await quotaService.savePipeInput(budgetId, {});
      return summary(event, budgetId, undefined, "已清空管道录入");
    }
    if (command === "setInfo") {
      if (interpreted.invalid) return text(event, interpreted.invalid, { template: "orange" });
      await quotaService.updateBudgetInfo(budgetId, { [interpreted.key]: interpreted.value });
      const shown = typeof interpreted.value === "number" ? `${Math.round(interpreted.value * 10000) / 100}%` : interpreted.value;
      return summary(event, budgetId, undefined, `已把${interpreted.label}改成“${shown}”`);
    }
    if (command === "delete" || command === "quantity") {
      const view = await quotaService.budgetView(budgetId);
      const row = findNumbered(view, interpreted.index, interpreted.section);
      if (row.missing) return text(event, `${row.missing}，说“清单”看编号。`, { template: "orange" });
      if (command === "delete") {
        if (row.kind === "quota") await quotaService.deleteQuotaLine(budgetId, row.line.id);
        else await quotaService.deleteMaterialLine(budgetId, row.line.id);
        return summary(event, budgetId, undefined, `已删除${row.label}`);
      }
      const unit = row.kind === "quota" ? row.line.item?.unit || "" : row.line.unit;
      const factor = interpreted.unit ? unitFactor(interpreted.unit, unit) : 1;
      const quantity = factor === null ? interpreted.quantity : Math.round(interpreted.quantity * factor * 1e6) / 1e6;
      if (row.kind === "quota") await quotaService.updateQuotaLine(budgetId, row.line.id, { quantity });
      else await quotaService.updateMaterialLine(budgetId, row.line.id, { quantity });
      return summary(event, budgetId, undefined, `已把${row.label}改成 ${qty(quantity)}${unit}`);
    }
    return null;
  }

  async function handleText(event) {
    const current = session(event) || openSession(event);
    const utterance = String(event.text || "").trim();
    let interpreted;
    try {
      interpreted = await quotaService.interpret(current.budgetId, utterance);
    } catch (error) {
      return text(event, error?.message || "暂时无法解析，请稍后再试", { template: "orange" });
    }
    if (interpreted.kind === "command") {
      const command = interpreted.command;
      if (command === "exit") {
        sessions.delete(sessionKey(event));
        return text(event, "已退出定额模式，现在可以正常查用户和光功率了。点菜单或说“定额模式”可以再进来。", { title: "已退出定额模式", template: "grey" });
      }
      if (command === "help") return text(event, QUOTA_HELP_LINES.join("\n"), { title: "定额模式 · 怎么说" });
      if (command === "create") return createForm(event);
      if (command === "open") return budgetList(event);
    }
    if (!current.budgetId) {
      return text(event, "先新建一份预算，或打开以前的预算，再说人工和材料。", { title: "还没有选预算", template: "orange" }).then(() => home(event));
    }
    const budgetId = current.budgetId;
    try {
      if (interpreted.kind === "command") {
        const handled = await handleCommand(event, current, interpreted);
        if (handled) return handled;
      }
      const parts = await quotaService.interpretMany(budgetId, utterance);
      if (parts) return batchCard(event, budgetId, parts, utterance);
      if (interpreted.kind === "error") return text(event, interpreted.message, { template: "orange" });
      if (interpreted.kind === "pipe") return pipeCard(event, budgetId, interpreted, utterance);
      const unsure = interpreted.kind === "unknown" || ((interpreted.kind === "quota" || interpreted.kind === "material") && !interpreted.confident);
      // 没有数字的话（问号、闲聊）不问大模型，也不乱给候选
      if (!/[0-9０-９]/.test(utterance) && (interpreted.kind === "unknown" || interpreted.parsed?.quantity == null)) {
        return text(event, `我只会记人工、材料和管道，没听懂“${utterance}”。可以这样说：\n${SHORT_HELP}\n\n说“清单”看已录的内容，说“帮助”看全部说法。`, { title: "没听懂", template: "orange" });
      }
      if (canAskModel() && unsure) return askModelThenConfirm(event, budgetId, interpreted, utterance);
      if (interpreted.kind === "quota" || interpreted.kind === "material") {
        if (interpreted.parsed.quantity === null) {
          return text(event, `要多少？请连同数量再说一次，例如“${interpreted.kind === "quota" ? "3个光缆端开缆" : "24芯光缆800米"}”。`, { template: "orange" });
        }
        return candidateCard(event, budgetId, interpreted, utterance);
      }
      return text(event, `没听懂“${utterance}”。可以这样说：\n${SHORT_HELP}`, { title: "没听懂", template: "orange" });
    } catch (error) {
      return text(event, error?.message || "操作失败，请稍后再试", { template: "orange" });
    }
  }

  async function handleCallback(rawEvent) {
    const pending = pendings.get(rawEvent.binding.token);
    const event = pending ? { ...rawEvent, quotaSessionKey: pending.sessionKey } : rawEvent;
    const options = replaceOptions(event);
    if (!pending || Date.parse(pending.expiresAt) <= time()) return text(event, "这张卡片已过期，请再说一次。", { template: "grey", options });
    if (pending.openId !== event.openId) return text(event, "这张卡片是别人发起的，请自己说一次。", { template: "grey" });
    const action = event.binding.action;
    const current = session(event, pending.sessionKey) || openSession(event, pending.budgetId ?? null, pending.sessionKey);
    try {
      if (action === "quota-new") return createForm(event, options);
      // 清单、基础信息上的“主菜单”回到定额模式主界面，不退出定额模式；只有主菜单上的“退出定额模式”才退出
      if (action === "quota-home") return home(event, options);
      if (action === "quota-exit") {
        sessions.delete(pending.sessionKey);
        return text(event, "已退出定额模式，现在可以正常查用户和光功率了。点菜单或说“定额模式”可以再进来。", { title: "已退出定额模式", template: "grey", options });
      }
      if (action === "quota-delete-ask") {
        return pending.budgetId ? deleteConfirm(event, pending.budgetId, options) : home(event, options, "预算列表已变化");
      }
      if (action === "quota-delete-confirm") {
        if (pending.used) return text(event, "这份预算已经删除了。", { template: "grey" });
        pending.used = true;
        await quotaService.deleteBudget(pending.budgetId);
        if (current.budgetId === pending.budgetId) current.budgetId = null;
        current.history = (current.history || []).filter((step) => step.budgetId !== pending.budgetId);
        return home(event, options, `已删除预算“${pending.name}”`);
      }
      if (action === "quota-help") return text(event, QUOTA_HELP_LINES.join("\n"), { title: "定额模式 · 怎么说", options });
      if (action === "quota-open") {
        const budgetId = pending.budgetIds?.[event.binding.index];
        if (!budgetId) return text(event, "预算列表已变化，请重新打开。", { template: "grey", options });
        current.budgetId = budgetId;
        return summary(event, budgetId, options, "已切换到这份预算，可以直接说人工和材料");
      }
      if (action === "quota-create-submit") {
        if (pending.used) return text(event, "这张表单已经提交过了。", { template: "grey" });
        const form = event.formValue || {};
        const budget = await quotaService.createBudget({
          presetId: Number(form.preset) || null,
          projectName: form.projectName,
          location: form.location,
          preparer: form.preparer,
          reviewer: form.reviewer,
          createdBy: event.openId,
          createdByName: event.senderName || ""
        });
        pending.used = true;
        current.budgetId = budget.id;
        return summary(event, budget.id, options, `已新建“${budget.name}”（${budget.info.location} · ${budget.info.regionClass} · 编制日期 ${budget.info.preparedDate}），点“＋人工”“＋材料”添加，也可以直接说`);
      }
      if (action === "quota-confirm") {
        if (pending.used) return text(event, "这条已经加入过了。", { template: "grey" });
        const budgetId = pending.budgetId;
        const step = { budgetId, utterance: pending.utterance, lines: [] };
        if (pending.type === "pipe") {
          step.pipeBefore = (await quotaService.budgetView(budgetId)).pipeInput || {};
          await addItem(budgetId, { type: "pipe", input: pending.input }, event.openId);
        } else {
          const choice = pending.candidates[event.binding.index];
          if (!choice) return text(event, "候选已失效，请再说一次。", { template: "grey", options });
          step.lines.push(await addItem(budgetId, { type: pending.type, code: choice.code, quantity: choice.quantity, reuse: pending.reuse, remark: pending.remark, utterance: pending.utterance }, event.openId, event.binding.index !== 0));
        }
        pending.used = true;
        current.budgetId = budgetId;
        remember(current, step);
        return summary(event, budgetId, options, `“${pending.utterance}”已记入${SECTION_LABEL[pending.type]}`);
      }
      if (action === "quota-batch-confirm") {
        if (pending.used) return text(event, "这些已经加入过了。", { template: "grey" });
        const budgetId = pending.budgetId;
        const step = { budgetId, utterance: pending.utterance, lines: [] };
        if (pending.items.some((item) => item.type === "pipe")) step.pipeBefore = (await quotaService.budgetView(budgetId)).pipeInput || {};
        pending.used = true;
        for (const item of pending.items) {
          const line = await addItem(budgetId, item, event.openId);
          if (line) step.lines.push(line);
        }
        current.budgetId = budgetId;
        remember(current, step);
        return summary(event, budgetId, options, `已记入 ${pending.items.length} 条；不对的话说“上一步”全部撤销，或点“改”单独改`);
      }
      if (action === "quota-batch-each") {
        if (pending.used) return text(event, "这些已经处理过了。", { template: "grey" });
        pending.used = true;
        await text(event, `已拆成 ${pending.items.length} 张卡片，请逐条确认。`, { title: "逐条确认", template: "grey", options });
        let last = null;
        for (const item of pending.items) {
          const local = await quotaService.interpret(pending.budgetId, item.utterance);
          const resolved = await resolveWithModel(pending.budgetId, local, item.utterance);
          if (resolved.kind === "pipe") last = await pipeCard(event, pending.budgetId, resolved, item.utterance);
          else if ((resolved.kind === "quota" || resolved.kind === "material") && resolved.candidates?.length) last = await candidateCard(event, pending.budgetId, resolved, item.utterance);
        }
        return last || text(event, "没有可以确认的条目，请再说一次。", { template: "orange" });
      }
      if (action === "quota-cancel") {
        pending.used = true;
        return text(event, `已取消“${pending.utterance || ""}”，没有记入预算。`, { title: "已取消", template: "grey", options });
      }
      const budgetId = pending.budgetId || current.budgetId;
      if (!budgetId) return home(event, options);
      current.budgetId = budgetId;
      if (action === "quota-summary") return summary(event, budgetId, options);
      if (action === "quota-add-quota") return quotaPicker(event, budgetId, options);
      if (action === "quota-add-material") return materialForm(event, budgetId, {}, options);
      if (action === "quota-pipe") return pipeForm(event, budgetId, options);
      if (action === "quota-pick-group") {
        const groupName = pending.groups?.[event.binding.index];
        return groupName ? quotaForm(event, budgetId, { groupName }, options) : quotaPicker(event, budgetId, options);
      }
      if (action === "quota-pick-category") {
        const category = pending.categories?.[event.binding.index];
        return category ? quotaForm(event, budgetId, { category }, options) : quotaPicker(event, budgetId, options);
      }
      if (action === "quota-material-sheets") return materialSheets(event, budgetId, options);
      if (action === "quota-pick-sheet") {
        const sheet = pending.sheets?.[event.binding.index];
        return materialForm(event, budgetId, { sheet }, options);
      }
      if (action === "quota-edit") {
        const row = pending.rows?.[event.binding.index];
        return row ? editForm(event, budgetId, row, options) : summary(event, budgetId, options);
      }
      if (action === "quota-edit-delete") {
        if (pending.used) return text(event, "这条已经处理过了。", { template: "grey" });
        pending.used = true;
        if (pending.row.kind === "quota") await quotaService.deleteQuotaLine(budgetId, pending.row.id);
        else await quotaService.deleteMaterialLine(budgetId, pending.row.id);
        return summary(event, budgetId, options, `已删除这条${SECTION_LABEL[pending.row.kind]}`);
      }
      if (action === "quota-info-submit") {
        if (pending.used) return text(event, "这张表单已经提交过了。", { template: "grey" });
        const result = await submitInfoForm(pending, event.formValue || {});
        if (result.error) return text(event, result.error, { title: "请补充", template: "orange" });
        pending.used = true;
        return infoCard(event, budgetId, options, result.note);
      }
      const submitters = { "quota-quota-submit": submitQuotaForm, "quota-material-submit": submitMaterialForm, "quota-edit-submit": submitEditForm, "quota-pipe-submit": submitPipeForm };
      if (submitters[action]) {
        if (pending.used) return text(event, "这张表单已经提交过了。", { template: "grey" });
        const result = await submitters[action](pending, event.formValue || {}, current);
        // 填错时不替换原表单，另发一条提示，改好可以再提交
        if (result.error) return text(event, result.error, { title: "请补充", template: "orange" });
        pending.used = true;
        // 连续添加：人工加完回到选人工，材料加完回到同一张材料表单；修改和管道回清单
        if (action === "quota-quota-submit") return quotaPicker(event, budgetId, options, result.note);
        if (action === "quota-material-submit") return materialForm(event, budgetId, { sheet: pending.sheet }, options, result.note);
        return summary(event, budgetId, options, result.note);
      }
      if (action === "quota-info") return infoCard(event, budgetId, options);
      if (action === "quota-export") return exportFile(event, budgetId);
      if (action === "quota-info-edit") return infoForm(event, budgetId, options);
      return text(event, "这个按钮已失效，请再说一次。", { template: "grey" });
    } catch (error) {
      return text(event, error?.message || "操作失败，请稍后再试", { template: "orange" });
    }
  }

  return {
    isActive: (event) => Boolean(session(event)),
    enter: (event, options) => home(event, options),
    handleText,
    handleCallback
  };
}
