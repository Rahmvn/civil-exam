import { expect, test } from "@playwright/test";

const journeys = [
  { name: "dashboard", route: "/dashboard", heading: "Welcome, Paid" },
  { name: "module access", route: "/access", heading: "Choose a module" },
];

async function installPerformanceObservers(page) {
  await page.addInitScript(() => {
    window.__promotionSurePerformance = { cls: 0, lcpMs: 0, longTasks: 0 };

    try {
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const latest = entries.at(-1);
        if (latest) window.__promotionSurePerformance.lcpMs = latest.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });

      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) window.__promotionSurePerformance.cls += entry.value;
        }
      }).observe({ type: "layout-shift", buffered: true });

      new PerformanceObserver((list) => {
        window.__promotionSurePerformance.longTasks += list.getEntries().length;
      }).observe({ type: "longtask", buffered: true });
    } catch {
      // Unsupported entry types remain zero and the navigation budgets still apply.
    }
  });
}

async function readMetrics(page) {
  return page.evaluate(() => {
    const navigation = performance.getEntriesByType("navigation")[0];
    const resources = performance.getEntriesByType("resource");
    const observed = window.__promotionSurePerformance ?? {};
    return {
      domContentLoadedMs: navigation?.domContentLoadedEventEnd ?? 0,
      loadMs: navigation?.loadEventEnd ?? 0,
      responseMs: navigation?.responseEnd ?? 0,
      lcpMs: observed.lcpMs ?? 0,
      cls: observed.cls ?? 0,
      longTasks: observed.longTasks ?? 0,
      resourceCount: resources.length,
      transferBytes: resources.reduce((total, resource) => total + (resource.transferSize || 0), 0),
    };
  });
}

for (const journey of journeys) {
  test(`${journey.name} stays within local browser performance budgets`, async ({ page }, testInfo) => {
    await installPerformanceObservers(page);
    await page.goto(journey.route);
    await expect(page.getByRole("heading", { name: journey.heading })).toBeVisible();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(250);

    const metrics = await readMetrics(page);
    await testInfo.attach(`${journey.name}-performance.json`, {
      body: JSON.stringify(metrics, null, 2),
      contentType: "application/json",
    });

    expect(metrics.domContentLoadedMs, "DOMContentLoaded must stay below 3 seconds locally").toBeLessThan(3_000);
    expect(metrics.loadMs, "load event must stay below 5 seconds locally").toBeLessThan(5_000);
    expect(metrics.transferBytes, "initial route transfer must stay below 2.5 MB").toBeLessThan(2_500_000);
    expect(metrics.cls, "CLS must meet the good Core Web Vitals threshold").toBeLessThanOrEqual(0.1);
    if (metrics.lcpMs > 0) {
      expect(metrics.lcpMs, "LCP must meet the good Core Web Vitals threshold").toBeLessThanOrEqual(2_500);
    }
  });
}
