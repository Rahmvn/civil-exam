import { expect, test } from "@playwright/test";

async function expectCaptchaToken(request) {
  const body = request.postDataJSON();
  expect(body.gotrue_meta_security?.captcha_token).toEqual(expect.any(String));
  expect(body.gotrue_meta_security.captcha_token.length).toBeGreaterThan(20);
}

async function rejectAfterCapturing(route) {
  await expectCaptchaToken(route.request());
  await route.fulfill({
    status: 400,
    contentType: "application/json",
    body: JSON.stringify({ error_code: "invalid_credentials", msg: "mock rejection" }),
  });
}

test("password sign-in sends a completed Turnstile token", async ({ page }) => {
  const requestSeen = new Promise((resolve) => {
    void page.route("**/auth/v1/token?grant_type=password", async (route) => {
      await rejectAfterCapturing(route);
      resolve();
    });
  });

  await page.goto("/auth?mode=sign-in");
  await page.getByLabel("Email address").fill("candidate@example.com");
  await page.getByLabel("Password", { exact: true }).fill("StrongPass123!");
  const submit = page.locator("form").getByRole("button", { name: "Sign in" });
  await expect(submit).toBeEnabled({ timeout: 20_000 });
  await submit.click();
  await requestSeen;
});

test("account creation sends a completed Turnstile token", async ({ page }) => {
  const requestSeen = new Promise((resolve) => {
    void page.route("**/auth/v1/signup", async (route) => {
      await rejectAfterCapturing(route);
      resolve();
    });
  });

  await page.goto("/auth?mode=sign-up");
  await page.getByLabel("Full name").fill("Test Candidate");
  await page.getByLabel("Email address").fill("candidate@example.com");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByLabel("Password", { exact: true }).fill("StrongPass123!");
  await page.getByLabel("Confirm password").fill("StrongPass123!");
  await page.getByRole("checkbox", { name: /I agree to the Terms of Service/i }).check();
  const submit = page.locator("form").getByRole("button", { name: "Create account" });
  await expect(submit).toBeEnabled({ timeout: 20_000 });
  await submit.click();
  await requestSeen;
});

test("password recovery sends a completed Turnstile token", async ({ page }) => {
  const requestSeen = new Promise((resolve) => {
    void page.route("**/auth/v1/recover**", async (route) => {
      await rejectAfterCapturing(route);
      resolve();
    });
  });

  await page.goto("/auth?mode=forgot");
  await page.getByLabel("Email address").fill("candidate@example.com");
  const submit = page.getByRole("button", { name: "Send recovery code" });
  await expect(submit).toBeEnabled({ timeout: 20_000 });
  await submit.click();
  await requestSeen;
});
