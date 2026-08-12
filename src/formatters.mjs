export function formatUptime(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "-";

  const parts = raw.replace(/\.\d+$/, "").split(":");
  let days = 0;
  let hours = 0;
  let minutes = 0;
  let seconds = 0;
  let totalSeconds = null;
  if (parts.length === 4 && parts.every((part) => /^\d+$/.test(part))) {
    [days, hours, minutes, seconds] = parts.map(Number);
  } else if (parts.length === 3 && parts.every((part) => /^\d+$/.test(part))) {
    [hours, minutes, seconds] = parts.map(Number);
  } else if (/^\d+$/.test(raw)) {
    totalSeconds = Math.floor(Number(raw) / 100);
  } else {
    return raw;
  }

  if (totalSeconds !== null) {
    days = Math.floor(totalSeconds / 86400);
    hours = Math.floor((totalSeconds % 86400) / 3600);
    minutes = Math.floor((totalSeconds % 3600) / 60);
    seconds = totalSeconds % 60;
  }

  const labels = [];
  if (days) labels.push(`${days}天`);
  if (hours || days) labels.push(`${hours}小时`);
  if (minutes || hours || days) labels.push(`${minutes}分钟`);
  labels.push(`${seconds}秒`);
  return labels.join(" ");
}
