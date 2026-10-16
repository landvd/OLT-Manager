// 定额模式的说法解析（ADR-092）：把一句话拆成指令、管道录入或一条定额 / 材料，并在本地定额库、物料库里找候选。
// 只做本地规则与字符匹配，不产生价格；每条录入都要用户在卡片上确认。
import { PIPE_ROADS, PIPE_WELLS, pickCoreTier } from "./quota-calc.mjs";

const CN_DIGITS = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const CN_UNITS = { 十: 10, 百: 100, 千: 1000, 万: 10000 };

/** 中文数字（“三”“十二”“二百五十”“两千”）转阿拉伯数字，其余原样保留。 */
const PROTECTED_WORDS = ["千克", "千米", "百米", "千瓦", "千伏", "十字", "万用"];

export function normalizeNumbers(text) {
  // 单位和专有词里的“千 / 百 / 十 / 万”不是数字，先换成占位符
  let source = String(text ?? "");
  PROTECTED_WORDS.forEach((word, index) => { source = source.replaceAll(word, `\u0000${index}\u0000`); });
  const converted = source.replace(/[零〇一二两三四五六七八九十百千万]+/g, (word) => {
    if (/^[零〇一二两三四五六七八九]{2,}$/.test(word)) return word; // 连续数字（如电话）不转
    let total = 0;
    let section = 0;
    let number = 0;
    for (const char of word) {
      if (char in CN_DIGITS) number = CN_DIGITS[char];
      else if (char === "万") {
        total += (section + number) * 10000;
        section = 0;
        number = 0;
      } else {
        section += (number || 1) * CN_UNITS[char];
        number = 0;
      }
    }
    return String(total + section + number);
  });
  return converted.replace(/\u0000(\d+)\u0000/g, (m, index) => PROTECTED_WORDS[Number(index)]);
}

const compact = (text) => normalizeNumbers(String(text ?? ""))
  .replace(/[，,。；;！!？?、]/g, " ")
  .replace(/[：:]/g, ":")
  .replace(/\s+/g, " ")
  .trim();

const UNIT_WORDS = "千米|公里|百米|平方米|平方|立方米|立方|千克|公斤|吨|米|个|端|芯|台|套|处|根|条|块|盘|只|座|架|点|系统|项|卷|包|袋|箱|副|对|片|kg|km|m";
const UNIT_ALIASES = { 公里: "千米", km: "千米", m: "米", 平方: "平方米", 立方: "立方米", 公斤: "千克", kg: "千克" };

/** 单位换算：说的单位 → 定额单位的倍数；不能换算时返回 null。 */
export function unitFactor(from, to) {
  const a = UNIT_ALIASES[from] || from;
  const b = UNIT_ALIASES[to] || to;
  if (!a || !b || a === b) return 1;
  const meters = { 米: 1, 百米: 100, 千米: 1000 };
  if (a in meters && b in meters) return meters[a] / meters[b];
  return null;
}

// ---------------- 指令 ----------------

const INFO_ALIASES = [
  ["建设单位", "constructionUnit"], ["项目名称", "projectName"], ["工程名称", "projectName"], ["建设地点", "location"], ["地点", "location"],
  ["建设地区类别", "regionClass"], ["地区类别", "regionClass"], ["工程规模", "scale"], ["预算书类别", "budgetType"],
  ["监理单位", "supervisor"], ["监理费下浮率", "supervisorDiscount"], ["监理技术负责人", "supervisorLead"],
  ["施工单位", "contractor"], ["施工费下浮率", "contractorDiscount"], ["施工单位增值税税率", "contractorTaxRate"], ["增值税税率", "contractorTaxRate"],
  ["施工技术负责人", "contractorLead"], ["设计单位", "designer"], ["设计费下浮率", "designDiscount"], ["批准", "approver"],
  ["设计技术负责人", "designLead"], ["编制人", "preparer"], ["审核", "reviewer"], ["校核", "checker"], ["编制日期", "preparedDate"], ["设计费费率", "designFeeRate"]
].sort((a, b) => b[0].length - a[0].length);

const UNDO_PATTERN = /^(上一步|撤销|撤消|撤回|回退|返回上一步|撤销上一步|刚才的?(那条|那个|那些)?(不要了?|删掉|删除|错了)|删掉刚才的?(那条|那个|那些)?|刚刚(那条|那个)?(不要了?|删掉|错了))$/;

