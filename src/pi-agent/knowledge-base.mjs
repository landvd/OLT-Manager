/**
 * Pi Agent 厂商/型号/版本命令知识库
 * 涵盖 ZTE C300 (ROS), ZTE C600 (TITAN), Huawei MA5800 现场验证的 CLI 语法与避坑指南
 */

export const OLT_KNOWLEDGE_BASE = [
  // ==========================================
  // ZTE C300 (ROS 架构, 如 V1.2.5, V2.1.0)
  // ==========================================
  {
    id: "zte-c300-enter-config",
    vendor: "zte",
    model: "zte-c300",
    category: "view_navigation",
    title: "进入全局配置模式",
    command: "configure terminal",
    alias: ["con t", "conf t", "进入配置模式"],
    view: "enable",
    description: "从特权模式进入全局配置模式，C300 支持缩写 con t",
    readOnly: true,
    verified: true
  },
  {
    id: "zte-c300-card-status",
    vendor: "zte",
    model: "zte-c300",
    category: "board_status",
    title: "查看机框板卡状态",
    command: "show card",
    alias: ["板卡状态", "槽位状态", "查看板卡"],
    view: "any",
    description: "查看槽位板卡在线状态、型号及主备状态（如 GTGO, GTGH, SCXN 等）",
    readOnly: true,
    verified: true
  },
  {
    id: "zte-c300-uncfg-onu",
    vendor: "zte",
    model: "zte-c300",
    category: "unregistered_onu",
    title: "查看未注册未配置 ONU",
    command: "show gpon onu uncfg",
    alias: ["show gpon uncfg-onu", "未注册", "未配置", "autofind"],
    view: "any",
    description: "查询 PON 口下发现但尚未绑定的未配置 ONU，显示 SN、MAC 及所在 PON 坐标",
    readOnly: true,
    verified: true
  },
  {
    id: "zte-c300-onu-state",
    vendor: "zte",
    model: "zte-c300",
    category: "onu_running_status",
    title: "查看 PON 口下所有 ONU 在线相位与状态",
    command: "show gpon onu state gpon-olt_1/{slot}/{pon}",
    alias: ["在线状态", "onu状态", "phase state", "离线原因"],
    view: "any",
    description: "查看指定 PON 口（如 gpon-olt_1/2/5）下所有 ONU 的 Admin State, OMCC State, Phase State 与最近离线原因",
    readOnly: true,
    verified: true
  },
  {
    id: "zte-c300-optical-power-port",
    vendor: "zte",
    model: "zte-c300",
    category: "optical_power",
    title: "查看整 PON 口下所有 ONU 接收光功率",
    command: "show pon power onu-rx gpon-olt_1/{slot}/{pon}",
    alias: ["整口收光", "整口光功率", "所有onu收光", "查光"],
    view: "any",
    description: "读取指定 PON 口（如 gpon-olt_1/2/5）下所有在线 ONU 的实时接收光功率 (dBm)，严禁敲不存在的 optical-info",
    readOnly: true,
    verified: true
  },
  {
    id: "zte-c300-optical-power-single",
    vendor: "zte",
    model: "zte-c300",
    category: "optical_power",
    title: "查看单台 ONU 接收光功率",
    command: "show pon power onu-rx gpon-onu_1/{slot}/{pon}:{onuId}",
    alias: ["收光", "单台收光", "onu收光"],
    view: "any",
    description: "读取指定单台 ONU 的实时接收光功率 (dBm)，正常范围通常在 -8 dBm 至 -27 dBm 之间",
    readOnly: true,
    verified: true
  },
  {
    id: "zte-c300-pon-power-attenuation",
    vendor: "zte",
    model: "zte-c300",
    category: "optical_power",
    title: "查看单台 ONU 双向光衰与收发光",
    command: "show pon power attenuation gpon-onu_1/{slot}/{pon}:{onuId}",
    alias: ["光衰", "衰耗", "attenuation", "线路衰减"],
    view: "any",
    description: "读取指定 ONU 的上行/下行实际传输衰耗 (dB) 以及 OLT 与 ONU 的双向发射/接收光功率明细",
    readOnly: true,
    verified: true
  },
  {
    id: "zte-c300-pon-power-olt-rx",
    vendor: "zte",
    model: "zte-c300",
    category: "optical_power",
    title: "查看 OLT 侧接收所有 ONU 的上行光功率",
    command: "show pon power olt-rx gpon-olt_1/{slot}/{pon}",
    alias: ["olt收光", "olt接收光", "上行光功率"],
    view: "any",
    description: "读取 OLT 端口接收到的该 PON 口下各 ONU 发射的上行光功率",
    readOnly: true,
    verified: true
  },
  {
    id: "zte-c300-pon-power-tx",
    vendor: "zte",
    model: "zte-c300",
    category: "optical_power",
    title: "查看 OLT PON 口发射光功率",
    command: "show pon power olt-tx gpon-olt_1/{slot}/{pon}",
    alias: ["olt发光", "pon口发光", "pon发光"],
    view: "any",
    description: "读取 OLT PON 光模块发光功率，GPON Class B+ 正常约为 +1.5 ~ +5 dBm，C+ 正常约为 +3 ~ +7 dBm",
    readOnly: true,
    verified: true
  },
  {
    id: "zte-c300-onu-detail",
    vendor: "zte",
    model: "zte-c300",
    category: "optical_power",
    title: "查看 ONU 详细信息与光模块数据",
    command: "show gpon onu detail-info gpon-onu_1/{slot}/{pon}:{onuId}",
    alias: ["onu详情", "光模块数据", "电压温度"],
    view: "any",
    description: "查看指定 ONU 测距距离、发光功率、收光功率、供电电压、偏置电流及工作温度",
    readOnly: true,
    verified: true
  },
  {
    id: "zte-c300-offline-reason",
    vendor: "zte",
    model: "zte-c300",
    category: "onu_running_status",
    title: "查看 ONU 离线原因",
    command: "show gpon onu detail-info gpon-onu_1/{slot}/{pon}:{onuId}",
    alias: ["离线原因", "掉线原因", "下线原因", "dyinggasp"],
    view: "any",
    description: "在输出的 Offline Reason 字段查看下线原因：DyingGasp 为停电关机，WireDown / LOS 为光路中断或弱光断开",
    readOnly: true,
    verified: true
  },
  {
    id: "zte-c300-onu-distance",
    vendor: "zte",
    model: "zte-c300",
    category: "onu_running_status",
    title: "查看 PON 口下所有 ONU 测距距离",
    command: "show gpon onu distance gpon-olt_1/{slot}/{pon}",
    alias: ["测距", "光纤距离", "光缆长度"],
    view: "any",
    description: "读取指定 PON 口下所有已注册 ONU 的均衡测距距离（单位：米）",
    readOnly: true,
    verified: true
  },
  {
    id: "zte-c300-pon-traffic",
    vendor: "zte",
    model: "zte-c300",
    category: "traffic_bandwidth",
    title: "查看 PON 端口实时流量与报文统计",
    command: "show interface gpon-olt_1/{slot}/{pon}",
    alias: ["端口流量", "流量", "带宽", "丢包", "crc"],
    view: "any",
    description: "查看 PON 端口收发字节数、速率、广播包数量及丢包 CRC 校验统计",
    readOnly: true,
    verified: true
  },
  {
    id: "zte-c300-uplink-status",
    vendor: "zte",
    model: "zte-c300",
    category: "uplink_network",
    title: "查看上联以太口运行状态与速率",
    command: "show interface gei_{slot}/{board}/{port}",
    alias: ["上联口", "万兆上联", "千兆口", "uplink"],
    view: "any",
    description: "查看上联板千兆口 (gei) 或万兆口 (xgei) 的链路协商、双工、收发光及端口流量",
    readOnly: true,
    verified: true
  },
  {
    id: "zte-c300-mac-table",
    vendor: "zte",
    model: "zte-c300",
    category: "mac_learning",
    title: "查看指定 VLAN 学习到的 MAC 地址",
    command: "show mac vlan {vlan}",
    alias: ["mac地址", "学mac", "查mac"],
    view: "any",
    description: "查询特定业务 VLAN 下所有已学习到的用户终端 MAC 地址及对应的逻辑端口",
    readOnly: true,
    verified: true
  },
  {
    id: "zte-c300-interface-config",
    vendor: "zte",
    model: "zte-c300",
    category: "interface_config",
    title: "查看接口运行配置",
    command: "show running-config interface gpon-onu_{slot}/{board}/{pon}:{onuId}",
    alias: ["查看配置", "show run"],
    view: "any",
    description: "C300 支持在任意视图直接打印特定接口的配置文本",
    readOnly: true,
    verified: true
  },
  {
    id: "zte-c300-service-port",
    vendor: "zte",
    model: "zte-c300",
    category: "vlan_service",
    title: "全局业务流 service-port 模式",
    command: "service-port {index} vport 1 user-vlan {vlan} vlan {vlan}",
    alias: ["业务流", "打标", "service-port"],
    view: "configure terminal",
    description: "C300 采用全局 service-port 打标映射业务 VLAN",
    readOnly: false,
    verified: true
  },
  {
    id: "zte-c300-system-health",
    vendor: "zte",
    model: "zte-c300",
    category: "system_health",
    title: "查看系统 CPU 与内存利用率",
    command: "show processor",
    alias: ["cpu", "内存", "show memory", "资源占用"],
    view: "any",
    description: "查看主控板 (SCXN/SCXL) CPU 使用负荷，配对命令为 show memory 查看内存余量",
    readOnly: true,
    verified: true
  },
  {
    id: "zte-c300-current-alarm",
    vendor: "zte",
    model: "zte-c300",
    category: "alarm_log",
    title: "查看当前活动设备告警",
    command: "show alarm current",
    alias: ["告警", "当前告警", "设备告警"],
    view: "any",
    description: "列出当前 OLT 处于未恢复状态的板卡、端口、光衰或链路告警列表",
    readOnly: true,
    verified: true
  },
  {
    id: "zte-c300-rogue-onu",
    vendor: "zte",
    model: "zte-c300",
    category: "rogue_onu",
    title: "检测流氓 ONU（连续常发光 ONT）",
    command: "show gpon rogue-onu",
    alias: ["流氓onu", "长发光", "常发光", "干扰onu"],
    view: "any",
    description: "查看当前 PON 口下是否存在非授权连续常发光干扰其他正常 ONU 通信的故障设备",
    readOnly: true,
    verified: true
  },
  {
    id: "zte-c300-version",
    vendor: "zte",
    model: "zte-c300",
    category: "firmware_version",
    title: "查看设备软件版本与主控状态",
    command: "show version",
    alias: ["软件版本", "系统版本", "固件版本"],
    view: "any",
    description: "查看 C300 ROS 系统内核版本、主控板型号及运行时间",
    readOnly: true,
    verified: true
  },
  {
    id: "zte-c300-igmp-group",
    vendor: "zte",
    model: "zte-c300",
    category: "iptv_multicast",
    title: "查看 IPTV 在线活跃组播组与电视频道",
    command: "show igmp group",
    alias: ["iptv组播", "组播组", "电视拉流", "直播频道"],
    view: "any",
    description: "查看当前 OLT 上正在播放的所有 IPTV 组播组 IP、上联接收端口及加入成员数量",
    readOnly: true,
    verified: true
  },
  {
    id: "zte-c300-igmp-user",
    vendor: "zte",
    model: "zte-c300",
    category: "iptv_multicast",
    title: "查看单台 ONU 的 IPTV 组播用户拉流状态",
    command: "show igmp user gpon-onu_1/{slot}/{pon}:{onuId}",
    alias: ["用户组播", "电视状态", "单台iptv"],
    view: "any",
    description: "检查指定 ONU（如客房机顶盒）当前所看的电视直播频道、组播组 IP、加入时间与权限",
    readOnly: true,
    verified: true
  },
  {
    id: "zte-c300-service-port-onu",
    vendor: "zte",
    model: "zte-c300",
    category: "vlan_service",
    title: "查看指定 ONU 的所有业务流打标映射",
    command: "show service-port gpon-onu_1/{slot}/{pon}:{onuId}",
    alias: ["业务流", "打标查询", "service-port", "专线打标"],
    view: "any",
    description: "列出指定 ONU 绑定的全部 service-port 索引、用户 VLAN (CVLAN)、上联 VLAN (SVLAN) 及优先级",
    readOnly: true,
    verified: true
  },
  {
    id: "zte-c300-mac-onu",
    vendor: "zte",
    model: "zte-c300",
    category: "mac_learning",
    title: "查看指定 ONU 学习到的用户 MAC 地址",
    command: "show mac gpon-onu_1/{slot}/{pon}:{onuId}",
    alias: ["查mac", "用户mac", "专线mac", "mac地址"],
    view: "any",
    description: "查看指定 ONU 各网口下挂主机、路由器或交换机上报的真实 MAC 地址与所在 VLAN",
    readOnly: true,
    verified: true
  },

  // ==========================================
  // ZTE C600 (TITAN 架构, 如 V2.0.10, V2.1.0)
  // ==========================================
  {
    id: "zte-c600-enter-config",
    vendor: "zte",
    model: "zte-c600",
    category: "view_navigation",
    title: "进入全局配置模式（全写）",
    command: "configure terminal",
    alias: ["con t", "conf t", "进入配置模式"],
    view: "enable",
    description: "【注意避坑】C600 键入 con t 会报 %Error 140301: Ambiguous command，必须全拼 configure terminal",
    readOnly: true,
    verified: true
  },
  {
    id: "zte-c600-card-status",
    vendor: "zte",
    model: "zte-c600",
    category: "board_status",
    title: "查看机框板卡状态",
    command: "show card",
    alias: ["板卡状态", "查看板卡", "槽位状态"],
    view: "any",
    description: "TITAN 架构查看板卡（如 GFGH, GFGM, SFUL 等 XGPON/GPON 板卡）状态与就绪阶段",
    readOnly: true,
    verified: true
  },
  {
    id: "zte-c600-uncfg-onu",
    vendor: "zte",
    model: "zte-c600",
    category: "unregistered_onu",
    title: "查看未配置发现的 ONU",
    command: "show gpon uncfg-onu",
    alias: ["show gpon onu uncfg", "未注册", "未配置", "autofind"],
    view: "any",
    description: "【注意避坑】C600 推荐语法为 show gpon uncfg-onu，同时兼容 show gpon onu uncfg，输出含真实槽位与 PON 坐标",
    readOnly: true,
    verified: true
  },
  {
    id: "zte-c600-olt-interface-name",
    vendor: "zte",
    model: "zte-c600",
    category: "interface_naming",
    title: "C600 OLT 端口下划线反转命名",
    command: "interface gpon_olt-{slot}/{board}/{pon}",
    alias: ["olt接口", "gpon_olt", "端口命名"],
    view: "configure terminal",
    description: "【重大避坑】C600 接口名称为 gpon_olt-（下划线在前连字符在后），输成 gpon-olt_ 报 Ambiguous",
    readOnly: false,
    verified: true
  },
  {
    id: "zte-c600-onu-interface-name",
    vendor: "zte",
    model: "zte-c600",
    category: "interface_naming",
    title: "C600 ONU 接口下划线反转命名",
    command: "interface gpon_onu-{slot}/{board}/{pon}:{onuId}",
    alias: ["onu接口", "gpon_onu", "onu视图"],
    view: "configure terminal",
    description: "【重大避坑】C600 ONU 接口为 gpon_onu-（下划线在前），必须全写 interface 进入配置视图",
    readOnly: false,
    verified: true
  },
  {
    id: "zte-c600-vport-mode",
    vendor: "zte",
    model: "zte-c600",
    category: "vlan_service",
    title: "C600 废除全局 service-port，采用 vport-mode manual",
    command: "vport-mode manual",
    alias: ["vport", "打标", "废除service-port"],
    view: "interface gpon_onu-...",
    description: "【重大避坑】C600 彻底废除了全局 service-port，改为在 ONU 接口下敲 vport-mode manual 后敲 vport-map 打标",
    readOnly: false,
    verified: true
  },
  {
    id: "zte-c600-veip-mode",
    vendor: "zte",
    model: "zte-c600",
    category: "vlan_service",
    title: "C600 VEIP / 以太网 vport-map 打标",
    command: "vport-map 1 1 vlan {vlan}",
    alias: ["vport-map", "veip", "vlan映射"],
    view: "interface gpon_onu-...",
    description: "在 ONU 视图下将用户业务 VLAN 映射到虚端口 vport 1，支持 VEIP 模式和多以太网口模式",
    readOnly: false,
    verified: true
  },
  {
    id: "zte-c600-show-this",
    vendor: "zte",
    model: "zte-c600",
    category: "view_navigation",
    title: "C600 废弃跨视图打印，查看配置必须使用 show this",
    command: "show this",
    alias: ["查看当前配置", "show this", "查看接口"],
    view: "interface gpon_onu-...",
    description: "【重大避坑】C600 不支持在全局打印特定 interface 配置，必须先进入接口视图后敲 show this 查看",
    readOnly: true,
    verified: true
  },
  {
    id: "zte-c600-optical-power",
    vendor: "zte",
    model: "zte-c600",
    category: "optical_power",
    title: "查看单个 ONU 接收光功率",
    command: "show pon power onu-rx gpon_onu-{slot}/{board}/{pon}:{onuId}",
    alias: ["收光", "光衰", "光功率", "查光"],
    view: "any",
    description: "注意接口命名为 gpon_onu-，读取当前光纤收光功率 (dBm)，正常范围为 -8 ~ -27 dBm",
    readOnly: true,
    verified: true
  },
  {
    id: "zte-c600-pon-power-tx",
    vendor: "zte",
    model: "zte-c600",
    category: "optical_power",
    title: "查看 C600 PON 端口发光功率",
    command: "show pon power olt-tx gpon_olt-{slot}/{board}/{pon}",
    alias: ["olt发光", "pon发光", "发光功率"],
    view: "any",
    description: "查看 C600 PON 口自身光模块输出光功率，GPON/XGPON 端口通常在 +2 ~ +7 dBm",
    readOnly: true,
    verified: true
  },
  {
    id: "zte-c600-pon-power-rx-all",
    vendor: "zte",
    model: "zte-c600",
    category: "optical_power",
    title: "查看 PON 口下所有 ONU 的 OLT 侧接收光功率",
    command: "show pon power olt-rx gpon_olt-{slot}/{board}/{pon}",
    alias: ["所有光功率", "批量查光", "全口收光"],
    view: "any",
    description: "在 PON 端口维度一次性列出该端口下所有在线 ONU 发送到 OLT 的光功率列表",
    readOnly: true,
    verified: true
  },
  {
    id: "zte-c600-onu-state-all",
    vendor: "zte",
    model: "zte-c600",
    category: "onu_running_status",
    title: "查看 PON 口下所有 ONU 运行状态与相位",
    command: "show gpon onu state gpon_olt-{slot}/{board}/{pon}",
    alias: ["onu状态", "在线列表", "working", "phase state"],
    view: "any",
    description: "列出该 PON 口全部已注册 ONU 的在线状态（working, logging, off 等）与 OMCC 通信状态",
    readOnly: true,
    verified: true
  },
  {
    id: "zte-c600-onu-detail",
    vendor: "zte",
    model: "zte-c600",
    category: "onu_running_status",
    title: "查看 ONU 详细信息与离线原因",
    command: "show gpon onu detail-info gpon_onu-{slot}/{board}/{pon}:{onuId}",
    alias: ["onu详情", "离线原因", "硬件版本", "loid"],
    view: "any",
    description: "查看 ONU 的硬件型号、SN、LOID、测距距离、协商速率及 Offline Reason（如 dying-gasp 掉电 / los 掉纤）",
    readOnly: true,
    verified: true
  },
  {
    id: "zte-c600-onu-distance",
    vendor: "zte",
    model: "zte-c600",
    category: "onu_running_status",
    title: "查看 PON 端口所有 ONU 测距数据",
    command: "show gpon onu distance gpon_olt-{slot}/{board}/{pon}",
    alias: ["测距", "光缆距离", "光纤长度"],
    view: "any",
    description: "读取 TITAN 端口下所有在线 ONU 的精确测距距离（单位：米）",
    readOnly: true,
    verified: true
  },
  {
    id: "zte-c600-traffic-stats",
    vendor: "zte",
    model: "zte-c600",
    category: "traffic_bandwidth",
    title: "查看 C600 PON 端口收发吞吐量与丢包",
    command: "show interface gpon_olt-{slot}/{board}/{pon}",
    alias: ["端口流量", "流量", "带宽", "丢包", "crc"],
    view: "any",
    description: "查看 C600 PON 端口入向/出向速率、带宽利用率、多播/单播包及 CRC 错包统计",
    readOnly: true,
    verified: true
  },
  {
    id: "zte-c600-uplink-traffic",
    vendor: "zte",
    model: "zte-c600",
    category: "uplink_network",
    title: "查看万兆上联口流量与协商状态",
    command: "show interface xgei-{slot}/{board}/{port}",
    alias: ["万兆上联", "上联口", "xgei", "10ge"],
    view: "any",
    description: "查看 TITAN 上联主控或交换板万兆口 (xgei) 状态、光模块收发光及链路丢包",
    readOnly: true,
    verified: true
  },
  {
    id: "zte-c600-mac-vlan",
    vendor: "zte",
    model: "zte-c600",
    category: "mac_learning",
    title: "查看 C600 VLAN 学习到的终端 MAC",
    command: "show mac vlan {vlan}",
    alias: ["mac地址", "学mac", "查mac"],
    view: "any",
    description: "查看指定业务 VLAN 内学习到的用户 MAC 地址及其绑定的逻辑虚端口",
    readOnly: true,
    verified: true
  },
  {
    id: "zte-c600-system-health",
    vendor: "zte",
    model: "zte-c600",
    category: "system_health",
    title: "查看 TITAN 分布式 CPU 与内存负荷",
    command: "show processor",
    alias: ["cpu", "内存", "show memory", "负荷"],
    view: "any",
    description: "查看 C600 主控板及分布式线卡 CPU 使用率，并可通过 show memory 查看各板卡内存余量",
    readOnly: true,
    verified: true
  },
  {
    id: "zte-c600-environment",
    vendor: "zte",
    model: "zte-c600",
    category: "system_health",
    title: "查看机框温度与风扇转速",
    command: "show environment temperature",
    alias: ["温度", "风扇", "温控", "fan"],
    view: "any",
    description: "查看机框进风口、各板卡芯片实时温度及风扇箱工作转速级别",
    readOnly: true,
    verified: true
  },
  {
    id: "zte-c600-current-alarm",
    vendor: "zte",
    model: "zte-c600",
    category: "alarm_log",
    title: "查看 C600 当前未消除活动告警",
    command: "show alarm current",
    alias: ["当前告警", "活动告警", "设备告警"],
    view: "any",
    description: "查看 C600 机框、板卡、端口、弱光或掉电等未恢复告警列表",
    readOnly: true,
    verified: true
  },
  {
    id: "zte-c600-rogue-onu",
    vendor: "zte",
    model: "zte-c600",
    category: "rogue_onu",
    title: "查看 C600 流氓 ONU 诊断与隔离",
    command: "show gpon rogue-onu",
    alias: ["流氓onu", "长发光", "常发光", "干扰onu"],
    view: "any",
    description: "查看 C600 是否检测到长发光 ONT，TITAN 支持硬件级时隙检测并自动抑制流氓发光",
    readOnly: true,
    verified: true
  },
  {
    id: "zte-c600-version",
    vendor: "zte",
    model: "zte-c600",
    category: "firmware_version",
    title: "查看 TITAN 软件版本与主备卡同步",
    command: "show version",
    alias: ["系统版本", "固件版本", "主备同步"],
    view: "any",
    description: "查看 C600 TITAN 操作系统版本号、编译时间及主备控制板同步状态",
    readOnly: true,
    verified: true
  },
  {
    id: "zte-c600-igmp-group",
    vendor: "zte",
    model: "zte-c600",
    category: "iptv_multicast",
    title: "查看 C600 IPTV 在线活跃组播组",
    command: "show igmp group",
    alias: ["iptv组播", "组播组", "c600电视"],
    view: "any",
    description: "查看 C600 TITAN 平台当前活跃的组播组频道与下发端口",
    readOnly: true,
    verified: true
  },
  {
    id: "zte-c600-igmp-user",
    vendor: "zte",
    model: "zte-c600",
    category: "iptv_multicast",
    title: "查看 C600 指定 ONU 的 IPTV 组播用户状态",
    command: "show igmp user gpon_onu-1/{slot}/{pon}:{onuId}",
    alias: ["用户组播", "电视状态", "单台iptv"],
    view: "any",
    description: "查看 C600 下指定 ONU 当前正在拉取的组播电视频道与流速",
    readOnly: true,
    verified: true
  },
  {
    id: "zte-c600-mac-onu",
    vendor: "zte",
    model: "zte-c600",
    category: "mac_learning",
    title: "查看 C600 指定 ONU 学习到的用户 MAC 地址",
    command: "show mac gpon_onu-1/{slot}/{pon}:{onuId}",
    alias: ["查mac", "用户mac", "专线mac"],
    view: "any",
    description: "查看 C600 接口下挂设备上报的真实 MAC 地址表",
    readOnly: true,
    verified: true
  },
  {
    id: "zte-c600-show-this",
    vendor: "zte",
    model: "zte-c600",
    category: "interface_config",
    title: "查看 C600 当前接口全部业务配置 (show this)",
    command: "show this",
    alias: ["show this", "查看当前配置", "当前接口配置"],
    view: "interface",
    description: "【注意避坑】C600 严禁跨视图查询接口配置，必须先进入 interface gpon_onu-1/x/y:id 视图后再执行 show this",
    readOnly: true,
    verified: true
  },

  // ==========================================
  // Huawei MA5800 (如 V800R018, V800R019)
  // ==========================================
  {
    id: "huawei-ma5800-enter-config",
    vendor: "huawei",
    model: "huawei-ma5800",
    category: "view_navigation",
    title: "进入系统配置视图",
    command: "config",
    alias: ["system-view", "进入配置模式"],
    view: "user",
    description: "从用户视图进入配置视图，终端提示符变为 (config)#",
    readOnly: true,
    verified: true
  },
  {
    id: "huawei-ma5800-board-status",
    vendor: "huawei",
    model: "huawei-ma5800",
    category: "board_status",
    title: "查看板卡在位与主备状态",
    command: "display board 0",
    alias: ["板卡状态", "单板状态", "查看板卡"],
    view: "any",
    description: "查看 0 号框所有板卡（如 H901GPHF, H902MPLA 等）状态、主备及在线情况",
    readOnly: true,
    verified: true
  },
  {
    id: "huawei-ma5800-autofind",
    vendor: "huawei",
    model: "huawei-ma5800",
    category: "unregistered_onu",
    title: "查看未注册自动发现 ONT",
    command: "display ont autofind all",
    alias: ["未注册", "autofind", "未配置", "新发现"],
    view: "any",
    description: "查看全局自动发现的未注册 ONT 列表，输出框/槽/端口、原始十六进制 SN 及厂商标识",
    readOnly: true,
    verified: true
  },
  {
    id: "huawei-ma5800-sn-auth",
    vendor: "huawei",
    model: "huawei-ma5800",
    category: "authentication",
    title: "华为 SN 认证必须使用原始 16 进制 SN",
    command: "ont add {pon} {ontId} sn-auth {hexSn} omci ont-lineprofile-id {lineId} ont-srvprofile-id {srvId}",
    alias: ["sn认证", "添加ont", "绑定sn"],
    view: "interface gpon 0/{slot}",
    description: "【重大避坑】Huawei ont add 的 sn-auth 必须使用原始十六进制 SN（如 5A544547030C0914），而不是括号内的字符串 ZTEG-030C0914",
    readOnly: false,
    verified: true
  },
  {
    id: "huawei-ma5800-optical-info",
    vendor: "huawei",
    model: "huawei-ma5800",
    category: "optical_power",
    title: "查看 ONT 光功率与诊断参数",
    command: "display ont optical-info 0/{slot} {pon} {ontId}",
    alias: ["收光", "光衰", "光功率", "查光"],
    view: "any",
    description: "查看 Rx optical power (dBm), Tx optical power (dBm), OLT Rx ONT optical power (dBm) 以及偏置电流和工作温度",
    readOnly: true,
    verified: true
  },
  {
    id: "huawei-ma5800-optical-info-all",
    vendor: "huawei",
    model: "huawei-ma5800",
    category: "optical_power",
    title: "批量查看 PON 端口下所有 ONT 光功率",
    command: "display ont optical-info 0/{slot} {pon} all",
    alias: ["所有光功率", "批量查光", "全口收光"],
    view: "any",
    description: "一次性打印指定 PON 口下全部在线 ONT 的收光、发光及 OLT 接收光功率",
    readOnly: true,
    verified: true
  },
  {
    id: "huawei-ma5800-port-optical-info",
    vendor: "huawei",
    model: "huawei-ma5800",
    category: "optical_power",
    title: "查看华为 OLT PON 端口自身发光",
    command: "display port optical-info 0/{slot}/{pon}",
    alias: ["pon发光", "olt发光", "端口发光"],
    view: "any",
    description: "查看 OLT 侧 PON 光模块自身发射功率（正常约 +2 ~ +5 dBm）、波长及工作偏置电流",
    readOnly: true,
    verified: true
  },
  {
    id: "huawei-ma5800-ont-info",
    vendor: "huawei",
    model: "huawei-ma5800",
    category: "onu_running_status",
    title: "查看已注册 ONT 运行信息与离线原因",
    command: "display ont info 0/{slot} {pon} {ontId}",
    alias: ["ont状态", "离线原因", "在线状态", "dying-gasp"],
    view: "any",
    description: "查看 ONT 的运行状态（online/offline）、配置状态及最后下线原因（如 dying-gasp 掉电 / los 断纤）",
    readOnly: true,
    verified: true
  },
  {
    id: "huawei-ma5800-ont-by-sn",
    vendor: "huawei",
    model: "huawei-ma5800",
    category: "onu_running_status",
    title: "通过 SN 全局精准查找 ONT 坐标",
    command: "display ont info by-sn {hexSn}",
    alias: ["按sn查", "搜sn", "查坐标"],
    view: "any",
    description: "在整台 MA5800 上根据 16 进制 SN 或厂商 SN 快速定位 ONT 所在框、槽、端口及 ONT ID",
    readOnly: true,
    verified: true
  },
  {
    id: "huawei-ma5800-ont-by-loid",
    vendor: "huawei",
    model: "huawei-ma5800",
    category: "onu_running_status",
    title: "通过 LOID 全局精准查找 ONT 坐标",
    command: "display ont info by-loid {loid}",
    alias: ["按loid查", "搜loid", "查宽带账号"],
    view: "any",
    description: "在整台 MA5800 上根据逻辑 LOID 快速检索 ONT 所在框、槽、端口及 ONT ID",
    readOnly: true,
    verified: true
  },
  {
    id: "huawei-ma5800-ont-distance",
    vendor: "huawei",
    model: "huawei-ma5800",
    category: "onu_running_status",
    title: "查看 ONT 测距距离与往返时延",
    command: "display ont distance 0/{slot} {pon} {ontId}",
    alias: ["测距", "光纤长度", "测距离"],
    view: "any",
    description: "读取 ONT 距离 OLT 的实际测距值（米）及光纤回路延迟",
    readOnly: true,
    verified: true
  },
  {
    id: "huawei-ma5800-service-port",
    vendor: "huawei",
    model: "huawei-ma5800",
    category: "vlan_service",
    title: "查看或配置华为 service-port 业务流",
    command: "display service-port port 0/{slot}/{pon} ont {ontId}",
    alias: ["service-port", "业务流", "查看vlan"],
    view: "any",
    description: "查看指定 ONT 绑定的 service-port 业务流、用户侧 VLAN、网络侧 SVLAN 及 GEM Port",
    readOnly: true,
    verified: true
  },
  {
    id: "huawei-ma5800-port-traffic",
    vendor: "huawei",
    model: "huawei-ma5800",
    category: "traffic_bandwidth",
    title: "查看 PON 口实时流量与吞吐速率",
    command: "display port traffic 0/{slot}/{pon}",
    alias: ["端口流量", "流量统计", "吞吐量"],
    view: "any",
    description: "查看 PON 口上行/下行实时数据速率（kbps）、包转发率及广播丢包",
    readOnly: true,
    verified: true
  },
  {
    id: "huawei-ma5800-mac-address",
    vendor: "huawei",
    model: "huawei-ma5800",
    category: "mac_learning",
    title: "查看业务流或端口学到的 MAC 地址",
    command: "display mac-address service-port {servicePortId}",
    alias: ["mac地址", "学mac", "查mac"],
    view: "any",
    description: "查询指定 service-port 业务流学习到的终端用户 MAC 地址（用于核对路由器/电脑是否联网）",
    readOnly: true,
    verified: true
  },
  {
    id: "huawei-ma5800-rogue-ont",
    vendor: "huawei",
    model: "huawei-ma5800",
    category: "rogue_onu",
    title: "查看华为流氓 ONT（常发光设备）",
    command: "display rogue-ont 0/{slot}/{pon}",
    alias: ["流氓ont", "长发光", "干扰ont"],
    view: "any",
    description: "检查 PON 端口是否存在连续常发光、发光漂移或破坏时分复用的流氓故障 ONT",
    readOnly: true,
    verified: true
  },
  {
    id: "huawei-ma5800-system-health",
    vendor: "huawei",
    model: "huawei-ma5800",
    category: "system_health",
    title: "查看华为主控 CPU 与内存利用率",
    command: "display cpu 0",
    alias: ["cpu", "内存", "display memory 0", "负荷"],
    view: "any",
    description: "查看 0 号框主控板 CPU 使用率，配合 display memory 0 查看系统内存分配情况",
    readOnly: true,
    verified: true
  },
  {
    id: "huawei-ma5800-alarm-active",
    vendor: "huawei",
    model: "huawei-ma5800",
    category: "alarm_log",
    title: "查看设备当前活动告警",
    command: "display alarm active all",
    alias: ["当前告警", "活动告警", "故障告警"],
    view: "any",
    description: "查看设备当前全部未恢复的高危、主要及次要告警事件（如断纤、失电、温度过高）",
    readOnly: true,
    verified: true
  },
  {
    id: "huawei-ma5800-version",
    vendor: "huawei",
    model: "huawei-ma5800",
    category: "firmware_version",
    title: "查看设备软件版本与主控板补丁",
    command: "display version",
    alias: ["软件版本", "系统版本", "主控版本"],
    view: "any",
    description: "查看 V800R0xx 软件版本、系统运行时间及主备控制板软件版本号",
    readOnly: true,
    verified: true
  },
  {
    id: "huawei-ma5800-igmp-group",
    vendor: "huawei",
    model: "huawei-ma5800",
    category: "iptv_multicast",
    title: "查看华为 IPTV 在线活跃组播组",
    command: "display igmp group",
    alias: ["iptv组播", "组播组", "华为电视拉流"],
    view: "any",
    description: "查看 MA5800 当前活跃的所有 IPTV 组播频道 IP 与加入成员",
    readOnly: true,
    verified: true
  },
  {
    id: "huawei-ma5800-igmp-user",
    vendor: "huawei",
    model: "huawei-ma5800",
    category: "iptv_multicast",
    title: "查看指定业务流的 IPTV 组播用户加入状态",
    command: "display igmp user service-port {servicePortId}",
    alias: ["组播用户", "单台电视状态", "igmp user"],
    view: "any",
    description: "查看指定 service-port 对应的机顶盒正在播放的电视频道与组播流量",
    readOnly: true,
    verified: true
  },
  {
    id: "huawei-ma5800-ont-config",
    vendor: "huawei",
    model: "huawei-ma5800",
    category: "interface_config",
    title: "查看指定 ONT 的全部已下发业务配置",
    command: "display current-configuration ont 0/{slot}/{pon} {ontId}",
    alias: ["ont配置", "查看配置", "核对配置"],
    view: "any",
    description: "导出并核对指定 ONT 下发的所有 native-vlan、service-port 和 profile 绑定关系",
    readOnly: true,
    verified: true
  },

  // ==========================================
  // 实战排障知识库 (Troubleshooting & Standard Practices)
  // ==========================================
  {
    id: "ts-optical-power-standards",
    vendor: "common",
    model: "common",
    category: "troubleshooting",
    title: "【排障标准】光功率正常门限与弱光整治标准",
    command: "show pon power / display ont optical-info",
    alias: ["光功率标准", "弱光标准", "合格光功率", "光衰标准"],
    view: "all",
    description: "GPON 接收光功率标准：\n- 优秀：-8 dBm ~ -22 dBm\n- 正常：-22 dBm ~ -25 dBm\n- 轻度弱光：-25 dBm ~ -27 dBm（可能偶发丢包）\n- 重度弱光：< -27 dBm（濒临掉线，需熔接或清洁法兰）\n- 光饱和：> -8 dBm（可能损坏接收器，需加光衰）",
    readOnly: true,
    verified: true
  },
  {
    id: "ts-dying-gasp-vs-los",
    vendor: "common",
    model: "common",
    category: "troubleshooting",
    title: "【排障分析】掉电 (DyingGasp) 与断纤 (LOS) 区别",
    command: "show gpon onu detail-info / display ont info",
    alias: ["掉电区别", "断纤区别", "离线分析", "下线原因分析"],
    view: "all",
    description: "离线原因排查铁律：\n- DyingGasp / power-off：用户主动关机、拔电源或家中跳闸停电，线路物理正常，无需上门修纤。\n- LOS (Loss of Signal) / WireDown：光信号丢失，通常为皮线光缆折断、法兰松脱、分光器跳线拔除或光衰严重超标，需要装维上门排查物理光路。",
    readOnly: true,
    verified: true
  },
  {
    id: "ts-rogue-onu-handling",
    vendor: "common",
    model: "common",
    category: "troubleshooting",
    title: "【重大故障】流氓 ONU（连续长发光）排查处置",
    command: "show gpon rogue-onu / display rogue-ont",
    alias: ["流氓onu排查", "常发光故障", "全口掉线", "长发光处理"],
    view: "all",
    description: "现象：某 PON 口下十几台甚至几十台 ONU 突然同时离线或频繁震荡。\n原因：其中一台 ONU 光发射器损坏持续发光，淹没了整个时隙。\n排查处置：\n1. 执行 show gpon rogue-onu 或 display rogue-ont 寻找异常 ONT。\n2. 若无法定位，可在分路器处逐一拔出支路光纤，直至其他 ONU 恢复正常，即可锁定损坏设备并更换。",
    readOnly: true,
    verified: true
  },
  {
    id: "ts-unregistered-cannot-register",
    vendor: "common",
    model: "common",
    category: "troubleshooting",
    title: "【开通故障】未注册 ONT 无法上线/认证失败排查",
    command: "show gpon onu uncfg / display ont autofind all",
    alias: ["无法注册", "autofind不出", "开通失败", "不亮光猫"],
    view: "all",
    description: "排查四步法：\n1. 测光：ONU 处测光必须大于 -27 dBm，光衰超标无法完成测距；\n2. 核对 SN：华为平台必须核对 16 进制原始 SN（非字符串）；中兴注意有无冲突；\n3. 核对配额：检查该 PON 口是否已满 64 或 128 台配额限制；\n4. 模式匹配：检查 XGPON 口是否插了普通 GPON 且未开启 Combo 模式。",
    readOnly: true,
    verified: true
  },
  {
    id: "ts-c600-migration-pitfalls",
    vendor: "zte",
    model: "zte-c600",
    category: "troubleshooting",
    title: "【工程避坑】中兴 C600 TITAN 架构四大核心踩坑防范",
    command: "configure terminal | interface gpon_olt- | vport-map | show this",
    alias: ["c600避坑", "titan避坑", "c600踩坑", "c600注意事项"],
    view: "all",
    description: "中兴 C600 TITAN 相比传统 C300 ROS 避坑铁律：\n1. 必须全拼 configure terminal，敲 con t 报 Ambiguous；\n2. 接口命名下划线反转：必须为 gpon_olt- 与 gpon_onu-；\n3. 彻底废除全局 service-port，改在 ONU 接口下通过 vport-mode manual + vport-map 打标；\n4. 查看配置必须进入对应接口视图后敲 show this，废除跨视图直接打印。",
    readOnly: true,
    verified: true
  }
];

