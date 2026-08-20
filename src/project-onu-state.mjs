export function normalizeProjectOnuRow(row = {}) {
  return {
    ...row,
    noteDraft: row.note || "",
    savingNote: false,
    removing: false
  };
}

export function selectProjectFromList(projects, preferredId = "", currentId = "") {
  const items = Array.isArray(projects) ? projects : [];
  return items.find((project) => project?.id === preferredId)
    || items.find((project) => project?.id === currentId)
    || null;
}

export function replaceProjectOnuRows(rows, selectedId = "") {
  const normalizedRows = (Array.isArray(rows) ? rows : []).map(normalizeProjectOnuRow);
  return {
    rows: normalizedRows,
    selectedOnu: normalizedRows.find((row) => row.id === selectedId) || normalizedRows[0] || null
  };
}

export function removeProjectOnuRow(rows, selectedId, removedId) {
  const remainingRows = (Array.isArray(rows) ? rows : []).filter((row) => row?.id !== removedId);
  return {
    rows: remainingRows,
    selectedOnu: selectedId === removedId
      ? remainingRows[0] || null
      : remainingRows.find((row) => row?.id === selectedId) || null
  };
}
