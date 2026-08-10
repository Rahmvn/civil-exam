import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers.js";

test("free candidate is guided into one module without exposing paid access", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Welcome, Free" })).toBeVisible();
  await expect(page.getByText("Free practice available", { exact: true })).toBeVisible();

  const moduleCard = page.locator("article").filter({ hasText: "Public Financial Management" }).first();
  await expect(moduleCard.getByRole("button", { name: "Try free" })).toBeVisible();
  const unlockButton = moduleCard.getByRole("button", { name: "Unlock module" });
  await expect(unlockButton).toBeVisible();
  await unlockButton.click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("dialog", { name: "Unlock Public Financial Management" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("dialog", { name: "Unlock Public Financial Management" })).toHaveCount(0);
  await expect(unlockButton).toBeFocused();
  await page.goForward();
  await expect(page.getByRole("dialog", { name: "Unlock Public Financial Management" })).toBeVisible();
  await page.getByRole("button", { name: "Close purchase" }).last().click();
  await expect(unlockButton).toBeFocused();

  await moduleCard.getByRole("button", { name: "Try free" }).click();
  await expect(page.getByRole("dialog", { name: "Public Financial Management" })).toBeVisible();
  await expect(page.getByText("You will get Practice set 1 for this module, plus one retry if you need it.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel" })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  await page.goto("/access?module=public-service-rules");
  await expect(page.locator("h1", { hasText: "Access and payment" })).toBeVisible();
  const purchaseDialog = page.getByRole("dialog", { name: "Unlock Public Service Rules" });
  const oneMonth = purchaseDialog.getByRole("radio", { name: /1 month/ });
  await expect(oneMonth).not.toBeChecked();
  await expect(purchaseDialog.getByRole("button", { name: "Review purchase" })).toBeDisabled();
  await oneMonth.click();
  await expect(oneMonth).toBeChecked();
  await expect(purchaseDialog.getByRole("button", { name: "Review purchase" })).toBeEnabled();
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

test("choose-three checkout uses the access page with an exact selection", async ({ page }) => {
  await page.goto("/access?scope=pick3");

  await expect(page.locator("h1", { hasText: "Access and payment" })).toBeVisible();
  const purchaseDialog = page.getByRole("dialog");
  const moduleChoices = purchaseDialog.getByRole("checkbox");
  await expect(moduleChoices).toHaveCount(3);
  const continueButton = purchaseDialog.getByRole("button", { name: "Continue" });
  await expect(continueButton).toBeDisabled();
  for (let index = 0; index < 3; index += 1) await moduleChoices.nth(index).check();

  await expect(purchaseDialog.getByText("3 of 3 selected")).toBeVisible();
  await expect(purchaseDialog.getByRole("radio")).toHaveCount(0);
  await expect(continueButton).toBeEnabled();
  await continueButton.click();
  await expect(purchaseDialog.getByRole("radio", { name: /1 month/ })).toBeVisible();
  await purchaseDialog.getByRole("radio", { name: /1 month/ }).click();
  await expect(purchaseDialog.getByRole("button", { name: "Continue to payment" })).toBeEnabled();
  await expect(purchaseDialog.locator(".purchase-modal-review__modules li")).toHaveCount(3);
  await expectNoHorizontalOverflow(page);
});