/**
 * 按厂商、型号、分类检索知识库条目
 */
export function queryKnowledgeBase({ vendor = "", model = "", category = "", keyword = "" } = {}) {
  const normVendor = String(vendor || "").trim().toLowerCase();
  const normModel = String(model || "").trim().toLowerCase();
  const normCategory = String(category || "").trim().toLowerCase();
  const normKw = String(keyword || "").trim().toLowerCase();

  return OLT_KNOWLEDGE_BASE.filter((entry) => {
    if (normVendor && !entry.vendor.toLowerCase().includes(normVendor) && !normVendor.includes(entry.vendor.toLowerCase()) && entry.vendor !== "common") {
      return false;
    }
    if (normModel && entry.model !== "common") {
      const cleanEntryModel = entry.model.toLowerCase().replace(/^(zte|huawei)-/, "");
      const cleanNormModel = normModel.replace(/^(zte|huawei)-/, "");
      if (!cleanEntryModel.includes(cleanNormModel) && !cleanNormModel.includes(cleanEntryModel)) {
        return false;
      }
    }
    if (normCategory && entry.category.toLowerCase() !== normCategory) return false;
    if (normKw) {
      const matchText = `${entry.title} ${entry.command} ${entry.description} ${(entry.alias || []).join(" ")}`.toLowerCase();
      if (!matchText.includes(normKw)) return false;
    }
    return true;
  });
}

