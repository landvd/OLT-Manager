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
  if (!mappings || mappings.length === 0) {
    throw mergedSyncError(`以下 OLT 缺少网管二期 IP 映射：${targets.map((item) => item.id).join(", ")}`, 409);
  }
  const mappingByOlt = new Map(mappings.map((item) => [String(item.oltIp), item]));
  return targets.map((target) => {
    let mapping = mappingByOlt.get(String(target.host));
    if (!mapping) {
      const host = String(target.host || "").trim();
      let resourceIp = host;
      const m106 = host.match(/^172\.19\.106\.(\d+)$/);
      const m104 = host.match(/^172\.19\.104\.(\d+)$/);
      if (m106) {
        resourceIp = `22.0.6.${m106[1]}`;
      } else if (m104) {
        resourceIp = `22.0.4.${m104[1]}`;
      }
      mapping = {
        oltIp: host,
        resourceIp,
        source: "auto-derived"
      };
    }
    return { target, mapping };
  });
}

export function selectMergedNmseTargets(olts = [], mappings = null) {
  const enabled = olts.filter((item) => item.enabled !== false);
  if (!enabled.length) throw mergedSyncError("没有可同步的已启用 OLT。", 409);
  if (Array.isArray(mappings) && mappings.length) {
    const mappingByOlt = new Map(mappings.map((item) => [String(item.oltIp), item]));
    const matched = enabled.filter((item) => mappingByOlt.has(String(item.host)));
    if (matched.length) {
      return matched.map((target) => ({ target, mapping: mappingByOlt.get(String(target.host)) }));
    }
  }
  return enabled.map((target) => ({ target }));
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
