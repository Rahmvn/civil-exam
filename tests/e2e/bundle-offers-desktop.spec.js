import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers.js";

test("choose-three checkout stays compact and centred on desktop", async ({ page }) => {
  await page.goto("/access#bundles");

  const offer = page.locator("article").filter({ hasText: "Any 3 modules" }).first();
  await expect(offer).toBeVisible();
  await offer.getByRole("button", { name: "Choose" }).click();

  const dialog = page.getByRole("dialog", { name: "Any 3 modules" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".bundle-checkout-handle")).toBeHidden();
  await expect(dialog.locator(".bundle-checkout-close")).toBeVisible();
  await expect(dialog.locator(".bundle-checkout-footer")).toBeVisible();

  const viewport = page.viewportSize();
  const modal = await dialog.boundingBox();
  expect(modal.width).toBeLessThanOrEqual(502);
  expect(Math.abs((modal.x + modal.width / 2) - viewport.width / 2)).toBeLessThanOrEqual(2);

  const moduleChoices = dialog.locator(".bundle-module-list > button");
  await expect(moduleChoices).toHaveCount(3);
  for (let index = 0; index < 3; index += 1) await moduleChoices.nth(index).click();

  await expect(dialog.getByText("Ready for payment")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Continue to payment" })).toBeEnabled();
  await expectNoHorizontalOverflow(page);
});