function sectionOf(word) {
  if (!word) return null;
  return word === "材料" ? "material" : "quota";
}

/**
 * 纠正上一条的数量：“是300米，不是4千米”“不是4千米是300米”“改成300米”“定额光缆是0.3千米不是2千米”。
 * 返回 { command: "correct", quantity, unit, keywords }；keywords 用来在清单里找要改的那条（空时改上一条）。
 */
export function parseCorrection(rawText) {
  const flat = compact(rawText).replace(/\s/g, "");
  const quantityPattern = `(\\d+(?:\\.\\d+)?)(${UNIT_WORDS})?`;
  let right = null;
  let rest = flat;
  let match = flat.match(new RegExp(`^(.*?)(?:是|应该是|应为)?${quantityPattern}[,]?不是${quantityPattern}$`));
  if (match) {
    right = { value: Number(match[2]), unit: match[3] || "" };
    rest = match[1];
  } else if ((match = flat.match(new RegExp(`^(.*?)不是${quantityPattern}[,]?(?:是|而是|应该是|应为)${quantityPattern}$`)))) {
    right = { value: Number(match[4]), unit: match[5] || "" };
    rest = match[1];
  } else if ((match = flat.match(new RegExp(`^(?:把)?(.*?)(?:数量)?(?:改成|改为|应该是|应为)${quantityPattern}$`)))) {
    if (/第\d+/.test(match[1])) return null;
    right = { value: Number(match[2]), unit: match[3] || "" };
    rest = match[1];
  }
  if (!right || !(right.value > 0)) return null;
  const keywords = rest.replace(/^(错了|不对|搞错了|错啦)/, "").replace(/^是/, "").replace(/^(人工|定额|材料)/, "").replace(/(的)?(长度|数量)$/, "").replace(/是$/, "");
  return {
    command: "correct",
    quantity: right.value,
    unit: UNIT_ALIASES[right.unit] || right.unit,
    section: /^(错了|不对)?(人工|定额)/.test(rest) ? "quota" : /^(错了|不对)?材料/.test(rest) ? "material" : null,
    keywords: applySynonyms(keywords.replace(STOP_WORDS, ""))
  };
}

const RATE_KEYS = new Set(["supervisorDiscount", "contractorDiscount", "contractorTaxRate", "designDiscount", "designFeeRate"]);

/**
 * 识别定额模式里的指令。返回 { command, ... } 或 null。
 * 指令：exit、create、open、list、export、info、delete(index)、quantity(index, quantity)、setInfo(key, value)、help。
 */
