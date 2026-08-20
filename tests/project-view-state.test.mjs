import test from "node:test";
import assert from "node:assert/strict";
import {
  blankProjectForm,
  projectFormFor,
  projectOnuRowClassName,
  projectPayloadFor
} from "../src/project-view-state.mjs";

test("project form state uses safe defaults and preserves editable fields", () => {
  assert.deepEqual(blankProjectForm(), {
    id: "", name: "", vlan: 100, address: "", contactName: "", contactPhone: "", contactNote: ""
  });
  assert.deepEqual(projectFormFor({ id: "p-1", name: "项目", vlan: "200", address: null, contactName: "张三" }), {
    id: "p-1", name: "项目", vlan: 200, address: "", contactName: "张三", contactPhone: "", contactNote: ""
  });
});

test("project payload trims user input without returning the form object", () => {
  const form = { id: "p-1", name: " 项目 ", vlan: 300, address: " 地址 ", contactPhone: " 138 ", contactNote: null };
  assert.deepEqual(projectPayloadFor(form), {
    name: "项目", vlan: 300, address: "地址", contactName: "", contactPhone: "138", contactNote: ""
  });
  assert.equal(Object.hasOwn(projectPayloadFor(form), "id"), false);
});

test("project ONU row selection is presentation-only", () => {
  assert.equal(projectOnuRowClassName({ id: 1 }, { id: 1 }), "selected-row");
  assert.equal(projectOnuRowClassName({ id: 1 }, { id: 2 }), "");
  assert.equal(projectOnuRowClassName(null, { id: 1 }), "");
});
