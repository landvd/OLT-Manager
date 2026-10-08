/**
 * 合并 ONU 属性比对冲突诊断与处置指引模型
 * 提供冲突成因剖析、容错策略说明、针对性修改建议与具体操作指南
 */

export const CONFLICT_REASON_GUIDE = Object.freeze({
  network_coordinate_duplicate: {
    key: "network_coordinate_duplicate",
    label: "二期物理坐标重复",
    tagType: "success",
    severity: "已自愈",
    summary: "同一 OLT 物理端口在网管二期出现多条记录，系统已全自动择优合并",
    cause: "常见于一线装维换机、业务热割接或不同批次批量导入后，网管二期旧设备未及时注销，导致新旧设备占用同一物理端口。",
    tolerance: "系统在数据融合时，自动对比了重复记录的在网发光状态、在线状态及最新时间戳，已【自动择优保留】在网活跃记录，其余冲突记录未落入主台账，确保巡检不报虚假故障。",
    suggestion: "系统已全自动完成智能去重保留，零人工介入。无需人工手动处理。",
    actionMethods: [
      {
        step: 1,
        title: "系统自主感知",
        content: "自动识别同一物理端口（框/槽/PON/ONU_ID）下的多条并存设备记录。"
      },
      {
        step: 2,
        title: "通光特征比对",
        content: "自动提取现场实际发光与注册的在网设备特征，比对在线状态与时间戳。"
      },
      {
        step: 3,
        title: "自愈择优落库",
        content: "保留在网活跃终端，自动过滤掉已拆机或停用残留，保障主台账纯净。"
      },
      {
        step: 4,
        title: "巡检平滑就绪",
        content: "该端口数据已完全对齐，巡检全流程正常运作，无需人工登录网管注销。"
      }
    ]
  },
  network_coordinate_unparseable: {
    key: "network_coordinate_unparseable",
    label: "二期非标坐标格式",
    tagType: "success",
    severity: "已自愈",
    summary: "中兴复合坐标与非标端口格式，系统已自动兼容解析",
    cause: "二期网管中部分设备采用中兴复合命名（如 1/1-1-9/3:3、1/1-1-3/6:28）或将 LOID 拼接在坐标后。",
    tolerance: "系统已启用智能坐标容错引擎，优先使用明确物理维度字段并兼容中兴机架/框/槽/PON复合坐标，已成功解析入库。",
    suggestion: "系统已全自动完成自适应解析与绑定，零人工介入。无需人工手动修改。",
    actionMethods: [
      {
        step: 1,
        title: "多维自适应切分",
        content: "规则引擎自动识别中兴复合坐标中的机架、框、槽位、PON 口与 ONU 编号。"
      },
      {
        step: 2,
        title: "规范坐标归一化",
        content: "将非标命名转换为标准框/槽/PON:ID 坐标系，完成与主台账的物理端口绑定。"
      },
      {
        step: 3,
        title: "数据平滑落库",
        content: "设备信息完整合入数据库，支持光衰巡检与通光研判。"
      }
    ]
  },
  nmse_loid_duplicate: {
    key: "nmse_loid_duplicate",
    label: "一期 BOSS LOID 重复",
    tagType: "success",
    severity: "已自愈",
    summary: "一期 NMSE 库同一 LOID 关联多条历史工单，系统已多维智能裁决",
    cause: "宽带用户过户、拆机新装或装维换机导致 BOSS 业务库留存多条历史宽带工单。",
    tolerance: "系统已启用多维特征评分与坐标共振智能仲裁引擎：综合物理坐标同频（+100分）、11位有效手机号（+20分）、二期姓名交叉印证（+25分）及销户/停机负向词过滤（-50分）自动做出最优裁决，成功绑定真实机主。",
    suggestion: "系统已全自动完成仲裁入库，零人工介入。无需登录 BOSS 后台解绑。",
    actionMethods: [
      {
        step: 1,
        title: "系统自主感知",
        content: "自动检索该 LOID 对应的全部历史工单候选与业务数据。"
      },
      {
        step: 2,
        title: "多维评分裁决",
        content: "对比二期在线设备物理坐标，自动过滤“销户/拆机/停机”无效记录，按实名与手机号打分。"
      },
      {
        step: 3,
        title: "黄金档案落库",
        content: "自动选取评分最高的在网机主姓名、手机号及详细装机地址合入台账。"
      },
      {
        step: 4,
        title: "审计归档",
        content: "记录仲裁策略日志，保障数据全生命周期可追溯，无需人工登录后台解绑。"
      }
    ]
  },
  nmse_coordinate_ambiguous: {
    key: "nmse_coordinate_ambiguous",
    label: "BOSS 坐标歧义",
    tagType: "success",
    severity: "已自愈",
    summary: "坐标对应多条业务记录，系统已坐标共振智能裁决",
    cause: "当网管二期缺少 LOID 时，该物理端口在 BOSS 历史库中曾关联过多张工单。",
    tolerance: "系统通过物理端口同频、有效联系电话及在网状态自主选拔最优记录，已自动完成合并。",
    suggestion: "系统已全自动完成裁决并采纳最优数据，无需人工介入。",
    actionMethods: [
      {
        step: 1,
        title: "物理坐标共振",
        content: "锁定当前通光的 OLT 与 PON 端口，过滤历史异地迁移工单。"
      },
      {
        step: 2,
        title: "资料丰度择优",
        content: "优先选取具备有效联系电话与详细门牌地址的真实机主。"
      },
      {
        step: 3,
        title: "自动关联生效",
        content: "更新本地合并台账，无需人工介入。"
      }
    ]
  },
  nmse_username_missing: {
    key: "nmse_username_missing",
    label: "BOSS 用户姓名缺失",
    tagType: "success",
    severity: "已自愈",
    summary: "NMSE 未登记客户姓名，系统已自动保留网管二期设备姓名",
    cause: "部分专线、测试账号、公用 Wi-Fi 或批量免开户账号未录入具体的客户姓名与安装地址。",
    tolerance: "系统自动平滑容错：自动沿用网管二期中的设备名称或机房别名，不影响任何光衰巡检与通光质量研判。",
    suggestion: "系统已自动平滑保留设备姓名，无需人工干预。",
    actionMethods: [
      {
        step: 1,
        title: "自动平滑继承",
        content: "保留网管二期的原生设备名称，确保台账不产生空缺。"
      },
      {
        step: 2,
        title: "巡检正常运转",
        content: "系统自动依据物理坐标开展通光验收与弱光排查。"
      }
    ]
  },
  nmse_unassignable: {
    key: "nmse_unassignable",
    label: "业务记录无法归属",
    tagType: "info",
    severity: "已忽略",
    summary: "NMSE 历史业务记录缺少 LOID 与坐标，系统已安全过滤",
    cause: "BOSS 历史数据库中留存的不完整死档或作废测试账号。",
    tolerance: "系统安全过滤，不将其混入现网活跃设备，不影响现网正常使用。",
    suggestion: "系统已自动安全剔除无效死档，无需人工干预。",
    actionMethods: [
      {
        step: 1,
        title: "智能过滤隔离",
        content: "自动拦截缺少必要凭据的历史无效数据，保障主库纯洁性。"
      }
    ]
  }
});