export function parseQuotaCommand(rawText) {
  const text = compact(rawText).replace(/\s/g, "");
  if (!text) return null;
  if (/^(退出|退出定额模式|结束|不录了|退出定额)$/.test(text)) return { command: "exit" };
  if (/^(新建|新建预算|新建工程|新建项目|新预算|开始新预算)$/.test(text)) return { command: "create" };
  if (/^(打开|打开预算|切换预算|换预算|我的预算|预算列表|最近预算)$/.test(text)) return { command: "open" };
  if (/^(清单|看清单|查看清单|汇总|合计|看看|查看|当前预算|列表|明细)$/.test(text)) return { command: "list" };
  if (/^(生成|生成预算书|导出|导出预算书|出预算书|生成文件|出表|生成表格)$/.test(text)) return { command: "export" };
  if (/^(基础信息|看基础信息|查看基础信息)$/.test(text)) return { command: "info" };
  if (/^(帮助|怎么用|说明|用法)$/.test(text)) return { command: "help" };
  if (/^(清空管道|删除管道|管道清空|清除管道)$/.test(text)) return { command: "clearPipe" };
  // 提问和撤销按原话判断（“上一步”“说一说”里的“一”不是数字）
  const raw = String(rawText ?? "").replace(/[\s，,。；;！!？?、：:]/g, "");
  if (UNDO_PATTERN.test(raw)) return { command: "undo" };
  // 人工、材料各自编号：“删除人工2”“删除材料1”“删除第3项”（没说哪边时由调用方判断）
  let match = text.match(/^(?:删除|删掉|删|去掉)(人工|定额|材料)?第?(\d+)(?:项|条|行)?$/);
  if (match) return { command: "delete", index: Number(match[2]), section: sectionOf(match[1]) };
  match = text.match(/^(人工|定额|材料)?第?(\d+)(项|条|行)?(?:的)?(?:数量)?(?:改成|改为|改|=)(\d+(?:\.\d+)?)(\S*)$/);
  if (match && (match[1] || match[3])) return { command: "quantity", index: Number(match[2]), section: sectionOf(match[1]), quantity: Number(match[4]), unit: match[5] || "" };
  for (const [label, key] of INFO_ALIASES) {
    match = text.match(new RegExp(`^(?:把)?${label}(?:改成|改为|改|设为|设成|填|=)(.+)$`));
    if (match) {
      let value = match[1];
      if (key === "regionClass") {
        const level = value.match(/^([1-4一二三四])类?(?:地区)?$/);
        if (!level) return { command: "setInfo", key, value, invalid: "地区类别只能是一类、二类、三类或四类地区" };
        value = `${"一二三四"[Number(normalizeNumbers(level[1])) - 1]}类地区`;
      } else if (RATE_KEYS.has(key)) {
        const rate = value.match(/^(\d+(?:\.\d+)?)%?$/);
        if (!rate) return { command: "setInfo", key, value, invalid: `${label}请填写百分数，例如 9%` };
        value = Number(rate[1]) / 100;
      }
      return { command: "setInfo", key, label, value };
    }
  }
  if (/^(工程编号|编号)(?:改成|改为|改|设为|填|=)/.test(text)) return { command: "setInfo", key: "projectCode", invalid: "工程编号由规建部门填写，这里不能改" };
  const correction = parseCorrection(text);
  if (correction) return correction;
  // 不带数字的提问（“材料是多少”“说一说人工和材料”“有哪些”）给清单；只有问号或闲聊给简短提示
  if (!/[0-9０-９]/.test(raw) && (/(多少|哪些|几项|几条|清单|明细|汇总|合计|总价|总共|一共|说一说|说说|讲讲|看看|看一下|列一下|列出)/.test(raw) || /^(人工|定额|材料)$/.test(raw))) {
    return { command: "list", section: /材料/.test(raw) && !/人工|定额/.test(raw) ? "material" : /人工|定额/.test(raw) && !/材料/.test(raw) ? "quota" : null };
  }
  return null;
}

// ---------------- 管道 ----------------

const ROAD_KINDS = [["混凝土", "混凝土路面"], ["水泥路", "混凝土路面"], ["柏油", "柏油路面"], ["沥青", "柏油路面"], ["砂石", "砂石路面"], ["花砖", "水泥花砖路面"], ["条石", "条石路面"], ["绿化", "绿化带路面"], ["普通土", "普通开挖"], ["泥地", "普通开挖"], ["普通开挖", "普通开挖"]];

function roadFrom(text) {
  const kind = ROAD_KINDS.find(([word]) => text.includes(word))?.[1];
  if (!kind) return null;
  if (["水泥花砖路面", "条石路面", "绿化带路面", "普通开挖"].includes(kind)) return { road: kind };
  const thickness = text.match(/(150|250|350|450)\s*(?:mm|毫米|以下)/);
  const allowed = kind === "混凝土路面" ? ["150", "250", "350", "450"] : ["150", "250"];
  if (thickness && allowed.includes(thickness[1])) return { road: `${kind}${thickness[1]}mm以下` };
  return { road: `${kind}150mm以下`, assumedThickness: true };
}

/**
 * 管道录入说法：开挖（路面 + 长度）、顶管（孔数 + 长度）、做井（类型 + 个数 + 路面）、直埋子管（长度 + 路面）。
 * 返回 { input, notes } 或 null（不是管道说法）。开挖和敷管一律 1 孔。
 */
