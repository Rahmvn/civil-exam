import { expect, test } from "@playwright/test";

test("a transient dashboard summary failure is retried without losing the page", async ({ page }) => {
  let requestCount = 0;
  await page.route("**/rest/v1/rpc/get_candidate_summary", async (route) => {
    requestCount += 1;
    if (requestCount === 1) {
      await route.abort("connectionreset");
      return;
    }
    await route.continue();
  });

  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Welcome, Paid" })).toBeVisible();
  expect(requestCount).toBeGreaterThanOrEqual(2);
});

test("an expired local browser session returns safely to authentication", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Welcome, Paid" })).toBeVisible();
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await expect(page).toHaveURL(/\/auth\?mode=sign-in&returnTo=%2Fdashboard/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});
