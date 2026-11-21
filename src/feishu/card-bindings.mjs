// 飞书卡片按钮令牌缓存（ADR-094）：内存里照常用 Map，同时写进 SQLite。
// 点按钮时内存里没有（超过内存上限被挤掉、或程序重启过），就从数据库读回来，所以卡片在有效期内随时能点。
// 定额卡片 3 天、用户查询卡片 1 天，由调用方在 expiresAt 里决定。

// 正在处理中的标记只在本次运行有效，读回来时清空，避免重启后一直显示“处理中”
const TRANSIENT_KEYS = new Set(["processingIndexes", "processingPages", "processing"]);
const PURGE_EVERY = 50;

function serialize(value) {
  return JSON.stringify(value, (key, item) => {
    if (TRANSIENT_KEYS.has(key)) return item instanceof Set ? { __set: [] } : undefined;
    if (item instanceof Set) return { __set: [...item] };
    if (item instanceof Map) return { __map: [...item] };
    return item;
  });
}

function deserialize(text) {
  return JSON.parse(text, (key, item) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      if (Array.isArray(item.__set)) return new Set(item.__set);
      if (Array.isArray(item.__map)) return new Map(item.__map);
    }
    return item;
  });
}

/**
 * 可落库的令牌表。和 Map 用法一样（get / set / delete / 遍历），delete 只清内存，数据库里的过期记录定期删除。
 * store：{ save({ token, scope, dataJson, expiresAt }), load({ token, scope, now }), purge({ now }) }，不传时只用内存。
 */
export class CardBindings extends Map {
  constructor({ store = null, scope, now = () => new Date().toISOString(), log = () => {} } = {}) {
    super();
    this.store = store && typeof store.save === "function" && typeof store.load === "function" ? store : null;
    this.scope = scope;
    this.now = now;
    this.log = log;
    this.writes = Promise.resolve();
    this.setsSincePurge = PURGE_EVERY;
  }

  set(token, value) {
    super.set(token, value);
    this.persist(token);
    return this;
  }

  /** 把内存里这条的当前内容写回数据库（处理完按钮后调用，记下“已使用”等变化）。 */
  persist(token) {
    if (!this.store || !token) return this.writes;
    const value = super.get(token);
    if (!value || typeof value.expiresAt !== "string") return this.writes;
    let dataJson;
    try {
      dataJson = serialize(value);
    } catch (error) {
      this.log("card binding serialize failed", error?.message || String(error));
      return this.writes;
    }
    const record = { token, scope: this.scope, dataJson, expiresAt: value.expiresAt };
    const purge = (this.setsSincePurge += 1) >= PURGE_EVERY && typeof this.store.purge === "function";
    if (purge) this.setsSincePurge = 0;
    // 按顺序写，后写的覆盖先写的
    this.writes = this.writes
      .then(() => this.store.save(record))
      .then(() => (purge ? this.store.purge({ now: this.now() }) : undefined))
      .catch((error) => this.log("card binding save failed", error?.message || String(error)));
    return this.writes;
  }

  /** 内存里没有时从数据库读回来；读到的放回内存。 */
  async hydrate(token) {
    if (!token || super.has(token) || !this.store) return super.get(token);
    try {
      await this.writes;
      const row = await this.store.load({ token, scope: this.scope, now: this.now() });
      if (!row) return undefined;
      const value = deserialize(row.dataJson);
      if (!value || typeof value !== "object") return undefined;
      value.expiresAt = row.expiresAt;
      super.set(token, value);
      return value;
    } catch (error) {
      this.log("card binding load failed", error?.message || String(error));
      return undefined;
    }
  }

  /** 测试和关闭前用：等所有写入完成。 */
  flush() {
    return this.writes;
  }
}
