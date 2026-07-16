import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const routes = [
  {
    name: "dashboard",
    route: "/dashboard",
    ready: (page) => page.getByRole("heading", { name: "Welcome, Paid" }),
  },
  {
    name: "module detail",
    route: "/modules/public-financial-management",
    ready: (page) => page.getByRole("heading", { name: "Choose a practice set", exact: true }),
  },
  {
    name: "module access",
    route: "/access",
    ready: (page) => page.getByText("Manage module access and view your payment history.", { exact: true }),
  },
  {
    name: "practice hub",
    route: "/practice",
    ready: (page) => page.getByRole("heading", { name: "Your modules", exact: true }),
  },
  {
    name: "oral practice start",
    route: "/oral-practice/e2e-oral-questions?batch=1",
    ready: (page) => page.getByText("Oral Questions", { exact: true }),
  },
];

for (const { name, route, ready } of routes) {
  test(`${name} has no serious automated accessibility violations`, async ({ page }) => {
    await page.goto(route);
    await expect(ready(page)).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const blocking = results.violations.filter(({ impact }) => ["serious", "critical"].includes(impact));
    expect(blocking).toEqual([]);
  });
}
