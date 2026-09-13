import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.OLT_MANAGER_DATA_DIR = await mkdtemp(join(tmpdir(), "olt-manager-nmse-boss-idempotent-"));
const db = await import("../src/db.mjs");
const { normalizeBossChange } = await import("../src/nmse-boss-sync.mjs");

const change = (input) => normalizeBossChange({ processStatus: "成功", installationAddress: "厚街镇测试地址", ...input });

test("BOSS incremental changes safely accept idempotent replays with evolved upstream fields", async () => {
  await db.initDb();
  await db.initializeNmseBossSyncState({ watermark: "2026-09-07 00:00:00" });

  // 1. 初始入库一条报装工单
  const initialInstall = change({
    operation: "报装",
    workOrder: "order-1001",
    LOID: "USER-1001",
    receivedAt: "2026-09-07 01:00:00",
    oltIp: "192.0.2.10",
    onuIndex: "1/1/1:1",
    username: "张三",
    userPhone: "13800000000",
    installationAddress: "厚街镇第一大道1号",
    mac: "AABBCCDDEE01",
    pon: "1",
    ponType: "GPON",
    deviceType: "普通网关"
  });

  await db.applyNmseBossIncrementalChanges({
    rows: [initialInstall],
    watermark: "2026-09-08 00:00:00",
    windowStart: "2026-09-07 00:00:00",
    windowEnd: "2026-09-08 00:00:00"
  });

  let users = await db.getResourceUsers({});
  assert.equal(users.length, 1);
  assert.equal(users[0].loid, "USER-1001");
  assert.equal(users[0].onuIndex, "1/1/1:1");
  assert.equal(users[0].deviceType, "普通网关");

  // 2. 次日增量由于重叠 1 天再次读到该工单，但上游动态详情接口返回了演进后的最新字段（如更换光猫、新地址、补齐MAC等）
  const replayedWithEvolvedFields = change({
    operation: "报装",
    workOrder: "order-1001", // 相同的幂等键
    LOID: "USER-1001",
    receivedAt: "2026-09-07 01:00:00",
    oltIp: "192.0.2.10",
    onuIndex: "1/1/1:1",
    username: "张三丰", // 姓名补全
    userPhone: "13800009999", // 电话更新
    installationAddress: "厚街镇第一大道1号201室", // 地址补全
    mac: "AABBCCDDEE99", // MAC 变化
    pon: "1",
    ponType: "GPON",
    deviceType: "智能光猫网关" // 设备型号变动
  });

  // 同批还有一条真正的新工单
  const newOrder = change({
    operation: "报装",
    workOrder: "order-1002",
    LOID: "USER-1002",
    receivedAt: "2026-09-08 02:00:00",
    oltIp: "192.0.2.10",
    onuIndex: "1/1/1:2",
    username: "李四",
    userPhone: "13900000000",
    installationAddress: "厚街镇第二大道2号"
  });

  // 应该平滑幂等放行，不抛出 "BOSS 同一幂等键对应的业务字段发生冲突" 409 异常
  const result = await db.applyNmseBossIncrementalChanges({
    rows: [replayedWithEvolvedFields, newOrder],
    watermark: "2026-09-09 00:00:00",
    windowStart: "2026-09-07 00:00:00",
    windowEnd: "2026-09-09 00:00:00"
  });

  assert.equal(result.watermark, "2026-09-09 00:00:00");

  users = await db.getResourceUsers({});
  assert.equal(users.length, 2);
  const user1 = users.find((u) => u.loid === "USER-1001");
  const user2 = users.find((u) => u.loid === "USER-1002");
  assert.ok(user1);
  assert.ok(user2);
  assert.equal(user2.username, "李四");

  // 3. 但如果同一幂等键的核心 operation 发生颠覆性冲突（如报装变成销户），必须 fail-closed 拦截
  const conflictOperation = change({
    operation: "销户",
    workOrder: "order-1001", // 相同单号相同接收时间但操作类型冲突
    LOID: "USER-1001",
    receivedAt: "2026-09-07 01:00:00"
  });

  await assert.rejects(
    db.applyNmseBossIncrementalChanges({
      rows: [conflictOperation],
      watermark: "2026-09-10 00:00:00",
      windowStart: "2026-09-07 00:00:00",
      windowEnd: "2026-09-10 00:00:00"
    }),
    /业务操作类型发生冲突/
  );
});
