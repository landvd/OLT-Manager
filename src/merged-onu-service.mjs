function mergedSyncError(message, status = 502) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function selectMergedOnuTargets(olts = [], mappings = []) {
  const enabled = olts.filter((item) => item.enabled !== false);
  const targets = enabled;
  const disabled = targets.filter((item) => item.enabled === false);
  if (disabled.length) throw mergedSyncError("合并 ONU 同步只能针对已启用 OLT。", 409);
  const mappingByOlt = new Map(mappings.map((item) => [String(item.oltIp), item]));
  const missing = targets.filter((item) => !mappingByOlt.has(String(item.host)));
  if (missing.length) {
    throw mergedSyncError(`以下 OLT 缺少网管二期 IP 映射：${missing.map((item) => item.id).join(", ")}`, 409);
  }
  return targets.map((target) => ({ target, mapping: mappingByOlt.get(String(target.host)) }));
}

export function selectMergedNmseTargets(olts = []) {
  const targets = olts.filter((item) => item.enabled !== false);
  if (!targets.length) throw mergedSyncError("没有可同步的已启用 OLT。", 409);
  return targets.map((target) => ({ target }));
}

export function projectNmseMergeRows(rows = [], oltIp = "") {
  return rows.map((row) => ({
    oltIp,
    onuIndex: row.onuIndexName || row.onuIndex || "",
    loid: row.loid || "",
    username: row.username || "",
    userPhone: row.userPhone || "",
    installationAddress: row.installationAddress || ""
  }));
}

export function createMergedOnuService({ readLocalUsers } = {}) {
  if (typeof readLocalUsers !== "function") {
    throw new TypeError("合并 ONU 服务需要注入本地用户读取器。");
  }

  return {
    selectMergedOnuTargets,
    selectMergedNmseTargets,
    projectNmseMergeRows,
    async readLocalUsersAsMergeRows(datasets = []) {
      const extracted = [];
      for (const dataset of datasets) {
        const rows = await readLocalUsers({ oltIp: dataset.oltIp });
        extracted.push(...projectNmseMergeRows(rows, dataset.oltIp));
      }
      return extracted;
    }
  };
}
