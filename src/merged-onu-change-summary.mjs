// 统一合并数据集的变更摘要：与上次合并结果相比新增、消失、换坐标、改名、联系方式变化各多少户。
// 只用于本地同步记录展示，不改变合并结果。

const SAMPLE_LIMIT = 10;

function text(value) {
  return String(value ?? "").trim();
}

function coordinate(row) {
  return `${text(row.oltIp)}|${text(row.chassis)}/${text(row.board)}/${text(row.pon)}:${text(row.onuId)}`;
}

function identity(row) {
  const loid = text(row.loid).replace(/\s+/g, "").toUpperCase();
  return loid ? `loid:${loid}` : `coord:${coordinate(row)}`;
}

function sample(row) {
  return {
    loid: text(row.loidDisplay || row.loid),
    name: text(row.username),
    oltIp: text(row.oltIp),
    onuIndex: `${text(row.chassis)}/${text(row.board)}/${text(row.pon)}:${text(row.onuId)}`
  };
}

function indexRows(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!row || row.persistable === false) continue;
    if (![row.oltIp, row.chassis, row.board, row.pon, row.onuId].every((value) => text(value))) continue;
    const key = identity(row);
    if (!map.has(key)) map.set(key, row);
  }
  return map;
}

/** 首次合并（没有上次结果）返回 null，避免把全部用户都算成“新增”。 */
export function summarizeMergedChanges(previousRows = [], nextRows = []) {
  const previous = indexRows(previousRows);
  if (previous.size === 0) return null;
  const next = indexRows(nextRows);
  const summary = { added: 0, removed: 0, moved: 0, renamed: 0, contactChanged: 0, byOlt: {}, samples: { added: [], removed: [], moved: [], renamed: [] } };
  const bump = (ip, field) => {
    const entry = summary.byOlt[ip] || (summary.byOlt[ip] = { added: 0, removed: 0 });
    entry[field] += 1;
  };
  const keep = (list, item) => { if (list.length < SAMPLE_LIMIT) list.push(item); };
  for (const [key, row] of next) {
    const before = previous.get(key);
    if (!before) {
      summary.added += 1;
      bump(text(row.oltIp), "added");
      keep(summary.samples.added, sample(row));
      continue;
    }
    if (coordinate(before) !== coordinate(row)) {
      summary.moved += 1;
      keep(summary.samples.moved, { ...sample(row), from: sample(before).onuIndex, fromOltIp: text(before.oltIp) });
    }
    if (text(before.username) && text(row.username) && text(before.username) !== text(row.username)) {
      summary.renamed += 1;
      keep(summary.samples.renamed, { ...sample(row), before: text(before.username) });
    }
    if (text(before.userPhone) !== text(row.userPhone) || text(before.installationAddress) !== text(row.installationAddress)) {
      summary.contactChanged += 1;
    }
  }
  for (const [key, row] of previous) {
    if (next.has(key)) continue;
    summary.removed += 1;
    bump(text(row.oltIp), "removed");
    keep(summary.samples.removed, sample(row));
  }
  return summary;
}
