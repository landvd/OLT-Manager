const SQLITE_MAGIC = "SQLite format 3\u0000";

function asBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new Uint8Array();
}

function startsWithAscii(bytes, text) {
  if (bytes.length < text.length) return false;
  for (let index = 0; index < text.length; index += 1) {
    if (bytes[index] !== text.charCodeAt(index)) return false;
  }
  return true;
}

export function detectBackupFormat({ name = "", type = "", bytes } = {}) {
  const input = asBytes(bytes);
  if (startsWithAscii(input, SQLITE_MAGIC)) return "sqlite";

  const prefix = new TextDecoder().decode(input.slice(0, 256)).trimStart();
  if (prefix.startsWith("{")) return "combined-json";

  const filename = String(name).toLowerCase();
  const mimeType = String(type).toLowerCase();
  if (filename.endsWith(".sqlite") || filename.endsWith(".sqlite3") || mimeType.includes("sqlite")) {
    return "sqlite";
  }
  if (filename.endsWith(".json") || filename.endsWith(".oltbackup") || mimeType.includes("json")) {
    return "combined-json";
  }
  return "unknown";
}
