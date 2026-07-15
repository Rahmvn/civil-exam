import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers.js";

test("candidate sessions cannot enter content administration", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Welcome, Paid" })).toBeVisible();
});

test("paid dashboard, modules, account, and access routes remain connected", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Welcome, Paid" })).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "Choose a module" })).toBeVisible();
  const unlockedModule = page.locator("article").filter({ hasText: "Public Financial Management" }).first();
  await expect(unlockedModule.getByText("Unlocked", { exact: true })).toBeVisible();
  const lockedModule = page.locator("article").filter({ hasText: "Public Service Rules" }).first();
  await expect(lockedModule.getByRole("button", { name: "Continue to payment" })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.goto("/access?module=public-service-rules");
  await expect(page.getByRole("heading", { name: "Public Service Rules" })).toBeVisible();
  await expect(page.locator(".access-module-row")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Continue to payment" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Choose a different module" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("practice hub prioritises usable modules and keeps unlock options quiet", async ({ page }) => {
  await page.goto("/practice");

  await expect(page.getByRole("heading", { name: "Practice", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your modules" })).toBeVisible();

  const usableModule = page.locator("article").filter({ hasText: "Public Financial Management" }).first();
  await expect(usableModule.getByRole("link", { name: /^(Start|Continue|Retry) practice$/ })).toBeVisible();
  await expect(usableModule.getByRole("link", { name: "Choose practice set" })).toBeVisible();

  const lockedModule = page.locator("article").filter({ hasText: "Public Service Rules" }).first();
  await expect(page.getByRole("heading", { name: "More modules" })).toBeVisible();
  await expect(lockedModule.getByRole("link", { name: "Unlock module" })).toBeVisible();
  await expect(page.getByText("Current Affairs", { exact: true })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test("oral practice is one-way, durable, and reveals guidance only after completion", async ({ page }) => {
  await page.goto("/modules/e2e-oral-questions");
  await expect(page.getByRole("heading", { name: "Choose a practice set" })).toBeVisible();
  await page.getByRole("link", { name: "Start", exact: true }).click();

  await expect(page).toHaveURL(/\/oral-practice\/e2e-oral-questions\?batch=1/);
  await expect(page.getByRole("heading", { name: "Oral Questions" })).toBeVisible();
  await expect(page.getByLabel("3 minutes")).toBeChecked();
  await expect(page.getByLabel("5 minutes")).not.toBeChecked();
  await expect(page.getByText("Accountability makes public officers answerable", { exact: false })).toHaveCount(0);

  await page.getByRole("button", { name: "Begin oral practice" }).click();
  await expect(page.getByRole("heading", { name: "Explain why accountability matters in public service." })).toBeVisible();
  await expect(page.getByText("Question 1", { exact: true })).toBeVisible();
  await expect(page.getByText("Accountability makes public officers answerable", { exact: false })).toHaveCount(0);

  const answerField = page.getByLabel("Your answer");
  await answerField.fill("It makes officers answerable for decisions and public resources.");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 5000 });
  await page.reload();
  await expect(page.getByLabel("Your answer")).toHaveValue("It makes officers answerable for decisions and public resources.");
  await expect(page.getByText("Question 1", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Lock answer and continue" }).click();
  await expect(page.getByRole("heading", { name: "Describe one practical safeguard for public funds." })).toBeVisible();
  await expect(page.getByText("Question 2", { exact: true })).toBeVisible();
  await expect(page.getByText("Explain why accountability matters in public service.", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Continue without an answer" }).click();
  await expect(page.getByRole("heading", { name: "How would you respond to an instruction that conflicts with approved procedure?" })).toBeVisible();
  await page.getByLabel("Your answer").fill("I would check the rule, document the concern, and escalate properly.");
  await page.getByRole("button", { name: "Lock answer and finish" }).click();

  await page.waitForURL(/\/oral-review\?attempt=/);
  await expect(page.getByRole("heading", { name: "Compare your answers" })).toBeVisible();
  await expect(page.getByText("Accountability makes public officers answerable", { exact: false })).toBeVisible();
  await expect(page.getByText("Answerability for decisions", { exact: true })).toBeVisible();
  await expect(page.getByText("This is a self-review, not a score.", { exact: false })).toBeVisible();
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
  await expect(page.getByRole("navigation", { name: "Mobile primary" })).toHaveCount(0);
});

test("active practice warns on refresh instead of silently continuing", async ({ page }) => {
  await page.goto("/practice/public-financial-management?batch=2");
  await expect(page.getByText(/Question 1 of 2/)).toBeVisible();
  await page.getByRole("button", { name: "Mark for review" }).first().click();
  await page.reload();

  await expect(page.getByRole("heading", { name: "Your previous answers were not submitted." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start again" })).toBeVisible();
});

test("authenticated shell has no serious automated accessibility violations", async ({ page }) => {
  await page.goto("/dashboard");
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const seriousViolations = results.violations.filter((violation) =>
    ["serious", "critical"].includes(violation.impact),
  );
  expect(seriousViolations).toEqual([]);
});
