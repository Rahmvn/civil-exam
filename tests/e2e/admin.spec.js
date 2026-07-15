import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { strToU8, zipSync } from "fflate";
import { expectNoHorizontalOverflow } from "./helpers.js";

function createXlsxBuffer(rows) {
  const escapeXml = (value) => String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
  const columnName = (index) => String.fromCharCode(65 + index);
  const sheetRows = rows.map((row, rowIndex) => (
    `<row r="${rowIndex + 1}">${row.map((cell, columnIndex) => (
      `<c r="${columnName(columnIndex)}${rowIndex + 1}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell)}</t></is></c>`
    )).join("")}</row>`
  )).join("");

  return Buffer.from(zipSync({
    "[Content_Types].xml": strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'),
    "_rels/.rels": strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    "xl/workbook.xml": strToU8('<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Questions" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    "xl/_rels/workbook.xml.rels": strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
    "xl/worksheets/sheet1.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`),
  }));
}

test("admin can create and safely remove unused content", async ({ page }, testInfo) => {
  const suffix = testInfo.project.name.includes("mobile") ? "Mobile" : "Desktop";
  const moduleName = `E2E Admin ${suffix} Module`;

  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Content", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Create module" }).click();
  const moduleDialog = page.getByRole("dialog", { name: "Create module" });
  await moduleDialog.getByLabel("Module name").fill(moduleName);
  await moduleDialog.getByLabel("Module price (NGN)").fill("1800");
  await moduleDialog.getByRole("button", { name: "Create module" }).click();

  const moduleCard = page.locator("article").filter({ hasText: moduleName });
  await expect(moduleCard).toBeVisible();
  await expect(moduleCard.getByText("Draft", { exact: true })).toBeVisible();
  await moduleCard.getByRole("button", { name: "Open" }).click();

  await expect(page.getByRole("heading", { name: moduleName })).toBeVisible();
  await page.getByRole("button", { name: "Add practice set" }).click();
  await page.getByLabel("Questions required").fill("2");
  await page.getByRole("button", { name: "Add draft set" }).click();

  await expect(page.getByRole("heading", { name: "Practice set 1" })).toBeVisible();
  await expect(page.getByText("Needs attention", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Delete empty set" }).click();
  await page.getByRole("dialog", { name: "Delete this empty practice set?" })
    .getByRole("button", { name: "Delete practice set" })
    .click();

  await expect(page.getByRole("heading", { name: moduleName })).toBeVisible();
  await page.getByRole("button", { name: "Delete unused module" }).click();
  await page.getByRole("dialog", { name: "Delete this unused module?" })
    .getByRole("button", { name: "Delete module" })
    .click();

  await expect(page.getByRole("heading", { name: "Content", exact: true })).toBeVisible();
  await expect(page.getByText(moduleName, { exact: true })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test("admin can bulk upload, review, and publish without silently enabling sales", async ({ page }, testInfo) => {
  const suffix = `${testInfo.project.name}-${Date.now()}`.replace(/[^a-z0-9]+/gi, "-");
  const moduleName = `E2E Import ${suffix}`;

  await page.goto("/admin");
  await page.getByRole("button", { name: "Create module" }).click();
  const moduleDialog = page.getByRole("dialog", { name: "Create module" });
  await moduleDialog.getByLabel("Module name").fill(moduleName);
  await moduleDialog.getByLabel("Module price (NGN)").fill("1800");
  await moduleDialog.getByRole("button", { name: "Create module" }).click();

  const moduleRow = page.locator(".admin-module-row").filter({ hasText: moduleName });
  await moduleRow.getByRole("button", { name: "Open" }).click();
  await page.getByRole("button", { name: "Add practice set" }).click();
  await page.getByLabel("Questions required").fill("2");
  await page.getByRole("button", { name: "Add draft set" }).click();

  await page.getByRole("button", { name: "Upload questions" }).click();
  await page.locator(".admin-file-drop input").setInputFiles({
    name: "e2e-question-upload.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: createXlsxBuffer([
      ["position", "question_text", "option_a", "option_b", "option_c", "option_d", "correct_answer", "explanation", "reference", "difficulty"],
      [1, "Which record should be checked first?", "Vote book", "Visitor log", "Blank form", "Personal note", "A", "The vote book is the official control record.", "E2E source", "medium"],
      [2, "Who authorises the control?", "Designated officer", "Visitor", "Vendor", "No one", "A", "The designated officer is responsible.", "E2E source", "easy"],
    ]),
  });

  await expect(page.getByText("2 questions found")).toBeVisible();
  await expect(page.getByText("All rows passed the initial checks")).toBeVisible();
  await page.getByRole("button", { name: "Import 2 questions" }).click();
  await expect(page.getByText("2 questions were imported into this set.")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Upload questions" })).toHaveCount(0);
  await expect(page.getByText("Which record should be checked first?", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Send for review" }).click();
  await page.getByRole("dialog", { name: "Send this set to review?" })
    .getByRole("button", { name: "Send to review" })
    .click();
  await expect(page.getByText("In review", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "Publish set" }).click();
  await page.getByRole("dialog", { name: "Publish this practice set?" })
    .getByRole("button", { name: "Publish practice set" })
    .click();
  await expect(page.getByText(/Practice set published\. Use module settings/)).toBeVisible();

  await page.getByRole("button", { name: moduleName }).click();
  await expect(page.getByText("Not on sale", { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("admin import blocks invalid question files without saving partial content", async ({ page }, testInfo) => {
  const suffix = `${testInfo.project.name}-${Date.now()}`.replace(/[^a-z0-9]+/gi, "-");
  const moduleName = `E2E Invalid Import ${suffix}`;

  await page.goto("/admin");
  await page.getByRole("button", { name: "Create module" }).click();
  const moduleDialog = page.getByRole("dialog", { name: "Create module" });
  await moduleDialog.getByLabel("Module name").fill(moduleName);
  await moduleDialog.getByLabel("Module price (NGN)").fill("1800");
  await moduleDialog.getByRole("button", { name: "Create module" }).click();

  const moduleRow = page.locator(".admin-module-row").filter({ hasText: moduleName });
  await moduleRow.getByRole("button", { name: "Open" }).click();
  await page.getByRole("button", { name: "Add practice set" }).click();
  await page.getByLabel("Questions required").fill("1");
  await page.getByRole("button", { name: "Add draft set" }).click();

  await page.getByRole("button", { name: "Upload questions" }).click();
  await page.locator(".admin-file-drop input").setInputFiles({
    name: "invalid-questions.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify([{
      batch_position: 0,
      question_text: "Which option is correct?",
      option_a: "Repeated option",
      option_b: "Repeated option",
      option_c: "Third option",
      option_d: "Fourth option",
      correct_option: "E",
      difficulty: "expert",
    }])),
  });

  const errors = page.getByRole("alert");
  await expect(errors).toContainText("position must be a positive whole number");
  await expect(errors).toContainText("answer options must be different");
  await expect(errors).toContainText("correct answer must be A, B, C, or D");
  await expect(errors).toContainText("difficulty must be easy, medium, or hard");
  await expect(page.getByRole("button", { name: "Import 1 questions" })).toBeDisabled();

  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(accessibility.violations.filter((violation) =>
    ["serious", "critical"].includes(violation.impact))).toEqual([]);

  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog", { name: "Upload questions" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Practice set 1" })).toBeVisible();
  await page.getByRole("button", { name: "Delete empty set" }).click();
  await page.getByRole("dialog", { name: "Delete this empty practice set?" })
    .getByRole("button", { name: "Delete practice set" })
    .click();
  await page.getByRole("button", { name: "Delete unused module" }).click();
  await page.getByRole("dialog", { name: "Delete this unused module?" })
    .getByRole("button", { name: "Delete module" })
    .click();

  await expect(page.getByText(moduleName, { exact: true })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test("admin can add, validate, preview, edit, and remove one question", async ({ page }, testInfo) => {
  const suffix = `${testInfo.project.name}-${Date.now()}`.replace(/[^a-z0-9]+/gi, "-");
  const moduleName = `E2E Manual Question ${suffix}`;
  const questionText = "Which document provides the approved spending control?";

  await page.goto("/admin");
  await page.getByRole("button", { name: "Create module" }).click();
  const moduleDialog = page.getByRole("dialog", { name: "Create module" });
  await moduleDialog.getByLabel("Module name").fill(moduleName);
  await moduleDialog.getByLabel("Module price (NGN)").fill("1800");
  await moduleDialog.getByRole("button", { name: "Create module" }).click();

  const moduleRow = page.locator(".admin-module-row").filter({ hasText: moduleName });
  await moduleRow.getByRole("button", { name: "Open" }).click();
  await page.getByRole("button", { name: "Add practice set" }).click();
  await page.getByLabel("Questions required").fill("1");
  await page.getByRole("button", { name: "Add draft set" }).click();
  await page.getByRole("button", { name: "Add one question" }).click();

  await page.getByLabel("Question", { exact: true }).fill(questionText);
  await page.getByLabel("Option A").fill("Approved vote book");
  await page.getByLabel("Option B").fill("Visitor register");
  await page.getByLabel("Option C").fill("Personal note");
  await page.getByLabel("Option D").fill("Blank form");
  await page.getByRole("button", { name: "Add question", exact: true }).click();

  await expect(page.getByText(questionText, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send for review" })).toBeDisabled();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Explanation").fill("The approved vote book is the authorised spending control.");
  await page.getByRole("button", { name: "Save question" }).click();

  await expect(page.getByRole("button", { name: "Send for review" })).toBeEnabled();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  const previewDialog = page.getByRole("dialog", { name: "Question 1" });
  await expect(previewDialog.getByText(questionText, { exact: true })).toBeVisible();
  await expect(previewDialog.getByText("Approved vote book", { exact: true })).toBeVisible();
  await expect(previewDialog.getByText("Correct answer", { exact: true })).toBeVisible();
  await previewDialog.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "Remove" }).click();
  await page.getByRole("dialog", { name: "Remove this question?" })
    .getByRole("button", { name: "Remove question" })
    .click();
  await expect(page.getByText(questionText, { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Delete empty set" }).click();
  await page.getByRole("dialog", { name: "Delete this empty practice set?" })
    .getByRole("button", { name: "Delete practice set" })
    .click();
  await page.getByRole("button", { name: "Delete unused module" }).click();
  await page.getByRole("dialog", { name: "Delete this unused module?" })
    .getByRole("button", { name: "Delete module" })
    .click();

  await expect(page.getByText(moduleName, { exact: true })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test("admin guide and activity remain directly accessible and searchable", async ({ page }) => {
  await page.goto("/admin/guide");
  await expect(page.getByRole("heading", { name: "Admin guide" })).toBeVisible();
  await page.getByRole("searchbox", { name: "Search current admin view" }).fill("bulk import");
  await expect(page.locator("summary").filter({ hasText: "Bulk import" })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole("button", { name: "Activity" }).click();
  await expect(page).toHaveURL(/\/admin\/activity$/);
  await expect(page.getByRole("heading", { name: "Activity", exact: true })).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Search current admin view" })).toHaveValue("");
  await expect(page.getByRole("combobox", { name: "Activity filter" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("admin catalogue has no serious automated accessibility violations", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Content", exact: true })).toBeVisible();

  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const seriousViolations = results.violations.filter((violation) =>
    ["serious", "critical"].includes(violation.impact));
  expect(seriousViolations).toEqual([]);
});

test("admin catalogue keeps its management layout at each breakpoint", async ({ page }, testInfo) => {
  await page.goto("/admin");

  const moduleTable = page.locator(".admin-module-table");
  const moduleRow = page.locator(".admin-module-row").first();
  const activeFilter = page.getByRole("button", { name: /^All/ });
  const inactiveFilter = page.getByRole("button", { name: /^Needs attention/ });

  await expect(moduleTable).toBeVisible();
  await expect(moduleRow).toBeVisible();
  await expect(activeFilter).toHaveClass(/is-active/);

  const filterColors = await Promise.all([
    activeFilter.evaluate((element) => getComputedStyle(element).backgroundColor),
    inactiveFilter.evaluate((element) => getComputedStyle(element).backgroundColor),
  ]);
  expect(filterColors[0]).not.toBe(filterColors[1]);

  if (testInfo.project.name.includes("mobile")) {
    await expect(page.locator(".admin-module-table-head")).toBeHidden();
    const rowColumns = await moduleRow.evaluate((element) => getComputedStyle(element).gridTemplateColumns);
    expect(rowColumns.trim().split(/\s+/)).toHaveLength(2);
  } else {
    await expect(page.locator(".admin-module-table-head")).toBeVisible();
    const rowColumns = await moduleRow.evaluate((element) => getComputedStyle(element).gridTemplateColumns);
    expect(rowColumns.trim().split(/\s+/)).toHaveLength(6);
  }
});

test("admin content workspaces use durable URLs", async ({ page }) => {
  await page.goto("/admin");
  const moduleRow = page.locator(".admin-module-row").filter({ hasText: "Public Service Rules" });
  await moduleRow.getByRole("button", { name: "Open" }).click();
  await expect(page).toHaveURL(/\/admin\/modules\/[^/]+$/);
  await page.locator(".admin-set-list article").first().getByRole("button", { name: "Open" }).click();
  await expect(page).toHaveURL(/\/admin\/modules\/[^/]+\/sets\/[^/]+$/);
  await expect(page.getByRole("heading", { name: /Practice set \d+/ })).toBeVisible();
});

test("admin sessions stay outside the candidate experience", async ({ page }) => {
  for (const path of ["/", "/auth?mode=sign-in", "/dashboard", "/review", "/access"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { name: "Content", exact: true })).toBeVisible();
  }

  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await expect(page.getByText("Exit admin", { exact: true })).toHaveCount(0);
});
