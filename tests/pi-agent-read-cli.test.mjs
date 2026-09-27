import test from "node:test";
import assert from "node:assert/strict";
import {
  validateReadOnlyCliCommand,
  sanitizeCliOutput,
  createPiAgentToolExecutor,
  PI_AGENT_TOOL_DEFINITIONS
} from "../src/pi-agent/agent-tools.mjs";

test("PI_AGENT_TOOL_DEFINITIONS 包含受限只读 read_olt_cli 工具定义", () => {
  const tool = PI_AGENT_TOOL_DEFINITIONS.find((t) => t.function?.name === "read_olt_cli");
  assert.ok(tool, "read_olt_cli 必须在工具定义中注册");
  assert.equal(tool.type, "function");
  assert.ok(tool.function.description.includes("4 重安全看门狗"));
  assert.deepEqual(tool.function.parameters.required, ["command"]);
});

test("看门狗防线一：命令前缀白名单严格匹配厂商", () => {
  // 中兴 OLT 必须以 show 开头
  const zteValid = validateReadOnlyCliCommand("show card", { vendor: "zte" });
  assert.equal(zteValid.valid, true);
  assert.equal(zteValid.sanitizedCommand, "show card");

  const zteUpper = validateReadOnlyCliCommand("SHOW VERSION", { vendor: "zte" });
  assert.equal(zteUpper.valid, true);

  const zteInvalidPrefix = validateReadOnlyCliCommand("display board 0", { vendor: "zte" });
  assert.equal(zteInvalidPrefix.valid, false);
  assert.match(zteInvalidPrefix.error, /中兴 OLT 只读命令必须且仅限以 'show ' 开头/);

  // 华为 MA5800 必须以 display 开头
  const hwValid = validateReadOnlyCliCommand("display board 0", { vendor: "huawei" });
  assert.equal(hwValid.valid, true);
  assert.equal(hwValid.sanitizedCommand, "display board 0");

  const hwInvalidPrefix = validateReadOnlyCliCommand("show card", { vendor: "huawei" });
  assert.equal(hwInvalidPrefix.valid, false);
  assert.match(hwInvalidPrefix.error, /华为 MA5800 只读命令必须且仅限以 'display ' 开头/);

  // 未提供命令或空字符串拦截
  assert.equal(validateReadOnlyCliCommand("", { vendor: "zte" }).valid, false);
  assert.equal(validateReadOnlyCliCommand("   ", { vendor: "huawei" }).valid, false);
});

test("看门狗防线二：多命令拼接与管道注入严格阻断", () => {
  const injections = [
    "show card; reboot",
    "show card & write",
    "show card && reboot",
    "show card | grep admin",
    "show card\nreboot",
    "show card\r\nreboot",
    "show card > /dev/null",
    "show card < /etc/shadow",
    "show card $(whoami)",
    "show card `reboot`",
    "show card \\ reboot"
  ];

  for (const cmd of injections) {
    const res = validateReadOnlyCliCommand(cmd, { vendor: "zte" });
    assert.equal(res.valid, false, `应拦截拼接注入命令: ${cmd}`);
    assert.match(res.error, /分号、管道、重定向或命令连接符/);
  }
});

test("看门狗防线三：高危敏感与写操作黑名单全词拦截", () => {
  const dangerousCommands = [
    "show running-config",
    "show config-info",
    "show configure",
    "display current-configuration",
    "show card set speed 100",
    "show card undo port 1",
    "show card delete",
    "show card del",
    "show reboot",
    "show reset",
    "show reload",
    "show shutdown",
    "show write",
    "show save",
    "show erase",
    "show format",
    "show enable",
    "show super",
    "show terminal",
    "show debug",
    "show download",
    "show upload",
    "show tftp",
    "show password",
    "show user",
    "show community",
    "display ont add 1",
    "display ont modify 1"
  ];

  for (const cmd of dangerousCommands) {
    const vendor = cmd.startsWith("display") ? "huawei" : "zte";
    const res = validateReadOnlyCliCommand(cmd, { vendor });
    assert.equal(res.valid, false, `必须拦截包含高危词汇的命令: ${cmd}`);
    assert.match(res.error, /包含受限敏感关键词/);
  }
});

