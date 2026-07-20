import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const indexPath = new URL("../../index.html", import.meta.url);

test("raw homepage HTML identifies PromotionSure and explains its purpose", async () => {
  const html = await readFile(indexPath, "utf8");

  assert.match(html, /<h1>PromotionSure<\/h1>/);
  assert.match(html, /public service promotion examinations/);
  assert.match(html, /objective questions and oral responses/);
  assert.match(html, /Google account name and email only/);
  assert.match(html, /href="\/privacy"/);
  assert.match(html, /href="\/terms"/);
});
