const fs = require("node:fs/promises");
const path = require("node:path");
const { randomBytes } = require("node:crypto");

function validPort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("Gateway port must be between 1024 and 65535.");
  }
  return port;
}

function validToken(value) {
  const token = String(value || "").trim();
  if (token.length < 32) throw new Error("Gateway token must contain at least 32 characters.");
  return token;
}

function createGatewaySettingsStore({ dataDirectory, safeStorage }) {
  const settingsPath = path.join(dataDirectory, "gateway-settings.json");

  async function readFile() {
    try {
      return JSON.parse(await fs.readFile(settingsPath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return { port: 8787, encryptedToken: "" };
      throw error;
    }
  }

  async function writeFile(settings) {
    await fs.mkdir(dataDirectory, { recursive: true, mode: 0o700 });
    const temporaryPath = `${settingsPath}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(settings, null, 2), {
      encoding: "utf8",
      mode: 0o600
    });
    await fs.rename(temporaryPath, settingsPath);
  }

  async function save({ port, token }) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("OS encryption is unavailable; Gateway token was not saved.");
    }
    const current = await readFile();
    const normalizedToken = String(token || "").trim();
    const encryptedToken = normalizedToken
      ? safeStorage.encryptString(validToken(normalizedToken)).toString("base64")
      : current.encryptedToken;
    if (!encryptedToken) throw new Error("Gateway token is required.");
    const settings = { port: validPort(port), encryptedToken };
    await writeFile(settings);
    return { port: settings.port, configured: true, restartRequired: true };
  }

  return Object.freeze({
    async readPublic() {
      const settings = await readFile();
      const runtime = await this.readRuntime();
      return {
        port: validPort(settings.port || 8787),
        configured: Boolean(settings.encryptedToken),
        available: !runtime.unavailableReason,
        unavailableReason: runtime.unavailableReason || null
      };
    },
    async readRuntime() {
      const settings = await readFile();
      if (!settings.encryptedToken) return { port: validPort(settings.port || 8787), token: "" };
      if (!safeStorage.isEncryptionAvailable()) {
        return {
          port: validPort(settings.port || 8787),
          token: "",
          unavailableReason: "OS encryption is unavailable; Gateway remains disabled."
        };
      }
      try {
        return {
          port: validPort(settings.port || 8787),
          token: safeStorage.decryptString(Buffer.from(settings.encryptedToken, "base64"))
        };
      } catch {
        return {
          port: validPort(settings.port || 8787),
          token: "",
          unavailableReason: "Gateway token could not be decrypted; Gateway remains disabled."
        };
      }
    },
    save,
    async generate({ port }) {
      const generatedToken = randomBytes(32).toString("hex");
      const result = await save({ port, token: generatedToken });
      return { ...result, generatedToken };
    }
  });
}

module.exports = { createGatewaySettingsStore };
