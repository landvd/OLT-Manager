/**
 * 外部 OLT 候选方案与现网快照的确定性匹配器。
 *
 * 外部搜索结果只作为候选参考；只有设备身份、版本、能力坐标和已验证命令
 * 全部通过时才返回 matched。缺字段一律不推断为匹配。
 */

export const OLT_MATCH_STATUSES = Object.freeze([
  "matched",
  "partial",
  "unknown",
  "incompatible"
]);

const VENDOR_ALIASES = new Map([
  ["zte", "zte"],
  ["中兴", "zte"],
  ["huawei", "huawei"],
  ["华为", "huawei"]
]);

function text(value) {
  return String(value ?? "").trim();
}

function normalized(value) {
  return text(value).toLocaleLowerCase("zh-Hans-CN").replace(/^[v\s]+(?=\d)/, "").replace(/[\s_-]+/g, "");
}

export function normalizeOltIdentity(value = {}) {
  const vendorRaw = normalized(value.vendor);
  const vendor = VENDOR_ALIASES.get(vendorRaw) || vendorRaw;
  const model = normalized(value.model);
  const deviceProfile = normalized(value.deviceProfile || value.device_profile);
  const version = normalized(value.version || value.softwareVersion || value.firmwareVersion);
  return { vendor, model, deviceProfile, version };
}

function known(value) {
  const normalizedValue = normalized(value);
  return normalizedValue && normalizedValue !== "unknown" && normalizedValue !== "未识别";
}

function safeCoordinate(value = {}) {
  if (!value || typeof value !== "object") return null;
  const coordinate = {
    chassis: text(value.chassis),
    board: text(value.board || value.slot),
    pon: text(value.pon)
  };
  return Object.values(coordinate).some(Boolean) ? coordinate : null;
}

function capabilityCoordinate(snapshot) {
  const capabilities = snapshot?.capabilities;
  if (!capabilities || typeof capabilities !== "object") return null;
  return safeCoordinate(capabilities.coordinate || capabilities.coordinates || capabilities);
}

function commandSignature(command) {
  return normalized(command)
    .replace(/\{(?:chassis|slot|board|pon|onuid|onu_id)\}/g, "<value>")
    .replace(/\b\d+\/\d+\/\d+(?::\d+)?\b/g, "<coordinate>")
    .replace(/\s+/g, " ");
}

function commandIsVerified(candidate, verifiedCommands) {
  const candidateCommand = text(candidate.command);
  if (!candidateCommand || !Array.isArray(verifiedCommands) || verifiedCommands.length === 0) {
    return { ok: false, reason: "缺少已验证命令证据" };
  }
  const signature = commandSignature(candidateCommand);
  const matched = verifiedCommands.some((entry) => {
    const command = typeof entry === "string" ? entry : entry?.command;
    return command && commandSignature(command) === signature && entry?.verified !== false;
  });
  return matched
    ? { ok: true, reason: "命令与本地已验证命令表一致" }
    : { ok: false, reason: "候选命令不在本地已验证命令表中" };
}

function safeReason(value) {
  return text(value).replace(/(?:password|community|token|cookie|secret|credential)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]");
}

export function matchOltCandidate({ candidate = {}, snapshot = {}, verifiedCommands = [] } = {}) {
  const safeCandidate = candidate && typeof candidate === "object" ? candidate : {};
  const safeSnapshot = snapshot && typeof snapshot === "object" ? snapshot : {};
  const candidateIdentity = normalizeOltIdentity(safeCandidate);
  const snapshotIdentity = normalizeOltIdentity(safeSnapshot);
  const reasons = [];
  const missing = [];
  let incompatible = false;

  for (const field of ["vendor", "model", "deviceProfile", "version"]) {
    const candidateValue = candidateIdentity[field];
    const snapshotValue = snapshotIdentity[field];
    if (!known(candidateValue)) missing.push(`candidate.${field}`);
    if (!known(snapshotValue)) missing.push(`snapshot.${field}`);
    if (known(candidateValue) && known(snapshotValue) && candidateValue !== snapshotValue) {
      incompatible = true;
      reasons.push(`${field} 不一致`);
    }
  }

  const candidateCoordinate = safeCoordinate(safeCandidate.coordinate || safeCandidate);
  const snapshotCoordinate = capabilityCoordinate(safeSnapshot);
  if (!candidateCoordinate) {
    missing.push("candidate.coordinate");
  } else if (["chassis", "board", "pon"].some((field) => !known(candidateCoordinate[field]))) {
    missing.push("candidate.coordinate.complete");
  } else if (!snapshotCoordinate) {
    missing.push("snapshot.capabilities.coordinate");
  } else {
    for (const field of ["chassis", "board", "pon"]) {
      if (candidateCoordinate[field] && snapshotCoordinate[field] && candidateCoordinate[field] !== snapshotCoordinate[field]) {
        incompatible = true;
        reasons.push(`coordinate.${field} 不在现网能力范围内`);
      }
      if (candidateCoordinate[field] && !snapshotCoordinate[field]) {
        missing.push(`snapshot.capabilities.${field}`);
      }
    }
  }

  const commandResult = commandIsVerified(safeCandidate, verifiedCommands);
  if (!commandResult.ok) missing.push("verifiedCommand");
  reasons.push(commandResult.reason);

  let status = "unknown";
  if (incompatible) status = "incompatible";
  else if (missing.length === 0) status = "matched";
  else if (known(candidateIdentity.vendor) && known(candidateIdentity.model) && known(snapshotIdentity.vendor) && known(snapshotIdentity.model)) {
    status = "partial";
  }

  return {
    status,
    matched: status === "matched",
    missing: [...new Set(missing)],
    reasons: reasons.map(safeReason),
    identity: {
      candidate: candidateIdentity,
      snapshot: snapshotIdentity
    },
    command: {
      candidate: text(safeCandidate.command),
      verified: commandResult.ok
    }
  };
}

export function matchOltCandidates({ candidates = [], snapshot = {}, verifiedCommands = [] } = {}) {
  if (!Array.isArray(candidates)) return [];
  return candidates.map((candidate) => matchOltCandidate({ candidate, snapshot, verifiedCommands }));
}
