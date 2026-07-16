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

test("failed access authority never renders as a real locked state", async ({ page }) => {
  await page.route("**/rest/v1/rpc/get_module_access_catalog", (route) => route.fulfill({
    body: JSON.stringify({ code: "TEMPORARY", message: "temporary catalogue failure" }),
    contentType: "application/json",
    status: 503,
  }));
  await page.goto("/dashboard");

  await expect(page.getByText("Your module access could not be loaded. No access changes have been made.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Unlock module" })).toHaveCount(0);

  await page.unroute("**/rest/v1/rpc/get_module_access_catalog");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("Your module access could not be loaded. No access changes have been made.")).toBeHidden();
  await expect(page.getByRole("heading", { name: "Public Financial Management" })).toBeVisible();
});

test("an expired local browser session returns safely to authentication", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Welcome, Paid" })).toBeVisible();
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
  await expect(page).toHaveURL(/\/auth\?mode=sign-in&returnTo=%2Fdashboard/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});

test("offline state is visible without replacing the current page", async ({ context, page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Welcome, Paid" })).toBeVisible();

  await context.setOffline(true);
  await expect(page.getByText("You are offline. Your current page will remain open while you reconnect.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Welcome, Paid" })).toBeVisible();

  await context.setOffline(false);
  await expect(page.getByText("You are offline. Your current page will remain open while you reconnect.")).toBeHidden();
});

test("profile authority failure blocks the app until account details recover", async ({ page }) => {
  await page.route("**/rest/v1/profiles*", (route) => route.fulfill({
    body: JSON.stringify({ code: "TEMPORARY", message: "temporary profile failure" }),
    contentType: "application/json",
    status: 503,
  }));
  await page.goto("/dashboard");

  await expect(page.getByRole("heading", { name: "Account details could not be loaded" })).toBeVisible({ timeout: 10_000 });
  await page.unroute("**/rest/v1/profiles*");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "Welcome, Paid" })).toBeVisible();
});
