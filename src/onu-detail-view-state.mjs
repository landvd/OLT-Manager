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

// 光功率阈值（与首页“全网光衰质量健康梯度”一致）：优良 ≥ -24，轻度关注 -27 ~ -24，严重弱光 < -27。
export const RX_GOOD_DBM = -24;
export const RX_SEVERE_DBM = -27;

function shortTime(value) {
  const text = String(value || "").replace("T", " ");
  const match = text.match(/(\d{4})-(\d{2})-(\d{2})[ ](\d{2}):(\d{2})/);
  return match ? `${match[2]}-${match[3]} ${match[4]}:${match[5]}` : text.slice(0, 16);
}

/**
 * 光功率历史折线图的绘图数据（SVG 坐标，默认 viewBox 880×240，接近对话框实际宽度，文字不被放大）。
 * 纵轴范围至少覆盖 -30 ~ -15 dBm，保证阈值分区始终可见；刻度每 3 dBm 一条。
 */
export function rxHistoryChart(detail, { width = 880, height = 240 } = {}) {
  const samples = (detail?.history?.rxPower || [])
    .map((sample) => ({ time: sample.sampledAt || sample.time || "", value: Number(sample.rxPower) }))
    .filter((sample) => Number.isFinite(sample.value));
  if (samples.length < 2) return null;
  const pad = { left: 48, right: 16, top: 14, bottom: 30 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const values = samples.map((sample) => sample.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const low = Math.min(-30, Math.floor((min - 1) / 3) * 3);
  const high = Math.max(-15, Math.ceil((max + 1) / 3) * 3);
  const y = (value) => pad.top + ((high - value) / (high - low)) * plotHeight;
  const x = (index) => pad.left + (index * plotWidth) / (samples.length - 1);
  const band = (from, to, tone) => {
    const top = y(Math.min(high, to));
    const bottom = y(Math.max(low, from));
    return { tone, x: pad.left, y: top, width: plotWidth, height: Math.max(0, bottom - top) };
  };
  const points = samples.map((sample, index) => ({ x: x(index), y: y(sample.value), value: sample.value, time: sample.time }));
  const yTicks = [];
  for (let value = high; value >= low; value -= 3) yTicks.push({ y: y(value), label: `${value}` });
  const middle = Math.floor((samples.length - 1) / 2);
  const latest = points[points.length - 1];
  const previous = points[points.length - 2];
  // 折线从上方下降到最新点时把数值标在点下方，避免压在线上。
  const latestLabelY = previous.y < latest.y ? Math.min(latest.y + 20, pad.top + plotHeight - 4) : Math.max(latest.y - 10, pad.top + 12);
  return {
    width,
    height,
    plot: { left: pad.left, right: width - pad.right, top: pad.top, bottom: height - pad.bottom },
    bands: [
      band(RX_GOOD_DBM, high, "good"),
      band(RX_SEVERE_DBM, RX_GOOD_DBM, "warn"),
      band(low, RX_SEVERE_DBM, "bad")
    ],
    yTicks,
    xLabels: [
      { x: points[0].x, label: shortTime(samples[0].time), anchor: "start" },
      ...(samples.length > 2 ? [{ x: points[middle].x, label: shortTime(samples[middle].time), anchor: "middle" }] : []),
      { x: latest.x, label: shortTime(samples[samples.length - 1].time), anchor: "end" }
    ],
    line: points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" "),
    points,
    latest,
    latestLabelY,
    stats: {
      count: samples.length,
      latest: latest.value,
      min,
      max,
      delta: Math.round((max - min) * 100) / 100,
      tone: latest.value >= RX_GOOD_DBM ? "good" : latest.value >= RX_SEVERE_DBM ? "warn" : "bad"
    }
  };
}
