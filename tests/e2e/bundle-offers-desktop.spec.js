import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers.js";

const scalableModuleNames = [
  "Oral: PSR, PFM & Pension",
  "Public Service Rules, Financial Regulations and Administrative Practice",
  "Pension",
  "Foreign Affairs",
  "Health",
  "Legal",
  "Current Affairs",
  "Public Financial Management",
];

async function mockEligibleModules(page, count = 8) {
  await page.route("**/rest/v1/rpc/get_module_access_catalog_v2", async (route) => {
    const response = await route.fetch();
    const rows = await response.json();
    const purchasable = rows.filter((row) => row.can_purchase);
    const seed = purchasable[0] ?? rows[0];
    const generated = Array.from({ length: count }, (_, index) => ({
      ...seed,
      access_expires_at: null,
      can_purchase: true,
      has_module_access: false,
      subject_id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      subject_name: scalableModuleNames[index] ?? `Eligible module ${index + 1}`,
      subject_slug: `e2e-eligible-module-${index + 1}`,
    }));
    await route.fulfill({ response, json: [...generated, ...rows.filter((row) => !row.can_purchase)] });
  });
}

async function mockAccessHub(page, { attention = false } = {}) {
  const names = [
    "Public Financial Management",
    "Oral: PSR, PFM & Pension",
    "Public Service Rules, Financial Regulations and Administrative Practice",
    "Health Policy, Public Administration and Social Development",
    "Pension",
    "Foreign Affairs",
    "Legal",
    "Current Affairs",
  ];

  await page.route("**/rest/v1/rpc/get_module_access_catalog_v2", async (route) => {
    const response = await route.fetch();
    const rows = await response.json();
    const seed = rows[0];
    const modules = names.map((name, index) => ({
      ...seed,
      access_expires_at: index < 2 ? "2028-01-01T00:00:00.000Z" : null,
      can_purchase: index < 7,
      candidate_availability: index === 7 ? "coming_soon" : "available",
      has_module_access: index < 2,
      lifecycle_status: index === 7 ? "coming_soon" : "active",
      published_batch_count: index === 7 ? 0 : 3,
      subject_id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      subject_name: name,
      subject_slug: `access-hub-module-${index + 1}`,
    }));
    await route.fulfill({ response, json: modules });
  });

  await page.route("**/rest/v1/rpc/get_purchase_pricing_catalog_v1", async (route) => {
    const response = await route.fetch();
    const catalog = await response.json();
    await route.fulfill({
      response,
      json: catalog.map((plan) => plan.plan_code === "complete_bundle"
        ? { ...plan, current_available_module_count: 7 }
        : plan),
    });
  });

  await page.route("**/rest/v1/rpc/get_payment_history", async (route) => {
    const bundleItems = names.slice(0, 3).map((subjectName, index) => ({
      subject_id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      subject_name: subjectName,
      subject_slug: `access-hub-module-${index + 1}`,
    }));
    const historyRecord = {
      access_expires_at: "2028-01-01T00:00:00.000Z",
      access_result_kind: "latest",
      amount_kobo: 650000,
      created_at: "2026-08-01T10:00:00.000Z",
      currency: "NGN",
      fulfillment_status: "fulfilled",
      id: "20000000-0000-4000-8000-000000000001",
      paid_at: "2026-08-01T10:01:00.000Z",
      provider_reference: "PS-ACCESS-HISTORY-001",
      provider_status: "success",
      product_label: "3-Module Bundle",
      purchase_label: "3-Module Bundle",
      purchase_scope: "pick_n_modules",
      duration_months: 3,
      item_count: 3,
      items: bundleItems,
      purchase_intent: "purchase",
      record_type: "history",
      receipt_eligible: true,
      review_status: "clear",
      status: "active",
    };
    const historyRecords = [
      historyRecord,
      {
        ...historyRecord,
        amount_kobo: 350000,
        created_at: "2026-08-02T10:00:00.000Z",
        id: "20000000-0000-4000-8000-000000000003",
        paid_at: "2026-08-02T10:01:00.000Z",
        provider_reference: "PS-ACCESS-HISTORY-002",
        product_label: "Pension",
        purchase_label: "Pension",
        purchase_scope: "single_module",
        duration_months: 3,
        item_count: 1,
        items: [{ subject_name: "Pension", subject_slug: "access-hub-module-5" }],
        purchase_intent: "extension",
        access_result_kind: "exact",
      },
      {
        ...historyRecord,
        amount_kobo: 1350000,
        created_at: "2026-08-03T10:00:00.000Z",
        id: "20000000-0000-4000-8000-000000000004",
        paid_at: "2026-08-03T10:01:00.000Z",
        provider_reference: "PS-ACCESS-HISTORY-003",
        product_label: "Complete Module Bundle",
        purchase_label: "Complete Module Bundle",
        purchase_scope: "complete_bundle",
        duration_months: 6,
        item_count: 7,
        items: names.slice(0, 7).map((subjectName, index) => ({
          subject_name: subjectName,
          subject_slug: `access-hub-module-${index + 1}`,
        })),
        access_result_kind: "latest",
      },
    ];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        ...(attention ? [{
          ...historyRecord,
          fulfillment_status: "pending",
          id: "20000000-0000-4000-8000-000000000002",
          provider_reference: "PS-ACCESS-ATTENTION-001",
          record_type: "attention",
          status: "paid",
        }] : []),
        ...historyRecords,
      ]),
    });
  });
}

