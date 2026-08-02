import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers.js";

test("free candidate is guided into one module without exposing paid access", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Welcome, Free" })).toBeVisible();
  await expect(page.getByText("Free practice available", { exact: true })).toBeVisible();

  const moduleCard = page.locator("article").filter({ hasText: "Public Financial Management" }).first();
  await expect(moduleCard.getByRole("button", { name: "Try free" })).toBeVisible();
  await expect(moduleCard.getByRole("button", { name: "Unlock module" })).toBeVisible();
  await moduleCard.getByRole("button", { name: "Try free" }).click();
  await expect(page.getByRole("dialog", { name: "Public Financial Management" })).toBeVisible();
  await expect(page.getByText("You will get Practice set 1 for this module, plus one retry if you need it.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel" })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  await page.goto("/access?module=public-service-rules");
  const unlockDialog = page.getByRole("dialog", { name: "Public Service Rules" });
  await expect(unlockDialog).toBeVisible();
  await expect(unlockDialog.getByRole("button", { name: "Continue to payment" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("practice hub lets a new candidate choose free practice or payment directly", async ({ page }) => {
  await page.goto("/practice");

  await expect(page.getByRole("heading", { name: "Your modules" })).toBeVisible();
  const moduleCard = page.locator("article").filter({ hasText: "Public Financial Management" }).first();
  await expect(moduleCard.getByRole("button", { name: "Try free" })).toBeVisible();
  await expect(moduleCard.getByRole("link", { name: "Unlock module" })).toHaveCount(0);
  await expect(page.getByText("Current Affairs", { exact: true })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test("choose-three checkout uses a full-width mobile sheet with an exact selection", async ({ page }) => {
  await page.goto("/access#bundles");

  await expect(page.getByRole("heading", { name: "Bundle offers" })).toBeVisible();
  const offer = page.locator("article").filter({ hasText: "Any 3 modules" }).first();
  await expect(offer.getByText(/5,000/)).toBeVisible();
  await offer.getByRole("button", { name: "Choose" }).click();

  const dialog = page.getByRole("dialog", { name: "Any 3 modules" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".bundle-checkout-handle")).toBeVisible();
  await expect(dialog.locator(".bundle-checkout-close")).toBeHidden();
  await expect(dialog.locator(".bundle-checkout-footer")).toBeVisible();

  const viewport = page.viewportSize();
  const sheet = await dialog.boundingBox();
  expect(sheet.x).toBeLessThanOrEqual(1);
  expect(sheet.width).toBeGreaterThanOrEqual(viewport.width - 1);

  const moduleChoices = dialog.locator(".bundle-module-list > button");
  await expect(moduleChoices).toHaveCount(3);
  for (let index = 0; index < 3; index += 1) await moduleChoices.nth(index).click();

  await expect(dialog.getByText("Ready for payment")).toBeVisible();
  await expect(dialog.getByText(/7,500/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Continue to payment" })).toBeEnabled();
  await expectNoHorizontalOverflow(page);
});
