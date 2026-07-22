import { expect, test } from "@playwright/test";

function pendingSignupState(now = Date.now()) {
  return {
    version: 1,
    purpose: "signup",
    email: "candidate@example.com",
    returnTo: "/dashboard",
    requestedAt: now,
    cooldownUntil: now + 60_000,
    expiresAt: now + 3_600_000,
  };
}

function mockJwt(userId) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    aud: "authenticated",
    exp: Math.floor(Date.now() / 1000) + 3_600,
    role: "authenticated",
    sub: userId,
  })}.mock-signature`;
}

async function openSignupVerification(page) {
  const pending = pendingSignupState();
  await page.addInitScript((value) => {
    window.sessionStorage.setItem("promotionsure.auth.pending.signup", JSON.stringify(value));
  }, pending);
  await page.goto("/auth?mode=verify-signup");
}

test("disabled Google authentication is not presented as an unfinished option", async ({ page }) => {
  await page.goto("/auth?mode=sign-in");
  await expect(page.getByRole("button", { name: /Google/i })).toHaveCount(0);
  await expect(page.getByText("Google sign-in coming soon")).toHaveCount(0);

  await page.goto("/auth?mode=sign-up");
  await expect(page.getByRole("button", { name: /Google/i })).toHaveCount(0);
});

test("OTP uses one accessible numeric input with six visual cells", async ({ page }) => {
  await openSignupVerification(page);

  const input = page.getByRole("textbox", { name: "Six-digit verification code" });
  await expect(input).toHaveCount(1);
  await expect(input).toHaveAttribute("inputmode", "numeric");
  await expect(input).toHaveAttribute("autocomplete", "one-time-code");
  await expect(input).toHaveAttribute("maxlength", "6");

  await input.pressSequentially("12a34-56");
  await expect(input).toHaveValue("123456");
  await expect(page.locator(".auth-otp-cell")).toHaveCount(6);
  await expect(page.locator(".auth-otp-cell").nth(0)).toHaveText("1");
  await expect(page.locator(".auth-otp-cell").nth(5)).toHaveText("6");
});

test("full-code paste behavior and expired-code errors remain safe", async ({ page }) => {
  await page.route("**/auth/v1/verify", async (route) => {
    await route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ error_code: "otp_expired", msg: "private provider token detail" }),
    });
  });
  await openSignupVerification(page);

  const input = page.getByRole("textbox", { name: "Six-digit verification code" });
  await input.evaluate((element) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(element, "987654");
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(input).toHaveValue("987654");
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(page.getByRole("alert")).toHaveText("That code has expired. Request a new code and try again.");
  await expect(page.getByRole("alert")).not.toContainText("private provider");
});

test("confirmation-required signup transitions to OTP without persisting password", async ({ page }) => {
  await page.route("**/auth/v1/signup", async (route) => {
    const body = route.request().postDataJSON();
    expect(body.email).toBe("candidate@example.com");
    expect(body.data.legal_acceptance).toBe(true);
    expect(body.data.legal_acceptance_source).toBe("email_signup");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user: {
          id: "00000000-0000-4000-8000-000000000123",
          aud: "authenticated",
          role: "authenticated",
          email: body.email,
          app_metadata: { provider: "email", providers: ["email"] },
          user_metadata: body.data,
          identities: [],
          created_at: new Date().toISOString(),
        },
        session: null,
      }),
    });
  });

  await page.goto("/auth?mode=sign-up");
  await page.getByLabel("Full name").fill("Test Candidate");
  await page.getByLabel("Email address").fill("candidate@example.com");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByLabel("Password", { exact: true }).fill("StrongPass123!");
  await page.getByLabel("Confirm password").fill("StrongPass123!");
  const createAccount = page.locator("form").getByRole("button", { name: "Create account" });
  await expect(createAccount).toBeDisabled();
  const termsLink = page.getByRole("link", { name: "Terms of Service" });
  const legalCheckbox = page.getByRole("checkbox", { name: /I agree to the Terms of Service/i });
  await expect(termsLink).toHaveAttribute("href", "/terms");
  await expect(termsLink).toHaveAttribute("target", "_blank");
  await expect(page.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");
  const termsPagePromise = page.waitForEvent("popup");
  await termsLink.click();
  const termsPage = await termsPagePromise;
  await expect(termsPage).toHaveURL(/\/terms$/);
  await termsPage.close();
  await expect(legalCheckbox).not.toBeChecked();
  await legalCheckbox.check();
  await expect(createAccount).toBeEnabled();
  await createAccount.click();

  await expect(page.getByRole("heading", { name: "Verify your email" })).toBeVisible();
  const stored = await page.evaluate(() => window.sessionStorage.getItem("promotionsure.auth.pending.signup"));
  expect(stored).not.toContain("StrongPass123!");
  expect(JSON.parse(stored).purpose).toBe("signup");
});

test("auto-confirm signup skips OTP and clears stale verification state", async ({ page }) => {
  const userId = "00000000-0000-4000-8000-000000000456";
  const user = {
    id: userId,
    aud: "authenticated",
    role: "authenticated",
    email: "autoconfirm@example.com",
    email_confirmed_at: new Date().toISOString(),
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: { full_name: "Auto Confirm" },
    identities: [],
    created_at: new Date().toISOString(),
  };
  await page.addInitScript((value) => {
    window.sessionStorage.setItem("promotionsure.auth.pending.signup", JSON.stringify(value));
  }, pendingSignupState());
  await page.route("**/auth/v1/signup", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        access_token: mockJwt(userId),
        token_type: "bearer",
        expires_in: 3_600,
        refresh_token: "mock-refresh-token",
        user,
      }),
    });
  });
  await page.route("**/rest/v1/**", async (route) => {
    const isProfile = new URL(route.request().url()).pathname.endsWith("/profiles");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: isProfile ? { "Content-Range": "0-0/1" } : {},
      body: isProfile ? JSON.stringify([{
        id: userId,
        email: user.email,
        full_name: "Auto Confirm",
        role: "candidate",
        created_at: new Date().toISOString(),
      }]) : "[]",
    });
  });

  await page.goto("/auth?mode=sign-up");
  await page.getByLabel("Full name").fill("Auto Confirm");
  await page.getByLabel("Email address").fill(user.email);
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByLabel("Password", { exact: true }).fill("StrongPass123!");
  await page.getByLabel("Confirm password").fill("StrongPass123!");
  await page.getByRole("checkbox", { name: /I agree to the Terms of Service/i }).check();
  await page.locator("form").getByRole("button", { name: "Create account" }).click();

  await expect(page.getByRole("heading", { name: "Verify your email" })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem("promotionsure.auth.pending.signup"))).toBeNull();
});

test("failed implicit callback is sanitized and removes query and fragment data", async ({ page }) => {
  await page.goto("/auth/callback?returnTo=%2Fdashboard#error=access_denied&error_description=private-provider-detail&state=private-state");

  await expect(page).toHaveURL("http://127.0.0.1:4174/auth/callback");
  await expect(page.getByRole("heading", { name: "Sign-in request unavailable" })).toBeVisible();
  await expect(page.getByText("Google sign-in was cancelled. You can try again or continue with email.")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("private-provider-detail");
});
