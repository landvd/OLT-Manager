# OLT Manager

OLT Manager is a read-only GPON OLT management prototype for ZTE C300/C320 and Huawei MA5800 style devices. It provides a Vue 3 + Element Plus frontend, a Node.js HTTP API, SQLite-backed local configuration, and SNMP v2c read-only collection.

## Features

- Dashboard with OLT system status, SNMP reachability, alarms, and PON ledger count.
- ONU installation query for unregistered ONU/ONT entries.
- ONU list search by address, serial number, slot, PON, Phase state, and RX optical power.
- ONU detail dialog with read-only status, RX power, distance, address, outer VLAN, and configuration template notes.
- Admin pages for OLT records, PON ledger import/export, collection history, and operation logs.
- Read-only SNMP safety boundary. The service does not expose `snmpset`, Telnet, SSH, or OLT write/config execution.

## Stack

- Frontend: Vue 3, Vite, Element Plus
- Backend: Node.js native HTTP server
- Data: SQLite, seeded from JSON files when present
- SNMP: system `snmpget` and `snmpbulkwalk`

## Setup

```bash
pnpm install
pnpm run build
pnpm start
```

Default URL:

```text
http://127.0.0.1:8787
```

## Local Data

Runtime files under `data/` are intentionally not committed:

- `data/olt-manager.sqlite`
- `data/olts.json`
- `data/pon-ports.json`

Use the examples as a starting point:

```bash
cp data/olts.example.json data/olts.json
cp data/pon-ports.example.json data/pon-ports.json
```

Then edit local OLT IPs, read-only SNMP community values, PON ports, addresses, and outer VLANs for your environment. Keep real communities and production ledger data out of git.

## SNMP Notes

The built-in profiles include commonly used read-only OIDs for:

- System: `sysDescr`, `sysUpTime`
- ZTE GPON ONU name, serial number, Phase state, RX optical power, distance, unconfigured ONU serial, and outer VLAN candidates
- Huawei XPON ifName mapping, ONT description, run status, RX optical power, distance, unconfigured ONT serial/status, and service-flow outer VLAN candidates

All vendor private OIDs should be verified against the target OLT software and MIB package before being treated as authoritative.

## Safety

This project is in a read-only stage:

- Do not configure write communities.
- Do not add automatic ONU registration, authorization, delete, reboot, reset, or service modification without a separate safety design.
- Existing command guards reject dangerous operation names such as `set`, `clear`, `erase`, `undo`, `delete`, `no`, `load`, `reboot`, `reset`, `shutdown`, `write`, and `commit`.
