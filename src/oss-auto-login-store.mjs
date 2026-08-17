import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const FORMAT = "olt-manager/oss-ngb-autologin/v1";

function requiredPassword(value) {
  const password = String(value ?? "");
  if (!password) throw new Error("网管二期登录密码不能为空。");
  return password;
}

export function createOssAutoLoginStore({ dataDirectory, safeStorage } = {}) {
  const directory = String(dataDirectory || ".");
  const filePath = join(directory, "oss-ngb-autologin.json");
  const isAvailable = () => Boolean(safeStorage?.isEncryptionAvailable?.());
  const ensureAvailable = () => {
    if (!isAvailable()) throw new Error("当前运行环境不支持系统加密存储。");
  };
  async function writeAtomic(value) {
    await mkdir(directory, { recursive: true });
    const temporaryPath = `${filePath}.tmp-${process.pid}`;
    await writeFile(temporaryPath, value, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, filePath);
  }
  return Object.freeze({
    isAvailable,
    async save(password) {
      ensureAvailable();
      const ciphertext = safeStorage.encryptString(requiredPassword(password)).toString("base64");
      await writeAtomic(JSON.stringify({ format: FORMAT, ciphertext }));
    },
    async read() {
      ensureAvailable();
      let envelope;
      try {
        envelope = JSON.parse(await readFile(filePath, "utf8"));
      } catch (error) {
        if (error.code === "ENOENT") return "";
        throw new Error("网管二期自动登录凭据不可用。", { cause: error });
      }
      if (envelope?.format !== FORMAT || typeof envelope.ciphertext !== "string" || !envelope.ciphertext) {
        throw new Error("网管二期自动登录凭据格式无效。");
      }
      try {
        return requiredPassword(safeStorage.decryptString(Buffer.from(envelope.ciphertext, "base64")));
      } catch (error) {
        throw new Error("网管二期自动登录凭据解密失败。", { cause: error });
      }
    },
    async configured() {
      if (!isAvailable()) return false;
      return Boolean(await this.read());
    },
    async clear() {
      await rm(filePath, { force: true });
    }
  });
}

export { FORMAT as OSS_AUTO_LOGIN_FORMAT };
