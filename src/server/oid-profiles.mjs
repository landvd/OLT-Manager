// 各厂商/型号的只读 OID 配置档。
import { ZTE_C600_RX_OPTICAL_POWER_OID } from "../snmp-oid-codecs.mjs";

export const oidProfiles = {
  zte: {
    sysDescr: "1.3.6.1.2.1.1.1.0",
    sysUpTime: "1.3.6.1.2.1.1.3.0",
    onuName: "1.3.6.1.4.1.3902.1012.3.28.1.1.3",
    serialNumber: "1.3.6.1.4.1.3902.1012.3.28.1.1.5",
    phaseState: "1.3.6.1.4.1.3902.1012.3.28.2.1.4",
    lastOnlineTime: "1.3.6.1.4.1.3902.1012.3.28.2.1.5",
    lastOfflineTime: "1.3.6.1.4.1.3902.1012.3.28.2.1.6",
    lastOfflineCause: "1.3.6.1.4.1.3902.1012.3.28.2.1.7",
    rxPower: "1.3.6.1.4.1.3902.1012.3.50.12.1.1.10",
    distance: "1.3.6.1.4.1.3902.1012.3.11.4.1.2",
    opticalAlarms: "1.3.6.1.4.1.3902.1012.3.45",
    unconfiguredSerial: "1.3.6.1.4.1.3902.1082.500.10.2.2.5.1.2",
    phaseMap: {
      0: "logging",
      1: "los",
      2: "syncMib",
      3: "working",
      4: "dyinggasp",
      5: "authFailed",
      6: "offline"
    },
    offlineCauseMap: {
      // Operator-selected GPON code table (2026-08-04). Keep the numeric
      // code in the gateway contract so the mapping can be corrected later
      // without losing the device's original value.
      1: "Unknown",
      2: "DyingGasp",
      3: "LOS",
      4: "LOF",
      8: "Deactive",
      9: "Reboot",
      10: "PEE"
    },
    notes: "ZTE C300 V2.1 read-only OIDs for ONU name, serial number, phase state, last activation, last shutdown time/reason, RX power, and distance. Full Authpass/OfflineTime/Cause history remains unsupported."
  },
  huawei: {
    sysDescr: "1.3.6.1.2.1.1.1.0",
    sysUpTime: "1.3.6.1.2.1.1.3.0",
    ifName: "1.3.6.1.2.1.31.1.1.1.1",
    ontDescription: "1.3.6.1.4.1.2011.6.128.1.1.2.45.1.4",
    ontSerialNumber: "1.3.6.1.4.1.2011.6.128.1.1.2.46.1.30",
    runStatus: "1.3.6.1.4.1.2011.6.128.1.1.2.46.1.15",
    lastOnlineTime: "1.3.6.1.4.1.2011.6.128.1.1.2.46.1.22",
    rxPower: "1.3.6.1.4.1.2011.6.128.1.1.2.51.1.4",
    distance: "1.3.6.1.4.1.2011.6.128.1.1.2.46.1.20",
    ethernetOnlineState: "1.3.6.1.4.1.2011.6.128.1.1.2.62.1.22",
    registerTable: "1.3.6.1.4.1.2011.6.128.1.1.2.52",
    registerInfoUpTime: "1.3.6.1.4.1.2011.6.128.1.1.2.101.1.6",
    unconfiguredSerial: "1.3.6.1.4.1.2011.6.128.1.1.2.48.1.2",
    unconfiguredStatus: "1.3.6.1.4.1.2011.6.128.1.1.2.52.1.3",
    notes: "Huawei MA5800 uses HUAWEI-XPON-MIB. RX power/status/distance/unconfigured ONT OIDs are common MA56xx/MA58xx field OIDs, but must be tested against the installed software package."
  },
  "zte-c600": {
    sysDescr: "1.3.6.1.2.1.1.1.0",
    sysUpTime: "1.3.6.1.2.1.1.3.0",
    vendor: "1.3.6.1.4.1.3902.1082.500.20.2.1.2.1.1",
    softwareVersion: "1.3.6.1.4.1.3902.1082.500.20.2.1.2.1.2",
    serialNumber: "1.3.6.1.4.1.3902.1082.500.20.2.1.2.1.3",
    trafficOpt: "1.3.6.1.4.1.3902.1082.500.20.2.1.2.1.4",
    batteryMonitor: "1.3.6.1.4.1.3902.1082.500.20.2.1.2.1.5",
    adminState: "1.3.6.1.4.1.3902.1082.500.20.2.1.2.1.6",
    phaseState: "1.3.6.1.4.1.3902.1082.500.20.2.1.2.1.7",
    realType: "1.3.6.1.4.1.3902.1082.500.20.2.1.2.1.15",
    rxPower: ZTE_C600_RX_OPTICAL_POWER_OID,
    survivalTime: "1.3.6.1.4.1.3902.1082.500.20.2.1.2.1.16",
    onuSysUpTime: "1.3.6.1.4.1.3902.1082.500.20.2.1.2.1.18",
    productionSerial: "1.3.6.1.4.1.3902.1082.500.20.2.1.2.1.21",
    unconfiguredSerial: "1.3.6.1.4.1.3902.1082.500.2.2.11.2.1.2",
    unconfiguredLoid: "1.3.6.1.4.1.3902.1082.500.2.2.11.2.1.4",
    unconfiguredType: "1.3.6.1.4.1.3902.1082.500.2.2.11.2.1.8",
    unconfiguredSoftwareVersion: "1.3.6.1.4.1.3902.1082.500.2.2.11.2.1.10",
    unconfiguredFirstOnlineTime: "1.3.6.1.4.1.3902.1082.500.2.2.11.2.1.12",
    unconfiguredLastOnlineTime: "1.3.6.1.4.1.3902.1082.500.2.2.11.2.1.13",
    phaseMap: {
      1: "working",
      2: "offline"
    },
    offlineCauseMap: {
      1: "Unknown",
      2: "DyingGasp",
      3: "LOS",
      4: "LOF",
      8: "Deactive",
      9: "Reboot",
      10: "PEE"
    },
    notes: "ZTE C600 V2.0.10 (ZXA10-TITAN) read-only OIDs verified against the live device: registered ONU table 1082.500.20, unconfigured ONU table 1082.500.2.2.11, and zxAnPonRxOpticalPower 1082.500.1.2.4.2.1.2. Distance and last-offline fields remain unsupported for this C600 software."
  }
};

