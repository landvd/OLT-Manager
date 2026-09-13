import test from "node:test";
import assert from "node:assert/strict";
import {
  OssNgbClient,
  mergeOssOnuRows,
  normalizeOssOnuRow
} from "../src/oss-ngb-client.mjs";

function dwrReply(value) {
  return `throw 'allowScriptTagRemoting is false.';\ndwr.engine._remoteHandleCallback('0','0',${JSON.stringify(value)});`;
}

test("normalizeOssOnuRow extracts deviceType from ONUTYPE and phase from N_AUTHSTATUS", () => {
  const row = normalizeOssOnuRow({
    CUID: "ONU-1",
    ONUDEVICEINDEX: "1/2/3:4",
    ONUTYPE: "ZXHN F660",
    N_AUTHSTATUS: "1",
    RX_OPTICAL: "-21.5",
    LOID: "LOID-100",
    DEVNAME: "东莞厚街-1/2/3:4"
  });

  assert.equal(row.deviceType, "ZXHN F660");
  assert.equal(row.phase, "在线");
  assert.equal(row.rxPower, "-21.5");
  assert.equal(row.loid, "LOID-100");
  assert.equal(row.onuIndex, "1/2/3:4");
});

test("normalizeOssOnuRow maps numeric N_AUTHSTATUS codes to human-readable phase", () => {
  assert.equal(normalizeOssOnuRow({ CUID: "1", ONUDEVICEINDEX: "1/1/1:1", N_AUTHSTATUS: "1" }).phase, "在线");
  assert.equal(normalizeOssOnuRow({ CUID: "2", ONUDEVICEINDEX: "1/1/1:2", N_AUTHSTATUS: "2" }).phase, "离线");
  assert.equal(normalizeOssOnuRow({ CUID: "3", ONUDEVICEINDEX: "1/1/1:3", N_AUTHSTATUS: "0" }).phase, "未认证");
  assert.equal(normalizeOssOnuRow({ CUID: "4", ONUDEVICEINDEX: "1/1/1:4", PHASE: "异常状态" }).phase, "异常状态");
});

test("normalizeOssOnuRow fails closed on non-numeric coordinate values in fallback fields", () => {
  // DEVNAME doesn't match standard pattern and BOARDIDX/ONUINDEX contain non-numeric data
  assert.throws(() => normalizeOssOnuRow({
    CUID: "ONU-DIRTY-1",
    DEVNAME: "DG-OLT-1/4/14:DG214222L73",
    BOARDIDX: "1-1-5",
    ONUINDEX: "DG214222L73"
  }), (error) => {
    assert.equal(error.status, 502);
    assert.match(error.message, /无法解析/);
    return true;
  });

  assert.throws(() => normalizeOssOnuRow({
    CUID: "ONU-DIRTY-2",
    DEVNAME: "InvalidDevice",
    SLOTINDEX: "chassis-1",
    BOARDIDX: "board-2",
    PONIDX: "pon-3",
    ONUINDEX: "onu-4"
  }), (error) => {
    assert.equal(error.status, 502);
    assert.match(error.message, /无法解析/);
    return true;
  });
});

test("mergeOssOnuRows protects hardware identity from secondary row when identityConflict is true", () => {
  const primary = {
    onuIndex: "1/7/14:10",
    chassis: "1",
    board: "7",
    pon: "14",
    onuId: "10",
    phase: "在线",
    rxPower: "-19.5",
    loid: "LOID-USER-A",
    serial: "SN-USER-A",
    mac: "AA:BB:CC:DD:EE:01",
    deviceNumber: "DEV-USER-A",
    username: "用户甲",
    userPhone: "13911111111",
    installationAddress: "厚街镇康乐南路1号"
  };

  const secondaryWithConflictingLoid = {
    onuIndex: "1/7/14:10",
    chassis: "1",
    board: "7",
    pon: "14",
    onuId: "10",
    phase: "离线",
    rxPower: "",
    loid: "LOID-USER-B",
    serial: "SN-USER-B-STRANGER",
    mac: "AA:BB:CC:DD:EE:99",
    deviceNumber: "DEV-USER-B-STRANGER",
    username: "用户乙",
    userPhone: "13922222222",
    installationAddress: "厚街镇莞太路99号"
  };

  const merged = mergeOssOnuRows(primary, secondaryWithConflictingLoid);

  // Identity conflict: primary hardware and user fields must NOT be overwritten by secondary
  assert.equal(merged.loid, "LOID-USER-A");
  assert.equal(merged.serial, "SN-USER-A");
  assert.equal(merged.mac, "AA:BB:CC:DD:EE:01");
  assert.equal(merged.deviceNumber, "DEV-USER-A");
  assert.equal(merged.username, "用户甲");
  assert.equal(merged.userPhone, "13911111111");
  assert.equal(merged.installationAddress, "厚街镇康乐南路1号");
  assert.equal(merged.duplicateCount, 2);
  assert.ok(merged.duplicateConflicts.some((c) => c.includes("LOID差异")));
});

test("readGridRows fails closed if page rows received are less than total count", async () => {
  const client = new OssNgbClient({
    authBaseUrl: "http://auth.example.test",
    ngbBaseUrl: "http://ngb.example.test",
    requestImpl: async (target, options = {}) => {
      const url = new URL(target);
      const body = String(options.body || "");
      if (url.pathname === "/ngb/ResDevAction/config.do") return { status: 200, headers: {}, text: "page" };
      if (url.pathname.includes("getGridPageInfo")) return { status: 200, headers: {}, text: dwrReply({ totalCount: 100 }) };
      if (url.pathname.includes("getGridData")) {
        // Upstream returns only 50 rows instead of expected 100
        return { status: 200, headers: {}, text: dwrReply({ list: [{ CUID: "1", ONUDEVICEINDEX: "1/1/1:1" }] }) };
      }
      throw new Error(`unexpected request: ${url.pathname}`);
    }
  });

  await assert.rejects(() => client.readOnuInventory("OLT-1", { pageSize: 100 }), (error) => {
    assert.equal(error.status, 502);
    assert.match(error.message, /分页数据不完整/);
    return true;
  });
});

test("readGridRows fails closed when totalCount exceeds safe maximum rows", async () => {
  const client = new OssNgbClient({
    authBaseUrl: "http://auth.example.test",
    ngbBaseUrl: "http://ngb.example.test",
    requestImpl: async (target) => {
      const url = new URL(target);
      if (url.pathname === "/ngb/ResDevAction/config.do") return { status: 200, headers: {}, text: "page" };
      if (url.pathname.includes("getGridPageInfo")) return { status: 200, headers: {}, text: dwrReply({ totalCount: 10001 }) };
      throw new Error(`unexpected request: ${url.pathname}`);
    }
  });

  await assert.rejects(() => client.readOnuInventory("OLT-1", { maxRows: 10000 }), (error) => {
    assert.equal(error.status, 502);
    assert.match(error.message, /超过单台上限/);
    return true;
  });
});
