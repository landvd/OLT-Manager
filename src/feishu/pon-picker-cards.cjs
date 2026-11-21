// 飞书“查 PON 口 / 抢修验收”卡片（ADR-095）。带下拉框的表单在手机飞书上要用卡片 JSON 2.0，
// 替换原卡片（选小组、翻页）的结果也必须是 2.0。查 PON 口用蓝色，抢修验收用橙色，一眼区分。

const MODE = {
  list: { template: "blue", title: "查 PON 口", submit: "下一步", whole: "整村（全部 PON 口）", regionSubmit: "查询", regionHint: "可以只看其中一个小组或小区",
    intro: "选一个村（分了小组的村下一步可以选小组或小区），列出 PON 口：一级地址、户数，点“整口状态”实时看在线和光功率。" },
  repair: { template: "orange", title: "抢修验收", submit: "下一步", whole: "整村（全部主要 PON 口）", regionSubmit: "开始验收", regionHint: "可以只验收其中一个",
    intro: "选一个村，对比断纤前后的光功率，看能不能封盒、要不要重新熔接。" }
};

function safe(value) {
  return String(value ?? "")
    .replace(/[\\*_`[\]]/g, "\\$&")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

const markdown = (content) => ({ tag: "markdown", content });
const grey = (content) => markdown(`<font color='grey'>${content}</font>`);

function callbackValue(reply, action, extra = {}) {
  return { token: reply.action.token, index: 0, action, expiresAt: reply.action.expiresAt, ...extra };
}

function button(text, value, { type = "default", width = "fill", size } = {}) {
  return {
    tag: "button",
    type,
    width,
    ...(size ? { size } : {}),
    text: { tag: "plain_text", content: String(text).slice(0, 40) },
    behaviors: [{ type: "callback", value }]
  };
}

function row(buttons) {
  return {
    tag: "column_set",
    flex_mode: "none",
    horizontal_spacing: "8px",
    columns: buttons.map((item) => ({ tag: "column", width: "weighted", weight: 1, elements: [item] }))
  };
}

/** 每排最多 2 个按钮（手机上 2 个一排能显示约 5 个字，村名·小组更长时独占一排）。 */
function buttonRows(buttons) {
  const rows = [];
  for (let index = 0; index < buttons.length;) {
    const pair = buttons.slice(index, index + 2);
    const fits = pair.length === 2 && pair.every((item) => [...item.text.content].length <= 6);
    rows.push(row(fits ? pair : [buttons[index]]));
    index += fits ? 2 : 1;
  }
  return rows;
}

function select(name, placeholder, options, { initial = "", required = true } = {}) {
  return {
    tag: "select_static",
    name,
    width: "fill",
    required,
    placeholder: { tag: "plain_text", content: placeholder },
    ...(initial ? { initial_option: initial } : {}),
    options: options.map((option) => ({ text: { tag: "plain_text", content: String(option.text).slice(0, 60) }, value: String(option.value) }))
  };
}

function submit(text, value, type = "primary") {
  return {
    tag: "button",
    name: "submit",
    type,
    width: "fill",
    text: { tag: "plain_text", content: text },
    form_action_type: "submit",
    behaviors: [{ type: "callback", value }]
  };
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

const userText = (count) => (Number(count) > 0 ? `（${Number(count)}户）` : "");

function renderPicker(reply) {
  const mode = MODE[reply.mode] || MODE.list;
  const elements = [];
  if (reply.notice) elements.push(markdown(`<font color='red'>${safe(reply.notice)}</font>`));
  if (reply.step === "region") {
    elements.push(markdown(`**${safe(reply.village)}**　分了 ${reply.regions.length} 个小组 / 小区，${mode.regionHint}`));
    const options = [
      { text: mode.whole, value: "all" },
      ...reply.regions.map((region) => ({
        text: `${region.name}（${Number(region.userCount) || 0}户/${Number(region.ponCount) || 0}口）`,
        value: String(region.index)
      }))
    ];
    elements.push({
      tag: "form",
      name: "pon_pick_region",
      elements: [
        select("region", "选择范围", options, { initial: "all" }),
        submit(mode.regionSubmit, callbackValue(reply, "pon-pick-submit"))
      ]
    });
    elements.push(button("换个村", callbackValue(reply, "pon-pick-back")));
    return card(mode.template, `${mode.title} · ${reply.village}`, elements);
  }
  elements.push(grey(mode.intro));
  elements.push({
    tag: "form",
    name: "pon_pick_village",
    elements: [
      select("village", "选择村", reply.villages.map((village) => ({ text: `${village.name}${userText(village.userCount)}`, value: village.name }))),
      submit(mode.submit, callbackValue(reply, "pon-pick-submit"))
    ]
  });
  if (reply.truncated) elements.push(grey(`只列出用户最多的 ${reply.villages.length} 个村；不在列表里的村请直接发文字查询。`));
  if (reply.recent?.length) {
    elements.push(grey("最近查过（点一下直接查）"));
    elements.push(...buttonRows(reply.recent.map((item) => button(item.label, callbackValue(reply, "pon-pick-recent", { index: item.index })))));
  }
  return card(mode.template, mode.title, elements);
}

function renderVillageChoice(reply) {
  return card("blue", reply.village, [
    markdown(`要查 **${safe(reply.village)}** 的什么？`),
    row([
      button("查 PON 口", callbackValue(reply, "pon-pick-choice-list"), { type: "primary" }),
      button("抢修验收", callbackValue(reply, "pon-pick-choice-repair"), { type: "danger" })
    ]),
    grey("以后也可以点菜单“查 PON 口”“抢修验收”直接选村。")
  ]);
}

function coordinate(pon) {
  return [pon?.chassis, pon?.board, pon?.pon].filter((value) => value !== undefined && value !== null && value !== "").join("/");
}

function renderPonList(reply) {
  const elements = [];
  const sparse = Number(reply.sparseCount) > 0 ? ` · 其中 ${Number(reply.sparseCount)} 个是零星沾边口` : "";
  elements.push(grey(`共 ${Number(reply.total) || 0} 个 PON 口${sparse} · 第 ${reply.page}/${reply.pageCount} 页`));
  for (const candidate of reply.candidates) {
    const lines = [
      `**PON ${safe(coordinate(candidate.pon) || "未知")}**${candidate.sparse ? "　<font color='grey'>零星</font>" : ""}`,
      safe(candidate.oltName || "OLT"),
      candidate.address ? `一级地址：${safe(candidate.address)}` : null,
      `本村 ${candidate.matchedUserCount} 户${candidate.ponUserCount > candidate.matchedUserCount ? ` · 口上共 ${candidate.ponUserCount} 户` : ""}`
    ].filter(Boolean);
    elements.push({
      tag: "column_set",
      flex_mode: "none",
      horizontal_spacing: "8px",
      columns: [
        { tag: "column", width: "weighted", weight: 1, vertical_align: "center", elements: [markdown(lines.join("\n"))] },
        { tag: "column", width: "auto", vertical_align: "center", elements: [button("整口状态", callbackValue(reply, "pon-list-detail", { index: candidate.index }), { type: "primary", width: "default", size: "small" })] }
      ]
    });
    elements.push({ tag: "hr" });
  }
  const pages = [];
  if (reply.page > 1) pages.push(button("上一页", callbackValue(reply, "pon-list-page", { page: reply.page - 1 })));
  if (reply.page < reply.pageCount) pages.push(button("下一页", callbackValue(reply, "pon-list-page", { page: reply.page + 1 }), { type: "primary" }));
  if (pages.length) elements.push(row(pages));
  elements.push(row([
    button("再查一个村", callbackValue(reply, "pon-list-again")),
    button("资料有误", callbackValue(reply, "pon-list-fix"))
  ]));
  elements.push(grey("整口状态会实时读取 OLT，口上用户多时要等几秒。"));
  return card("blue", `${reply.village} · PON 口`, elements);
}

function regionOptions(regions, where) {
  return [
    { text: "整村（不分小组）", value: "all" },
    ...regions.map((region) => ({ text: region.name, value: String(region.index) })),
    { text: `新小组（${where}填写名称）`, value: "new-group" },
    { text: `新小区 / 楼盘（${where}填写名称）`, value: "new-community" }
  ];
}

/** PON 口“资料有误”（ADR-096）：第 1 步选口和村，第 2 步选台账行和小组 / 小区，提交给审批人。 */
function renderPlaceFix(reply) {
  const elements = [];
  if (reply.notice) elements.push(markdown(`<font color='red'>${safe(reply.notice)}</font>`));
  if (reply.step === "place") {
    elements.push(markdown(`**${safe(reply.ponLabel)}**\n正确的村：**${safe(reply.village)}**`));
    const formElements = [];
    if (reply.rows.length > 1) {
      elements.push(grey(`这个口在台账里分成 ${reply.rows.length} 行（分路），请选要改的一行`));
      formElements.push(select("row", "选择台账行", reply.rows.map((item) => ({
        text: `${item.address} · 现在：${item.place || "未指定"}`, value: String(item.index)
      })), { initial: "0" }));
    } else {
      elements.push(grey(`一级地址：${safe(reply.rows[0]?.address || "")} · 现在：${safe(reply.rows[0]?.place || "未指定")}`));
    }
    formElements.push(select("region", "小组 / 小区", regionOptions(reply.regions, "下面"), { initial: reply.regionInitial || "all" }));
    formElements.push({
      tag: "input",
      name: "newName",
      required: false,
      width: "fill",
      max_length: 30,
      placeholder: { tag: "plain_text", content: "选“新小组 / 新小区”时才填，例如 下栅" }
    });
    formElements.push(submit(`提交给${String(reply.approverName || "审批人").slice(0, 8)}审批`, callbackValue(reply, "place-fix-submit")));
    elements.push({ tag: "form", name: "place_fix_place", elements: formElements });
    elements.push(button("上一步", callbackValue(reply, "place-fix-back")));
    elements.push(grey("改的是 PON 台账这一行的归属，这一行的用户都会按它算；审批人同意后才生效。"));
    return card("orange", "资料有误 · 选小组 / 小区", elements);
  }
  const hasRegions = reply.defaultVillage && reply.defaultRegions?.length;
  elements.push(grey(hasRegions
    ? `同一个村换小组：直接选小组 / 小区，点“下一步”确认。换了村：先选村，下一步再选小组。`
    : "选出归属不对的 PON 口和它真正属于的村，下一步再选小组或小区（楼盘）。"));
  const formElements = [
    select("pon", "选择 PON 口", reply.pons.map((item) => ({ text: item.label, value: String(item.index) })), { initial: String(reply.ponIndex || 0) }),
    select("village", "正确的村", reply.villages.map((name) => ({ text: name, value: name })), { initial: reply.village || "" })
  ];
  if (hasRegions) {
    formElements.push(select("region1", `${reply.defaultVillage}的小组 / 小区（不改可不选）`, regionOptions(reply.defaultRegions, "下一步"), { required: false }));
  }
  formElements.push(submit("下一步", callbackValue(reply, "place-fix-next")));
  elements.push({ tag: "form", name: "place_fix_pon", elements: formElements });
  return card("orange", "资料有误 · 纠正村 / 小组 / 楼盘", elements);
}

function renderPonPickerReply(reply) {
  if (reply?.kind === "place-fix" && reply.action?.token) return renderPlaceFix(reply);
  if (reply?.kind === "pon-picker" && reply.action?.token) return renderPicker(reply);
  if (reply?.kind === "pon-village-choice" && reply.action?.token) return renderVillageChoice(reply);
  if (reply?.kind === "village-pon-list" && reply.action?.token) return renderPonList(reply);
  return null;
}

module.exports = { renderPonPickerReply };
