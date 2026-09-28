/**
 * 合并 ONU 属性比对冲突诊断与处置指引模型
 * 提供冲突成因剖析、容错策略说明、针对性修改建议与具体操作指南
 */

export const CONFLICT_REASON_GUIDE = Object.freeze({
  network_coordinate_duplicate: {
    key: "network_coordinate_duplicate",
    label: "二期物理坐标重复",
    tagType: "danger",
    severity: "高",
    summary: "同一 OLT 物理端口（框/槽/PON/ONU_ID）在网管二期中出现多条重复记录",
    cause: "常见于一线装维换机、业务热割接或不同批次批量导入后，旧设备在网管二期中未正常拆机注销，导致新旧两台 ONU 占用同一个物理位置。",
    tolerance: "系统在数据融合时，自动对比了重复记录的 LOID、序列号及更新时间，已【自动择优保留】包含有效业务凭据与最新时间戳的活跃记录，其余冲突记录未落入主台账，确保巡检不报虚假故障。",
    suggestion: "核对重复记录中哪一台是当前现场正在使用的设备，登录网管二期清理注销已拆机的废弃残留记录。",
    actionMethods: [
      {
        step: 1,
        title: "定位重复设备",
        content: "复制表格中的 OLT IP 与物理端口（如 1/1/5:4），登录网管二期资源管理平台，在‘ONU 资源查询’中搜索该物理端口。"
      },
      {
        step: 2,
        title: "核对在线真实 SN",
        content: "在软件【ONU 状态】或通过内置终端查看该 PON 口下实际注册在线的 MAC / SN，确认哪一台是现场正在发光的在网终端。"
      },
      {
        step: 3,
        title: "二期下线废弃记录",
        content: "在网管二期中，将另一台已停用、未注册或属于历史工单的废弃 ONU 记录执行‘设备注销’或‘释放端口’。"
      },
      {
        step: 4,
        title: "重新执行数据同步",
        content: "完成二期清理后，回到本软件点击【全量融合同步】，该端口冲突将自动消除。"
      }
    ]
  },
  network_coordinate_unparseable: {
    key: "network_coordinate_unparseable",
    label: "二期坐标无法解析",
    tagType: "warning",
    severity: "中",
    summary: "网管二期该 ONU 记录中的物理位置格式非标，缺少标准机框/板卡/PON/ONU_ID",
    cause: "设备在网管二期录入时未绑定具体的物理板卡或端口，或者使用了特殊自定义字符串命名（例如 '1/1-1-5/4:DG...'），导致规则引擎无法自动切分出框槽端口。",
    tolerance: "系统暂时跳过物理端口比对，通过 LOID 尝试与一期 BOSS 业务数据做业务层软关联；若 LOID 匹配成功则保留业务档案，但暂不具备精准物理端口绑定。",
    suggestion: "在网管二期中规范该 ONU 的端口绑定，或在软件本地台账中手动补充标准 PON 端口号。",
    actionMethods: [
      {
        step: 1,
        title: "查看该条异常记录",
        content: "复制该记录的 LOID，在网管二期中检索该 ONU 的详细卡片，查看其‘所属机架/框/槽/端口’字段。"
      },
      {
        step: 2,
        title: "规范物理端口绑定",
        content: "在网管二期资源树上，将该 ONU 拖拽或关联至正确的 GPON 业务板卡端口下（如 1/9/3），保存资源属性。"
      },
      {
        step: 3,
        title: "快捷矫正方式",
        content: "若二期网管暂时无法修改，可直接在【台账管理】中通过 Excel 模板录入该 LOID 对应的标准 OLT IP 与 PON 端口（如 1/9/3:3），导入后本地台账即可直接生效。"
      }
    ]
  },
  nmse_loid_duplicate: {
    key: "nmse_loid_duplicate",
    label: "一期 BOSS LOID 重复",
    tagType: "warning",
    severity: "中",
    summary: "同一 LOID 在一期 NMSE BOSS 业务库中对应了多个用户或多张历史工单",
    cause: "宽带用户过户、拆机重新开户、或装维人员在施工时将同一 LOID 录入到了多个不同宽带账号的工单中，导致 BOSS 业务库出现‘一号多主’。",
    tolerance: "系统秉持‘不盲目猜测用户真实姓名’的原则，若无法判定哪一条属于当前有效生效订单，系统保留网管二期设备上原有的用户名或标记冲突，防止将他人的敏感个人信息错误覆盖。",
    suggestion: "在 BOSS 计费运维后台检索该 LOID，清理或解绑已销户但未回收的历史无效工单。",
    actionMethods: [
      {
        step: 1,
        title: "复制冲突 LOID",
        content: "点击表格中的【复制 LOID】，登录 BOSS 营业/计费管理后台。"
      },
      {
        step: 2,
        title: "检索关联账号",
        content: "在 BOSS 业务台账中按 LOID 搜索，查看当前绑定的全部宽带账号及其订单状态（如‘在网正常’、‘欠费拆机’、‘历史过户’）。"
      },
      {
        step: 3,
        title: "释放解绑旧账号",
        content: "将已销户或历史工单中的 LOID 绑定关系清空或修改，确保该 LOID 在 BOSS 库中仅唯一绑定当前实际交费使用的宽带账号。"
      },
      {
        step: 4,
        title: "同步一期增量",
        content: "在软件中点击【同步一期增量】或【全量融合】，系统将自动采用最新的唯一用户姓名刷新台账。"
      }
    ]
  },
  nmse_coordinate_ambiguous: {
    key: "nmse_coordinate_ambiguous",
    label: "BOSS 坐标歧义未决",
    tagType: "info",
    severity: "低",
    summary: "网络行缺少 LOID，且该物理坐标在 BOSS 中关联了多条历史账号，无法安全回退",
    cause: "当网管二期缺少 LOID 时，系统尝试按物理端口（OLT IP + PON 坐标）去匹配 BOSS 记录，但 BOSS 该端口下历史曾安装过多户且未明确标识当前在网账号。",
    tolerance: "为防止将历史租客或搬迁用户的姓名错配到现网设备，系统不猜测姓名，仅保留网络原生数据。",
    suggestion: "优先在终端侧或网管二期中配置该设备的真实 LOID，有了 LOID 后系统将立刻实现 100% 精准匹配。",
    actionMethods: [
      {
        step: 1,
        title: "核对终端真实 LOID",
        content: "装维人员现场查看光猫背贴或登录光猫管理后台（192.168.1.1），获取设备下发的真实 LOID。"
      },
      {
        step: 2,
        title: "补填 LOID",
        content: "在网管二期录入该 LOID，或在软件【ONU 设备列表】中找到该物理坐标，编辑并填入 LOID。"
      }
    ]
  },
  nmse_username_missing: {
    key: "nmse_username_missing",
    label: "BOSS 用户姓名缺失",
    tagType: "info",
    severity: "低",
    summary: "NMSE BOSS 业务匹配成功，但该业务行未登记用户姓名或联系方式",
    cause: "部分专线、测试账号、公用 Wi-Fi 或批量免开户账号在 BOSS 系统立项时未录入具体的客户姓名与安装地址。",
    tolerance: "系统自动平滑容错：自动沿用网管二期中的设备名称或机房别名，不影响任何光衰巡检与通光质量研判。",
    suggestion: "如需在巡检报告和飞书通知中展示具体联系人，可在本地台账补充客户姓名，或在 BOSS 系统补齐资料。",
    actionMethods: [
      {
        step: 1,
        title: "在台账中补齐",
        content: "在软件【ONU 设备列表】或【台账管理】中，搜索该 LOID，直接在行内或详情中编辑补充‘用户姓名’与‘安装地址’。"
      },
      {
        step: 2,
        title: "批量导入更新",
        content: "若缺失较多，可点击【导出台账 Excel】，在表格中批量补充‘用户姓名’和‘地址’列后重新导入。"
      }
    ]
  },
  nmse_unassignable: {
    key: "nmse_unassignable",
    label: "业务记录无法归属",
    tagType: "info",
    severity: "低",
    summary: "NMSE BOSS 用户记录中既无 LOID 也无有效物理坐标",
    cause: "BOSS 历史数据库中留存的不完整死档或作废测试账号。",
    tolerance: "系统安全过滤，不将其混入现网活跃设备。",
    suggestion: "BOSS 业务系统定期清理历史无效垃圾数据，不影响现网正常使用。",
    actionMethods: [
      {
        step: 1,
        title: "检查 BOSS 原始记录",
        content: "在 BOSS 导出台账中查找缺少 LOID 和坐标的空行，将其从数据源中剔除。"
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
