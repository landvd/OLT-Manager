/**
 * Pi Agent 长期记忆与自主纠错防踩坑引擎
 * 负责跨会话的记忆持久化、静默纠错识别、全域资料（用户/OLT/机房/命令）沉淀与高优先级召回
 */

function cleanText(val) {
  return String(val || "").trim();
}

/**
 * 本地确定性规则静默提取（零依赖、毫秒级响应，离线或断网同样生效）
 * @param {string} userText 工程师的输入
 * @param {string} assistantText 上一轮助手的回答
 * @returns {Array<object>} 提取出的记忆数组
 */
export function extractMemoriesHeuristics(userText = "", assistantText = "") {
  const norm = cleanText(userText);
  if (!norm) return [];

  const memories = [];

  // 1. 机房/局点资料与外层 SVLAN 规约提取
  // 例如：“厚街机房外层VLAN是2048”、“双岗局点外层统一用1000”
  const siteVlanMatch = norm.match(/(?:([^\s，。、（）:：!！]+(?:机房|局点|分光点|社区|中心)).*?(?:外层|svlan|业务vlan|vlan)\D*(\d+))/i);
  if (siteVlanMatch) {
    const siteName = siteVlanMatch[1].trim();
    const vlanId = siteVlanMatch[2].trim();
    memories.push({
      domain: "site",
      entityKey: siteName,
      topic: "外层SVLAN规划",
      factContent: `${siteName}外层 SVLAN 规划为 ${vlanId}`,
      antiPattern: norm.includes("不是") ? (norm.match(/不是\D*(\d+)/)?.[1] || "") : (norm.includes("不要用") ? (norm.match(/不要用\D*(\d+)/)?.[1] || "") : ""),
      reason: "现场工程师纠错/指定局点 VLAN 规约",
      confidence: 1.0
    });
  }

  // 2. 机房光衰/弱光阈值规约提取
  // 例如：“厚街机房光衰在-28以内都正常”、“双岗光衰门限调为-28dBm”
  const siteOpticalMatch = norm.match(/(?:([^\s，。、（）:：!！]+(?:机房|局点|分光点)).*?(?:光衰|收光|功率|门限).*?(-?\d+(?:\.\d+)?)\s*(?:dbm|以内|正常))/i);
  if (siteOpticalMatch) {
    const siteName = siteOpticalMatch[1].trim();
    const power = siteOpticalMatch[2].trim();
    memories.push({
      domain: "site",
      entityKey: siteName,
      topic: "光衰健康门限",
      factContent: `${siteName}正常接收光功率门限为 ${power} dBm 以内，放宽告警标准`,
      antiPattern: "-27",
      reason: "现场工程师指定局点特定光衰判断标准",
      confidence: 1.0
    });
  }

  // 3. 命令语法与架构避坑规约提取（针对中兴 C600 vs C300、华为等）
  // 例如：“不对，C600不能用 gpon-olt_，必须用 interface gpon_olt-1/2/5”
  const c600AntiMatch = norm.match(/(?:(c600|titan).*?(?:不能用|别用|严禁|报错|没有).*?(gpon[-_]olt[-_]\S*))/i);
  if (c600AntiMatch) {
    memories.push({
      domain: "command",
      entityKey: "zte-c600",
      topic: "端口视图命令语法",
      factContent: "中兴 C600 (TITAN) 必须使用 interface gpon_olt-1/<槽位>/<PON口> 格式",
      antiPattern: c600AntiMatch[2] || "gpon-olt_1/",
      reason: "历史避坑：C600 不支持 C300 的 gpon-olt_ 语法，敲此命令设备报 20202 错误",
      confidence: 1.0
    });
  }

  const c300FrameMatch = norm.match(/(?:(c300).*?(?:必须|补齐|漏了).*?(?:机框|框号\s*1))/i);
  if (c300FrameMatch) {
    memories.push({
      domain: "command",
      entityKey: "zte-c300",
      topic: "三级端口坐标补齐机框号",
      factContent: "中兴 C300 CLI 中必须显式补齐机框编号 1（如 gpon-olt_1/<槽位>/<PON口>），严禁写为 gpon-olt_2/5",
      antiPattern: "gpon-olt_2/",
      reason: "漏掉机框号设备必定报错 20202",
      confidence: 1.0
    });
  }

  // 4. 用户资料更新（电话/地址纠正）
  // 例如：“用户张三电话改成13800138000”、“李四的实际地址是厚街村东路88号”
  const userPhoneMatch = norm.match(/(?:(?:用户\s*([^\s，。：:（(]+)|([^\s，。：:（(]+用户)).*?(?:电话|手机|联系电话|号码).*?(1[3-9]\d{9}))/i);
  if (userPhoneMatch) {
    const userName = (userPhoneMatch[1] || userPhoneMatch[2]).trim();
    const phone = userPhoneMatch[3].trim();
    memories.push({
      domain: "user",
      entityKey: userName,
      topic: "联系电话修正",
      factContent: `用户【${userName}】的最新真实联系电话为 ${phone}`,
      antiPattern: "",
      reason: "现场工程师纠正用户联系方式",
      confidence: 1.0
    });
  }

  const userAddrMatch = norm.match(/(?:(?:用户\s*([^\s，。：:（(]+)|([^\s，。：:（(]+用户)).*?(?:实际地址|装机地址|住址|搬到).*?([^\s，。]+[村路街号弄栋室小区]+[^\s，。]*))/i);
  if (userAddrMatch) {
    const userName = (userAddrMatch[1] || userAddrMatch[2]).trim();
    const address = userAddrMatch[3].trim();
    memories.push({
      domain: "user",
      entityKey: userName,
      topic: "装机地址修正",
      factContent: `用户【${userName}】的实际装机地址已更新为【${address}】`,
      antiPattern: "",
      reason: "现场工程师纠正用户物理装机地址",
      confidence: 1.0
    });
  }

  // 5. 显式纠错/避坑指令提取（“记住：...”、“避坑：...”）
  const explicitMatch = norm.match(/(?:(?:记住|记下来|避坑|规约|注意)[：:]\s*(.+))/i);
  if (explicitMatch) {
    const content = explicitMatch[1].trim();
    memories.push({
      domain: "command",
      entityKey: "general-rule",
      topic: "工程师指定规约",
      factContent: content,
      antiPattern: "",
      reason: "工程师显式要求记忆的现场规约",
      confidence: 1.0
    });
  }

  return memories;
}

/**
 * 利用大模型异步提炼复杂纠错与现场新事实（当配置了大模型时触发）
 */
export async function extractMemoriesWithLlm({
  userQuery = "",
  lastAssistantReply = "",
  languageConfig = null,
  fetchImpl = null
} = {}) {
  if (!languageConfig || !languageConfig.endpoint || !languageConfig.apiKey || !languageConfig.model) {
    return [];
  }
  if (!userQuery || userQuery.trim().length < 4) return [];

  const safeFetch = typeof fetchImpl === "function" ? fetchImpl : globalThis.fetch;
  if (!safeFetch) return [];

  const extractionPrompt = `你是一个网络接入层运维知识提炼器。分析以下工程师与助手的对话回合：
【助手上一轮回答】：${lastAssistantReply.slice(0, 500)}
【工程师最新发言】：${userQuery.slice(0, 500)}

任务：判断工程师是否纠正了助手的错误，或者提供了关于【用户 user】、【设备 olt】、【机房 site】、【命令避坑 command】的现场权威事实。
如果包含有效事实或纠错，请输出标准 JSON 格式：
{
  "hasFact": true,
  "memories": [
    {
      "domain": "site" | "olt" | "user" | "command",
      "entityKey": "核心实体，如机房名、OLT型号/IP、用户名、命令名",
      "topic": "主题，如外层SVLAN、真实地址、C600语法避坑",
      "factContent": "准确的事实规约",
      "antiPattern": "被纠正的旧认知或错误模式（若无留空）",
      "reason": "原因说明"
    }
  ]
}
若无任何新事实或纠错，严格输出：{"hasFact": false, "memories": []}
严禁输出任何 Markdown 标记或多余文字。`;

  try {
    const url = new URL(languageConfig.endpoint.replace(/\/+$/, "") + "/chat/completions");
    const res = await safeFetch(url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${languageConfig.apiKey}`
      },
      body: JSON.stringify({
        model: languageConfig.model,
        messages: [
          { role: "system", content: "你是严格只输出 JSON 的信息抽取器。" },
          { role: "user", content: extractionPrompt }
        ],
        temperature: 0.1
      })
    });

    if (!res.ok) return [];
    const data = await res.json();
    const rawContent = data.choices?.[0]?.message?.content || "";
    const cleaned = rawContent.replace(/```json/gi, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (parsed && parsed.hasFact && Array.isArray(parsed.memories)) {
      return parsed.memories.map((m) => ({
        domain: String(m.domain || "general").toLowerCase(),
        entityKey: cleanText(m.entityKey),
        topic: cleanText(m.topic),
        factContent: cleanText(m.factContent),
        antiPattern: cleanText(m.antiPattern),
        reason: cleanText(m.reason),
        confidence: 0.95
      })).filter((m) => m.entityKey && m.factContent);
    }
  } catch {
    // 忽略大模型异步提取中的瞬时网络错误，回退到规则提取
  }

  return [];
}

/**
 * 静默提取并持久化记忆（结合规则与大模型双引擎）
 */
export async function silentExtractAndSaveMemories({
  userQuery = "",
  lastAssistantReply = "",
  context = {},
  languageConfig = null,
  fetchImpl = null,
  saveLearnedMemory = null
} = {}) {
  if (typeof saveLearnedMemory !== "function") return [];

  // 1. 本地规则快速提取
  const heuristicMemories = extractMemoriesHeuristics(userQuery, lastAssistantReply);

  // 2. 大模型深度提炼（如果已配置）
  let llmMemories = [];
  if (languageConfig && languageConfig.apiKey) {
    try {
      llmMemories = await extractMemoriesWithLlm({
        userQuery,
        lastAssistantReply,
        languageConfig,
        fetchImpl
      });
    } catch {
      // ignore
    }
  }

  // 3. 去重与合并保存
  const allToSave = [...heuristicMemories, ...llmMemories];
  const saved = [];
  const seenKeys = new Set();

  for (const mem of allToSave) {
    const key = `${mem.domain}|${mem.entityKey}|${mem.topic}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    try {
      const persisted = await saveLearnedMemory({
        domain: mem.domain,
        entityKey: mem.entityKey,
        topic: mem.topic,
        factContent: mem.factContent,
        antiPattern: mem.antiPattern || "",
        reason: mem.reason || "",
        sourceContext: `User: ${cleanText(userQuery).slice(0, 200)}`,
        confidence: mem.confidence || 1.0
      });
      if (persisted) saved.push(persisted);
    } catch {
      // 容错保存
    }
  }

  return saved;
}

/**
 * 根据当前上下文与提问，动态检索相关的高优先级记忆并组装提示词
 */
export async function recallMemoriesForPrompt({
  context = {},
  userQuery = "",
  queryLearnedMemories = null,
  incrementMemoryHitCount = null
} = {}) {
  if (typeof queryLearnedMemories !== "function") {
    return { memories: [], promptSection: "" };
  }

  const queryText = cleanText(userQuery);
  const entityKeys = [];
  const keywords = [];

  // 提取 OLT 与型号特征
  if (context.oltId) entityKeys.push(String(context.oltId));
  if (context.vendor) keywords.push(String(context.vendor));
  if (context.model) {
    entityKeys.push(String(context.model).toLowerCase());
    keywords.push(String(context.model));
  }

  // 从提问中提取机房关键词
  const siteMatches = queryText.match(/[^\s，。、（）]+(?:机房|局点|分光点)/g);
  if (siteMatches) {
    for (const site of siteMatches) entityKeys.push(site.trim());
  }

  // 从提问中提取手机号
  const phoneMatch = queryText.match(/1[3-9]\d{9}/);
  if (phoneMatch) entityKeys.push(phoneMatch[0]);

  // 从提问中提取典型技术词
  if (/c600|titan/i.test(queryText)) entityKeys.push("zte-c600");
  if (/c300/i.test(queryText)) entityKeys.push("zte-c300");
  if (/5800|ma5800/i.test(queryText)) entityKeys.push("huawei-ma5800");
  if (/vlan|svlan/i.test(queryText)) keywords.push("vlan");
  if (/光衰|功率/i.test(queryText)) keywords.push("光衰");

  // 执行 SQLite 检索
  let memories = [];
  try {
    memories = await queryLearnedMemories({
      entityKeys,
      keywords,
      limit: 8
    });
  } catch {
    return { memories: [], promptSection: "" };
  }

  if (!Array.isArray(memories) || memories.length === 0) {
    return { memories: [], promptSection: "" };
  }

  // 统计命中率
  if (typeof incrementMemoryHitCount === "function") {
    for (const m of memories) {
      if (m.id) incrementMemoryHitCount(m.id).catch(() => {});
    }
  }

  // 格式化为高优先级 System Prompt 区块
  const domainHeaders = {
    site: "🏛️ 机房实况与规划资料",
    olt: "💻 OLT 设备专属特性",
    user: "👤 现场用户档案修正",
    command: "⛔ 命令避坑铁律（严禁再犯）",
    general: "📌 现场通用规约"
  };

  const lines = [
    "\n\n### 🧠 工程师现场已沉淀专属资料与避坑铁律（最高优先级，永久生效，必须无条件遵循）："
  ];

  for (const m of memories) {
    const domainTitle = domainHeaders[m.domain] || "📌 现场规约";
    const antiStr = m.anti_pattern ? ` 【严禁使用或套用旧模式：\`${m.anti_pattern}\`】` : "";
    lines.push(`- 【${domainTitle} | ${m.topic}】(${m.entity_key})：${m.fact_content}${antiStr}`);
  }

  return {
    memories,
    promptSection: lines.join("\n")
  };
}

/**
 * 校验生成的文本是否命中了已知 Anti-Pattern 并打上警示
 */
export function inspectWatchdogAntiPatterns(replyText = "", memories = []) {
  if (!replyText || !Array.isArray(memories) || memories.length === 0) return replyText;

  let sanitized = replyText;
  const warnings = [];

  for (const m of memories) {
    if (m.domain === "command" && m.anti_pattern) {
      const anti = m.anti_pattern.trim();
      if (anti && sanitized.includes(anti)) {
        warnings.push(`检测到回复中包含已知踩坑特征【${anti}】，请核对规约：${m.fact_content}`);
      }
    }
  }

  if (warnings.length > 0) {
    sanitized += `\n\n> ⚠️ **【记忆守护系统提示】**：${warnings.join("；")}`;
  }

  return sanitized;
}
