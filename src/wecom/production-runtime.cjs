const {
  renderWelcomeText,
  renderHelpMarkdown,
  renderOnuDetailMarkdown,
  renderPonStatusMarkdown,
  renderOnuHistoryMarkdown,
  renderVillageReportMarkdown,
  renderCandidatesMarkdown,
  renderPonCandidateListMarkdown,
  renderLoidCopyText,
  renderPiAgentAnswerMarkdown
} = require("./formatter.cjs");

function getWebSocketConstructor() {
  try {
    return require("ws");
  } catch {
    try {
      const sdkPath = require.resolve("@larksuiteoapi/node-sdk");
      const wsPath = require.resolve("ws", { paths: [sdkPath] });
      return require(wsPath);
    } catch {
      if (typeof globalThis.WebSocket !== "undefined") {
        return globalThis.WebSocket;
      }
      throw new Error("找不到可用的 WebSocket 客户端库 (ws 或 globalThis.WebSocket)");
    }
  }
}

function generateReqId() {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function isHelpText(text) {
  const clean = String(text ?? "").trim().toLowerCase();
  return [
    "帮助", "help", "?", "？", "使用方法", "操作指南", "说明", "菜单", "功能"
  ].includes(clean);
}

function extractVillageName(text) {
  const raw = String(text ?? "").trim();
  const match = raw.match(/(?:查查|查询|查找|查一下|帮我查|帮忙查|请查)?\s*([\u4e00-\u9fff·]{2,32}(?:村|社区|居委))\s*(?:的)?\s*(?:所有|全部|各个|所有的)?\s*(?:PON|pon)\s*口/u) ||
    raw.match(/(?:光功率|光衰|测光)\s*([\u4e00-\u9fff·]{2,32}(?:村|社区|居委)?)/u) ||
    raw.match(/([\u4e00-\u9fff·]{2,32}(?:村|社区|居委))\s*(?:光功率|光衰)/u);
  return match?.[1] ? match[1].trim() : null;
}

function extractIpAndPon(text) {
  const raw = String(text ?? "").trim();
  // 匹配类似 172.19.104.101 3/4 或 104.101 3/4 或 104.101/3/4
  const match = raw.match(/(?:^|[^\d.])((?:\d{1,3}\.){1,3}\d{1,3})\s*(?:[/_\s]|gpon[-_]olt[-_])\s*(?:(\d+)[/_-])?(\d+)[/_-](\d+)(?![\d./])/i);
  if (!match) return null;
  let ip = match[1];
  if (ip.split(".").length === 2) {
    // 简写 IP 如 104.101 -> 172.19.104.101
    ip = `172.19.${ip}`;
  }
  const chassis = match[2];
  const board = match[3];
  const pon = match[4];
  return { oltIp: ip, chassis, board, pon };
}

function resolveUserQueryIntent(text) {
  const raw = String(text ?? "").trim();
  const clean = raw.replace(/\s+/g, "");

  // 1. 手机号
  const phone = clean.match(/1\d{10}/)?.[0];
  if (phone) return { intent: "find_by_phone", value: phone };

  // 2. LOID
  const loidMatch = raw.match(/LOID\s*(?:[:：=]\s*|\s+)([A-Za-z0-9._-]+)/iu) ||
    clean.match(/^LOID[-_A-Z0-9]+$/i);
  if (loidMatch) return { intent: "find_by_loid", value: loidMatch[1] || loidMatch[0] };

  // 3. 设备号（17-24位纯数字）
  if (/^\d{17,24}$/.test(clean)) return { intent: "find_by_device_number", value: clean };

  // 4. MAC 地址（带分隔符或纯12位十六进制）
  if (/^(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/.test(clean) || /^[0-9A-Fa-f]{12}$/.test(clean)) {
    return { intent: "find_by_mac", value: clean };
  }

  // 5. SN 序列号（如 ZTEG 开头或 16 位十六进制）
  if (/^[A-Z]{4}[0-9A-Fa-f]{8}$/i.test(clean) || /^[0-9A-Fa-f]{16}$/i.test(clean)) {
    return { intent: "find_by_sn", value: clean };
  }

  // 6. ONU 物理坐标（如 1/8/5:1 或 8/5:1）
  const coordMatch = clean.match(/^(?:(\d+)[/_-])?(\d+)[/_-](\d+):(\d+)$/);
  if (coordMatch) {
    return {
      intent: "find_by_onu_coordinate",
      value: clean
    };
  }

  // 7. 姓名（2-4位中文）
  if (/^[\u4e00-\u9fff·]{2,4}$/u.test(raw)) return { intent: "find_by_name", value: raw };

  // 8. 常见装机地址关键词
  if (/^[\u4e00-\u9fff]{2,}[\u4e00-\u9fffA-Za-z0-9０-９#\-－_（）()]*(?:村|路|街|巷|小区|花园|公寓|广场|大厦|号|楼)$/u.test(clean)) {
    return { intent: "find_by_address", value: clean };
  }

  return null;
}

function isPiAgentQuery(text) {
  const clean = String(text ?? "").trim().toLowerCase();
  const keywords = [
    "排查", "故障", "为什么", "怎么", "如何", "标准", "门限", "命令", "命令模式",
    "los", "dyinggasp", "dying-gasp", "流氓onu", "流氓", "隔离", "配置", "教程",
    "指南", "专家", "pi", "agent", "助手", "请问", "问：", "问:"
  ];
  return keywords.some((kw) => clean.includes(kw));
}

function createWecomProductionRuntime({
  gateway,
  piAgentEngine = null,
  getSecret,
  wsFactory = null,
  now = () => new Date().toISOString()
}) {
  let ws = null;
  let statusState = "stopped";
  let lastError = null;
  let pingTimer = null;
  let reconnectTimer = null;
  let activeBotId = null;
  let activeSecret = null;
  let welcomeEnabled = true;
  let currentDatasetRevision = null;
  let shouldReconnect = false;

  function setStatus(nextState, error = null) {
    statusState = nextState;
    if (error) {
      lastError = String(error.message || error);
    } else if (nextState === "connected") {
      lastError = null;
    }
  }

  function sendJson(payload) {
    if (!ws || ws.readyState !== 1) { // 1 = OPEN
      return false;
    }
    ws.send(JSON.stringify(payload));
    return true;
  }

  const userSessions = new Map();
  const SESSION_TTL_MS = 15 * 60 * 1000;

  function getSession(senderId) {
    if (!senderId) return null;
    const s = userSessions.get(senderId);
    if (!s) return null;
    if (Date.now() - s.updatedAt > SESSION_TTL_MS) {
      userSessions.delete(senderId);
      return null;
    }
    return s;
  }

  function setSession(senderId, patch) {
    if (!senderId) return;
    const cur = getSession(senderId) || {};
    userSessions.set(senderId, {
      ...cur,
      ...patch,
      updatedAt: Date.now()
    });
  }

  async function handleMessageCallback(event) {
    const reqId = event.headers?.req_id || generateReqId();
    const body = event.body || {};
    const textContent = body.text?.content?.trim() || "";
    const senderId = String(body.from?.user_id || body.chat_id || body.chattype || "default_user");
    const session = getSession(senderId);

    async function getActiveOlts() {
      const olts = await gateway.listOlts();
      return olts.filter((o) => o.enabled !== false);
    }

    async function getActiveOltIds() {
      const olts = await getActiveOlts();
      return olts.map((o) => String(o.oltId || o.id));
    }

    // 辅助：渲染并回复单个用户的完整 ONU 详情
    async function replyUserDetail(user, targetReqId) {
      let liveStatus = {};
      try {
        liveStatus = await gateway.readOnuDetail({ oltId: user.oltId, coordinate: user.onu });
      } catch {
        try {
          liveStatus = await gateway.readOnuStatus({ oltId: user.oltId, coordinate: user.onu });
        } catch {
          liveStatus = { online: false };
        }
      }
      let oltDisplay = user.oltName || user.oltId;
      try {
        const allOlts = await getActiveOlts();
        const targetOlt = allOlts.find((o) => String(o.oltId || o.id) === String(user.oltId));
        if (targetOlt?.ip) {
          oltDisplay = `${targetOlt.ip} (${targetOlt.name || user.oltId})`;
        }
      } catch {}
      const targetUser = {
        name: user.name,
        phone: user.phone || user.mobile,
        address: user.address,
        oltIp: oltDisplay,
        oltId: user.oltId,
        onu: user.onu,
        loid: user.loid,
        deviceNumber: user.deviceNumber,
        coordinate: [user.onu?.chassis, user.onu?.board, user.onu?.pon].filter(Boolean).join("/") + `:${user.onu?.onuId || ""}`
      };
      const detailMd = renderOnuDetailMarkdown({
        user: targetUser,
        coordinate: targetUser.coordinate,
        liveStatus
      });
      setSession(senderId, { lastUser: targetUser, lastCandidates: null });
      sendJson({
        cmd: "aibot_respond_msg",
        headers: { req_id: targetReqId },
        body: {
          msgtype: "markdown",
          markdown: { content: detailMd }
        }
      });
    }

    // 辅助：渲染并回复某个用户的 7 天历史光衰时序
    async function replyUserHistory(targetUser, targetReqId) {
      let history = null;
      if (typeof gateway.readOnuHistoricalOptical === "function") {
        const end = new Date();
        const start = new Date(end.getTime() - 6 * 86400000);
        try {
          history = await gateway.readOnuHistoricalOptical({
            oltId: targetUser.oltId,
            coordinate: targetUser.onu,
            startDate: start.toISOString().slice(0, 10),
            endDate: end.toISOString().slice(0, 10),
            limit: 48
          });
        } catch (remoteError) {
          if (typeof gateway.readOnuHistory === "function") {
            history = await gateway.readOnuHistory({
              oltId: targetUser.oltId,
              coordinate: targetUser.onu,
              days: 7,
              limit: 48
            });
          } else {
            throw remoteError;
          }
        }
      } else if (typeof gateway.readOnuHistory === "function") {
        history = await gateway.readOnuHistory({
          oltId: targetUser.oltId,
          coordinate: targetUser.onu,
          days: 7,
          limit: 48
        });
      }
      const historyMd = renderOnuHistoryMarkdown(targetUser, history || { rows: [] });
      setSession(senderId, { lastUser: targetUser });
      sendJson({
        cmd: "aibot_respond_msg",
        headers: { req_id: targetReqId },
        body: {
          msgtype: "markdown",
          markdown: { content: historyMd }
        }
      });
    }

    // 1. 帮助指引
    if (isHelpText(textContent)) {
      sendJson({
        cmd: "aibot_respond_msg",
        headers: { req_id: reqId },
        body: {
          msgtype: "markdown",
          markdown: { content: renderHelpMarkdown() }
        }
      });
      return;
    }

    // 2. 复制 LOID 指令
    const loidCmd = textContent.toLowerCase().replace(/\s+/g, "");
    if (["loid", "查loid", "复制loid"].includes(loidCmd)) {
      if (session?.lastUser) {
        sendJson({
          cmd: "aibot_respond_msg",
          headers: { req_id: reqId },
          body: {
            msgtype: "markdown",
            markdown: { content: renderLoidCopyText(session.lastUser) }
          }
        });
        return;
      }
      sendJson({
        cmd: "aibot_respond_msg",
        headers: { req_id: reqId },
        body: {
          msgtype: "markdown",
          markdown: { content: "💡 请先查询某个具体用户（例如输入 `田金水`），再回复 `LOID` 进行提取。" }
        }
      });
      return;
    }

    // 3. 历史光衰追溯
    const isHistoryKeyword = /历史光衰|历史记录|光衰趋势|历史/.test(textContent);
    if (isHistoryKeyword && !isPiAgentQuery(textContent)) {
      const cleanHistoryCmd = textContent.replace(/历史光衰|历史记录|光衰趋势|历史/g, "").trim();
      if (!cleanHistoryCmd) {
        // 无参“历史”：基于上下文
        if (session?.lastUser) {
          try {
            await replyUserHistory(session.lastUser, reqId);
            return;
          } catch (err) {
            sendJson({
              cmd: "aibot_respond_msg",
              headers: { req_id: reqId },
              body: {
                msgtype: "markdown",
                markdown: { content: `⚠️ 读取历史光功率失败：${err.message || "服务暂不可用"}` }
              }
            });
            return;
          }
        }
        sendJson({
          cmd: "aibot_respond_msg",
          headers: { req_id: reqId },
          body: {
            msgtype: "markdown",
            markdown: { content: "💡 请先查询某个具体用户（例如输入 `田金水`），或直接输入 `历史 田金水` 进行追溯。" }
          }
        });
        return;
      }
      // 显式带参“历史 [关键词]”
      try {
        const oltIds = await getActiveOltIds();
        const { result } = await searchUsersByOrder(cleanHistoryCmd, oltIds);
        const cands = result?.candidates || [];
        if (cands.length === 1) {
          await replyUserHistory(cands[0], reqId);
          return;
        }
        if (cands.length > 1) {
          sendJson({
            cmd: "aibot_respond_msg",
            headers: { req_id: reqId },
            body: {
              msgtype: "markdown",
              markdown: { content: `🔍 匹配到 ${cands.length} 户名为【${cleanHistoryCmd}】的用户，请先输入更详细的姓名或手机号精准定位。` }
            }
          });
          return;
        }
        sendJson({
          cmd: "aibot_respond_msg",
          headers: { req_id: reqId },
          body: {
            msgtype: "markdown",
            markdown: { content: `未找到与【${cleanHistoryCmd}】相关的用户，无法调取历史光衰。` }
          }
        });
        return;
      } catch (err) {
        sendJson({
          cmd: "aibot_respond_msg",
          headers: { req_id: reqId },
          body: {
            msgtype: "markdown",
            markdown: { content: `查询历史光衰发生异常：${err.message || "未知错误"}` }
          }
        });
        return;
      }
    }

    // 4. 整口态势（基于上下文查看所属 PON 口）
    const ponStatusKeywords = ["整口", "所属pon", "pon状态", "整口态势", "查看pon", "端口态势"];
    if (ponStatusKeywords.includes(textContent.replace(/\s+/g, ""))) {
      if (session?.lastUser && session.lastUser.onu) {
        try {
          const oltIds = await getActiveOltIds();
          const allOlts = await getActiveOlts();
          const targetOlt = allOlts.find((o) => String(o.oltId || o.id) === String(session.lastUser.oltId));
          const oltIp = targetOlt?.ip || targetOlt?.host || session.lastUser.oltIp;
          const statusRes = await gateway.readPonStatusesByIp({
            oltIp,
            board: session.lastUser.onu.board,
            pon: session.lastUser.onu.pon,
            oltIds
          });
          const md = renderPonStatusMarkdown({
            oltIp,
            board: session.lastUser.onu.board,
            pon: session.lastUser.onu.pon,
            areaName: statusRes.address || session.lastUser.address || "",
            onCount: statusRes.onCount,
            offCount: statusRes.offCount,
            total: statusRes.total,
            onuerList: statusRes.onuerList || [],
            sort: "power"
          });
          sendJson({
            cmd: "aibot_respond_msg",
            headers: { req_id: reqId },
            body: {
              msgtype: "markdown",
              markdown: { content: md }
            }
          });
          return;
        } catch (err) {
          sendJson({
            cmd: "aibot_respond_msg",
            headers: { req_id: reqId },
            body: {
              msgtype: "markdown",
              markdown: { content: `读取所属 PON 口态势失败：${err.message || "未知错误"}` }
            }
          });
          return;
        }
      }
      sendJson({
        cmd: "aibot_respond_msg",
        headers: { req_id: reqId },
        body: {
          msgtype: "markdown",
          markdown: { content: "💡 请先查询某个用户（例如输入 `田金水`），或直接输入 PON 坐标（例如 `104.101 8/5`）。" }
        }
      });
      return;
    }

    // 5. 候选人翻页指令（下页 / 上页 / 第X页）
    if (session?.lastCandidates && session.lastCandidates.length > 0) {
      const pageMatch = textContent.match(/^(?:下页|下一页|下)$/i) ? (session.lastCandidatesPage || 1) + 1
        : textContent.match(/^(?:上页|上一页|上)$/i) ? Math.max(1, (session.lastCandidatesPage || 1) - 1)
        : textContent.match(/^第\s*(\d+)\s*页$/) ? Number(textContent.match(/^第\s*(\d+)\s*页$/)[1])
        : null;
      if (pageMatch !== null) {
        const pageSize = 5;
        const total = session.lastCandidateTotal || session.lastCandidates.length;
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        const targetPage = Math.max(1, Math.min(pageMatch, totalPages));
        setSession(senderId, { lastCandidatesPage: targetPage });
        const candMd = renderCandidatesMarkdown(session.lastCandidates, total, targetPage, pageSize);
        sendJson({
          cmd: "aibot_respond_msg",
          headers: { req_id: reqId },
          body: {
            msgtype: "markdown",
            markdown: { content: candMd }
          }
        });
        return;
      }
    }

    // 6. 数字序号选单（支持选 PON 端口或选具体用户）
    const numMatch = textContent.match(/^(?:选|查看|查|第)?\s*(\d+)\s*(?:个|条|户|号|口)?$/);
    if (numMatch) {
      const seq = Number(numMatch[1]);
      if (session?.lastPonCandidates && session.lastPonCandidates.length > 0) {
        if (seq >= 1 && seq <= session.lastPonCandidates.length) {
          const selectedPon = session.lastPonCandidates[seq - 1];
          try {
            const oltIds = await getActiveOltIds();
            const allOlts = await getActiveOlts();
            const targetOlt = allOlts.find((o) => String(o.oltId || o.id) === String(selectedPon.oltId));
            const oltIp = targetOlt?.ip || targetOlt?.host || selectedPon.oltIp || selectedPon.oltName || selectedPon.oltId;
            const statusRes = await gateway.readPonStatusesByIp({
              oltIp,
              board: selectedPon.pon.board,
              pon: selectedPon.pon.pon,
              oltIds
            });
            const md = renderPonStatusMarkdown({
              oltIp,
              board: selectedPon.pon.board,
              pon: selectedPon.pon.pon,
              areaName: selectedPon.addresses?.join(" / ") || selectedPon.address || "",
              onCount: statusRes.onCount,
              offCount: statusRes.offCount,
              total: statusRes.total,
              onuerList: statusRes.onuerList || [],
              sort: "power"
            });
            setSession(senderId, {
              lastPon: { oltIp, board: selectedPon.pon.board, pon: selectedPon.pon.pon }
            });
            sendJson({
              cmd: "aibot_respond_msg",
              headers: { req_id: reqId },
              body: {
                msgtype: "markdown",
                markdown: { content: md }
              }
            });
            return;
          } catch (err) {
            sendJson({
              cmd: "aibot_respond_msg",
              headers: { req_id: reqId },
              body: {
                msgtype: "markdown",
                markdown: { content: `读取 PON 端口详情失败：${err.message || "未知错误"}` }
              }
            });
            return;
          }
        }
      } else if (session?.lastCandidates && session.lastCandidates.length > 0) {
        if (seq >= 1 && seq <= session.lastCandidates.length) {
          const selectedCandidate = session.lastCandidates[seq - 1];
          try {
            await replyUserDetail(selectedCandidate, reqId);
            return;
          } catch (err) {
            sendJson({
              cmd: "aibot_respond_msg",
              headers: { req_id: reqId },
              body: {
                msgtype: "markdown",
                markdown: { content: `读取序号 ${seq} 的详情失败：${err.message || "未知错误"}` }
              }
            });
            return;
          }
        }
      }
    }

    // 7. 村级所有 PON 口抢修验收定界
    const village = extractVillageName(textContent);
    if (village && typeof gateway.queryVillagePons === "function") {
      try {
        const oltIds = await getActiveOltIds();
        const firstPage = await gateway.queryVillagePons({ value: village, oltIds, offset: 0 });
        if (!firstPage || firstPage.total === 0) {
          sendJson({
            cmd: "aibot_respond_msg",
            headers: { req_id: reqId },
            body: {
              msgtype: "markdown",
              markdown: { content: `未查询到与【${village}】相关的有效 PON 口台账，请核对村名是否准确。` }
            }
          });
          return;
        }

        const degradedPons = [];
        let completed = 0;
        for (const candidate of firstPage.candidates) {
          try {
            const sampling = await gateway.sampleVillagePonOnlineUser({
              village,
              oltIds,
              oltId: candidate.oltId,
              pon: candidate.pon
            });
            if (sampling && sampling.comparison) {
              completed += 1;
              const currentRx = sampling.comparison.current;
              const diff = sampling.comparison.rawDifference;
              if (Number.isFinite(diff) && diff <= -2.0) {
                degradedPons.push({
                  oltIp: candidate.oltName || candidate.oltId,
                  slot: candidate.pon.board,
                  pon: candidate.pon.pon,
                  currentRx,
                  delta: diff,
                  area: candidate.address || village
                });
              }
            } else if (sampling && sampling.status === "no-history") {
              completed += 1;
            }
          } catch {
            // 单个 PON 口异常隔离，继续统计其余
          }
        }

        const reportMd = renderVillageReportMarkdown(village, {
          totalPons: firstPage.total,
          completeCount: completed,
          degradedPons
        });

        sendJson({
          cmd: "aibot_respond_msg",
          headers: { req_id: reqId },
          body: {
            msgtype: "markdown",
            markdown: { content: reportMd }
          }
        });
        return;
      } catch (err) {
        sendJson({
          cmd: "aibot_respond_msg",
          headers: { req_id: reqId },
          body: {
            msgtype: "markdown",
            markdown: { content: `村级抢修定界分析发生异常：${err.message || "未知错误"}` }
          }
        });
        return;
      }
    }

    // 8. 显式 IP + PON 端口状态与排序模式
    const ipPon = extractIpAndPon(textContent);
    if (ipPon && typeof gateway.readPonStatusesByIp === "function") {
      try {
        const oltIds = await getActiveOltIds();
        const sortMode = textContent.includes("序号") ? "onu" : "power";
        const statusRes = await gateway.readPonStatusesByIp({
          oltIp: ipPon.oltIp,
          board: ipPon.board,
          pon: ipPon.pon,
          oltIds
        });
        const md = renderPonStatusMarkdown({
          oltIp: ipPon.oltIp,
          board: ipPon.board,
          pon: ipPon.pon,
          areaName: statusRes.address || "",
          onCount: statusRes.onCount,
          offCount: statusRes.offCount,
          total: statusRes.total,
          onuerList: statusRes.onuerList || [],
          sort: sortMode
        });
        sendJson({
          cmd: "aibot_respond_msg",
          headers: { req_id: reqId },
          body: {
            msgtype: "markdown",
            markdown: { content: md }
          }
        });
        return;
      } catch (err) {
        sendJson({
          cmd: "aibot_respond_msg",
          headers: { req_id: reqId },
          body: {
            msgtype: "markdown",
            markdown: { content: `PON 端口查询失败：${err.message || "未知错误"}` }
          }
        });
        return;
      }
    }

    // 9. 一级地址反查 PON 端口（智能优先）：解决“输入一级地址搜索到的却是用户地址”的问题
    const explicitUserPrefix = textContent.match(/^(?:用户|查人|客户|查客户)\s*(.+)$/i);
    const isExplicitUser = Boolean(explicitUserPrefix);
    const explicitPonPrefix = textContent.match(/^(?:pon|查pon|一级地址|查口|端口|光交箱|光交)\s*(.+)$/i);
    const isExplicitPon = Boolean(explicitPonPrefix);
    const cleanedSearchTarget = explicitUserPrefix ? explicitUserPrefix[1].trim()
      : explicitPonPrefix ? explicitPonPrefix[1].trim()
      : textContent;

    // 当非显式查人、且网关支持 queryPons 时，针对具备地址/地名特征的文本优先反查 PON 口
    const hasAddressTrait = isExplicitPon ||
      /^[\u4e00-\u9fff]{2,}[\u4e00-\u9fffA-Za-z0-9０-９#\-－_（）()]*(?:村|路|街|巷|小区|花园|公寓|广场|市场|学校|厂|栋|幢|座|号|光交箱|楼)$/u.test(cleanedSearchTarget) ||
      (cleanedSearchTarget.length >= 2 && !/^\d+$/.test(cleanedSearchTarget) && !/^[A-Za-z0-9_-]+$/.test(cleanedSearchTarget));

    if (!isExplicitUser && hasAddressTrait && typeof gateway.queryPons === "function") {
      try {
        const oltIds = await getActiveOltIds();
        const ponRes = await gateway.queryPons({ value: cleanedSearchTarget, oltIds, limit: 20 });
        const ponCandidates = ponRes?.candidates || [];
        if (ponCandidates.length > 0) {
          // 聚合相同 OLT 和 PON 端口，去重并合并一级地址信息
          const allOlts = await getActiveOlts();
          const oltMap = new Map(allOlts.map((o) => [String(o.oltId || o.id), o]));
          const ponMap = new Map();
          for (const cand of ponCandidates) {
            const olt = oltMap.get(String(cand.oltId));
            const oltIp = olt?.ip || olt?.host || cand.oltName || cand.oltId;
            const key = `${oltIp}:${cand.pon?.board}/${cand.pon?.pon}`;
            if (ponMap.has(key)) {
              const existing = ponMap.get(key);
              if (cand.address && !existing.addresses.includes(cand.address)) {
                existing.addresses.push(cand.address);
              }
            } else {
              ponMap.set(key, {
                ...cand,
                oltIp,
                addresses: cand.address ? [cand.address] : []
              });
            }
          }
          const aggregatedPons = [...ponMap.values()];

          // 若聚合后仅 1 个 PON 端口，直接展示整口态势
          if (aggregatedPons.length === 1) {
            const p = aggregatedPons[0];
            const statusRes = await gateway.readPonStatusesByIp({
              oltIp: p.oltIp,
              board: p.pon.board,
              pon: p.pon.pon,
              oltIds
            });
            const md = renderPonStatusMarkdown({
              oltIp: p.oltIp,
              board: p.pon.board,
              pon: p.pon.pon,
              areaName: p.addresses.join(" / ") || p.address || cleanedSearchTarget,
              onCount: statusRes.onCount,
              offCount: statusRes.offCount,
              total: statusRes.total,
              onuerList: statusRes.onuerList || [],
              sort: "power"
            });
            setSession(senderId, {
              lastPon: { oltIp: p.oltIp, board: p.pon.board, pon: p.pon.pon }
            });
            sendJson({
              cmd: "aibot_respond_msg",
              headers: { req_id: reqId },
              body: {
                msgtype: "markdown",
                markdown: { content: md }
              }
            });
            return;
          }

          // 若聚合后有多个 PON 端口，展示候选端口列表，并缓存以供回复数字序号直接秒开
          setSession(senderId, {
            lastPonCandidates: aggregatedPons,
            lastCandidates: null
          });
          const listMd = renderPonCandidateListMarkdown(aggregatedPons, cleanedSearchTarget, true);
          sendJson({
            cmd: "aibot_respond_msg",
            headers: { req_id: reqId },
            body: {
              msgtype: "markdown",
              markdown: { content: listMd }
            }
          });
          return;
        }
      } catch {
        // 一级地址查询异常，平滑回退到查用户台账
      }
    }

    // 10. 台账用户多维查单（对齐飞书递进查询行为）
    const ORDERED_SEARCH_INTENTS = [
      "find_by_name",
      "find_by_phone",
      "find_by_loid",
      "find_by_device_number",
      "find_by_onu_coordinate",
      "find_by_sn",
      "find_by_mac",
      "find_by_address"
    ];

    async function searchUsersByOrder(val, scopedOltIds) {
      const resolved = resolveUserQueryIntent(val);
      if (resolved) {
        try {
          let r;
          if (resolved.intent === "find_by_device_number" && typeof gateway.queryUsersByDeviceNumber === "function") {
            r = await gateway.queryUsersByDeviceNumber({ value: resolved.value, oltIds: scopedOltIds, limit: 50 });
          } else {
            r = await gateway.queryUsers({ intent: resolved.intent, value: resolved.value, oltIds: scopedOltIds, limit: 50 });
          }
          if (r?.authorizedCount > 0) return { result: r, intent: resolved.intent };
        } catch {
          // ignore and fallback
        }
      }

      for (const intent of ORDERED_SEARCH_INTENTS) {
        if (resolved && intent === resolved.intent) continue;
        try {
          let r;
          if (intent === "find_by_device_number") {
            if (typeof gateway.queryUsersByDeviceNumber !== "function") continue;
            r = await gateway.queryUsersByDeviceNumber({ value: val, oltIds: scopedOltIds, limit: 50 });
          } else {
            r = await gateway.queryUsers({ intent, value: val, oltIds: scopedOltIds, limit: 50 });
          }
          if (r?.authorizedCount > 0) return { result: r, intent };
        } catch {
          // ignore and try next
        }
      }
      return { result: { authorizedCount: 0, candidates: [] }, intent: "find_by_name" };
    }

    if (typeof gateway.queryUsers === "function") {
      try {
        const oltIds = await getActiveOltIds();
        const { result: userResult } = await searchUsersByOrder(cleanedSearchTarget, oltIds);
        const candidates = userResult?.candidates || [];

        // 单户精准命中
        if (candidates.length === 1) {
          await replyUserDetail(candidates[0], reqId);
          return;
        }

        // 多户命中展示候选列表（保存至会话上下文供数字序号秒开）
        if (candidates.length > 1) {
          let enriched = candidates;
          try {
            const allOlts = await getActiveOlts();
            const oltMap = new Map(allOlts.map((o) => [String(o.oltId || o.id), o]));
            enriched = candidates.map((item) => {
              const olt = oltMap.get(String(item.oltId));
              return {
                ...item,
                oltIp: olt?.ip || item.oltName || item.oltId
              };
            });
          } catch {}

          setSession(senderId, {
            lastCandidates: enriched,
            lastCandidateTotal: userResult.authorizedCount,
            lastCandidatesPage: 1,
            lastPonCandidates: null
          });

          const candMd = renderCandidatesMarkdown(enriched, userResult.authorizedCount, 1, 5);
          sendJson({
            cmd: "aibot_respond_msg",
            headers: { req_id: reqId },
            body: {
              msgtype: "markdown",
              markdown: { content: candMd }
            }
          });
          return;
        }
      } catch {
        // 查询遇错降级
      }
    }

    // 11. Pi Agent 排障专家支持（仅在包含排障意图或技术咨询关键词时进入）
    if (isPiAgentQuery(textContent) && piAgentEngine && typeof piAgentEngine.chat === "function") {
      try {
        const answer = await piAgentEngine.chat({
          messages: [{ role: "user", content: textContent }]
        });
        if (answer && answer.reply) {
          sendJson({
            cmd: "aibot_respond_msg",
            headers: { req_id: reqId },
            body: {
              msgtype: "markdown",
              markdown: { content: renderPiAgentAnswerMarkdown(textContent, answer.reply) }
            }
          });
          return;
        }
      } catch {
        // Pi Agent 降级
      }
    }

    // 12. 无匹配兜底：给出友好提示和操作指引（绝不向大模型报“条件不足”）
    sendJson({
      cmd: "aibot_respond_msg",
      headers: { req_id: reqId },
      body: {
        msgtype: "markdown",
        markdown: {
          content: [
            `### ❓ 未匹配到相关台账记录或指令`,
            "",
            `已检索姓名、手机号、LOID、设备号、坐标及装机地址，未找到与【${textContent}】相关的台账。`,
            "",
            "请核对输入的信息是否准确。您可以输入：",
            "- 姓名（如 `田金水`）",
            "- 地址或村名关键词（如 `坑口`、`三屯`）",
            "- 11 位手机号（如 `13543733008`）",
            "- PON 端口与所属地址（如 `104.101 8/5`）",
            "- 村级抢修定界（如 `双岗村所有pon口`）",
            "- 历史光衰追溯（如 `历史 田金水`）",
            "- 或回复 `帮助` 查看完整实战指南。"
          ].join("\n")
        }
      }
    });
  }

  function handleEventCallback(event) {
    const reqId = event.headers?.req_id || generateReqId();
    const body = event.body || {};
    const eventType = body.event?.eventtype;

    if (eventType === "enter_chat") {
      if (welcomeEnabled) {
        sendJson({
          cmd: "aibot_respond_welcome_msg",
          headers: { req_id: reqId },
          body: {
            msgtype: "text",
            text: { content: renderWelcomeText() }
          }
        });
      }
    } else if (eventType === "disconnected_event") {
      setStatus("disconnected", new Error("连接已被新建立的长连接取代踢下线"));
      shouldReconnect = false;
      cleanup();
    }
  }

  function bindListener(target, event, handler) {
    if (typeof target.addEventListener === "function") {
      target.addEventListener(event, handler);
    } else if (typeof target.on === "function") {
      target.on(event, handler);
    } else {
      target[`on${event}`] = handler;
    }
  }

  function cleanup() {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
    if (ws) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      ws = null;
    }
  }

  function scheduleReconnect() {
    if (!shouldReconnect || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (shouldReconnect && activeBotId && activeSecret) {
        connect().catch(() => {});
      }
    }, 5000);
    if (reconnectTimer && typeof reconnectTimer.unref === "function") {
      reconnectTimer.unref();
    }
  }

  async function connect() {
    cleanup();
    setStatus("connecting");

    const createWs = typeof wsFactory === "function"
      ? wsFactory
      : (url) => {
          const WsClass = getWebSocketConstructor();
          return new WsClass(url);
        };
    const endpoint = "wss://openws.work.weixin.qq.com";

    try {
      ws = createWs(endpoint);
    } catch (err) {
      setStatus("faulted", err);
      scheduleReconnect();
      return;
    }

    const onOpenHandler = () => {
      const reqId = generateReqId();
      sendJson({
        cmd: "aibot_subscribe",
        headers: { req_id: reqId },
        body: {
          bot_id: activeBotId,
          secret: activeSecret
        }
      });
    };

    const onMessageHandler = (raw) => {
      let rawText;
      if (typeof raw === "string") {
        rawText = raw;
      } else if (raw && typeof raw.data !== "undefined") {
        rawText = typeof raw.data === "string" ? raw.data : raw.data?.toString?.();
      } else if (typeof Buffer !== "undefined" && (Buffer.isBuffer(raw) || raw instanceof Uint8Array)) {
        rawText = raw.toString();
      } else {
        rawText = String(raw ?? "");
      }
      let data;
      try {
        data = JSON.parse(rawText);
      } catch {
        return;
      }

      if (data.errcode !== undefined) {
        // 订阅响应
        if (data.errcode === 0) {
          setStatus("connected");
          // 启动 30 秒心跳保活
          if (pingTimer) clearInterval(pingTimer);
          pingTimer = setInterval(() => {
            if (ws && ws.readyState === 1) {
              try {
                if (typeof ws.ping === "function") {
                  ws.ping();
                } else {
                  sendJson({ cmd: "ping", headers: { req_id: generateReqId() } });
                }
              } catch {
                /* ignore */
              }
            }
          }, 30000);
          if (pingTimer && typeof pingTimer.unref === "function") {
            pingTimer.unref();
          }
        } else {
          setStatus("faulted", new Error(`WeCom 订阅失败：[${data.errcode}] ${data.errmsg || "身份凭证校验不通过"}`));
        }
        return;
      }

      const cmd = data.cmd;
      if (cmd === "aibot_event_callback") {
        handleEventCallback(data);
      } else if (cmd === "aibot_msg_callback") {
        handleMessageCallback(data).catch(() => {});
      }
    };

    const onErrorHandler = (err) => {
      if (statusState !== "disconnected") {
        setStatus("faulted", err || new Error("WebSocket 通信故障"));
      }
    };

    const onCloseHandler = () => {
      if (statusState === "connected" || statusState === "connecting") {
        setStatus("stopped");
      }
      cleanup();
      scheduleReconnect();
    };

    bindListener(ws, "open", onOpenHandler);
    bindListener(ws, "message", onMessageHandler);
    bindListener(ws, "error", onErrorHandler);
    bindListener(ws, "close", onCloseHandler);
  }

  return Object.freeze({
    async start(options = {}) {
      activeBotId = options.botId;
      welcomeEnabled = options.welcomeEnabled !== false;
      currentDatasetRevision = options.datasetRevision || null;

      if (!activeBotId) {
        throw new Error("WeCom 智能机器人 BotID 不能为空");
      }

      let secret = options.secret;
      if (!secret && typeof getSecret === "function" && options.credentialReference) {
        secret = await getSecret(options.credentialReference);
      }
      if (!secret) {
        throw new Error("WeCom 智能机器人 Secret 不能为空");
      }
      activeSecret = secret;
      shouldReconnect = true;

      await connect();
      return this.status();
    },

    async stop() {
      shouldReconnect = false;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      cleanup();
      setStatus("stopped");
      return this.status();
    },

    status() {
      return {
        state: statusState,
        lastError,
        datasetRevision: currentDatasetRevision,
        checkedAt: now()
      };
    },

    // 仅供自动化单元测试注入与事件驱动验证
    _dispatchForTesting(event) {
      if (event.cmd === "aibot_event_callback") {
        handleEventCallback(event);
      } else if (event.cmd === "aibot_msg_callback") {
        return handleMessageCallback(event);
      }
    }
  });
}

module.exports = {
  createWecomProductionRuntime
};
