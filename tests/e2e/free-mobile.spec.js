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
  await expect(page.getByRole("heading", { name: "Unlock Public Service Rules" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Selected module" })).toContainText("Public Service Rules");
  await expect(page.locator(".access-purchase-module-list")).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Public Service Rules" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Continue to payment/ })).toBeVisible();
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

  await expect(page.getByRole("heading", { name: "Buy access" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const moduleChoices = page.locator(".access-purchase-module-list > button");
  await expect(moduleChoices).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Select 3 modules" })).toBeDisabled();
  for (let index = 0; index < 3; index += 1) await moduleChoices.nth(index).click();

  await expect(page.getByText("3 of 3 selected")).toBeVisible();
  await expect(page.locator(".access-order-summary-main")).toContainText("₦6,000");
  await expect(page.getByText("3-Module Bundle - 1 month")).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue to payment" })).toBeEnabled();
  await expectNoHorizontalOverflow(page);
});
