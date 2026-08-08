import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers.js";

test("choose-three checkout stays compact and centred on desktop", async ({ page }) => {
  await page.goto("/access#bundles");

  const offer = page.locator("article").filter({ hasText: "3-Module Bundle" }).first();
  await expect(offer).toBeVisible();
  await offer.getByRole("button", { name: "Choose" }).click();

  const dialog = page.getByRole("dialog", { name: "3-Module Bundle" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".access-plan-handle")).toBeHidden();
  await expect(dialog.locator(".access-plan-close")).toBeVisible();
  await expect(dialog.locator(".access-plan-footer")).toBeVisible();

  const viewport = page.viewportSize();
  const modal = await dialog.boundingBox();
  expect(modal.width).toBeLessThanOrEqual(562);
  expect(Math.abs((modal.x + modal.width / 2) - viewport.width / 2)).toBeLessThanOrEqual(2);

  const moduleChoices = dialog.locator(".access-plan-module-list > button");
  await expect(moduleChoices).toHaveCount(3);
  await expect(dialog.getByRole("button", { name: "Select 3 modules" })).toBeDisabled();
  for (let index = 0; index < 3; index += 1) await moduleChoices.nth(index).click();

  await expect(dialog.getByText("Ready for payment")).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Continue/ })).toBeEnabled();
  await expectNoHorizontalOverflow(page);
});
