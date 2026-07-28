import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:4175";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /turnstile-mocked\.spec\.js/,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 4175",
    env: {
      VITE_E2E: "true",
      VITE_SUPABASE_URL: "http://127.0.0.1:59999",
      VITE_SUPABASE_ANON_KEY: "local-auth-mock-key",
      VITE_GOOGLE_AUTH_ENABLED: "false",
      VITE_TURNSTILE_ENABLED: "true",
      // Cloudflare's documented always-pass public test sitekey.
      VITE_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
    },
    reuseExistingServer: false,
    timeout: 120_000,
    url: baseURL,
  },
});
