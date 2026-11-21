// 飞书卡片按钮令牌（ADR-094）：定额卡片和用户查询卡片的按钮令牌落库，程序重启、隔天再点也能用。
// 只存本机 SQLite；内容是卡片发出时记下的数据（JSON），过期后删除。
import { exec, query, sqlQuote } from "./core.mjs";

const SCOPES = new Set(["quota", "query"]);
const MAX_DATA_LENGTH = 2_000_000;

/** 写入或更新一条令牌；dataJson 由调用方序列化好。 */
export async function saveCardBinding({ token, scope, dataJson, expiresAt } = {}) {
  if (!token || !SCOPES.has(scope) || typeof dataJson !== "string" || dataJson.length > MAX_DATA_LENGTH) return false;
  await exec(`INSERT INTO feishu_card_bindings (token, scope, data_json, expires_at, updated_at)
VALUES (${sqlQuote(token)}, ${sqlQuote(scope)}, ${sqlQuote(dataJson)}, ${sqlQuote(String(expiresAt))}, ${sqlQuote(new Date().toISOString())})
ON CONFLICT(token) DO UPDATE SET data_json = excluded.data_json, expires_at = excluded.expires_at, updated_at = excluded.updated_at;`);
  return true;
}

/** 读一条未过期的令牌，没有或已过期返回 null。 */
export async function getCardBinding({ token, scope, now = new Date().toISOString() } = {}) {
  if (!token || !SCOPES.has(scope)) return null;
  const [row] = await query(`SELECT data_json, expires_at FROM feishu_card_bindings
WHERE token = ${sqlQuote(token)} AND scope = ${sqlQuote(scope)} AND expires_at > ${sqlQuote(String(now))};`);
  return row ? { dataJson: row.data_json, expiresAt: row.expires_at } : null;
}

/** 删除已过期的令牌。 */
export async function purgeExpiredCardBindings({ now = new Date().toISOString() } = {}) {
  await exec(`DELETE FROM feishu_card_bindings WHERE expires_at <= ${sqlQuote(String(now))};`);
}
