import { expect, test } from "@playwright/test";

test("candidate lifecycle cards retain their approved visual hierarchy", async ({ page }) => {
  await page.goto("/dashboard");
  const moduleGrid = page.locator(".dashboard-module-grid-v3");
  await expect(moduleGrid).toBeVisible();
  await expect(moduleGrid).toHaveScreenshot("candidate-module-lifecycle-grid.png", {
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: 0.01,
  });
});

test("module access rows retain clear locked, unlocked, and coming-soon states", async ({ page }) => {
  await page.goto("/access");
  const moduleList = page.locator(".access-module-list");
  await expect(moduleList).toBeVisible();
  await expect(moduleList).toHaveScreenshot("candidate-module-access-list.png", {
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: 0.01,
  });
});
