import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers.js";

test("paid dashboard, modules, account, and access routes remain connected", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Welcome, Paid" })).toBeVisible();
  await expect(page.getByText("Module access", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Modules" })).toBeVisible();
  const dashboardUnlockedModule = page.locator("article").filter({ hasText: "Public Financial Management" }).first();
  await expect(dashboardUnlockedModule.getByText("Unlocked", { exact: true })).toBeVisible();

  await page.goto("/modules");
  await expect(page).toHaveURL(/\/dashboard#modules$/);

  await page.goto("/modules/public-financial-management");
  await expect(page.getByRole("heading", { name: "Choose a practice set" })).toBeVisible();
  await expect(page.getByText("Practice set 1", { exact: true })).toBeVisible();

  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "Paid Candidate" })).toBeVisible();
  await expect(page.getByText("08012345678", { exact: true })).toBeVisible();
  await expect(page.getByText("Lagos", { exact: true })).toBeVisible();
  await expect(page.getByText("Federal Ministry of Works", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit details" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Add (optional|missing) details/ })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Paid Candidate" })).toBeVisible();

  await page.goto("/access");
  await expect(page.getByRole("heading", { name: "Choose a module" })).toBeVisible();
  const unlockedModule = page.locator("article").filter({ hasText: "Public Financial Management" }).first();
  await expect(unlockedModule.getByText("Unlocked", { exact: true })).toBeVisible();
  const lockedModule = page.locator("article").filter({ hasText: "Public Service Rules" }).first();
  await expect(lockedModule.getByRole("button", { name: "Continue to payment" })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.goto("/access?module=public-service-rules");
  await expect(page.getByRole("heading", { name: "Public Service Rules" })).toBeVisible();
  await expect(page.locator(".access-module-row")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Continue to payment" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Choose a different module" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("practice hub prioritises usable modules and keeps unlock options quiet", async ({ page }) => {
  await page.goto("/practice");

  await expect(page.getByRole("heading", { name: "Practice", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your modules" })).toBeVisible();

  const usableModule = page.locator("article").filter({ hasText: "Public Financial Management" }).first();
  await expect(usableModule.getByRole("link", { name: /^(Start|Continue|Retry) practice$/ })).toBeVisible();
  await expect(usableModule.getByRole("link", { name: "Choose practice set" })).toBeVisible();

  const lockedModule = page.locator("article").filter({ hasText: "Public Service Rules" }).first();
  await expect(page.getByRole("heading", { name: "More modules" })).toBeVisible();
  await expect(lockedModule.getByRole("link", { name: "Unlock module" })).toBeVisible();
  await expect(page.getByText("Current Affairs", { exact: true })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test("completed practice opens a durable result and answer review", async ({ page }) => {
  await page.goto("/practice/public-financial-management?batch=1");
  await expect(page.getByRole("heading", { name: "Public Financial Management" })).toBeVisible();

  const answers = [
    "Option A for question 1",
    "Option B for question 2",
    "Option C for question 3",
    "Option D for question 4",
  ];

  for (let index = 0; index < answers.length; index += 1) {
    await page.getByRole("button", { name: new RegExp(answers[index]) }).click();
    if (index < answers.length - 1) {
      await page.getByRole("button", { name: "Next", exact: true }).click();
    }
  }

  await page.getByRole("button", { name: "Submit Test" }).click();
  const dialog = page.getByRole("dialog", { name: "Submit Test?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Submit Test" }).click();

  await page.waitForURL(/\/result\?attempt=/);
  await expect(page.getByRole("heading", { name: "You passed" })).toBeVisible();
  await expect(page.getByText("100%", { exact: true })).toBeVisible();
  const durableResultUrl = page.url();

  await page.reload();
  await expect(page).toHaveURL(durableResultUrl);
  await expect(page.getByRole("heading", { name: "You passed" })).toBeVisible();

  await page.getByRole("link", { name: "Review answers" }).click();
  await expect(page.getByRole("heading", { name: "Answer review" })).toBeVisible();
  await expect(page.getByText("1 of 4", { exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Mobile primary" })).toHaveCount(0);
});

test("active practice warns on refresh instead of silently continuing", async ({ page }) => {
  await page.goto("/practice/public-financial-management?batch=2");
  await expect(page.getByText(/Question 1 of 2/)).toBeVisible();
  await page.getByRole("button", { name: "Mark for review" }).first().click();
  await page.reload();

  await expect(page.getByRole("heading", { name: "Your previous answers were not submitted." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start again" })).toBeVisible();
});

test("authenticated shell has no serious automated accessibility violations", async ({ page }) => {
  await page.goto("/dashboard");
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const seriousViolations = results.violations.filter((violation) =>
    ["serious", "critical"].includes(violation.impact),
  );
  expect(seriousViolations).toEqual([]);
});
