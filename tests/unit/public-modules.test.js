import assert from "node:assert/strict";
import test from "node:test";
import { normalizePublicModules } from "../../src/lib/publicModules.js";

test("public module rows preserve current availability in server order", () => {
  assert.deepEqual(normalizePublicModules([
    {
      name: " Public Financial Management ",
      slug: "public-financial-management",
      practice_type: "objective",
      availability_status: "available",
    },
    {
      name: "Oral Questions",
      slug: "oral-questions",
      practice_type: "oral",
      availability_status: "coming_soon",
    },
  ]), [
    {
      name: "Public Financial Management",
      slug: "public-financial-management",
      practiceType: "objective",
      status: "available",
    },
    {
      name: "Oral Questions",
      slug: "oral-questions",
      practiceType: "oral",
      status: "coming_soon",
    },
  ]);
});

test("public module rows discard malformed or private lifecycle values", () => {
  assert.deepEqual(normalizePublicModules([
    null,
    { name: "Draft module", slug: "draft", availability_status: "draft" },
    { name: "Missing slug", availability_status: "available" },
  ]), []);
  assert.deepEqual(normalizePublicModules(null), []);
});
