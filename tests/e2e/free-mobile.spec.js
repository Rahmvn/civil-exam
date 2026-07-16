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
  await expect(page.getByRole("dialog", { name: "Use free practice?" })).toBeVisible();
  await expect(page.getByText("Your free practice unlocks Practice Set 1 for this module and includes one retry.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start free practice" })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.goto("/access?module=public-service-rules");
  const unlockDialog = page.getByRole("dialog", { name: "Module access" });
  await expect(unlockDialog).toBeVisible();
  await expect(unlockDialog.getByText("Public Service Rules", { exact: true })).toBeVisible();
  await expect(unlockDialog.getByRole("button", { name: "Continue" })).toBeVisible();
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
