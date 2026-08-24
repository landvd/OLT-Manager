export const terminalPasteCharDelayMs = 8;
export const terminalPasteLineDelayMs = 120;

export function terminalPasteLines(text) {
  const normalized = String(text || "").replace(/\r\n?/g, "\n");
  return normalized.split("\n").filter((line) => line.trim());
}

export function terminalPasteFrames(text, options = {}) {
  return terminalPasteLines(text, options).map((line) => ({ line, input: `${line}\r` }));
}

export function terminalPasteNeedsExtraEnter(line, vendor) {
  if (!String(vendor || "").toLowerCase().includes("huawei")) return false;
  const text = String(line || "");
  return /^\s*ont\s+add\b/i.test(text) || /^\s*service-port\b/i.test(text);
}
