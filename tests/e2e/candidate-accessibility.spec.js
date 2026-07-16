import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const routes = [
  ["dashboard", "/dashboard", "Welcome, Paid"],
  ["module detail", "/modules/public-financial-management", "Choose a practice set"],
  ["module access", "/access", "Choose a module"],
  ["practice hub", "/practice", "Practice"],
  ["oral practice start", "/oral-practice/e2e-oral-questions?batch=1", "Oral Questions"],
];

for (const [name, route, heading] of routes) {
  test(`${name} has no serious automated accessibility violations`, async ({ page }) => {
    await page.goto(route);
    await expect(page.getByRole("heading", { name: heading, exact: heading !== "Welcome, Paid" })).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const blocking = results.violations.filter(({ impact }) => ["serious", "critical"].includes(impact));
    expect(blocking).toEqual([]);
  });
}
