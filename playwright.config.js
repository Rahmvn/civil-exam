import { defineConfig, devices } from "@playwright/test";

const isLocalRun = process.env.E2E_LOCAL_SUPABASE === "true";
const supabaseUrl = process.env.E2E_SUPABASE_URL ?? "";
const isPerformanceRun = process.env.E2E_PERFORMANCE === "true";

if (!isLocalRun || !["127.0.0.1", "localhost"].includes(new URL(supabaseUrl).hostname)) {
  throw new Error("Use `npm run test:e2e` so Playwright is isolated to local Supabase.");
}

const baseURL = "http://127.0.0.1:4173";
const visualProjects = process.env.E2E_VISUAL === "true"
  ? [{
      name: "visual-desktop",
      dependencies: ["setup-paid", "setup-admin"],
      testMatch: /visual\.spec\.js/,
      use: { ...devices["Desktop Chrome"], storageState: ".playwright-auth/paid.json" },
    }]
  : [];
const performanceProjects = isPerformanceRun
  ? [{
      name: "performance-desktop",
      dependencies: ["setup-paid"],
      testMatch: /browser-performance\.spec\.js/,
      use: { ...devices["Desktop Chrome"], storageState: ".playwright-auth/paid.json" },
    }]
  : [];

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: ".playwright-results",
  globalSetup: "./tests/e2e/global-setup.js",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: isPerformanceRun
      ? "npm run build && npm run preview -- --host 127.0.0.1 --port 4173"
      : "npm run dev -- --host 127.0.0.1 --port 4173",
    env: {
      VITE_E2E: "true",
      VITE_SUPABASE_URL: process.env.E2E_SUPABASE_URL,
      VITE_SUPABASE_ANON_KEY: process.env.E2E_SUPABASE_PUBLIC_KEY,
    },
    reuseExistingServer: false,
    timeout: 120_000,
    url: baseURL,
  },
  projects: [
    { name: "setup-admin", testMatch: /admin\.setup\.js/ },
    { name: "setup-paid", testMatch: /paid\.setup\.js/ },
    { name: "setup-free", testMatch: /free\.setup\.js/ },
    {
      name: "admin-desktop",
      dependencies: ["setup-admin"],
      testMatch: /admin\.spec\.js/,
      use: { ...devices["Desktop Chrome"], storageState: ".playwright-auth/admin.json" },
    },
    {
      name: "admin-mobile",
      dependencies: ["setup-admin"],
      testMatch: /admin\.spec\.js/,
      use: { ...devices["Pixel 5"], storageState: ".playwright-auth/admin.json" },
    },
    {
      name: "public-desktop",
      testMatch: /public\.spec\.js/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "public-mobile",
      testMatch: /public\.spec\.js/,
      use: { ...devices["Pixel 5"] },
    },
    {
      name: "paid-desktop",
      dependencies: ["setup-paid"],
      testMatch: /paid\.spec\.js/,
      use: { ...devices["Desktop Chrome"], storageState: ".playwright-auth/paid.json" },
    },
    {
      name: "paid-mobile",
      dependencies: ["setup-paid"],
      testMatch: /paid-mobile\.spec\.js/,
      use: { ...devices["Pixel 5"], storageState: ".playwright-auth/paid.json" },
    },
    {
      name: "free-mobile",
      dependencies: ["setup-free"],
      testMatch: /free-mobile\.spec\.js/,
      use: { ...devices["Pixel 5"], storageState: ".playwright-auth/free.json" },
    },
    {
      name: "critical-firefox",
      dependencies: ["setup-paid", "setup-admin"],
      testMatch: /critical-cross-browser\.spec\.js/,
      use: { ...devices["Desktop Firefox"], storageState: ".playwright-auth/paid.json" },
    },
    {
      name: "critical-webkit",
      dependencies: ["setup-paid", "setup-admin"],
      testMatch: /critical-cross-browser\.spec\.js/,
      use: { ...devices["Desktop Safari"], storageState: ".playwright-auth/paid.json" },
    },
    {
      name: "candidate-accessibility",
      dependencies: ["setup-paid"],
      testMatch: /candidate-accessibility\.spec\.js/,
      use: { ...devices["Desktop Chrome"], storageState: ".playwright-auth/paid.json" },
    },
    {
      name: "admin-accessibility",
      dependencies: ["setup-admin"],
      testMatch: /admin-accessibility\.spec\.js/,
      use: { ...devices["Desktop Chrome"], storageState: ".playwright-auth/admin.json" },
    },
    {
      name: "reliability-desktop",
      dependencies: ["setup-paid"],
      testMatch: /reliability\.spec\.js/,
      use: { ...devices["Desktop Chrome"], storageState: ".playwright-auth/paid.json" },
    },
    ...performanceProjects,
    ...visualProjects,
  ],
});
