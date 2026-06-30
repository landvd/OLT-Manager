export function oidSuffix(oid, baseOid) {
  const base = baseOid.replace(/^\./, "");
  const full = oid.replace(/^\./, "");
  return full.startsWith(`${base}.`) ? full.slice(base.length + 1).split(".").map(Number) : [];
}

export function encodeZtePonIfIndex(slot, pon) {
  return (0x11 << 24) + (0x01 << 16) + (Number(slot) << 8) + Number(pon);
}

export function parseZteUnconfiguredIndex(oid, baseOid) {
  const suffix = oidSuffix(oid, baseOid);
  const encoded = suffix[0] || 0;
  const board = (encoded >> 8) & 0xff;
  return {
    // Field samples encode C300 unconfigured ONU ports as 0x1101SSPP.
    chassis: 1,
    board,
    slot: board,
    pon: encoded & 0xff,
    entryIndex: suffix[1] || 0,
    encoded
  };
}

export function decodeRawHexString(value) {
  const hex = String(value).match(/Hex-STRING:\s*([0-9A-Fa-f ]+)/)?.[1];
  if (hex) {
    const clean = hex.trim().split(/\s+/).join("").toUpperCase();
    return /^0+$/.test(clean) ? "N/A" : clean;
  }
  const clean = String(value || "")
    .replace(/^[A-Z-]+:\s*/, "")
    .replace(/^"|"$/g, "")
    .replace(/[^0-9A-Fa-f]/g, "")
    .toUpperCase();
  return clean.length >= 16 ? clean.slice(0, 16) : "N/A";
}
