export function defaultChassisForVendor(vendor) {
  const clean = String(vendor || "").trim().toLowerCase();
  if (clean === "huawei") return "0";
  if (clean === "zte") return "1";
  return "";
}

export function splitPonPort(value) {
  return String(value || "")
    .trim()
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function normalizePonCoordinate(row = {}, { vendor = "" } = {}) {
  const parts = splitPonPort(row.ponPort ?? row.pon_port ?? row["PON"] ?? row["PON口"] ?? "");
  let chassis = String(row.chassis ?? row["槽"] ?? row["框"] ?? "").trim();
  let board = String(row.board ?? row.slot ?? row["板卡"] ?? row["槽位"] ?? "").trim();
  let pon = String(row.pon ?? row["PON"] ?? row["PON口"] ?? row["PON 口"] ?? "").trim();

  if (!chassis && !board && !pon && parts.length >= 3) {
    [chassis, board, pon] = parts;
  } else if (!board && !pon && parts.length >= 2) {
    [board, pon] = parts;
  }

  if (!chassis) chassis = defaultChassisForVendor(vendor);
  const ponPort = chassis && board && pon ? `${chassis}/${board}/${pon}` : String(row.ponPort ?? row.pon_port ?? "").trim();
  return {
    chassis,
    board,
    slot: board,
    pon,
    ponPort
  };
}

export function ponCoordinateKey({ chassis, board, slot, pon }) {
  const safeChassis = String(chassis ?? "").trim();
  const safeBoard = String(board ?? slot ?? "").trim();
  const safePon = String(pon ?? "").trim();
  return safeChassis && safeBoard && safePon ? `${safeChassis}/${safeBoard}/${safePon}` : "";
}

export function onuCoordinateLabel({ chassis, board, slot, pon, onuId }) {
  const base = ponCoordinateKey({ chassis, board, slot, pon });
  return base && onuId != null && onuId !== "" ? `${base}/${onuId}` : base;
}