/**
 * 获取命令差异对比说明（如 C300 vs C600 vs Huawei）
 */
export function getCommandDifferences({ feature = "" } = {}) {
  const normFeature = String(feature || "").trim().toLowerCase();
  const diffs = [
    {
      feature: "config_terminal",
      name: "进入配置模式",
      c300: "configure terminal (可缩写为 con t)",
      c600: "configure terminal (【不可缩写】，敲 con t 报歧义错误)",
      ma5800: "config 或 system-view"
    },
    {
      feature: "interface_naming",
      name: "接口命名格式",
      c300: "interface gpon-olt_1/1/1 与 interface gpon-onu_1/1/1:1 (连字符在前，下划线在后)",
      c600: "interface gpon_olt-1/1/1 与 interface gpon_onu-1/1/1:1 (【命名反转】：下划线在前，连字符在后)",
      ma5800: "interface gpon 0/1 (按框/板卡进入接口视图，子接口下敲 ont 命令)"
    },
    {
      feature: "vlan_service",
      name: "业务流与打标方式",
      c300: "全局命令行模式：service-port 1 vport 1 user-vlan X vlan X",
      c600: "【彻底废除全局 service-port】在 interface gpon_onu 内敲：vport-mode manual + vport-map 1 1 vlan X",
      ma5800: "全局命令行模式：service-port vlan X gpon 0/1/1 ont 1 gemport 1 multi-service user-vlan X"
    },
    {
      feature: "show_config",
      name: "查看接口配置",
      c300: "可在全局任意视图敲：show running-config interface gpon-onu_1/1/1:1",
      c600: "【废弃跨视图打印】必须进入对应接口视图后敲：show this",
      ma5800: "可在全局敲：display current-configuration ont 0/1/1 1 或在接口下敲 display this"
    },
    {
      feature: "autofind_unregistered",
      name: "未注册设备发现",
      c300: "show gpon onu uncfg",
      c600: "show gpon uncfg-onu (也兼容 show gpon onu uncfg)",
      ma5800: "display ont autofind all"
    },
    {
      feature: "optical_power",
      name: "查看 ONU 接收光功率",
      c300: "show pon power onu-rx gpon-onu_1/1/1:1",
      c600: "show pon power onu-rx gpon_onu-1/1/1:1",
      ma5800: "display ont optical-info 0/1 1 1"
    },
    {
      feature: "offline_reason",
      name: "查看 ONU 离线原因",
      c300: "show gpon onu detail-info gpon-onu_1/1/1:1 (查看 Offline Reason)",
      c600: "show gpon onu detail-info gpon_onu-1/1/1:1 (查看 Offline Reason)",
      ma5800: "display ont info 0/1 1 1 (查看 Last down cause，如 dying-gasp / los)"
    },
    {
      feature: "rogue_onu",
      name: "检测流氓 ONU / 常发光",
      c300: "show gpon rogue-onu",
      c600: "show gpon rogue-onu (TITAN 支持硬件时隙隔离)",
      ma5800: "display rogue-ont 0/1/1"
    }
  ];

  if (normFeature) {
    return diffs.filter((d) => d.feature.includes(normFeature) || d.name.includes(normFeature));
  }
  return diffs;
}
