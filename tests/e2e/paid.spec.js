import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers.js";

test("candidate sessions cannot enter content administration", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Welcome, Paid" })).toBeVisible();
});

test("paid dashboard keeps WhatsApp support, modules, account, and access connected", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Welcome, Paid" })).toBeVisible();
  const whatsappSupport = page.getByRole("link", { name: "Chat with PromotionSure support on WhatsApp" });
  await expect(whatsappSupport).toBeVisible();
  await expect(whatsappSupport).toContainText("Support");
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
  await expect(page.getByText("Manage module access and view your payment history.", { exact: true })).toBeVisible();
  const unlockedModule = page.locator("article").filter({ hasText: "Public Financial Management" }).first();
  await expect(unlockedModule.getByText("Unlocked", { exact: true })).toBeVisible();
  const lockedModule = page.locator("article").filter({ hasText: "Public Service Rules" }).first();
  await expect(lockedModule.getByRole("button", { name: "Unlock module" })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.goto("/access?module=public-service-rules");
  const unlockDialog = page.getByRole("dialog", { name: "Module access" });
  await expect(unlockDialog).toBeVisible();
  await expect(unlockDialog.getByText("Public Service Rules", { exact: true })).toBeVisible();
  await expect(unlockDialog.getByRole("button", { name: "Continue" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("WhatsApp support stays out of active practice", async ({ page }) => {
  await page.goto("/practice/public-financial-management?batch=1");
  await expect(page.getByRole("heading", { name: "Public Financial Management" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Chat with PromotionSure support on WhatsApp" })).toHaveCount(0);
});

test("payment return stays on the receipt until the candidate opens the purchased module", async ({ page }) => {
  const reference = "PS-e2e-payment-return";
  let verificationCount = 0;

  await page.route("**/functions/v1/verify-paystack-payment", async (route) => {
    verificationCount += 1;
    const requestBody = route.request().postDataJSON();
    expect(requestBody).toEqual({ reference });
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        status: "active",
        expires_at: "2027-07-18T00:00:00.000Z",
        subject_name: "Public Financial Management",
        subject_slug: "public-financial-management",
      }),
    });
  });

  await page.goto(`/payment/verify?trxref=${reference}&reference=${reference}`);
  await expect(page).toHaveURL(new RegExp(`/payment/verify\\?trxref=${reference}&reference=${reference}$`));
  await expect(page.getByRole("heading", { name: "Access unlocked" })).toBeVisible();
  await expect(page.getByText("Public Financial Management is now unlocked.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Continue practice" })).toHaveAttribute(
    "href",
    "/modules/public-financial-management",
  );

  const verificationCountBeforeReload = verificationCount;
  await page.reload();
  await expect(page.getByRole("heading", { name: "Access unlocked" })).toBeVisible();
  expect(verificationCount).toBeGreaterThan(verificationCountBeforeReload);

  await page.getByRole("link", { name: "Continue practice" }).click();
  await expect(page).toHaveURL(/\/modules\/public-financial-management$/);
  await expect(page.getByText("Public Financial Management", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Welcome, Paid" })).toHaveCount(0);
});

test("WhatsApp payment context preserves a delayed-access reference", async ({ page }) => {
  const reference = "PS-e2e-access-issue";

  await page.route("**/functions/v1/verify-paystack-payment", async (route) => {
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        code: "PAYMENT_FULFILLMENT_FAILED",
        error: "Payment was received, but module access still needs attention. Please check again.",
      }),
    });
  });

  await page.goto(`/payment/verify?reference=${reference}`);
  await expect(page.getByRole("heading", { name: "Payment received — access needs attention" })).toBeVisible();
  await expect(page.getByText(/Your payment was received, but the module has not unlocked yet/)).toBeVisible();
  await expect(page.getByText("Payment not confirmed yet", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Check again" })).toBeVisible();
  const whatsappSupport = page.getByRole("link", { name: "Chat with PromotionSure support on WhatsApp" });
  const whatsappUrl = new URL(await whatsappSupport.getAttribute("href"));
  expect(whatsappUrl.searchParams.get("text")).toContain(reference);

  const helpLink = page.getByRole("link", { name: "Get payment help" });
  await expect(helpLink).toHaveAttribute(
    "href",
    `/help?category=payment&reference=${reference}`,
  );
  await helpLink.click();
  await expect(page.getByLabel("What do you need help with?")).toHaveValue("payment");
  await expect(page.getByLabel("Payment reference optional")).toHaveValue(reference);
  await expect(page.getByLabel("Issue")).toHaveValue("Payment received but module did not unlock");
});

test("candidate can submit and track a help request", async ({ page }) => {
  await page.goto("/help");
  await expect(page.getByRole("heading", { name: "Help & support" })).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Send a request" })).toBeVisible();

  await page.getByLabel("What do you need help with?").selectOption("technical");
  await page.getByLabel("Issue").fill("Practice page did not respond");
  await page.getByLabel("What happened?").fill("The practice page remained open but the action did not complete when selected.");
  await page.getByRole("button", { name: "Send request" }).click();

  await expect(page.getByText(/Your request has been received|Your request could not be sent/)).toBeVisible();
  await expect(page.getByText("Practice page did not respond", { exact: true }).first()).toBeVisible();
  if (await page.getByText("Your request has been received. You can follow its status below.").isVisible()) {
    await expect(page.getByText("Received", { exact: true }).first()).toBeVisible();
  }
  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(accessibility.violations.filter((violation) =>
    ["serious", "critical"].includes(violation.impact))).toEqual([]);
});

test("coming-soon lifecycle is never presented as unlocked", async ({ page }) => {
  await page.goto("/dashboard");
  const dashboardModule = page.locator("article").filter({ hasText: "Coming Soon Regression" }).first();
  await expect(dashboardModule).toBeVisible();
  await expect(dashboardModule.getByText("Unlocked", { exact: true })).toHaveCount(0);
  await expect(dashboardModule.getByText("Practice for this module is coming soon.")).toBeVisible();
  await expect(dashboardModule.getByRole("button", { name: "Coming soon" })).toBeDisabled();
  await expect(dashboardModule).not.toHaveClass(/is-unlocked/);

  await page.goto("/access");
  const accessModule = page.locator("article").filter({ hasText: "Coming Soon Regression" }).first();
  await expect(accessModule).toBeVisible();
  await expect(accessModule.getByText("Unlocked", { exact: true })).toHaveCount(0);
  await expect(accessModule.getByText("Practice is coming soon.")).toBeVisible();
  await expect(accessModule.getByText("Not available yet")).toBeVisible();
  await expect(accessModule.getByRole("link", { name: "Continue practice" })).toHaveCount(0);
  await expect(accessModule).not.toHaveClass(/is-unlocked/);

  await page.goto("/modules/e2e-coming-soon");
  await expect(page.getByRole("heading", { name: "Practice is coming soon" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Coming soon" })).toBeDisabled();
  await expect(page.getByRole("link", { name: /^(Start|Continue|Retry)/ })).toHaveCount(0);
});

test("practice hub prioritises usable modules and keeps unlock options quiet", async ({ page }) => {
  await page.goto("/practice");

  await expect(page.getByRole("heading", { name: "Your modules" })).toBeVisible();

  const usableModule = page.locator("article").filter({ hasText: "Public Financial Management" }).first();
  await expect(usableModule.getByRole("link", { name: /^(Start|Continue|Retry) practice$/ })).toBeVisible();
  await expect(usableModule.getByRole("link", { name: "Choose practice set" })).toBeVisible();

  const availableFreeModule = page.locator("article").filter({ hasText: "Public Service Rules" }).first();
  await expect(availableFreeModule.getByRole("button", { name: "Try free" })).toBeVisible();
  await expect(page.getByText("Current Affairs", { exact: true })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test("oral practice is one-way, durable, and reveals guidance only after completion", async ({ page }) => {
  await page.goto("/modules/e2e-oral-questions");
  await expect(page.getByRole("heading", { name: "Choose a practice set" })).toBeVisible();
  await page.getByRole("link", { name: "Start", exact: true }).click();

  await expect(page).toHaveURL(/\/oral-practice\/e2e-oral-questions\?batch=1/);
  await expect(page.getByText("Oral Questions", { exact: true })).toBeVisible();
  if (await page.getByRole("button", { name: "Begin oral practice" }).isVisible()) {
    await expect(page.getByText("Answer each prompt in your own words. Once you continue, that answer is locked.")).toBeVisible();
    await expect(page.getByLabel("3 minutes")).toBeChecked();
    await expect(page.getByLabel("5 minutes")).not.toBeChecked();
    await page.getByRole("button", { name: "Begin oral practice" }).click();
  }
  await expect(page.getByText("Accountability makes public officers answerable", { exact: false })).toHaveCount(0);

  await expect(page.getByRole("heading", { name: "Explain why accountability matters in public service." })).toBeVisible();
  await expect(page.getByText(/Question 1 of 3/)).toBeVisible();
  await expect(page.getByText("Accountability makes public officers answerable", { exact: false })).toHaveCount(0);

  const answerField = page.getByLabel("Your answer");
  await answerField.fill("It makes officers answerable for decisions and public resources.");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 5000 });
  page.once("dialog", (dialog) => dialog.accept());
  await page.reload();
  await expect(page.getByLabel("Your answer")).toHaveValue("It makes officers answerable for decisions and public resources.");
  await expect(page.getByText(/Question 1 of 3/)).toBeVisible();

  await page.getByRole("button", { name: "Exit" }).click();
  const exitDialog = page.getByRole("dialog", { name: "Leave oral practice?" });
  await expect(exitDialog).toBeVisible();
  await expect(exitDialog).toContainText("the current question timer will continue");
  await exitDialog.getByRole("button", { name: "Continue practice" }).click();
  await expect(exitDialog).not.toBeVisible();

  await page.getByRole("button", { name: "Exit" }).click();
  await exitDialog.getByRole("button", { name: "Save and leave" }).click();
  await page.waitForURL(/\/dashboard#modules$/);
  await page.goto("/oral-practice/e2e-oral-questions?batch=1");
  await expect(page.getByLabel("Your answer")).toHaveValue("It makes officers answerable for decisions and public resources.");
  await expect(page.getByText(/Question 1 of 3/)).toBeVisible();

  await page.getByRole("button", { name: "Lock answer and continue" }).click();
  await expect(page.getByRole("heading", { name: "Describe one practical safeguard for public funds." })).toBeVisible();
  await expect(page.getByText(/Question 2 of 3/)).toBeVisible();
  await expect(page.getByText("Explain why accountability matters in public service.", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Continue without an answer" }).click();
  await expect(page.getByRole("heading", { name: "How would you respond to an instruction that conflicts with approved procedure?" })).toBeVisible();
  await page.getByLabel("Your answer").fill("I would check the rule, document the concern, and escalate properly.");
  await page.getByRole("button", { name: "Lock answer and finish" }).click();

  await page.waitForURL(/\/oral-review\?attempt=/);
  await expect(page.getByText("Oral Questions - Practice set 1", { exact: true })).toBeVisible();
  await expect(page.getByText("Self-review only. No score is assigned.", { exact: true })).toBeVisible();
  await expect(page.getByText("Accountability makes public officers answerable", { exact: false })).toBeVisible();
  await expect(page.getByText("Answerability for decisions", { exact: true })).toBeVisible();
  await expect(page.getByText("Self-review only. No score is assigned.", { exact: true })).toBeVisible();
  await expect(page.getByText(/pass mark/i)).toHaveCount(0);

  const firstReview = page.locator(".oral-review-card").first();
  await firstReview.getByRole("button", { name: "Partly covered" }).click();
  await expect(firstReview.getByRole("button", { name: "Partly covered" })).toHaveAttribute("aria-pressed", "true");
  const reviewUrl = page.url();
  await page.reload();
  await expect(page).toHaveURL(reviewUrl);
  await expect(page.locator(".oral-review-card").first().getByRole("button", { name: "Partly covered" })).toHaveAttribute("aria-pressed", "true");
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
  await expect(page.locator(".answer-review-explanation")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Mobile primary" })).toHaveCount(0);
});

test("active practice can recover saved work after refresh", async ({ page }) => {
  await page.goto("/practice/public-financial-management?batch=2");
  await expect(page.getByText(/Question 1 of 2/)).toBeVisible();
  await page.getByRole("button", { name: "Mark for review" }).first().click();
  await page.reload();

  await expect(page.getByRole("heading", { name: "Continue your practice?" })).toBeVisible();
  await page.getByRole("button", { name: "Resume practice" }).click();
  await expect(page.getByRole("button", { name: "Remove review flag" }).first()).toBeVisible();
});

test("exiting from the refresh recovery screen closes the server session", async ({ page }) => {
  const sessionPayloads = [];
  page.on("response", async (response) => {
    if (!response.url().includes("/rest/v1/rpc/start_objective_practice_session_v2") || !response.ok()) return;
    sessionPayloads.push(await response.json());
  });

  await page.goto("/practice/public-financial-management?batch=2");
  await expect(page.getByText(/Question 1 of 2/)).toBeVisible();
  await expect.poll(() => sessionPayloads.length).toBeGreaterThanOrEqual(1);
  const firstSession = sessionPayloads.at(-1);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Continue your practice?" })).toBeVisible();
  await page.getByRole("button", { name: "Exit practice" }).click();
  await page.waitForURL(/\/dashboard#modules$/);

  await page.goto("/practice/public-financial-management?batch=2");
  await expect(page.getByText(/Question 1 of 2/)).toBeVisible();
  await expect.poll(() => sessionPayloads.length).toBeGreaterThanOrEqual(2);
  const secondSession = sessionPayloads.at(-1);

  expect(secondSession.practice_session_id).not.toBe(firstSession.practice_session_id);
  expect(Date.parse(secondSession.deadline_at)).toBeGreaterThan(Date.parse(firstSession.deadline_at));

  await page.getByRole("button", { name: "Exit" }).click();
  await page.getByRole("dialog", { name: "Exit this practice?" })
    .getByRole("button", { name: "Exit practice" })
    .click();
  await page.waitForURL(/\/dashboard#modules$/);
});

test("explicit objective practice exit creates a fresh server session and timer", async ({ page }) => {
  const sessionPayloads = [];
  page.on("response", async (response) => {
    if (!response.url().includes("/rest/v1/rpc/start_objective_practice_session_v2") || !response.ok()) return;
    sessionPayloads.push(await response.json());
  });

  await page.goto("/practice/public-financial-management?batch=2");
  await expect(page.getByText(/Question 1 of 2/)).toBeVisible();
  await expect.poll(() => sessionPayloads.length).toBeGreaterThanOrEqual(1);
  const firstSession = sessionPayloads.at(-1);

  await page.getByRole("button", { name: "Exit" }).click();
  const exitDialog = page.getByRole("dialog", { name: "Exit this practice?" });
  await expect(exitDialog).toBeVisible();
  await exitDialog.getByRole("button", { name: "Exit practice" }).click();
  await page.waitForURL(/\/dashboard#modules$/);

  await page.goto("/practice/public-financial-management?batch=2");
  await expect(page.getByText(/Question 1 of 2/)).toBeVisible();
  await expect.poll(() => sessionPayloads.length).toBeGreaterThanOrEqual(2);
  const secondSession = sessionPayloads.at(-1);

  expect(secondSession.practice_session_id).not.toBe(firstSession.practice_session_id);
  expect(Date.parse(secondSession.deadline_at)).toBeGreaterThan(Date.parse(firstSession.deadline_at));

  await page.getByRole("button", { name: "Exit" }).click();
  await page.getByRole("dialog", { name: "Exit this practice?" })
    .getByRole("button", { name: "Exit practice" })
    .click();
  await page.waitForURL(/\/dashboard#modules$/);
});

test("authenticated shell has no serious automated accessibility violations", async ({ page }) => {
  await page.goto("/dashboard");
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const seriousViolations = results.violations.filter((violation) =>
    ["serious", "critical"].includes(violation.impact),
  );
  expect(seriousViolations).toEqual([]);
});