export function resolveOidProfile(olt) {
  if (olt?.deviceProfile === "zte-c600" || olt?.model === "C600") {
    return oidProfiles["zte-c600"] || oidProfiles.zte;
  }
  return oidProfiles[olt?.vendor] || oidProfiles.zte;
}

export function publicOidProfiles() {
  const profiles = [];
  const entries = [];
  for (const [key, profile] of Object.entries(oidProfiles)) {
    const isC600 = key === "zte-c600";
    const profileId = isC600 ? "zte-c600" : `${key}-${key === "huawei" ? "ma5800" : "c300"}`;
    const vendor = key.startsWith("zte") ? "zte" : key;
    const model = isC600 ? "C600" : key === "huawei" ? "MA5800" : "C300";
    const version = isC600 ? "V2.0.10" : key === "huawei" ? "unknown" : "V2.1";
    profiles.push({
      id: profileId,
      vendor,
      model,
      version,
      notes: profile.notes || "",
      verified: key.startsWith("zte")
    });
    for (const [fieldName, value] of Object.entries(profile)) {
      if (typeof value !== "string" || !/^\d+(\.\d+)+$/.test(value)) continue;
      entries.push({
        profile_id: profileId,
        field_name: fieldName,
        oid: value,
        operation: fieldName === "sysDescr" || fieldName === "sysUpTime" ? "get" : "walk",
        value_transform: fieldName === "rxPower" ? (isC600 ? "zte-c600-rx-power" : `${vendor}-rx-power`) : "",
        index_parser: isC600
          ? fieldName.startsWith("unconfigured") ? "zte-c600-unconfigured-index" : "zte-c600-pon-onu-index"
          : vendor === "huawei" ? "ifIndex+ontIndex" : "zte-pon-onu-index",
        status: key.startsWith("zte") ? "verified" : "candidate",
        notes: ""
      });
    }
  }
  return { profiles, entries };
}

export const zteServicePortOids = {
  desc: "1.3.6.1.4.1.3902.1082.110.5.2.2.1.1",
  serviceMode: "1.3.6.1.4.1.3902.1082.110.5.2.2.1.4",
  vport: "1.3.6.1.4.1.3902.1082.110.5.2.2.1.5",
  userVlan: "1.3.6.1.4.1.3902.1082.110.5.2.2.1.8",
  cVlan: "1.3.6.1.4.1.3902.1082.110.5.2.2.1.18",
  sVlan: "1.3.6.1.4.1.3902.1082.110.5.2.2.1.19"
};
