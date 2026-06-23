export const deviceProfiles = [
  {
    id: "zte-c300",
    vendor: "zte",
    vendorLabel: "中兴",
    model: "C300",
    label: "C300",
    configSupported: true
  },
  {
    id: "zte-c600",
    vendor: "zte",
    vendorLabel: "中兴",
    model: "C600",
    label: "C600（暂未支持配置方案）",
    configSupported: false
  },
  {
    id: "huawei-ma5800",
    vendor: "huawei",
    vendorLabel: "华为",
    model: "MA5800",
    label: "MA5800",
    configSupported: true
  }
];

export const supportedConfigDeviceProfileIds = new Set(
  deviceProfiles.filter((profile) => profile.configSupported).map((profile) => profile.id)
);

export function profilesForVendor(vendor) {
  const cleanVendor = String(vendor || "").trim().toLowerCase();
  return deviceProfiles.filter((profile) => profile.vendor === cleanVendor);
}

export function profileById(profileId) {
  return deviceProfiles.find((profile) => profile.id === profileId) || null;
}

export function defaultProfileForVendor(vendor) {
  return profilesForVendor(vendor)[0] || null;
}

export function defaultProfileForModel(vendor, model) {
  const cleanModel = String(model || "").trim().toLowerCase();
  return profilesForVendor(vendor).find((profile) => profile.model.toLowerCase() === cleanModel) || defaultProfileForVendor(vendor);
}

export function normalizeDeviceProfile({ vendor, model, deviceProfile } = {}) {
  const cleanProfile = String(deviceProfile || "").trim().toLowerCase();
  const explicit = profileById(cleanProfile);
  const fallback = defaultProfileForModel(vendor, model);
  const profile = explicit || fallback;
  if (!profile) {
    throw new Error("OLT 型号只能选择当前厂商支持的设备型号。");
  }
  if (String(vendor || "").trim().toLowerCase() !== profile.vendor) {
    throw new Error("OLT 厂商和型号不匹配。");
  }
  return profile.id;
}

export function supportsConfigPlan(deviceProfile) {
  return supportedConfigDeviceProfileIds.has(String(deviceProfile || "").trim().toLowerCase());
}
