export function blankProjectForm() {
  return {
    id: "",
    name: "",
    vlan: 100,
    address: "",
    contactName: "",
    contactPhone: "",
    contactNote: ""
  };
}

export function projectFormFor(project = null) {
  if (!project) return blankProjectForm();
  return {
    id: project.id || "",
    name: project.name || "",
    vlan: Number(project.vlan || 100),
    address: project.address || "",
    contactName: project.contactName || "",
    contactPhone: project.contactPhone || "",
    contactNote: project.contactNote || ""
  };
}

export function projectPayloadFor(form = {}) {
  return {
    name: String(form.name || "").trim(),
    vlan: form.vlan,
    address: String(form.address || "").trim(),
    contactName: String(form.contactName || "").trim(),
    contactPhone: String(form.contactPhone || "").trim(),
    contactNote: String(form.contactNote || "").trim()
  };
}

export function projectOnuRowClassName(row, selectedOnu) {
  return row?.id && row.id === selectedOnu?.id ? "selected-row" : "";
}
