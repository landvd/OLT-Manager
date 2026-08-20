export function opticalValue(value) {
  if (value === null || value === undefined || value === "") return "-";
  return Number.isFinite(Number(value)) ? `${Number(value).toFixed(2)} dBm` : "-";
}

export function rxHistoryPoints(detail) {
  const samples = detail?.history?.rxPower || [];
  if (samples.length < 2) return "";
  const values = samples.map((sample) => Number(sample.rxPower)).filter(Number.isFinite);
  if (values.length < 2) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return samples.map((sample, index) => {
    const x = 20 + (index * 560) / Math.max(1, samples.length - 1);
    const y = 160 - ((Number(sample.rxPower) - min) / span) * 140;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

export function servicePortCli(detail) {
  if (detail?.cliConfig?.runningConfig) return detail.cliConfig.runningConfig;
  const onu = detail?.onu || {};
  const lines = [`interface gpon-onu_${onu.chassis || "1"}/${onu.board || onu.slot}/${onu.pon}:${onu.onuId}`];
  for (const item of detail?.servicePorts || []) {
    const parts = [
      `  service-port ${item.servicePort}`,
      `vport ${item.vport}`,
      `user-vlan ${item.userVlan}`,
      `vlan ${item.cVlan || item.userVlan}`
    ];
    if (item.sVlan) parts.push(`svlan ${item.sVlan}`);
    lines.push(parts.join(" "));
  }
  lines.push("!");
  return lines.join("\n");
}

export function onuMgmtCli(detail) {
  return detail?.cliConfig?.onuRunningConfig || "";
}
