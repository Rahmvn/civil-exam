import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers.js";

test("privacy and terms are public, responsive, and accessible", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page).toHaveTitle("Privacy Policy | PromotionSure");
  await expect(page.getByRole("heading", { level: 1, name: "Privacy Policy" })).toBeVisible();
  await expect(page.getByText(/operated by Saheed Imran/)).toBeVisible();
  await expect(page.getByText(/Paystack processes card and bank details/)).toBeVisible();
  await expect(page.getByRole("link", { name: "promotionsureapp@gmail.com" }).first()).toHaveAttribute(
    "href",
    "mailto:promotionsureapp@gmail.com",
  );
  await expectNoHorizontalOverflow(page);

  const privacyA11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(privacyA11y.violations.filter((violation) => ["serious", "critical"].includes(violation.impact))).toEqual([]);

  await page.goto("/terms");
  await expect(page).toHaveTitle("Terms of Service | PromotionSure");
  await expect(page.getByRole("heading", { level: 1, name: "Terms of Service" })).toBeVisible();
  await expect(page.getByText(/Refunds are available for duplicate charges/)).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