test("Access hub prioritizes bundles and groups the full authoritative module catalogue", async ({ page }) => {
  await mockAccessHub(page);
  await page.goto("/access");

  await expect(page.getByText("2 active of 8", { exact: true })).toBeVisible();
  await expect(page.getByText("Access all 7 currently available modules", { exact: true })).toBeVisible();
  const offers = page.getByRole("heading", { name: "Bundle options" });
  const modules = page.getByRole("heading", { name: "Your modules", exact: true });
  const history = page.getByRole("heading", { name: "Payment history" });
  const positions = await Promise.all([offers, modules, history].map(async (locator) => (await locator.boundingBox()).y));
  expect(positions[0]).toBeLessThan(positions[1]);
  expect(positions[1]).toBeLessThan(positions[2]);

  await expect(page.getByText("2 active · 5 available · 1 coming soon", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Active" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Available", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Coming soon" })).toBeVisible();
  const unlockedGroup = page.getByRole("heading", { name: "Active" }).locator("xpath=../..");
  const availableGroup = page.getByRole("heading", { name: "Available", exact: true }).locator("xpath=../..");
  await expect(unlockedGroup.locator(".access-module-ledger-row")).toHaveCount(2);
  await expect(availableGroup.locator(".access-module-ledger-row")).toHaveCount(5);
  const comingSoonRow = page.locator(".access-module-ledger-row.is-coming-soon");
  await expect(comingSoonRow).toHaveCount(1);
  await expect(comingSoonRow.getByRole("button")).toHaveCount(0);
  await expect(page.getByText("Public Service Rules, Financial Regulations and Administrative Practice", { exact: true })).toBeVisible();
  await expect(availableGroup.getByText("Not currently unlocked", { exact: true })).toHaveCount(0);
  const firstActiveRow = unlockedGroup.locator(".access-module-ledger-row").first();
  await expect(firstActiveRow.getByRole("link", { name: /^View/ })).toBeVisible();
  await expect(firstActiveRow.getByText("Access until 1 January 2028", { exact: true })).toBeVisible();
  await expect(firstActiveRow.getByRole("button", { name: /^Extend access/ })).toBeVisible();

  const historyDetails = page.locator(".access-payment-section");
  await expect(historyDetails).not.toHaveAttribute("open", "");
  await history.click();
  await expect(historyDetails).toHaveAttribute("open", "");
  await expect(page.getByRole("button", { name: /Copy payment reference/ }).first()).toBeVisible();
  await page.getByRole("button", { name: "View receipt" }).first().click();
  await expect(page.getByRole("dialog", { name: "Payment receipt" })).toBeVisible();
  await page.getByRole("button", { name: "Close receipt" }).click();
  await history.click();

  await page.setViewportSize({ width: 320, height: 720 });
  await history.scrollIntoViewIfNeeded();
  await expectNoHorizontalOverflow(page);
  const [historyBox, bottomNavBox] = await Promise.all([
    historyDetails.boundingBox(),
    page.getByRole("navigation", { name: "Mobile primary" }).boundingBox(),
  ]);
  expect(historyBox.y + historyBox.height).toBeLessThan(bottomNavBox.y);
  const unlockAction = page.getByRole("button", { name: /^Unlock/ }).first();
  const actionBox = await unlockAction.boundingBox();
  expect(actionBox.height).toBeGreaterThanOrEqual(44);
});

test("payment attention stays exceptional and directly follows the Access header", async ({ page }) => {
  await mockAccessHub(page, { attention: true });
  await page.goto("/access");

  const header = page.locator(".access-page-header");
  const attention = page.getByRole("heading", { name: "Payment needs attention" }).locator("xpath=../..");
  const bundles = page.getByRole("heading", { name: "Bundle options" });
  const positions = await Promise.all([header, attention, bundles].map(async (locator) => (await locator.boundingBox()).y));
  expect(positions[0]).toBeLessThan(positions[1]);
  expect(positions[1]).toBeLessThan(positions[2]);
  await expect(attention.getByText("Payment received. Access still needs attention.", { exact: true })).toBeVisible();
  await expect(attention.getByRole("link", { name: "Check access" })).toBeVisible();
});

test("mobile floating support preserves dock choice without covering Access controls", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem("promotionsure.whatsappSupportDockSide", "right"));
  await mockAccessHub(page);
  await page.goto("/access");
  await page.getByRole("heading", { name: "Available", exact: true }).evaluate((element) => {
    window.scrollTo({ top: element.getBoundingClientRect().top + window.scrollY - 88 });
  });

  const support = page.getByRole("link", { name: /Chat on WhatsApp/ });
  const bottomNav = page.getByRole("navigation", { name: "Mobile primary" });
  await expect(support).toHaveAttribute("data-dock-side", "right");
  await expect(page.locator('[data-floating-support-clearance="right"]')).toHaveCount(1);

  const expectSafePosition = async () => {
    const [supportBox, navBox] = await Promise.all([support.boundingBox(), bottomNav.boundingBox()]);
    expect(supportBox.x).toBeGreaterThanOrEqual(13);
    expect(supportBox.x + supportBox.width).toBeLessThanOrEqual(page.viewportSize().width - 13);
    expect(supportBox.y + supportBox.height).toBeLessThan(navBox.y - 7);
    const coveredControls = await page.evaluate(() => {
      const bubble = document.querySelector(".whatsapp-support-button").getBoundingClientRect();
      const controls = document.querySelectorAll([
        ".access-page-v4 .access-page-action",
        ".access-page-v4 .access-module-ledger-copy h4",
        ".access-page-v4 .access-module-ledger-copy p",
        ".access-page-v4 .access-payment-section > summary",
        ".access-page-v4 .access-receipt-button",
      ].join(","));
      return [...controls].filter((control) => {
        const paintedRects = control.matches("h4, p")
          ? (() => {
            const textNodes = [];
            const walker = document.createTreeWalker(control, NodeFilter.SHOW_TEXT);
            while (walker.nextNode()) textNodes.push(walker.currentNode);
            return textNodes.filter((node) => node.textContent.trim()).flatMap((node) => {
              const range = document.createRange();
              range.selectNodeContents(node);
              return [...range.getClientRects()];
            });
          })()
          : [control.getBoundingClientRect()];
        return paintedRects.some((rect) => (
          rect.bottom > bubble.top && rect.top < bubble.bottom
          && rect.right > bubble.left && rect.left < bubble.right
        ));
      }).map((control) => control.textContent.trim());
    });
    expect(coveredControls).toEqual([]);
  };

  await expectSafePosition();
  const box = await support.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(18, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(support).toHaveAttribute("data-dock-side", "left");
  await expect(page.locator('[data-floating-support-clearance="left"]')).toHaveCount(1);
  await expectSafePosition();

  await page.setViewportSize({ width: 320, height: 720 });
  await expect(support).toHaveAttribute("data-dock-side", "left");
  await expectSafePosition();
  await expectNoHorizontalOverflow(page);
});

test("Pick 3 separates module selection from confirmation and clears duration after composition changes", async ({ page }) => {
  await mockEligibleModules(page);
  await page.goto("/access?scope=pick3");

  await expect(page.locator("h1", { hasText: "Access and payment" })).toBeVisible();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const moduleChoices = dialog.getByRole("checkbox");
  await expect(moduleChoices).toHaveCount(8);
  await expect(dialog.getByText("0 of 3 selected")).toBeVisible();
  await expect(dialog.getByText("Select 3 modules to continue.")).toBeVisible();
  await expect(dialog.getByRole("radio")).toHaveCount(0);
  const continueButton = dialog.getByRole("button", { name: "Continue" });
  await expect(continueButton).toBeDisabled();
  await expect(dialog.locator(".purchase-module-selector__list")).toHaveCount(1);
  await expect.poll(() => dialog.locator(".purchase-module-selector__list").evaluate((list) => list.scrollHeight > list.clientHeight)).toBe(true);

  await moduleChoices.nth(0).focus();
  const checkboxFocusStyles = await moduleChoices.nth(0).evaluate((input) => ({
    inputOutline: window.getComputedStyle(input).outlineStyle,
    rowShadow: window.getComputedStyle(input.closest("label")).boxShadow,
  }));
  expect(checkboxFocusStyles.inputOutline).toBe("none");
  expect(checkboxFocusStyles.rowShadow).not.toBe("none");
  await page.keyboard.press("Space");
  await expect(moduleChoices.nth(0)).toBeChecked();
  await expect(dialog.getByText("1 of 3 selected")).toBeVisible();
  await expect(dialog.getByText("Select 2 more modules.")).toBeVisible();

  await moduleChoices.nth(1).check();
  await expect(dialog.getByText("2 of 3 selected")).toBeVisible();
  await expect(dialog.getByText("Select 1 more module.")).toBeVisible();
  await expect(dialog.getByRole("radio")).toHaveCount(0);
  await expect(continueButton).toBeDisabled();

  await moduleChoices.nth(2).check();
  await expect(dialog.getByText("3 of 3 selected")).toBeVisible();
  await expect(dialog.getByText("3 modules selected. Deselect one to choose another.")).toBeVisible();
  await expect(dialog.getByRole("radio")).toHaveCount(0);
  await expect(continueButton).toBeEnabled();
  for (let index = 0; index < 3; index += 1) await expect(moduleChoices.nth(index)).toBeEnabled();
  for (let index = 3; index < 8; index += 1) await expect(moduleChoices.nth(index)).toBeDisabled();

  await continueButton.click();
  await expect(dialog.getByText("Selected modules", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("checkbox")).toHaveCount(0);
  const oneMonth = dialog.getByRole("radio", { name: /1 month/ });
  const paymentButton = dialog.getByRole("button", { name: "Continue to payment" });
  await expect(oneMonth).not.toBeChecked();
  await expect(paymentButton).toBeDisabled();
  await oneMonth.check();
  await expect(dialog.getByText("Total", { exact: true })).toBeVisible();
  await expect(paymentButton).toBeEnabled();

  await dialog.getByRole("button", { name: "Change" }).click();
  const changedChoices = dialog.getByRole("checkbox");
  for (let index = 0; index < 3; index += 1) await expect(changedChoices.nth(index)).toBeChecked();
  await expect(dialog.getByRole("radio")).toHaveCount(0);
  await changedChoices.nth(2).uncheck();
  await changedChoices.nth(3).check();
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(dialog.getByRole("radio", { name: /1 month/ })).not.toBeChecked();
  await expect(dialog.getByRole("button", { name: "Continue to payment" })).toBeDisabled();
  await expectNoHorizontalOverflow(page);
});

test("Pick 3 confirmation lists exact modules and Change preserves an unchanged draft", async ({ page }) => {
  await mockEligibleModules(page);
  await page.goto("/access?scope=pick3");
  let dialog = page.getByRole("dialog");
  const moduleChoices = dialog.getByRole("checkbox");
  const selectedNames = [];
  for (let index = 0; index < 3; index += 1) {
    selectedNames.push((await moduleChoices.nth(index).locator("xpath=..").innerText()).trim());
    await moduleChoices.nth(index).check();
  }
  await dialog.getByRole("button", { name: "Continue" }).click();

  dialog = page.getByRole("dialog", { name: "Choose access period" });
  await expect(dialog.getByText("Selected modules", { exact: true })).toBeVisible();
  const reviewModules = dialog.locator(".purchase-modal-review__modules li > span:last-child");
  await expect(reviewModules).toHaveCount(3);
  await expect(reviewModules).toHaveText(selectedNames);
  await expect(dialog.getByRole("radio", { name: /3 months/ })).not.toBeChecked();
  await dialog.getByRole("radio", { name: /3 months/ }).check();
  await expect(dialog.getByText("3 months", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Total", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("checkbox")).toHaveCount(0);

  await dialog.getByRole("button", { name: "Change" }).click();
  dialog = page.getByRole("dialog");
  for (let index = 0; index < 3; index += 1) await expect(dialog.getByRole("checkbox").nth(index)).toBeChecked();
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(dialog.getByRole("radio", { name: /3 months/ })).toBeChecked();
});

test("Pick 3 payment error remains on confirmation using PromotionSure action-error styling", async ({ page }) => {
  await mockEligibleModules(page);
  await page.route("**/functions/v1/initialize-paystack-payment", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ message: "Temporary payment initialization failure" }),
    });
  });
  await page.goto("/access?scope=pick3");
  const dialog = page.getByRole("dialog");
  for (let index = 0; index < 3; index += 1) await dialog.getByRole("checkbox").nth(index).check();
  await dialog.getByRole("button", { name: "Continue" }).click();
  await dialog.getByRole("radio", { name: /3 months/ }).check();
  await dialog.getByRole("button", { name: "Continue to payment" }).click();

  await expect(dialog.getByRole("alert")).toHaveClass(/action-error/);
  await expect(dialog.getByRole("heading", { name: "Choose access period" })).toBeVisible();
  await expect(dialog.locator(".purchase-modal-review__modules li")).toHaveCount(3);
  await expect(dialog.getByText("3 months", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Continue to payment" })).toBeEnabled();
});

test("Pick 3 disables only unselected checkboxes at the configured maximum", async ({ page }) => {
  await mockEligibleModules(page);
  await page.route("**/rest/v1/rpc/get_purchase_pricing_catalog_v1", async (route) => {
    const response = await route.fetch();
    const catalog = await response.json();
    const updatedCatalog = catalog.map((plan) => plan.plan_code === "three_module_bundle"
      ? { ...plan, module_count: 2 }
      : plan);
    await route.fulfill({ response, json: updatedCatalog });
  });

  await page.goto("/access?scope=pick3");
  const dialog = page.getByRole("dialog");
  const moduleChoices = dialog.getByRole("checkbox");
  await expect(moduleChoices).toHaveCount(8);
  await moduleChoices.nth(0).check();
  await moduleChoices.nth(1).check();
  await expect(dialog.getByText("2 of 2 selected")).toBeVisible();
  await expect(moduleChoices.nth(0)).toBeEnabled();
  await expect(moduleChoices.nth(1)).toBeEnabled();
  await expect(moduleChoices.nth(2)).toBeDisabled();
  await expect(dialog.getByText("2 modules selected. Deselect one to choose another.")).toBeVisible();
  await moduleChoices.nth(0).uncheck();
  await expect(moduleChoices.nth(2)).toBeEnabled();
});

test("Complete uses the authoritative included count and gates review on duration", async ({ page }) => {
  let includedCount = 0;
  let completePlanName = "";
  await page.route("**/rest/v1/rpc/get_purchase_pricing_catalog_v1", async (route) => {
    const response = await route.fetch();
    const catalog = await response.json();
    const completePlan = catalog.find((plan) => plan.plan_code === "complete_bundle");
    includedCount = Number(completePlan?.current_available_module_count ?? 0);
    completePlanName = String(completePlan?.display_name ?? "Complete Module Bundle");
    await route.fulfill({ response, json: catalog });
  });
  await page.goto("/access?scope=complete");
  const dialog = page.getByRole("dialog", { name: "Choose access period" });
  await expect(dialog.getByText(completePlanName, { exact: true })).toBeVisible();
  await expect(dialog.getByText(`Includes all ${includedCount} currently available modules.`)).toBeVisible();
  await expect(dialog.getByRole("group", { name: "Choose access period" })).toBeVisible();
  await expect(dialog.locator(".purchase-duration-selector__legend")).toHaveCSS("clip-path", "inset(50%)");
  await expect(dialog.getByRole("checkbox")).toHaveCount(0);

  const oneMonth = dialog.getByRole("radio", { name: /1 month/ });
  const twoMonths = dialog.getByRole("radio", { name: /2 months/ });
  const threeMonths = dialog.getByRole("radio", { name: /3 months/ });
  const reviewButton = dialog.getByRole("button", { name: "Review purchase" });
  await expect(reviewButton).toBeDisabled();
  await oneMonth.focus();
  await page.keyboard.press("ArrowRight");
  await expect(twoMonths).toBeChecked();
  await twoMonths.press("ArrowRight");
  await expect(threeMonths).toBeChecked();
  const selectedPrice = await threeMonths.locator("xpath=ancestor::label").locator(".purchase-duration-selector__price").innerText();
  await expect(dialog.getByText(new RegExp(`3 months access.*${selectedPrice.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`))).toBeVisible();
  await expect(reviewButton).toBeEnabled();
  await reviewButton.click();

  const reviewDialog = page.getByRole("dialog", { name: "Review purchase" });
  await expect(reviewDialog.getByText(completePlanName, { exact: true })).toBeVisible();
  await expect(reviewDialog.getByText("Includes", { exact: true })).toBeVisible();
  await expect(reviewDialog.getByText(`${includedCount} modules`, { exact: true })).toBeVisible();
  await expect(reviewDialog.getByText("Access duration", { exact: true })).toBeVisible();
  await expect(reviewDialog.getByText("3 months", { exact: true })).toBeVisible();
  await expect(reviewDialog.getByText("Total", { exact: true })).toBeVisible();
  await expect(reviewDialog.getByText(selectedPrice, { exact: true })).toBeVisible();
  await expect(reviewDialog.getByRole("checkbox")).toHaveCount(0);
  await reviewDialog.getByRole("button", { name: "Change" }).click();
  await expect(page.getByRole("dialog", { name: "Choose access period" }).getByRole("radio", { name: /3 months/ })).toBeChecked();
});

test("Complete review preserves its draft and shared error behavior after payment failure", async ({ page }) => {
  let initializationCount = 0;
  await page.route("**/functions/v1/initialize-paystack-payment", async (route) => {
    initializationCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ message: "Temporary payment initialization failure" }),
    });
  });

  await page.goto("/access?scope=complete");
  const dialog = page.getByRole("dialog", { name: "Choose access period" });
  await dialog.getByRole("radio", { name: /3 months/ }).check();
  await dialog.getByRole("button", { name: "Review purchase" }).click();
  const reviewDialog = page.getByRole("dialog", { name: "Review purchase" });
  const paymentButton = reviewDialog.getByRole("button", { name: "Continue to payment" });
  await paymentButton.evaluate((button) => {
    button.click();
    button.click();
  });

  await expect(reviewDialog.getByRole("button", { name: "Preparing payment..." })).toBeVisible();
  await expect(reviewDialog.getByRole("alert")).toBeVisible();
  await expect(reviewDialog.getByText("3 months", { exact: true })).toBeVisible();
  await expect(reviewDialog.getByText("Total", { exact: true })).toBeVisible();
  await expect(reviewDialog.getByRole("heading", { name: "Review purchase" })).toBeVisible();
  expect(initializationCount).toBe(1);
});

