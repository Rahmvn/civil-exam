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
  await page.getByRole("button", { name: "Delete unused draft" }).click();
  await page.getByRole("dialog", { name: "Delete this unused draft?" })
    .getByRole("button", { name: "Delete unused draft" })
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
      [1, "Which record should be checked first?", "Vote book", "Visitor log", "Blank form", "Personal note", "A", "", "", "medium"],
      [2, "Who authorises the control?", "Designated officer", "Visitor", "Vendor", "No one", "A", "", "", "easy"],
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

  await page.getByRole("button", { name: "Withdraw temporarily" }).click();
  await page.getByRole("dialog", { name: "Withdraw this practice set temporarily?" })
    .getByRole("button", { name: "Withdraw temporarily" }).click();
  await expect(page.getByText("Withdrawn", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Republish unchanged" }).click();
  await page.getByRole("dialog", { name: "Republish this unchanged version?" })
    .getByRole("button", { name: "Republish unchanged" }).click();
  await expect(page.getByText("Published", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "Create corrected replacement" }).click();
  const replacementDialog = page.getByRole("dialog", { name: "Create a corrected replacement?" });
  await replacementDialog.getByLabel("Copy existing questions").check();
  await replacementDialog.getByRole("button", { name: "Create replacement" }).click();
  await expect(page.getByText("Replacement draft created", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Send for review" }).click();
  await page.getByRole("dialog", { name: "Send this set to review?" })
    .getByRole("button", { name: "Send to review" }).click();
  await page.getByRole("button", { name: "Publish replacement" }).click();
  await page.getByRole("dialog", { name: "Publish this replacement?" })
    .getByRole("button", { name: "Publish replacement" }).click();
  await expect(page.getByText("Replacement published", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: moduleName }).click();
  await expect(page.getByText("Not on sale", { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("admin can create, import, review, and publish an oral practice module", async ({ page }, testInfo) => {
  const suffix = `${testInfo.project.name}-${Date.now()}`.replace(/[^a-z0-9]+/gi, "-");
  const moduleName = `E2E Oral Admin ${suffix}`;

  await page.goto("/admin");
  await page.getByRole("button", { name: "Create module" }).click();
  const moduleDialog = page.getByRole("dialog", { name: "Create module" });
  await moduleDialog.getByLabel("Module name").fill(moduleName);
  await moduleDialog.getByLabel("Oral practice").check();
  await expect(moduleDialog.getByLabel("Questions per practice set")).toHaveValue("5");
  await expect(moduleDialog.getByLabel("Pass mark (%)")).toHaveCount(0);
  await moduleDialog.getByLabel("Module price (NGN)").fill("2000");
  await moduleDialog.getByRole("button", { name: "Create module" }).click();

  const moduleRow = page.locator(".admin-module-row").filter({ hasText: moduleName });
  await expect(moduleRow.getByText("Oral practice", { exact: true })).toBeVisible();
  await moduleRow.getByRole("button", { name: "Open" }).click();
  await page.getByRole("button", { name: "Add practice set" }).click();
  await page.getByLabel("Questions required").fill("2");
  await page.getByRole("button", { name: "Add draft set" }).click();

  await page.getByRole("button", { name: "Add one question" }).click();
  await expect(page.getByLabel("Model answer")).toBeVisible();
  await expect(page.getByLabel("Key point 1")).toBeVisible();
  await expect(page.getByLabel("Option A")).toHaveCount(0);
  await page.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "Upload questions" }).click();
  const uploadDialog = page.getByRole("dialog", { name: "Upload questions" });
  await expect(uploadDialog.getByRole("heading", { name: "Upload oral questions" })).toBeVisible();
  await expect(uploadDialog.getByRole("button", { name: "Download oral CSV template" })).toBeVisible();
  await expect(uploadDialog.getByRole("button", { name: "Download oral JSON example" })).toBeVisible();
  await expect(uploadDialog.getByText("Use the oral template fields, not answer options A-D.", { exact: false })).toBeVisible();
  await uploadDialog.locator(".admin-file-drop input").setInputFiles({
    name: "oral-questions.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify([
      {
        batch_position: 1,
        question_text: "Explain accountability in public service.",
        model_answer: "Accountability means being answerable for decisions and public resources.",
        key_points: ["Answerability", "Responsible use of resources"],
        reference_note: "PSR",
        difficulty: "medium",
      },
      {
        batch_position: 2,
        question_text: "Describe due process.",
        model_answer: "Due process follows approved and documented procedures.",
        key_points: ["Approved procedure", "Documented decisions"],
        difficulty: "easy",
      },
    ])),
  });

  await expect(uploadDialog.getByText("2 questions found")).toBeVisible();
  await expect(uploadDialog.getByText("2 key points", { exact: true }).first()).toBeVisible();
  await uploadDialog.getByRole("button", { name: "Import 2 questions" }).click();
  await expect(page.getByText("2 questions were imported into this set.")).toBeVisible();
  await expect(page.getByText("Explain accountability in public service.", { exact: true })).toBeVisible();
  await expect(page.getByText("Correct answer:")).toHaveCount(0);

  await page.getByRole("button", { name: "Preview", exact: true }).first().click();
  const preview = page.getByRole("dialog", { name: "Question 1" });
  await expect(preview.getByText("Model answer", { exact: true })).toBeVisible();
  await expect(preview.getByText("Answerability", { exact: true })).toBeVisible();
  await preview.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "Send for review" }).click();
  await page.getByRole("dialog", { name: "Send this set to review?" })
    .getByRole("button", { name: "Send to review" }).click();
  await page.getByRole("button", { name: "Publish set" }).click();
  await page.getByRole("dialog", { name: "Publish this practice set?" })
    .getByRole("button", { name: "Publish practice set" }).click();

  await page.getByRole("button", { name: moduleName }).click();
  await expect(page.getByText("Oral practice", { exact: true })).toBeVisible();
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
  await page.getByRole("button", { name: "Delete unused draft" }).click();
  await page.getByRole("dialog", { name: "Delete this unused draft?" })
    .getByRole("button", { name: "Delete unused draft" })
    .click();
  await page.getByRole("button", { name: "Delete unused module" }).click();
  await page.getByRole("dialog", { name: "Delete this unused module?" })
    .getByRole("button", { name: "Delete module" })
    .click();

  await expect(page.getByText(moduleName, { exact: true })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test("admin can add, validate, preview, and remove one question without optional guidance", async ({ page }, testInfo) => {
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
  await expect(page.getByLabel("Explanation (optional)")).toBeVisible();
  await page.getByRole("button", { name: "Add question", exact: true }).click();

  await expect(page.getByText(questionText, { exact: true })).toBeVisible();
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
  await page.getByRole("button", { name: "Delete unused draft" }).click();
  await page.getByRole("dialog", { name: "Delete this unused draft?" })
    .getByRole("button", { name: "Delete unused draft" })
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

  await page.getByRole("searchbox", { name: "Search current admin view" }).fill("oral practice");
  await expect(page.locator("summary").filter({ hasText: "Oral practice" })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole("button", { name: "Activity" }).click();
  await expect(page).toHaveURL(/\/admin\/activity$/);
  await expect(page.getByRole("heading", { name: "Activity", exact: true })).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Search current admin view" })).toHaveValue("");
  await expect(page.getByRole("combobox", { name: "Activity filter" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("admin help queue is directly accessible", async ({ page }) => {
  const supportRequests = [
    {
      id: "support-open-e2e",
      category: "technical",
      subject: "Practice page did not respond",
      description: "The timer stopped and the page did not respond when the candidate selected an answer.",
      requester_name: "Test Candidate",
      requester_email: "candidate@example.test",
      payment_reference: null,
      page_path: "/practice/mock-module",
      status: "received",
      resolution_note: null,
      created_at: "2026-07-22T09:10:00.000Z",
      updated_at: "2026-07-22T09:10:00.000Z",
    },
    {
      id: "support-resolved-e2e",
      category: "payment",
      subject: "Module access restored",
      description: "Payment succeeded but access was initially unavailable.",
      requester_name: "Resolved Candidate",
      requester_email: "resolved@example.test",
      payment_reference: "PS-E2E-SUPPORT",
      page_path: "/access",
      status: "resolved",
      resolution_note: "Access was restored after reconciliation.",
      created_at: "2026-07-21T08:00:00.000Z",
      updated_at: "2026-07-21T09:00:00.000Z",
    },
  ];
  await page.route("**/rest/v1/rpc/get_admin_support_queue", async (route) => {
    const status = route.request().postDataJSON()?.requested_status ?? "open";
    const items = status === "all" ? supportRequests : supportRequests.filter((request) => (
      status === "open" ? ["received", "in_review"].includes(request.status) : request.status === status
    ));
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        items,
        total: items.length,
        counts: { open: 1, received: 1, in_review: 0, resolved: 1, closed: 0, all: 2 },
        limit: 25,
        offset: 0,
        has_more: false,
      }),
    });
  });

  await page.goto("/admin/help");
  await expect(page.getByRole("heading", { name: "Help requests", exact: true })).toBeVisible();
  await expect(page.getByPlaceholder("Search subject, candidate, email, or reference")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Help request status" })).toHaveValue("open");
  await expect(page.locator(".admin-support-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".admin-support-table thead")).toContainText("Request");
  await expect(page.locator(".admin-support-table thead")).toContainText("Candidate");
  await expect(page.locator(".admin-support-layout")).toHaveCount(0);

  await page.getByRole("combobox", { name: "Help request status" }).selectOption("all");
  await expect(page.locator(".admin-support-table tbody tr")).toHaveCount(2);
  await page.getByRole("button", { name: /Module access restored/ }).click();
  const requestDrawer = page.getByRole("dialog", { name: "Module access restored" });
  await expect(requestDrawer).toBeVisible();
  await expect(requestDrawer.getByText("Access was restored after reconciliation.")).toBeVisible();
  await requestDrawer.getByText("Handling checklist").click();
  await expect(requestDrawer.getByText(/Do not ask the candidate to pay again/)).toBeVisible();
  await expect(requestDrawer.getByRole("button", { name: "Save changes" })).toBeVisible();
  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(accessibility.violations.filter((violation) =>
    ["serious", "critical"].includes(violation.impact))).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(requestDrawer).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test("admin payment attention queue identifies paid access mismatches", async ({ page }) => {
  await page.route("**/rest/v1/rpc/get_admin_payment_attention", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([{
        payment_order_id: "payment-attention-e2e",
        user_id: "candidate-attention-e2e",
        requester_name: "Affected Candidate",
        requester_email: "affected@example.test",
        subject_id: "subject-attention-e2e",
        subject_name: "Public Service Rules",
        subject_slug: "public-service-rules",
        provider_reference: "PS-ATTENTION-E2E",
        amount_kobo: 250000,
        currency: "NGN",
        paid_at: "2026-07-22T04:00:00.000Z",
        created_at: "2026-07-22T03:55:00.000Z",
        provider_status: "success",
        fulfillment_status: "failed",
        fulfillment_error: "Access activation must be retried",
        review_status: "clear",
        attention_type: "access_issue",
        entitlement_status: null,
        access_expires_at: null,
        support_request_id: "support-attention-e2e",
        support_request_status: "received",
      }]),
    });
  });

  await page.goto("/admin/payments");
  await expect(page.getByRole("heading", { name: "Payment attention", exact: true })).toBeVisible();
  await expect(page.getByText("PS-ATTENTION-E2E", { exact: true })).toBeVisible();
  await expect(page.getByText("Affected Candidate", { exact: true })).toBeVisible();
  await expect(page.getByText("Access issue", { exact: true })).toBeVisible();
  await expect(page.getByText("Access activation must be retried", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open help request" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("admin catalogue excludes WhatsApp support and has no serious accessibility violations", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Content", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Chat with PromotionSure support on WhatsApp" })).toHaveCount(0);

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

test("published admin questions and replacement controls survive durable URL reloads", async ({ page }) => {
  await page.goto("/admin");
  const moduleRow = page.locator(".admin-module-row").filter({ hasText: "Public Financial Management" });
  await moduleRow.getByRole("button", { name: "Open" }).click();
  await expect(page).toHaveURL(/\/admin\/modules\/[^/]+$/);
  await page.locator(".admin-set-list article").first().getByRole("button", { name: "Open" }).click();
  await expect(page).toHaveURL(/\/admin\/modules\/[^/]+\/sets\/[^/]+$/);
  await expect(page.getByRole("heading", { name: /Practice set \d+/ })).toBeVisible();

  const questionRows = page.locator(".admin-question-rows article");
  await expect(questionRows.first()).toBeVisible();
  await expect(page.getByText("Checking", { exact: true })).toHaveCount(0);
  await expect(questionRows.first().getByRole("button", { name: "Preview" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create corrected replacement" })).toBeVisible();
  await expect(questionRows.first().getByRole("button", { name: "Edit" })).toHaveCount(0);
  await expect(questionRows.first().getByRole("button", { name: "Remove" })).toHaveCount(0);

  const setUrl = page.url();
  await page.reload();
  await expect(page).toHaveURL(setUrl);
  await expect(questionRows.first()).toBeVisible();
  await expect(page.getByText("Checking", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create corrected replacement" })).toBeVisible();
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