test("看门狗防线四：合法只读命令安全放行并不误伤子词", () => {
  // display mac-address 中包含 address，但不能被 add 拦截
  const macCmd = validateReadOnlyCliCommand("display mac-address 0/1/1", { vendor: "huawei" });
  assert.equal(macCmd.valid, true);

  // 合法常用只读命令全部通过
  const safeZteList = [
    "show card",
    "show version",
    "show alarm current",
    "show fan",
    "show environment",
    "show mac",
    "show vlan summary",
    "show uplink interface"
  ];
  for (const cmd of safeZteList) {
    const res = validateReadOnlyCliCommand(cmd, { vendor: "zte" });
    assert.equal(res.valid, true, `中兴合法只读命令应放行: ${cmd}`);
  }

  const safeHuaweiList = [
    "display board 0",
    "display version",
    "display alarm active all",
    "display fan 0",
    "display temperature all"
  ];
  for (const cmd of safeHuaweiList) {
    const res = validateReadOnlyCliCommand(cmd, { vendor: "huawei" });
    assert.equal(res.valid, true, `华为合法只读命令应放行: ${cmd}`);
  }

  // 超过 120 字符长度限制被拦截
  const tooLong = "show card " + "a".repeat(120);
  const lenRes = validateReadOnlyCliCommand(tooLong, { vendor: "zte" });
  assert.equal(lenRes.valid, false);
  assert.match(lenRes.error, /超过 120 字符限制/);
});

test("输出安全脱敏与 50KB 缓冲区限制", () => {
  // 正常输出保持
  const normal = "Slot  CardType  Status\n1     GTGH      INSERVICE";
  assert.equal(sanitizeCliOutput(normal), normal);

  // 敏感 community 与 password 脱敏
  const sensitive = "snmp-agent community read public123\nlogin password mySecretPassword";
  const sanitized = sanitizeCliOutput(sensitive);
  assert.ok(!sanitized.includes("public123"), "不得泄露 community");
  assert.ok(!sanitized.includes("mySecretPassword"), "不得泄露 password");
  assert.ok(sanitized.includes("******"));

  // 50KB 限制截断
  const hugeText = "X".repeat(60 * 1024);
  const truncated = sanitizeCliOutput(hugeText, 50 * 1024);
  assert.ok(truncated.length < 55 * 1024);
  assert.ok(truncated.includes("单次只读安全上限 50KB"));
});

test("Pi Agent toolExecutor 调度 read_olt_cli 行为断言", async () => {
  const mockOlts = [
    {
      id: "zte-mock-1",
      vendor: "zte",
      host: "10.0.0.1",
      telnetPort: 23,
      telnetUsername: "admin",
      telnetPassword: "password"
    },
    {
      id: "hw-mock-2",
      vendor: "huawei",
      host: "10.0.0.2",
      telnetPort: 23,
      telnetUsername: "admin",
      telnetPassword: "password"
    },
    {
      id: "no-telnet-olt",
      vendor: "zte",
      host: "10.0.0.3"
      // 无 telnet 凭据
    }
  ];

  let executedCalls = [];
  const executor = createPiAgentToolExecutor({
    getOlts: async () => mockOlts,
    runReadOnlyCliCommand: async ({ olt, command }) => {
      executedCalls.push({ oltId: olt.id, command });
      return {
        status: "success",
        oltId: olt.id,
        vendor: olt.vendor,
        command,
        output: `Mock CLI Output for ${command}`
      };
    }
  });

  // 1. 成功调用中兴 show card
  const res1 = await executor("read_olt_cli", {
    oltId: "zte-mock-1",
    command: "show card"
  });
  assert.equal(res1.status, "success");
  assert.equal(res1.command, "show card");
  assert.equal(res1.output, "Mock CLI Output for show card");
  assert.equal(executedCalls.length, 1);

  // 2. 看门狗拦截：试图在中兴上执行写配置
  const resBlocked = await executor("read_olt_cli", {
    oltId: "zte-mock-1",
    command: "show running-config"
  });
  assert.equal(resBlocked.status, "blocked_by_guard");
  assert.match(resBlocked.error, /受限敏感关键词/);
  assert.equal(executedCalls.length, 1, "看门狗拦截不应透传到底层执行");

  // 3. 看门狗拦截：华为上使用 show
  const resHwWrong = await executor("read_olt_cli", {
    oltId: "hw-mock-2",
    command: "show card"
  });
  assert.equal(resHwWrong.status, "blocked_by_guard");
  assert.match(resHwWrong.error, /华为 MA5800 只读命令必须且仅限以 'display ' 开头/);

  // 4. 缺少凭据的 OLT（使用默认无 runReadOnlyCliCommand 时）
  const fallbackExecutor = createPiAgentToolExecutor({
    getOlts: async () => mockOlts
  });
  const resNoCreds = await fallbackExecutor("read_olt_cli", {
    oltId: "no-telnet-olt",
    command: "show card"
  });
  assert.equal(resNoCreds.status, "credentials_missing");
  assert.match(resNoCreds.error, /未配置 Telnet 访问凭据/);
});