export function parsePipeUtterance(rawText) {
  const text = compact(rawText);
  const flat = text.replace(/\s/g, "");
  const length = (pattern) => {
    const match = flat.match(pattern);
    return match ? Number(match[1]) * (match[2] && /千米|公里/.test(match[2]) ? 1000 : 1) : null;
  };
  const notes = [];
  if (/顶管/.test(flat)) {
    const holes = flat.match(/(\d)孔/);
    const meters = length(/(\d+(?:\.\d+)?)(米|m|千米|公里)(?!m)/);
    if (!meters) return { error: "顶管要说长度，例如“顶管 2 孔 15 米”" };
    const count = holes ? Number(holes[1]) : 1;
    if (!holes) notes.push("没说孔数，按 1 孔");
    if (count < 1 || count > 9) return { error: "顶管孔数只能是 1～9 孔" };
    return { input: { jacking: { [count]: meters } }, notes, summary: `顶管 ${count} 孔 ${meters} 米` };
  }
  const well = Object.keys(PIPE_WELLS).find((type) => flat.includes(type) || flat.includes(type.replace("页", "叶")));
  if (well) {
    const count = flat.match(/(\d+)(?:个|座|口)/);
    if (!count) return { error: `${well}要说个数，例如“${well} 2 个 混凝土路面 250 以下”` };
    const road = roadFrom(flat.replace(well, ""));
    const wellRoad = road?.road === "普通开挖" || !road ? "普通土" : road.road;
    if (!road) notes.push("没说井在什么路面，按普通土");
    else if (road.assumedThickness) notes.push("没说路面厚度，按 150mm 以下");
    return { input: { wells: [{ type: well, road: wellRoad, count: Number(count[1]) }] }, notes, summary: `${well} ${count[1]} 个（${wellRoad}）` };
  }
  if (/直埋子管|埋子管/.test(flat)) {
    const meters = length(/(\d+(?:\.\d+)?)(米|m|千米|公里)(?!m)/);
    if (!meters) return { error: "直埋子管要说长度，例如“直埋子管 100 米”" };
    const road = roadFrom(flat);
    const subductRoad = road?.road === "普通开挖" || !road ? "普通土" : road.road;
    return { input: { subduct: { length: meters, road: subductRoad } }, notes, summary: `直埋子管 ${meters} 米（${subductRoad}）` };
  }
  if (/开挖|挖路|破路|开路/.test(flat) && ROAD_KINDS.some(([word]) => flat.includes(word))) {
    const road = roadFrom(flat);
    // 先去掉路面厚度（“250mm以下”），再找长度，避免把 250mm 当成长度
    const lengthText = flat.replace(/(150|250|350|450)\s*(?:mm|毫米)(?:以下)?|(150|250|350|450)以下/, "");
    const lengthMatch = lengthText.match(/(\d+(?:\.\d+)?)(米|m|千米|公里)/);
    const meters = lengthMatch ? Number(lengthMatch[1]) * (/千米|公里/.test(lengthMatch[2]) ? 1000 : 1) : null;
    if (!meters) return { error: "开挖要说长度，例如“开挖混凝土路面 250 以下 30 米”" };
    if (road.assumedThickness) notes.push("没说路面厚度，按 150mm 以下");
    if (/[2-9]孔/.test(flat)) notes.push("开挖和敷管一律按 1 孔计算");
    return { input: { trench: { [road.road]: meters } }, notes, summary: `开挖${road.road} ${meters} 米` };
  }
  return null;
}

/** 把一次管道录入并入已有录入（长度、个数相加）。 */
export function mergePipeInput(current = {}, addition = {}) {
  const next = {
    trench: { ...(current.trench || {}) },
    jacking: { ...(current.jacking || {}) },
    wells: (current.wells || []).map((well) => ({ ...well })),
    subduct: current.subduct ? { ...current.subduct } : null,
    ...(current.soil ? { soil: { ...current.soil } } : {})
  };
  for (const [road, value] of Object.entries(addition.trench || {})) next.trench[road] = (Number(next.trench[road]) || 0) + Number(value);
  for (const [holes, value] of Object.entries(addition.jacking || {})) next.jacking[holes] = (Number(next.jacking[holes]) || 0) + Number(value);
  for (const well of addition.wells || []) {
    const existing = next.wells.find((item) => item.type === well.type && item.road === well.road);
    if (existing) existing.count += Number(well.count);
    else next.wells.push({ ...well });
  }
  if (addition.subduct) {
    // 直埋子管只记一段：同一路面时长度相加，换了路面以新说的为准
    next.subduct = next.subduct && next.subduct.road === addition.subduct.road
      ? { ...next.subduct, length: Number(next.subduct.length) + Number(addition.subduct.length) }
      : { ...addition.subduct };
  }
  return next;
}

// ---------------- 定额 / 材料 ----------------

const QUOTA_VERBS = /(敷设|布放|架设|安装|接续|熔接|测试|调试|开挖|修复|回填|制作|开缆|开端|砌|浇筑|抹面|测量|穿放|整治|排查|扶正|抽水|立杆|立|拆除|更换|迁改|割接|成端|打|装|挂|拉线)/;
const SYNONYMS = [
  ["熔接", "接续"], ["熔纤", "接续"], ["接续盒", "接头盒"], ["开端", "端开缆"], ["开缆", "端开缆"],
  ["光交", "光缆交接箱"], ["分纤箱", "光缆分纤箱"], ["皮线", "皮线光缆"], ["蝶缆", "皮线光缆"]
];

