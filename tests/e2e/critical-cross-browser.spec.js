import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers.js";

test("critical module lifecycle and practice routes agree", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Welcome, Paid" })).toBeVisible();

  const comingSoon = page.locator("article").filter({ hasText: "Coming Soon Regression" }).first();
  await expect(comingSoon.getByText("Unlocked", { exact: true })).toHaveCount(0);
  await expect(comingSoon.getByRole("button", { name: "Coming soon" })).toBeDisabled();

  await page.goto("/modules/public-financial-management");
  await expect(page.getByRole("heading", { name: "Choose a practice set" })).toBeVisible();
  await expect(page.getByText("Practice set 1", { exact: true })).toBeVisible();

  await page.goto("/modules/e2e-coming-soon");
  await expect(page.getByRole("heading", { name: "Practice is coming soon" })).toBeVisible();
  await expect(page.getByRole("link", { name: /^(Start|Continue|Retry)/ })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test("critical access states agree across browser engines", async ({ page }) => {
  await page.goto("/access");
  const paidModule = page.locator("article").filter({ hasText: "Public Financial Management" }).first();
  const comingSoon = page.locator("article").filter({ hasText: "Coming Soon Regression" }).first();

  await expect(paidModule.getByText("Unlocked", { exact: true })).toBeVisible();
  await expect(paidModule.getByRole("link", { name: "Continue practice" })).toBeVisible();
  await expect(comingSoon.getByText("Unlocked", { exact: true })).toHaveCount(0);
  await expect(comingSoon.getByText("Not available yet")).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
