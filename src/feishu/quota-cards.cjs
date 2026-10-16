// 飞书定额模式卡片（ADR-092）。一律用飞书卡片 JSON 2.0：新建预算表单在手机上需要 2.0 才稳定，
// 按钮点击后替换原卡片的结果卡也必须是 2.0（飞书不允许 2.0 卡片更新成 1.0）。

function safe(value) {
  return String(value ?? "").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function markdown(content) {
  return { tag: "markdown", content };
}

function grey(content) {
  return markdown(`<font color='grey'>${content}</font>`);
}

function button(text, action, { index = 0, type = "default" } = {}) {
  return {
    tag: "button",
    type,
    width: "fill",
    text: { tag: "plain_text", content: String(text).slice(0, 40) },
    behaviors: [{ type: "callback", value: { token: action.token, index, action: action.name, expiresAt: action.expiresAt } }]
  };
}

function columnRow(buttons) {
  return {
    tag: "column_set",
    flex_mode: "none",
    horizontal_spacing: "8px",
    columns: buttons.map((item) => ({ tag: "column", width: "weighted", weight: 1, elements: [item] }))
  };
}

// 手机上一排按钮能完整显示的字数（再多就被截成“生…”）：3 个一排每个最多 3 个字，2 个一排最多 5 个字，更长的独占一排
const ROW_CAPACITY = [[3, 3], [2, 5]];
const buttonText = (item) => [...String(item.text?.content || "")].length;

/** 按字数把按钮排成若干行，保证每个按钮的字都能完整显示。返回行数组，用 ... 展开。 */
function buttonRows(buttons) {
  const rows = [];
  let index = 0;
  while (index < buttons.length) {
    const [count] = ROW_CAPACITY.find(([size, limit]) => buttons.slice(index, index + size).length === size
      && buttons.slice(index, index + size).every((item) => buttonText(item) <= limit)) || [1];
    rows.push(columnRow(buttons.slice(index, index + count)));
    index += count;
  }
  return rows;
}

function card(template, title, elements) {
  return {
    msgType: "interactive",
    content: {
      schema: "2.0",
      config: { update_multi: true, width_mode: "fill" },
      header: { template, title: { tag: "plain_text", content: String(title).slice(0, 60) } },
      body: { elements }
    }
  };
}

function input(name, label, value, placeholder, { required = true } = {}) {
  return {
    tag: "input",
    name,
    label: { tag: "plain_text", content: label },
    label_position: "top",
    default_value: String(value ?? ""),
    placeholder: { tag: "plain_text", content: placeholder },
    max_length: 60,
    width: "fill",
    required
  };
}

function select(name, placeholder, options, { initial = "", required = false } = {}) {
  return {
    tag: "select_static",
    name,
    width: "fill",
    required,
    placeholder: { tag: "plain_text", content: placeholder },
    ...(initial ? { initial_option: String(initial) } : {}),
    options: options.map((option) => (typeof option === "string"
      ? { text: { tag: "plain_text", content: option.slice(0, 60) }, value: option }
      : { text: { tag: "plain_text", content: String(option.text).slice(0, 60) }, value: String(option.value) }))
  };
}

function submitButton(text, action) {
  return {
    tag: "button",
    name: "submit",
    type: "primary",
    width: "fill",
    text: { tag: "plain_text", content: text },
    form_action_type: "submit",
    behaviors: [{ type: "callback", value: { token: action.token, index: 0, action: action.name, expiresAt: action.expiresAt } }]
  };
}

function form(name, elements) {
  return { tag: "form", name, elements };
}

const act = (reply, name) => ({ ...reply.action, name });

function renderHome(reply) {
  const elements = [];
  if (reply.note) elements.push(markdown(`<font color='green'>${safe(reply.note)}</font>`));
  if (reply.current) elements.push(markdown(`当前预算：**${safe(reply.current)}**`));
  if (!reply.materialsReady) elements.push(markdown("<font color='orange'>还没有导入材料单价表，暂时只能录人工。</font>"));
  if (reply.budgets.length) {
    elements.push(markdown(reply.current ? "**切换到其它预算**" : "**继续以前的预算**"));
    reply.budgets.forEach((budget, index) => {
      elements.push(button(`${budget.name} · ${budget.location}`, act(reply, "quota-open"), { index }));
    });
  }
  elements.push(...buttonRows([button("新建预算", act(reply, "quota-new"), { type: "primary" }), button("怎么说", act(reply, "quota-help"))]));
  if (reply.help?.length) elements.push(markdown(reply.help.join("\n")));
  elements.push(button("退出定额模式", act(reply, "quota-exit")));
  elements.push(grey("在定额模式里说的话都按人工 / 材料理解；点“退出定额模式”或说“退出”回到普通查询。"));
  return card("blue", reply.title || "定额模式", elements);
}

function renderCreateForm(reply) {
  const presets = Array.isArray(reply.presets) ? reply.presets : [];
  const initial = presets.find((preset) => preset.isDefault) || presets[0];
  const formElements = [];
  if (presets.length) {
    formElements.push({
      tag: "select_static",
      name: "preset",
      width: "fill",
      placeholder: { tag: "plain_text", content: "基础信息模板" },
      ...(initial ? { initial_option: initial.id } : {}),
      options: presets.map((preset) => ({ text: { tag: "plain_text", content: String(preset.name).slice(0, 40) }, value: preset.id }))
    });
  }
  formElements.push(input("projectName", "项目名称", "", "例如 厚街南五四网合一工程"));
  formElements.push(input("location", "建设地点", "", "例如 厚街镇南五社区"));
  formElements.push(input("preparer", "编制人", reply.preparer, "填写编制人"));
  formElements.push(input("reviewer", "审核", reply.reviewer, "填写审核人"));
  formElements.push({
    tag: "button",
    name: "submit",
    type: "primary",
    width: "fill",
    text: { tag: "plain_text", content: "新建预算" },
    form_action_type: "submit",
    behaviors: [{ type: "callback", value: { token: reply.action.token, index: 0, action: "quota-create-submit", expiresAt: reply.action.expiresAt } }]
  });
  return card("blue", reply.title || "新建预算", [
    { tag: "form", name: "quota_create", elements: formElements },
    grey("工程编号留空，由规建部门填写；编制日期取今天。其它基础信息按所选模板，之后可以说“地区类别改成三类”等修改。")
  ]);
}

function renderConfirm(reply) {
  const elements = [markdown(`“${safe(reply.utterance)}”`)];
  for (const line of reply.lines || []) elements.push(grey(safe(line)));
  reply.candidates.forEach((candidate, index) => {
    elements.push(markdown(`${index === 0 ? "**推荐**" : `**候选 ${index + 1}**`}：${safe(candidate.title)}\n${safe(candidate.detail)}${candidate.note ? `\n<font color='orange'>${safe(candidate.note)}</font>` : ""}`));
    elements.push(button(index === 0 ? "确认加入" : "改用这个", act(reply, "quota-confirm"), { index, type: index === 0 ? "primary" : "default" }));
  });
  elements.push(button("取消", act(reply, "quota-cancel")));
  return card("orange", reply.title || "请确认", elements);
}

function renderBatch(reply) {
  const elements = [markdown(`“${safe(reply.utterance)}”`)];
  reply.items.forEach((item, index) => {
    elements.push(markdown(`**${index + 1}. ${safe(item.title)}**\n${safe(item.detail)}${item.note ? `\n<font color='orange'>${safe(item.note)}</font>` : ""}`));
  });
  if (reply.skipped?.length) elements.push(markdown(`<font color='orange'>没听懂、没加入：${reply.skipped.map(safe).join("；")}</font>`));
  elements.push(...buttonRows([
    button("全部加入", act(reply, "quota-batch-confirm"), { type: "primary" }),
    button("逐条确认", act(reply, "quota-batch-each")),
    button("取消", act(reply, "quota-cancel"))
  ]));
  elements.push(grey("全部加入后不对，说“上一步”整批撤销，或说“人工2改成300米”单独改。"));
  return card("orange", reply.title || "请确认", elements);
}

/** 清单一行：左边文字，右边“改”。 */
function editableRow(content, reply, index) {
  return {
    tag: "column_set",
    flex_mode: "none",
    horizontal_spacing: "8px",
    columns: [
      { tag: "column", width: "weighted", weight: 5, vertical_align: "center", elements: [markdown(content)] },
      { tag: "column", width: "auto", vertical_align: "center", elements: [{ ...button("改", act(reply, "quota-edit"), { index }), width: "default", size: "small" }] }
    ]
  };
}

function renderSummary(reply) {
  const elements = [];
  if (reply.note) elements.push(markdown(`<font color='green'>${safe(reply.note)}</font>`));
  elements.push(grey(safe(reply.infoLine)));
  // 每条两行：名称、灰字的数量和金额
  const itemText = (item) => `${safe(item.title)}\n<font color='grey'>${safe(item.detail)}</font>`;
  const quotaItems = reply.quotaItems || reply.quotaRows.map((row) => ({ title: row, detail: "" }));
  const materialItems = reply.materialItems || reply.materialRows.map((row) => ({ title: row, detail: "" }));
  elements.push(markdown("**人工**"));
  if (!quotaItems.length) elements.push(grey("（还没有）"));
  quotaItems.forEach((item, index) => elements.push(editableRow(itemText(item), reply, index)));
  if (reply.pipeRows.length) elements.push(markdown(`**管道生成的人工**（说“清空管道”可重来）\n${reply.pipeRows.map(safe).join("\n")}`));
  elements.push(markdown("**材料**"));
  if (!materialItems.length) elements.push(grey("（还没有）"));
  materialItems.forEach((item, index) => elements.push(editableRow(itemText(item), reply, quotaItems.length + index)));
  elements.push({ tag: "hr" });
  elements.push(reply.totalsList
    ? markdown(`${reply.totalsList.map(safe).join("\n")}\n**合计（含税）${safe(reply.taxedTotal)} 元**`)
    : markdown(`**合计**：${safe(reply.totals)}`));
  if (reply.oaNotice) elements.push(markdown(`<font color='red'>**${safe(reply.oaNotice)}**</font>`));
  for (const warning of reply.warnings || []) elements.push(markdown(`<font color='orange'>${safe(warning)}</font>`));
  elements.push(...buttonRows([
    button("＋人工", act(reply, "quota-add-quota"), { type: "primary" }),
    button("＋材料", act(reply, "quota-add-material"), { type: "primary" }),
    button("管道", act(reply, "quota-pipe"))
  ]));
  elements.push(...buttonRows([
    button("生成预算书", act(reply, "quota-export")),
    button("基础信息", act(reply, "quota-info")),
    button("主菜单", act(reply, "quota-home")),
    button("删除预算", act(reply, "quota-delete-ask"), { type: "danger" })
  ]));
  elements.push(grey("也可以直接说：“架空光缆300米，4端开缆”“上一步”“是300米不是4千米”。"));
  return card(reply.oaNotice ? "red" : "blue", reply.title || "预算清单", elements);
}

/** 一组同类按钮（分类、常用项）：按字数排，每排最多 3 个。 */
function buttonGrid(buttons) {
  return buttonRows(buttons);
}

/** 连续添加时：刚加的那条（绿色）和已录清单。 */
function addedBlock(reply, label) {
  const elements = [];
  if (reply.note) elements.push(markdown(`<font color='green'>${safe(reply.note)}</font>`));
  if (reply.added?.length) elements.push(markdown(`**已录${label}（${reply.added.length} 项）**\n${reply.added.map(safe).join("\n")}`));
  if (reply.oaNotice) elements.push(markdown(`<font color='red'>**${safe(reply.oaNotice)}**</font>`));
  return elements;
}

function renderPicker(reply) {
  const elements = [...addedBlock(reply, "人工"), markdown("**常用**（点了直接填数量）")];
  elements.push(...buttonGrid(reply.common.map((name, index) => button(name, act(reply, "quota-pick-group"), { index, type: "primary" }))));
  elements.push(markdown("**按分类选**"));
  elements.push(...buttonGrid(reply.categories.map((name, index) => button(name, act(reply, "quota-pick-category"), { index }))));
  elements.push(...buttonRows([
    button("人工选好了，下一步选材料", act(reply, "quota-add-material"), { type: "primary" }),
    button("看清单", act(reply, "quota-summary"))
  ]));
  return card("blue", reply.title || "添加人工", elements);
}

function renderItemForm(reply) {
  const isQuota = reply.section === "quota";
  // 表单保持短：选项、数量、利旧 / 用途，紧接“加入”（备注在清单上点“改”再填）。
  // 卡片太长时手机键盘会挡住输入框和“加入”按钮。
  const fields = [select("item", `选${reply.itemLabel}`, reply.options, { initial: reply.initial, required: true })];
  fields.push(input("quantity", isQuota && reply.unitHint ? `数量（${reply.unitHint}）` : "数量", "", "例如 300"));
  if (isQuota && reply.reusable) fields.push(select("reuse", "利旧？（只有光缆敷设可选，按 7 折）", ["否", "是"], { initial: "否" }));
  if (!isQuota) fields.push(select("use", "用途（可不选）", reply.uses));
  fields.push(submitButton("加入", act(reply, isQuota ? "quota-quota-submit" : "quota-material-submit")));
  const elements = [];
  if (reply.note) elements.push(markdown(`<font color='green'>${safe(reply.note)}</font>`));
  if (reply.oaNotice) elements.push(markdown(`<font color='red'>**${safe(reply.oaNotice)}**</font>`));
  elements.push(form(isQuota ? "quota_item" : "material_item", fields));
  if (reply.more > 0) elements.push(grey(`这一类还有 ${reply.more} 项没列出，可以直接说名称和数量。`));
  elements.push(...buttonRows(isQuota
    ? [button("换一项", act(reply, "quota-add-quota")), button("看清单", act(reply, "quota-summary"))]
    : [button("换分类", act(reply, "quota-material-sheets")), button("看清单", act(reply, "quota-summary"), { type: reply.added?.length ? "primary" : "default" })]));
  if (!isQuota && reply.added?.length) elements.push(markdown(`**已录材料（${reply.added.length} 项）**\n${reply.added.map(safe).join("\n")}`));
  return card(isQuota ? "blue" : "turquoise", reply.title, elements);
}

function renderMaterialSheets(reply) {
  return card("turquoise", reply.title || "添加材料 · 选分类", [
    button("常用材料", act(reply, "quota-add-material"), { type: "primary" }),
    markdown("**按分类选**"),
    ...buttonGrid(reply.sheets.map((name, index) => button(name, act(reply, "quota-pick-sheet"), { index }))),
    button("看清单", act(reply, "quota-summary"))
  ]);
}

function renderEditForm(reply) {
  const isQuota = reply.section === "quota";
  const fields = [];
  if (isQuota) fields.push(select("item", "档位", reply.options, { initial: reply.initial, required: true }));
  fields.push(input("quantity", `数量（${reply.unitHint}）`, reply.quantity, "例如 300"));
  if (isQuota && reply.reusable) fields.push(select("reuse", "利旧？", ["否", "是"], { initial: reply.reuse ? "是" : "否" }));
  if (!isQuota) fields.push(select("use", "用途（可不选）", reply.uses, { initial: reply.uses.includes(reply.remark) ? reply.remark : "" }));
  fields.push(input("remark", "备注（可不填）", reply.uses?.includes(reply.remark) ? "" : reply.remark, "", { required: false }));
  fields.push(submitButton("保存", act(reply, "quota-edit-submit")));
  return card("orange", reply.title, [
    form("quota_edit", fields),
    ...buttonRows([button("删除这条", act(reply, "quota-edit-delete"), { type: "danger" }), button("返回清单", act(reply, "quota-summary"))])
  ]);
}

function renderInfo(reply) {
  return card("blue", reply.title || "基础信息", [
    ...(reply.note ? [markdown(`<font color='green'>${safe(reply.note)}</font>`)] : []),
    markdown(reply.lines.map(safe).join("\n")),
    button("修改基础信息", act(reply, "quota-info-edit"), { type: "primary" }),
    ...buttonRows([
      button("返回清单", act(reply, "quota-summary")),
      button("＋人工", act(reply, "quota-add-quota")),
      button("主菜单", act(reply, "quota-home"))
    ])
  ]);
}

function renderInfoForm(reply) {
  // 下拉框没有标题属性，前面加一行文字说明
  const fields = reply.fields.flatMap((field) => (field.options
    ? [grey(field.label), select(field.key, field.label, field.options, { initial: field.options.includes(field.value) ? field.value : "", required: field.required })]
    : [{ ...input(field.key, field.label, field.value, `填写${field.label}`, { required: field.required }), max_length: 100 }]));
  fields.push(submitButton("保存基础信息", act(reply, "quota-info-submit")));
  return card("orange", reply.title || "改基础信息", [
    form("quota_info", fields),
    grey("默认值是这份预算现在的基础信息（新建时取自所选模板）。工程编号由规建部门填写，不在这里改；改地区类别后人工按新类别重新取单价。"),
    ...buttonRows([button("基础信息", act(reply, "quota-info")), button("主菜单", act(reply, "quota-home"))])
  ]);
}

function renderDeleteConfirm(reply) {
  return card("red", reply.title || "删除预算", [
    markdown(`删除预算 **${safe(reply.name)}**？\n${safe(reply.detail)}\n\n删除后不能恢复，桌面版也会一起删除。`),
    ...buttonRows([button("确认删除", act(reply, "quota-delete-confirm"), { type: "danger" }), button("取消", act(reply, "quota-summary"))])
  ]);
}

function renderPipeForm(reply) {
  const fields = [
    markdown("**开挖**（一律按 1 孔）"),
    select("trenchRoad", "路面", reply.roads),
    input("trenchLength", "开挖长度（米）", "", "例如 30", { required: false }),
    markdown("**顶管**"),
    select("jackingHoles", "孔数", ["1", "2", "3", "4", "5", "6"], { initial: "1" }),
    input("jackingLength", "顶管长度（米）", "", "例如 15", { required: false }),
    markdown("**做井**"),
    select("wellType", "井的类型", reply.wells),
    select("wellRoad", "井所在路面", reply.wellRoads),
    input("wellCount", "个数", "", "例如 2", { required: false }),
    markdown("**直埋子管**"),
    input("subductLength", "直埋子管长度（米）", "", "例如 100", { required: false }),
    submitButton("加入管道", act(reply, "quota-pipe-submit"))
  ];
  return card("blue", reply.title || "管道", [
    form("quota_pipe", fields),
    grey("填哪项算哪项，按管道工程量计算器规则自动生成开挖、修复、土方、顶管、做井等人工。"),
    button("返回清单", act(reply, "quota-summary"))
  ]);
}

/** 定额模式回复渲染；不是定额模式的回复返回 null。 */
function renderQuotaReply(reply) {
  switch (reply?.kind) {
    case "quota-text":
      return card(reply.template || "blue", reply.title || "定额模式", [
        markdown(safe(reply.message)),
        ...(reply.alert ? [markdown(`<font color='red'>**${safe(reply.alert)}**</font>`)] : []),
        ...(reply.buttons?.length && reply.action ? [...buttonRows(reply.buttons.map((item) => button(item.text, act(reply, item.action))))] : [])
      ]);
    case "quota-home":
      return renderHome(reply);
    case "quota-create-form":
      return renderCreateForm(reply);
    case "quota-confirm":
      return renderConfirm(reply);
    case "quota-added":
      return card("green", reply.title || "已加入", [markdown(safe(reply.message)), grey(safe(reply.totals)), grey("继续说下一条，或说“清单”“生成预算书”。")]);
    case "quota-summary":
      return renderSummary(reply);
    case "quota-batch":
      return renderBatch(reply);
    case "quota-picker":
      return renderPicker(reply);
    case "quota-item-form":
      return renderItemForm(reply);
    case "quota-material-sheets":
      return renderMaterialSheets(reply);
    case "quota-edit-form":
      return renderEditForm(reply);
    case "quota-pipe-form":
      return renderPipeForm(reply);
    case "quota-info":
      return renderInfo(reply);
    case "quota-info-form":
      return renderInfoForm(reply);
    case "quota-delete-confirm":
      return renderDeleteConfirm(reply);
    default:
      return null;
  }
}

module.exports = { renderQuotaReply };