function applySynonyms(text) {
  let result = String(text || "");
  for (const [from, to] of SYNONYMS) if (result.includes(from) && !result.includes(to)) result = result.replace(from, to);
  return result;
}
const STOP_WORDS = /(以下|以上|个|的|一下|帮我|请|加上?|添加|录入|再|还有|共|总共|一共|大概|左右)/g;

/**
 * 拆一句录入：数量与单位、芯数、利旧、备注、类型（quota / material / auto）、用于匹配的关键词。
 * “24芯光缆800米”的 24芯 是规格，800米 是数量；“熔接24芯”的 24芯 同时是芯数和数量。
 */
export function parseItemUtterance(rawText) {
  let text = compact(rawText);
  let mode = "auto";
  if (/^(材料|甲供|表四)[:：\s]*/.test(text)) {
    mode = "material";
    text = text.replace(/^(材料|甲供|表四)[:：\s]*/, "");
  } else if (/^(定额|表二|人工)[:：\s]*/.test(text)) {
    mode = "quota";
    text = text.replace(/^(定额|表二|人工)[:：\s]*/, "");
  }
  const reuse = /利旧/.test(text);
  text = text.replace(/利旧/g, " ");
  let remark = "";
  const remarkMatch = text.match(/备注[:：]?\s*(\S+)/) || text.match(/((?:架空|管道|直埋|墙壁|楼道|入户|室内|室外|应急|备用)用)/);
  if (remarkMatch) {
    remark = remarkMatch[1];
    text = text.replace(remarkMatch[0], " ");
  }
  const flat = text.replace(/\s/g, "");
  // 芯数：“24芯”；分光比：“1分8”“1:8”
  const coreMatches = [...flat.matchAll(/(\d+)芯/g)];
  const cores = coreMatches.length ? Number(coreMatches[0][1]) : null;
  const ratioMatch = flat.match(/1[分:比](\d+)/);
  const ratio = ratioMatch ? Number(ratioMatch[1]) : null;
  // 数量：数字 + 单位；“芯”只在没有别的数量时算数量（例如“熔接24芯”）
  const quantities = [...flat.matchAll(new RegExp(`(\\d+(?:\\.\\d+)?)(${UNIT_WORDS})(?![a-zA-Z])`, "g"))]
    .filter((match) => !(ratioMatch && match.index === ratioMatch.index + 2))
    .map((match) => ({ value: Number(match[1]), unit: UNIT_ALIASES[match[2]] || match[2], index: match.index, raw: match[0] }));
  let quantity = quantities.filter((item) => item.unit !== "芯").at(-1) || null;
  if (!quantity && quantities.length) quantity = quantities.at(-1);
  if (!quantity) {
    // “光缆端开缆3” “3光缆端开缆”：没有单位的纯数字
    const bare = flat.replace(/(\d+)芯/g, "").replace(/1[分:比]\d+/g, "").replace(/[A-Za-z]+-?\d+[A-Za-z0-9#-]*/g, "").match(/(?:^|[^\d.])(\d+(?:\.\d+)?)(?![\d.])/);
    if (bare) quantity = { value: Number(bare[1]), unit: "", raw: bare[1] };
  }
  let keywords = flat;
  for (const item of quantities) keywords = keywords.replace(item.raw, " ");
  if (quantity && !quantity.unit) keywords = keywords.replace(quantity.raw, " ");
  keywords = keywords.replace(/(\d+)芯(以下|以上)?/g, " ").replace(/1[分:比]\d+/g, " ").replace(STOP_WORDS, " ").replace(/\s+/g, " ").trim();
  keywords = applySynonyms(keywords);
  const models = [...flat.matchAll(/[A-Za-z]{2,}[A-Za-z0-9#-]*/g)].map((match) => match[0].toUpperCase()).filter((word) => !/^(MM|KM)$/.test(word));
  // “架空光缆 300 米”“管道光缆”说的是敷设（人工），材料名称里没有敷设方式
  if (/(架空|管道|直埋|埋式|吊线式?|钉固式?|沿墙)光缆/.test(keywords) && !/敷设/.test(keywords) && mode !== "material") keywords = keywords.replace(/((?:架空|管道|直埋|埋式|吊线式?|钉固式?|沿墙)光缆)/, "$1敷设");
  // “材料：48芯300米”只说了芯数和长度，就是光缆
  if (mode === "material" && !keywords.replace(/\s/g, "") && cores && /米/.test(quantity?.unit || "")) keywords = "光缆";
  if (mode === "auto") mode = QUOTA_VERBS.test(flat) || /敷设/.test(keywords) ? "quota" : "material";
  // 规格：没被当作数量的“数字 + 单位”（例如“立水泥杆 7米”的 7米）和分光比，用来在同名定额的几档里挑
  const specs = quantities.filter((item) => item !== quantity && item.unit !== "芯").map((item) => item.raw);
  if (ratio) specs.push(`1:${ratio}`);
  return {
    specs,
    mode,
    quantity: quantity ? quantity.value : null,
    unit: quantity ? quantity.unit : "",
    cores,
    ratio,
    reuse,
    remark,
    models,
    keywords: keywords.replace(/\s/g, "")
  };
}

const SECTION_MARK = /^(人工|定额|表二|材料|甲供|表四)[:：]?$/;

/**
 * 一句话里说了几条时拆开：按逗号、分号、顿号、换行拆，“人工：…材料：…”分段；
 * 没有数字的小段（如“架空用”）并到前一段；每段带上所在分段的前缀（“材料 …”）。
 * 只有一段时返回 [原话]。
 */
export function splitUtterance(rawText) {
  const text = normalizeNumbers(String(rawText ?? "")).replace(/(人工|定额|表二|材料|甲供|表四)\s*[:：]/g, "\n$1:\n");
  const pieces = text.split(/[，,；;。\n、]+/).map((piece) => piece.trim()).filter(Boolean);
  const parts = [];
  let section = "";
  for (const piece of pieces) {
    if (SECTION_MARK.test(piece)) {
      section = /人工|定额|表二/.test(piece) ? "人工" : "材料";
      continue;
    }
    if (!/\d/.test(piece) && parts.length) {
      parts[parts.length - 1].text += ` ${piece}`;
      continue;
    }
    parts.push({ section, text: piece });
  }
  if (parts.length <= 1) return [String(rawText ?? "").trim()];
  return parts.map((part) => (part.section && !/^(人工|定额|表二|材料|甲供|表四)/.test(part.text) ? `${part.section} ${part.text}` : part.text));
}

/** 说法与名称的相似度（0～1），纠正数量时用来找是哪一条。 */
export function textMatchScore(query, target) {
  return charCoverage(query, target) * 0.7 + bigramScore(query, target) * 0.3;
}

function charCoverage(query, target) {
  const chars = [...new Set([...query].filter((char) => /[一-鿿A-Za-z0-9]/.test(char)))];
  if (!chars.length) return 0;
  return chars.filter((char) => target.includes(char)).length / chars.length;
}

function bigramScore(query, target) {
  const grams = (text) => new Set([...text].map((char, index) => text.slice(index, index + 2)).filter((gram) => gram.length === 2));
  const a = grams(query);
  if (!a.size) return 0;
  const b = grams(target);
  return [...a].filter((gram) => b.has(gram)).length / a.size;
}

/** 定额候选：按关键词与“名称 + 明细”的字符覆盖排序；有芯数时在同名的芯数档里挑一档。 */
export function matchQuotaItems(items, parsed, { limit = 5 } = {}) {
  const query = parsed.keywords;
  if (!query) return [];
  const scored = items.map((item) => {
    const name = `${item.name}`;
    const full = `${item.name}${item.detail}`;
    const score = charCoverage(query, full) * 0.5 + bigramScore(query, full) * 0.3 + charCoverage(name, query) * 0.2;
    return { item, score };
  }).filter((entry) => entry.score >= 0.45).sort((a, b) => b.score - a.score);
  const results = [];
  const seenNames = new Set();
  for (const entry of scored) {
    if (seenNames.has(entry.item.name)) continue;
    const sameName = items.filter((item) => item.name === entry.item.name);
    if (parsed.cores && sameName.some((item) => /\d+芯(以下|以上)/.test(item.detail))) {
      const tier = pickCoreTier(sameName, parsed.cores);
      if (tier) {
        results.push({ item: tier, score: entry.score, reason: `${parsed.cores} 芯归“${tier.detail}”档` });
        seenNames.add(entry.item.name);
        continue;
      }
    }
    // 同名多档且无法按芯数选择时，把各档都列为候选；明细里含说到的规格（7米、1:8）的排前
    if (sameName.length > 1) {
      const specBonus = (item) => ((parsed.specs || []).some((spec) => item.detail.replace(/\s/g, "").startsWith(spec)) ? 0.2 : 0);
      const ranked = sameName.map((item) => ({ item, score: entry.score + specBonus(item) + charCoverage(item.detail, query) * 0.05 })).sort((a, b) => b.score - a.score);
      results.push(...ranked);
    } else {
      results.push(entry);
    }
    seenNames.add(entry.item.name);
    if (results.length >= limit) break;
  }
  return results.slice(0, limit);
}

/** 物料候选：芯数、分光比、型号字母必须出现在名称或规格里；常用物料优先。 */
export function matchMaterials(materials, parsed, { limit = 5 } = {}) {
  const query = parsed.keywords.replace(/[A-Za-z0-9#-]+/g, "");
  return materials.map((material) => {
    const text = `${material.name}${material.spec}${material.attr}`.toUpperCase();
    if (parsed.cores && !new RegExp(`(^|[^\\d])${parsed.cores}芯`).test(text)) return null;
    if (parsed.ratio && !new RegExp(`1[分:比]${parsed.ratio}(?!\\d)`).test(text)) return null;
    if (parsed.models.some((model) => !text.includes(model))) return null;
    const coverage = query ? charCoverage(query, text) : 0.6;
    if (coverage < 0.5) return null;
    // 名称里多出来的字越多越靠后（“24芯光缆”不该把“光缆接头盒”排在光缆前面）
    const nameFit = query ? charCoverage(material.name, query) : 0.5;
    return { material, score: coverage * 0.6 + bigramScore(query, text) * 0.15 + nameFit * 0.3 + (material.common ? 0.15 : 0) };
  }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, limit);
}

/** 学习用的说法键：去掉数量、芯数、利旧、备注后的关键词（同一说法换数量、换芯数都算同一条）。 */
export function learnKey(parsed) {
  return String(parsed?.keywords || "").replace(/\s/g, "");
}

/**
 * 按芯数 / 规格在同名定额里定档：学到的或大模型选的定额是“架空光缆敷设 12芯以下”，
 * 这次说 24 芯时仍按芯数规则改到“36芯以下”。
 */
export function resolveQuotaTier(items, item, parsed) {
  const sameName = items.filter((entry) => entry.name === item.name);
  if (sameName.length <= 1) return item;
  if (parsed.cores && sameName.some((entry) => /\d+芯(以下|以上)/.test(entry.detail))) return pickCoreTier(sameName, parsed.cores) || item;
  const bySpec = sameName.find((entry) => (parsed.specs || []).some((spec) => entry.detail.replace(/\s/g, "").startsWith(spec)));
  return bySpec || item;
}

/** 给大模型的定额候选池：比本地匹配宽松，按字符覆盖取前 n 条（同名多档都带上）。 */
export function poolQuotaItems(items, parsed, limit = 24) {
  const query = parsed.keywords;
  if (!query) return [];
  return items.map((item) => ({ item, score: charCoverage(query, `${item.name}${item.detail}`) * 0.7 + bigramScore(query, `${item.name}${item.detail}`) * 0.3 }))
    .filter((entry) => entry.score >= 0.25).sort((a, b) => b.score - a.score).slice(0, limit).map((entry) => entry.item);
}

/** 给大模型的物料候选池：芯数、分光比仍然必须对上，其余放宽。 */
export function poolMaterials(materials, parsed, limit = 16) {
  const query = parsed.keywords.replace(/[A-Za-z0-9#-]+/g, "");
  return materials.map((material) => {
    const text = `${material.name}${material.spec}${material.attr}`.toUpperCase();
    if (parsed.cores && !new RegExp(`(^|[^\\d])${parsed.cores}芯`).test(text)) return null;
    if (parsed.ratio && !new RegExp(`1[分:比]${parsed.ratio}(?!\\d)`).test(text)) return null;
    const score = (query ? charCoverage(query, text) : 0.5) + (material.common ? 0.1 : 0);
    return score >= 0.3 ? { material, score } : null;
  }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, limit).map((entry) => entry.material);
}

export { PIPE_ROADS };
