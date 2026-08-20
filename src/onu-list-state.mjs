import { compareOnuCoordinates } from "./pon-coordinate.mjs";

export function createOnuListState() {
  return {
    filters: { search: "", chassis: "", slot: "", pon: "" },
    sort: { field: "", direction: "asc" }
  };
}

export function findPonAddressMatch(ponPorts, keyword) {
  const normalizedKeyword = String(keyword || "").trim().toLowerCase();
  if (!normalizedKeyword) return undefined;

  return ponPorts
    .filter((port) => port.address && port.address.toLowerCase().includes(normalizedKeyword))
    .sort((a, b) => a.address.length - b.address.length)[0];
}

function phaseSortValue(phase) {
  return {
    working: 1,
    online: 1,
    logging: 2,
    syncmib: 3,
    offline: 4,
    los: 5,
    dyinggasp: 6,
    authfailed: 7
  }[String(phase || "").trim().toLowerCase()] || 99;
}

function rxPowerSortValue(rxPower) {
  const value = Number.parseFloat(String(rxPower || ""));
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

export function sortOnuRows(rows, sort = {}) {
  if (!sort.field) return rows;
  const direction = sort.direction === "descending" ? -1 : 1;
  return [...rows].sort((a, b) => {
    if (sort.field === "coordinate") return compareOnuCoordinates(a, b) * direction;
    const left = sort.field === "phase" ? phaseSortValue(a.phase) : rxPowerSortValue(a.rxPower);
    const right = sort.field === "phase" ? phaseSortValue(b.phase) : rxPowerSortValue(b.rxPower);
    if (left === right) return String(a.onuId).localeCompare(String(b.onuId), "zh-Hans-CN");
    return (left - right) * direction;
  });
}
