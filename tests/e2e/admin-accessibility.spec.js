import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const routes = [
  ["content catalogue", "/admin", "Content"],
  ["activity log", "/admin/activity", "Activity"],
  ["admin guide", "/admin/guide", "Admin guide"],
];

for (const [name, route, heading] of routes) {
  test(`${name} has no serious automated accessibility violations`, async ({ page }) => {
    await page.goto(route);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const blocking = results.violations.filter(({ impact }) => ["serious", "critical"].includes(impact));
    expect(blocking).toEqual([]);
  });
}
