import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers.js";

test("choose-three checkout stays inline on desktop", async ({ page }) => {
  await page.goto("/access?scope=pick3");

  await expect(page.getByRole("heading", { name: "Access and payment" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const bundleRow = page.locator("#access-bundle-pick3");
  await expect(bundleRow).toHaveClass(/is-expanded/);
  await expect(bundleRow.getByText("From ₦6,000")).toBeVisible();

  const moduleChoices = bundleRow.locator(".access-bundle-choices > button");
  await expect(moduleChoices).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Continue to payment" })).toBeDisabled();
  for (let index = 0; index < 3; index += 1) await moduleChoices.nth(index).click();

  await expect(page.getByText("3 of 3 selected")).toBeVisible();
  await bundleRow.getByRole("radio", { name: /1 month/ }).click();
  await expect(page.getByRole("button", { name: /Continue/ })).toBeEnabled();
  await expectNoHorizontalOverflow(page);
});
