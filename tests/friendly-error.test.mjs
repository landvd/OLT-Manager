import test from "node:test";
import assert from "node:assert/strict";
import { friendlyErrorMessage } from "../src/friendly-error.mjs";

test("friendly error strips trace ids and adds actionable hints", () => {
  assert.equal(
    friendlyErrorMessage("验证码为空，请填写验证码 traceId=4a20d06dc9a8a644"),
    "验证码为空，请填写验证码。二期网管要求输入验证码，当前无法自动登录。请稍后重试，或先在网管网页端登录一次。"
  );
  assert.equal(friendlyErrorMessage("登录失败 (requestId: abc-123)"), "登录失败");
  assert.match(friendlyErrorMessage("connect ETIMEDOUT 10.205.136.199:18140"), /网络是否可达/);
  assert.equal(friendlyErrorMessage("OLT 不存在。"), "OLT 不存在。");
  assert.equal(friendlyErrorMessage(""), "请求失败");
  assert.equal(friendlyErrorMessage(undefined, "加载失败"), "加载失败");
});
