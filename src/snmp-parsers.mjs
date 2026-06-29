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
