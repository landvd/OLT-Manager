export const ENCRYPTED_BACKUP_JSON_TYPE = "application/json";
export const ENCRYPTED_BACKUP_BINARY_TYPES = new Set([
  "application/octet-stream",
  "application/vnd.olt-manager.encrypted-backup"
]);
export const ENCRYPTED_BACKUP_REQUEST_LIMIT = 16 * 1024;
export const ENCRYPTED_BACKUP_CONTAINER_LIMIT = 96 * 1024 * 1024;
export const ENCRYPTED_BACKUP_PASSWORD_HEADER = "x-olt-manager-backup-password";

export function json(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(body));
}

export async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

export async function readBinaryBody(req, limit = 100 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      const error = new Error("备份文件不能超过 100 MB。");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function requestContentType(req) {
  return String(req.headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
}

export function encryptedBackupError(code = "ENCRYPTED_BACKUP_INVALID", status = 400) {
  const error = new Error(code === "ENCRYPTED_BACKUP_TOO_LARGE" ? "加密备份请求过大。" : "加密备份请求无效。");
  error.status = status;
  error.code = code;
  return error;
}

export async function readEncryptedBackupPasswordBody(req) {
  if (requestContentType(req) !== ENCRYPTED_BACKUP_JSON_TYPE) throw encryptedBackupError("ENCRYPTED_BACKUP_CONTENT_TYPE");
  let body;
  try {
    body = JSON.parse((await readBinaryBody(req, ENCRYPTED_BACKUP_REQUEST_LIMIT)).toString("utf8"));
  } catch (error) {
    if (error?.status === 413) throw encryptedBackupError("ENCRYPTED_BACKUP_TOO_LARGE", 413);
    throw encryptedBackupError();
  }
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 || typeof body.password !== "string" || !body.password) {
    throw encryptedBackupError("BACKUP_PASSWORD_REQUIRED");
  }
  return body.password;
}

export async function readEncryptedBackupContainer(req) {
  if (!ENCRYPTED_BACKUP_BINARY_TYPES.has(requestContentType(req))) throw encryptedBackupError("ENCRYPTED_BACKUP_CONTENT_TYPE");
  try {
    return await readBinaryBody(req, ENCRYPTED_BACKUP_CONTAINER_LIMIT);
  } catch (error) {
    if (error?.status === 413) throw encryptedBackupError("ENCRYPTED_BACKUP_TOO_LARGE", 413);
    throw encryptedBackupError();
  }
}
