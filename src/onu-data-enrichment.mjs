function onuIdentityKey(row = {}) {
  return [
    String(row.oltId || "").trim(),
    String(row.chassis ?? "").trim(),
    String(row.board ?? row.slot ?? "").trim(),
    String(row.pon ?? "").trim(),
    String(row.onuId ?? "").trim()
  ].join("|");
}

function normalizeResourceOnuIndex(value) {
  const parts = String(value || "").trim().replace(/:/g, "/").split("/");
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) return "";
  return parts.join("/");
}

function projectOnuSnapshot(row = {}, olt = {}, refreshError = "") {
  return {
    ...row,
    oltId: row.oltId,
    oltName: olt.name || row.oltId,
    oltHost: olt.host || "",
    serial: row.serial || "",
    phase: row.phase || "",
    rxPower: row.rxPower || "",
    distance: row.distance || "",
    address: row.address || "",
    vlan: row.vlan || "",
    refreshError
  };
}

export function createOnuDataEnrichment({
  getMergedOnuSnapshots,
  getProjectOnuAssignments,
  getProjectOnus,
  listOnus
} = {}) {
  async function attachResourceUserFields(rows = [], olt = {}) {
    if (!rows.length) return rows;
    const resourceUsers = await getMergedOnuSnapshots({ oltIp: olt.host });
    const userByOnuIndex = new Map();
    for (const user of resourceUsers) {
      const key = normalizeResourceOnuIndex(user.onuIndex);
      if (key) userByOnuIndex.set(key, user);
    }
    return rows.map((row) => {
      const key = normalizeResourceOnuIndex(`${row.chassis}/${row.board ?? row.slot}/${row.pon}/${row.onuId}`);
      const user = key ? userByOnuIndex.get(key) : null;
      return {
        ...row,
        loid: user?.loid || "",
        username: user?.username || "",
        userPhone: user?.userPhone || "",
        installationAddress: user?.installationAddress || "",
        mac: user?.mac || "",
        deviceNumber: user?.deviceNumber || "",
        userSyncedAt: user?.syncedAt || ""
      };
    });
  }

  async function attachProjectAssignments(rows = [], oltId = "") {
    if (!rows.length) return rows;
    const assignments = await getProjectOnuAssignments({ oltId });
    const projectByOnu = new Map(assignments.map((item) => [onuIdentityKey(item), item]));
    return rows.map((row) => {
      const assignment = projectByOnu.get(onuIdentityKey(row));
      if (!assignment) return { ...row, project: null, projectId: "", projectName: "" };
      return {
        ...row,
        project: {
          id: assignment.projectId,
          name: assignment.projectName,
          vlan: assignment.projectVlan
        },
        projectId: assignment.projectId,
        projectName: assignment.projectName
      };
    });
  }

  async function listProjectOnus(projectId, olts = []) {
    const associations = await getProjectOnus(projectId);
    const oltById = new Map(olts.map((olt) => [olt.id, olt]));
    const rows = [];

    for (const association of associations) {
      const olt = oltById.get(association.oltId) || {};
      if (!olt.id) {
        rows.push(projectOnuSnapshot(association, olt, "未找到关联的 OLT，已保留加入项目时的快照。"));
        continue;
      }

      try {
        const currentRows = await listOnus(olt, {
          chassis: association.chassis,
          board: association.board,
          pon: association.pon
        });
        const current = currentRows.find((item) => onuIdentityKey(item) === onuIdentityKey(association));
        if (!current) {
          rows.push(projectOnuSnapshot(association, olt, "未读取到该 ONU 当前状态，已保留加入项目时的快照。"));
          continue;
        }
        rows.push({
          ...association,
          oltName: olt.name || association.oltId,
          oltHost: olt.host || "",
          serial: current.serial || association.serial || "",
          phase: current.phase || "",
          rxPower: current.rxPower || "",
          distance: current.distance || "",
          address: current.address || "",
          vlan: association.vlan || "",
          refreshError: ""
        });
      } catch (error) {
        rows.push(projectOnuSnapshot(
          association,
          olt,
          `当前状态读取失败，已保留加入项目时的快照：${error.message || "未知错误"}`
        ));
      }
    }

    return rows;
  }

  return { attachResourceUserFields, attachProjectAssignments, listProjectOnus };
}

export { normalizeResourceOnuIndex, onuIdentityKey, projectOnuSnapshot };