test("Complete modal restores with browser history and reflows without horizontal overflow", async ({ page }) => {
  await page.goto("/access");
  await page.getByRole("button", { name: /^View access options/ }).click();
  await expect(page.getByRole("dialog", { name: "Choose access period" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goForward();
  await expect(page.getByRole("dialog", { name: "Choose access period" })).toBeVisible();

  await page.setViewportSize({ width: 320, height: 720 });
  await expectNoHorizontalOverflow(page);
  const modalBox = await page.getByRole("dialog").boundingBox();
  expect(modalBox.width).toBeLessThanOrEqual(320);
  expect(modalBox.height).toBeLessThan(720);
});

test("Complete modal has no serious automated accessibility violations", async ({ page }) => {
  await page.goto("/access?scope=complete");
  const dialog = page.getByRole("dialog", { name: "Choose access period" });
  await dialog.getByRole("radio", { name: /1 month/ }).check();
  await dialog.getByRole("button", { name: "Review purchase" }).click();
  const results = await new AxeBuilder({ page })
    .include(".purchase-modal")
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  const blocking = results.violations.filter(({ impact }) => ["serious", "critical"].includes(impact));
  expect(blocking).toEqual([]);
});

test("individual access opens in a modal and requires a duration before review", async ({ page }) => {
  await page.goto("/access?module=public-service-rules");
  const dialog = page.getByRole("dialog", { name: "Public Service Rules" });
  const oneMonth = dialog.getByRole("radio", { name: /1 month/ });
  const twoMonths = dialog.getByRole("radio", { name: /2 months/ });
  const threeMonths = dialog.getByRole("radio", { name: /3 months/ });
  const reviewButton = dialog.getByRole("button", { name: "Review purchase" });
  await expect(dialog.getByText("Choose how long you want access")).toBeVisible();
  await expect(dialog.getByText("Choose a duration to continue.")).toBeVisible();
  await expect(oneMonth).not.toBeChecked();
  await expect(twoMonths).not.toBeChecked();
  await expect(dialog.getByRole("radio", { name: /6 months/ })).toHaveCount(0);
  await expect(reviewButton).toBeDisabled();
  const unselectedDialogBox = await dialog.boundingBox();
  await threeMonths.focus();
  const focusStyles = await threeMonths.evaluate((input) => ({
    inputOutline: window.getComputedStyle(input).outlineStyle,
    rowShadow: window.getComputedStyle(input.closest("label")).boxShadow,
  }));
  expect(focusStyles.inputOutline).toBe("none");
  expect(focusStyles.rowShadow).not.toBe("none");
  await threeMonths.check();
  await expect(dialog.getByText("3 months access · ₦6,500")).toBeVisible();
  const selectedDialogBox = await dialog.boundingBox();
  expect(Math.abs(selectedDialogBox.height - unselectedDialogBox.height)).toBeLessThanOrEqual(1);
  await expect(reviewButton).toBeEnabled();
  await reviewButton.click();
  await expect(page.getByRole("heading", { name: "Review purchase" })).toBeVisible();
  const reviewDialog = page.getByRole("dialog", { name: "Review purchase" });
  await expect(reviewDialog.getByText("Public Service Rules", { exact: true })).toBeVisible();
  await expect(reviewDialog.getByText("Access duration", { exact: true })).toBeVisible();
  await expect(reviewDialog.getByText("3 months", { exact: true })).toBeVisible();
  await expect(reviewDialog.getByText("Total", { exact: true })).toBeVisible();
  await expect(reviewDialog.getByText("₦6,500", { exact: true })).toBeVisible();
  await reviewDialog.getByRole("button", { name: "Change" }).click();
  await expect(page.getByRole("dialog").getByRole("radio", { name: /3 months/ })).toBeChecked();
});

test("module modal traps focus, locks the page, and moves focus with its step", async ({ page }) => {
  await page.goto("/access?module=public-service-rules");
  const dialog = page.getByRole("dialog", { name: "Public Service Rules" });
  const title = dialog.getByRole("heading", { name: "Public Service Rules" });
  await expect(title).toBeFocused();
  await expect.poll(() => page.evaluate(() => ({
    backgroundIsInert: Boolean(document.querySelector("[inert]")),
    bodyOverflow: document.body.style.overflow,
  }))).toEqual({ backgroundIsInert: true, bodyOverflow: "hidden" });

  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Close purchase" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("radio", { name: /3 months/ })).toBeFocused();

  await dialog.getByRole("radio", { name: /1 month/ }).check();
  await dialog.getByRole("button", { name: "Review purchase" }).click();
  await expect(page.getByRole("dialog", { name: "Review purchase" }).getByRole("heading", { name: "Review purchase" })).toBeFocused();
});

test("module modal supports keyboard and backdrop dismissal and restores its trigger", async ({ page }) => {
  await page.goto("/access");
  const moduleRow = page.locator(".access-ledger-row").filter({ hasText: "Public Service Rules" }).first();
  const moduleTrigger = moduleRow.getByRole("button", { name: /^Unlock/ });

  await moduleTrigger.click();
  await expect(page.getByRole("dialog", { name: "Public Service Rules" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(moduleTrigger).toBeFocused();

  await moduleTrigger.click();
  await expect(page.getByRole("dialog", { name: "Public Service Rules" })).toBeVisible();
  await page.locator(".purchase-modal-backdrop").click({ position: { x: 4, y: 4 } });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(moduleTrigger).toBeFocused();
});

test("module modal has no serious automated accessibility violations", async ({ page }) => {
  await page.goto("/access?module=public-service-rules");
  await expect(page.getByRole("dialog", { name: "Public Service Rules" })).toBeVisible();
  const results = await new AxeBuilder({ page })
    .include(".purchase-modal")
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  const blocking = results.violations.filter(({ impact }) => ["serious", "critical"].includes(impact));
  expect(blocking).toEqual([]);
});

test("Pick 3 modal has no serious automated accessibility violations", async ({ page }) => {
  await mockEligibleModules(page);
  await page.goto("/access?scope=pick3");
  const dialog = page.getByRole("dialog");
  for (let index = 0; index < 3; index += 1) await dialog.getByRole("checkbox").nth(index).check();
  await dialog.getByRole("button", { name: "Continue" }).click();
  await dialog.getByRole("radio", { name: /1 month/ }).check();
  const results = await new AxeBuilder({ page })
    .include(".purchase-modal")
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  const blocking = results.violations.filter(({ impact }) => ["serious", "critical"].includes(impact));
  expect(blocking).toEqual([]);
});

test("backend-unavailable durations remain readable and use native disabled state", async ({ page }) => {
  await page.route("**/rest/v1/rpc/get_purchase_pricing_catalog_v1", async (route) => {
    const response = await route.fetch();
    const catalog = await response.json();
    const updatedCatalog = catalog.map((plan) => plan.plan_code === "individual_objective"
      ? {
          ...plan,
          durations: plan.durations.map((duration) => Number(duration.duration_months) === 3
            ? { ...duration, is_available: false }
            : duration),
        }
      : plan);
    await route.fulfill({ response, json: updatedCatalog });
  });

  await page.goto("/access?module=public-service-rules");
  const dialog = page.getByRole("dialog");
  const unavailableDuration = dialog.getByRole("radio", { name: /3 months/ });
  await expect(unavailableDuration).toBeDisabled();
  await expect(dialog.getByText("Save about 13%")).toBeVisible();
});

test("access query state controls modal visibility and browser history", async ({ page }) => {
  await page.goto("/access?returnTo=%2Fpractice");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const moduleRow = page.locator(".access-ledger-row").filter({ hasText: "Public Service Rules" }).first();
  const moduleTrigger = moduleRow.getByRole("button", { name: /^Unlock/ });
  await moduleTrigger.click();
  await expect.poll(() => page.evaluate(() => Object.fromEntries(new URL(window.location.href).searchParams))).toEqual({
    module: "public-service-rules",
    returnTo: "/practice",
  });
  await expect(page.getByRole("dialog", { name: "Public Service Rules" })).toBeVisible();

  await page.goBack();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(moduleTrigger).toBeFocused();
  await page.goForward();
  await expect(page.getByRole("dialog", { name: "Public Service Rules" })).toBeVisible();

  await page.getByRole("button", { name: "Close purchase" }).last().click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => Object.fromEntries(new URL(window.location.href).searchParams))).toEqual({
    returnTo: "/practice",
  });

  await page.goto("/access?module=not-a-module&scope=not-a-scope");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("dismissal clears the unfinished Pick 3 draft", async ({ page }) => {
  await page.goto("/access");
  await page.getByRole("button", { name: /^Choose modules/ }).click();
  const pickDialog = page.getByRole("dialog");
  const firstChoice = pickDialog.getByRole("checkbox").first();
  await firstChoice.check();
  await page.getByRole("button", { name: "Close purchase" }).last().click();

  await page.getByRole("button", { name: /^View access options/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close purchase" }).last().click();

  await page.getByRole("button", { name: /^Choose modules/ }).click();
  const reopenedChoice = page.getByRole("dialog").getByRole("checkbox").first();
  await expect(reopenedChoice).not.toBeChecked();
  await reopenedChoice.check();
  await page.goBack();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goForward();
  await expect(page.getByRole("dialog").getByRole("checkbox").first()).not.toBeChecked();
});

test("payment initialization ignores rapid duplicate starts and preserves draft on error", async ({ page }) => {
  let initializationCount = 0;
  await page.route("**/functions/v1/initialize-paystack-payment", async (route) => {
    initializationCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ message: "Temporary payment initialization failure" }),
    });
  });

  await page.goto("/access?module=public-service-rules");
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("radio", { name: /1 month/ }).click();
  await dialog.getByRole("button", { name: "Review purchase" }).click();
  const paymentButton = dialog.getByRole("button", { name: "Continue to payment" });

  await paymentButton.evaluate((button) => {
    button.click();
    button.click();
  });

  await expect(dialog.getByRole("button", { name: "Preparing payment..." })).toBeVisible();
  await expect(dialog.getByText("Public Service Rules", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Change" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Close purchase" })).toBeDisabled();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Review purchase" })).toBeVisible();
  expect(initializationCount).toBe(1);
  await expect(dialog.getByText("Access duration", { exact: true })).toBeVisible();
  await expect(dialog.getByText("1 month", { exact: true })).toBeVisible();
  await expect(paymentButton).toBeEnabled();
});

test("payment truth surfaces retain their existing responsive shells", async ({ page }) => {
  const artifact = (name) => `artifacts/payment-receipt-truth-alignment/${name}.png`;
  await mockAccessHub(page);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/access");
  await page.getByRole("heading", { name: "Payment history" }).click();
  await page.screenshot({ path: artifact("desktop-payment-history"), fullPage: true });

  const receiptButtons = page.getByRole("button", { name: "View receipt" });
  await receiptButtons.nth(0).click();
  await page.screenshot({ path: artifact("desktop-pick3-receipt") });
  await page.getByRole("button", { name: "Close receipt" }).click();
  await receiptButtons.nth(1).click();
  await page.screenshot({ path: artifact("desktop-extension-receipt") });
  await page.getByRole("button", { name: "Close receipt" }).click();
  await receiptButtons.nth(2).click();
  await page.screenshot({ path: artifact("desktop-complete-receipt") });
  await page.getByRole("button", { name: "Close receipt" }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await receiptButtons.nth(0).click();
  await page.screenshot({ path: artifact("mobile-390-bundle-receipt") });
  await page.getByRole("button", { name: "Close receipt" }).click();
  await page.screenshot({ path: artifact("mobile-390-payment-history"), fullPage: true });

  await page.setViewportSize({ width: 320, height: 720 });
  await receiptButtons.nth(2).click();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: artifact("mobile-320-dense-receipt") });
  await page.getByRole("button", { name: "Close receipt" }).click();

  await page.unroute("**/rest/v1/rpc/get_payment_history");
  await page.route("**/rest/v1/rpc/get_payment_history", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{
        access_expires_at: "2026-09-01T00:00:00.000Z",
        access_result_kind: "exact",
        amount_kobo: 350000,
        created_at: "2026-08-01T10:00:00.000Z",
        currency: "NGN",
        duration_months: 1,
        fulfillment_status: "fulfilled",
        id: "20000000-0000-4000-8000-000000000005",
        item_count: 1,
        items: [{ subject_name: "Pension", subject_slug: "access-hub-module-5" }],
        paid_at: "2026-08-01T10:01:00.000Z",
        product_label: "Pension",
        provider_reference: "PS-ACCESS-SINGLE-001",
        provider_status: "success",
        purchase_intent: "purchase",
        purchase_scope: "single_module",
        receipt_eligible: true,
        record_type: "history",
        review_status: "clear",
        status: "active",
      }]),
    });
  });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.reload();
  await page.getByRole("heading", { name: "Payment history" }).click();
  await page.getByRole("button", { name: "View receipt" }).click();
  await page.screenshot({ path: artifact("desktop-single-module-receipt") });
  await page.getByRole("button", { name: "Close receipt" }).click();

  await page.route("**/functions/v1/verify-paystack-payment", async (route) => {
    const verifyItems = scalableModuleNames.slice(0, 3).map((subjectName, index) => ({
      subject_name: subjectName,
      subject_slug: `access-hub-module-${index + 1}`,
    }));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "active",
        payment: {
          product_label: "3-Module Bundle",
          purchase_scope: "pick_n_modules",
          purchase_intent: "mixed",
          item_count: 3,
          items: verifyItems,
        },
      }),
    });
  });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/payment/verify?reference=PS-ACCESS-HISTORY-001&returnTo=/access");
  await expect(page.getByRole("heading", { name: "Access unlocked" })).toBeVisible();
  await page.screenshot({ path: artifact("desktop-payment-verify") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: artifact("mobile-390-payment-verify") });
});
