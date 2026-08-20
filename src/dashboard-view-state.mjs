import { formatUptime } from "./formatters.mjs";

export function dashboardMetricsFor({ selectedOlt = {}, status = {}, unregisteredCount = 0, ponPortCount = 0, emptyLedgerCount = 0 } = {}) {
  return [
    { label: "当前 OLT", value: selectedOlt.name || "-", hint: selectedOlt.host || "未配置管理地址", tone: "primary" },
    { label: "SNMP 状态", value: status.snmpState || "检测中", hint: status.reachable ? "设备可读" : "需要检查连通性", tone: status.reachable ? "ok" : "warn" },
    { label: "未注册 ONU", value: unregisteredCount, hint: "等待安装确认", tone: unregisteredCount ? "warn" : "ok" },
    { label: "PON 台账", value: ponPortCount, hint: `空地址 ${emptyLedgerCount} 条`, tone: emptyLedgerCount ? "warn" : "ok" }
  ];
}

export function dashboardWorkItemsFor({ unregisteredCount = 0, counts = {}, emptyLedgerCount = 0, duplicateLedgerCount = 0 } = {}) {
  return [
    { label: "未注册 ONU", value: unregisteredCount, hint: "进入安装查询生成方案", view: "install", tone: unregisteredCount ? "warn" : "ok" },
    { label: "LOS", value: counts.los || 0, hint: "光路中断需排查", view: "onus", tone: counts.los ? "danger" : "ok" },
    { label: "断电", value: counts.power || 0, hint: "疑似终端断电", view: "onus", tone: counts.power ? "danger" : "ok" },
    { label: "离线", value: counts.offline || 0, hint: "查看 ONU 数据查询", view: "onus", tone: counts.offline ? "warn" : "ok" },
    { label: "空地址台账", value: emptyLedgerCount, hint: "补齐地址方便定位", view: "adminPonPorts", tone: emptyLedgerCount ? "warn" : "ok" },
    { label: "重复地址", value: duplicateLedgerCount, hint: "检查台账是否重复", view: "adminPonPorts", tone: duplicateLedgerCount ? "warn" : "ok" }
  ];
}

export function dashboardFreshnessFor({ selectedOlt = {}, status = {}, counts = {}, onuCount = 0, installMessage = "", duplicateLedgerCount = 0, emptyLedgerCount = 0 } = {}) {
  return [
    { label: "型号/版本", value: `${selectedOlt.model || "-"} / ${selectedOlt.version || "-"}` },
    { label: "管理地址", value: selectedOlt.host || "未配置" },
    { label: "运行时间", value: formatUptime(status.uptime) },
    { label: "ONU 数据", value: `${onuCount} 条，在线 ${counts.online || 0} 条` },
    { label: "未注册数据", value: installMessage || `${counts.unregistered || 0} 条` },
    { label: "台账健康", value: `重复地址 ${duplicateLedgerCount} 个，空地址 ${emptyLedgerCount} 条` }
  ];
}

export function onuSummaryFor(counts = {}) {
  return [
    { label: "总计", value: counts.total || 0, key: "total" },
    { label: "在线", value: counts.online || 0, key: "online" },
    { label: "离线", value: counts.offline || 0, key: "offline" },
    { label: "LOS", value: counts.los || 0, key: "los" },
    { label: "断电", value: counts.power || 0, key: "power" },
    { label: "认证失败", value: counts.auth || 0, key: "auth" },
    { label: "登录中", value: counts.logging || 0, key: "logging" },
    { label: "同步中", value: counts.sync || 0, key: "sync" }
  ];
}

export function onuEmptyTextFor(filters = {}) {
  const hasInput = filters.search || filters.chassis || filters.slot || filters.pon;
  return hasInput ? "没有匹配到 ONU，请确认地址、槽、板卡和 PON 口。" : "请输入地址，或选择槽、板卡和 PON 口后点击搜索。";
}