const DEFAULT_GUIDE = Object.freeze({
  key: "unknown",
  label: "其他属性差异",
  tagType: "info",
  severity: "低",
  summary: "两端系统字段存在部分不一致，已按系统安全规则容错",
  cause: "一期 BOSS 与二期网管在历史演变中存在部分字段差异。",
  tolerance: "系统已默认保留当前可用数据，不影响系统核心功能。",
  suggestion: "关注明细数据并根据业务需要决定是否手动纠正。",
  actionMethods: [
    {
      step: 1,
      title: "查看详情",
      content: "核对明细中的 OLT IP 与 LOID，按实际业务需要决定是否更新。"
    }
  ]
});

/**
 * 获取指定冲突类型的处置指引
 */
export function getConflictGuide(reason = "") {
  const key = String(reason || "").trim();
  return CONFLICT_REASON_GUIDE[key] || DEFAULT_GUIDE;
}

/**
 * 汇总冲突行列表的分类统计
 */
export function summarizeConflicts(rows = []) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const counts = {};
  for (const row of safeRows) {
    const key = row.reason || "unknown";
    counts[key] = (counts[key] || 0) + 1;
  }
  return {
    total: safeRows.length,
    counts,
    categories: Object.keys(counts).map((key) => ({
      key,
      count: counts[key],
      guide: getConflictGuide(key)
    })).sort((a, b) => b.count - a.count)
  };
}

/**
 * 过滤冲突列表
 */
export function filterConflictRows(rows = [], { reason = "", keyword = "", oltIp = "" } = {}) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const targetReason = String(reason || "").trim();
  const kw = String(keyword || "").trim().toLowerCase();
  const targetOlt = String(oltIp || "").trim();

  return safeRows.filter((row) => {
    if (targetReason && targetReason !== "all" && row.reason !== targetReason) return false;
    if (targetOlt && row.oltIp !== targetOlt) return false;
    if (kw) {
      const matchLoid = String(row.loid || "").toLowerCase().includes(kw);
      const matchIp = String(row.oltIp || "").toLowerCase().includes(kw);
      const matchIndex = String(row.onuIndexDisplay || "").toLowerCase().includes(kw);
      const matchDetail = String(row.detail || "").toLowerCase().includes(kw);
      if (!matchLoid && !matchIp && !matchIndex && !matchDetail) return false;
    }
    return true;
  });
}
