import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers.js";

test("mobile navigation and practice controls fit the viewport", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("navigation", { name: "Mobile primary" })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.goto("/practice/public-financial-management?batch=1");
  await expect(page.getByRole("heading", { name: "Public Financial Management" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Question Map" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark for review" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Next", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Mobile primary" })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test("oral practice start and answer controls fit a mobile viewport", async ({ page }) => {
  await page.goto("/oral-practice/e2e-oral-questions?batch=1");
  await expect(page.getByRole("heading", { name: "Oral Questions" })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole("button", { name: "Begin oral practice" }).click();
  await expect(page.getByLabel("Your answer")).toBeVisible();
  await expect(page.getByRole("button", { name: /continue|finish/i })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Mobile primary" })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});
