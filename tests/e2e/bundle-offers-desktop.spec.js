import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers.js";

test("choose-three checkout stays inline on desktop", async ({ page }) => {
  await page.goto("/access?scope=pick3");

  await expect(page.getByRole("heading", { name: "Buy access" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".access-order-summary")).toBeVisible();
  await expect(page.getByText("3-Module Bundle - 1 month")).toBeVisible();

  const moduleChoices = page.locator(".access-purchase-module-list > button");
  await expect(moduleChoices).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Select 3 modules" })).toBeDisabled();
  for (let index = 0; index < 3; index += 1) await moduleChoices.nth(index).click();

  await expect(page.getByText("3 of 3 selected")).toBeVisible();
  await expect(page.getByRole("button", { name: /Continue/ })).toBeEnabled();
  await expectNoHorizontalOverflow(page);
});
