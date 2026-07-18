import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers.js";

test("landing page gives a clear public entry point", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("link", { name: "PromotionSure" })).toBeVisible();
  await expect(page).toHaveTitle("PromotionSure | Public Service Promotion Exam Practice");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Practise for your 2026 public service promotion exam.",
  );
  await expect(page.getByRole("link", { name: "Start free practice" })).toBeVisible();
  await expect(page.getByText("Public Financial Management", { exact: true })).toBeVisible();
  await expect(page.getByText("Public Service Rules", { exact: true })).toBeVisible();
  await expect(page.getByText(/Current Affairs/)).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("authentication uses the canonical product descriptor", async ({ page }) => {
  await page.goto("/auth?mode=sign-in");

  const brand = page.getByRole("link", {
    name: "PromotionSure Public Service Promotion Exam Practice",
  });
  await expect(brand).toBeVisible();
  await expect(page.getByText("Public Service Promotion Exam Practice", { exact: true })).toHaveCount(1);
});

test("a user who forgot their password can reach a clear recovery form", async ({ page }) => {
  await page.goto("/auth?mode=sign-in");
  await page.getByRole("button", { name: "Forgot password?" }).click();

  await expect(page).toHaveURL(/mode=forgot/);
  await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send recovery code" })).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});

test("protected direct URL preserves the intended destination", async ({ page }) => {
  await page.goto("/review?attempt=00000000-0000-4000-8000-000000000001");

  await expect(page).toHaveURL(/\/auth\?mode=sign-in&returnTo=/);
  const returnTo = new URL(page.url()).searchParams.get("returnTo");
  expect(returnTo).toBe("/review?attempt=00000000-0000-4000-8000-000000000001");
  await expect(page.getByText("Please sign in to continue.")).toBeVisible();
});

test("unknown URL has a safe recovery action", async ({ page }) => {
  await page.goto("/not-a-real-page");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to home" })).toHaveAttribute("href", "/");
});

test("landing page has no serious automated accessibility violations", async ({ page }) => {
  await page.goto("/");
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const seriousViolations = results.violations.filter((violation) =>
    ["serious", "critical"].includes(violation.impact),
  );
  expect(seriousViolations).toEqual([]);
});
