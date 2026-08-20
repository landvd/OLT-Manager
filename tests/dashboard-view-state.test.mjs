import test from "node:test";
import assert from "node:assert/strict";
import {
  dashboardFreshnessFor,
  dashboardMetricsFor,
  dashboardWorkItemsFor,
  onuEmptyTextFor,
  onuSummaryFor
} from "../src/dashboard-view-state.mjs";

test("dashboard view state keeps status, counts, and ledger health presentation stable", () => {
  const selectedOlt = { name: "OLT A", host: "192.0.2.1", model: "C320", version: "R1" };
  const status = { reachable: true, snmpState: "connected", uptime: 360000 };
  const counts = { total: 4, online: 2, offline: 1, los: 1, power: 0, auth: 0, logging: 0, sync: 0 };

  assert.deepEqual(dashboardMetricsFor({ selectedOlt, status, unregisteredCount: 2, ponPortCount: 8, emptyLedgerCount: 1 }), [
    { label: "当前 OLT", value: "OLT A", hint: "192.0.2.1", tone: "primary" },
    { label: "SNMP 状态", value: "connected", hint: "设备可读", tone: "ok" },
    { label: "未注册 ONU", value: 2, hint: "等待安装确认", tone: "warn" },
    { label: "PON 台账", value: 8, hint: "空地址 1 条", tone: "warn" }
  ]);
  assert.equal(dashboardWorkItemsFor({ unregisteredCount: 2, counts, emptyLedgerCount: 1, duplicateLedgerCount: 3 })[1].tone, "danger");
  assert.deepEqual(dashboardFreshnessFor({ selectedOlt, status, counts, onuCount: 4, installMessage: "已刷新", duplicateLedgerCount: 3, emptyLedgerCount: 1 }), [
    { label: "型号/版本", value: "C320 / R1" },
    { label: "管理地址", value: "192.0.2.1" },
    { label: "运行时间", value: "1小时 0分钟 0秒" },
    { label: "ONU 数据", value: "4 条，在线 2 条" },
    { label: "未注册数据", value: "已刷新" },
    { label: "台账健康", value: "重复地址 3 个，空地址 1 条" }
  ]);
});

test("ONU summary and empty-state text remain deterministic for zero values and filters", () => {
  assert.deepEqual(onuSummaryFor({}), [
    { label: "总计", value: 0, key: "total" },
    { label: "在线", value: 0, key: "online" },
    { label: "离线", value: 0, key: "offline" },
    { label: "LOS", value: 0, key: "los" },
    { label: "断电", value: 0, key: "power" },
    { label: "认证失败", value: 0, key: "auth" },
    { label: "登录中", value: 0, key: "logging" },
    { label: "同步中", value: 0, key: "sync" }
  ]);
  assert.equal(onuEmptyTextFor({}), "请输入地址，或选择槽、板卡和 PON 口后点击搜索。");
  assert.equal(onuEmptyTextFor({ search: "alice" }), "没有匹配到 ONU，请确认地址、槽、板卡和 PON 口。");
});
