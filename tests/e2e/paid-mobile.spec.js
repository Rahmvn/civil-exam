import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers.js";

test("candidate help centre stacks cleanly on mobile", async ({ page }) => {
  await page.goto("/help");
  await expect(page.getByRole("heading", { name: "Help & support" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Send a request" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your requests" })).toBeVisible();

  const formBox = await page.locator(".support-form").boundingBox();
  const historyBox = await page.locator(".support-history").boundingBox();
  expect(historyBox.y).toBeGreaterThan(formBox.y + formBox.height);
  expect(Math.abs(historyBox.x - formBox.x)).toBeLessThanOrEqual(1);
  await expectNoHorizontalOverflow(page);
});

test("mobile WhatsApp support, navigation, and practice controls fit the viewport", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("navigation", { name: "Mobile primary" })).toBeVisible();
  const whatsappSupport = page.getByRole("link", { name: "Chat with PromotionSure support on WhatsApp" });
  await expect(whatsappSupport).toBeVisible();
  const supportBox = await whatsappSupport.boundingBox();
  const bottomNavBox = await page.getByRole("navigation", { name: "Mobile primary" }).boundingBox();
  expect(supportBox.y + supportBox.height).toBeLessThan(bottomNavBox.y - 4);
  const interactionStyles = await page.evaluate(() => {
    const button = document.querySelector("button");
    const link = document.querySelector("a[href]");
    const readingText = document.querySelector("main p");
    const summarize = (element) => {
      const style = getComputedStyle(element);
      return {
        tapHighlight: style.webkitTapHighlightColor,
        touchAction: style.touchAction,
        userSelect: style.userSelect,
      };
    };
    return {
      button: summarize(button),
      link: summarize(link),
      readingText: summarize(readingText),
    };
  });
  expect(interactionStyles.button).toEqual({
    tapHighlight: "rgba(0, 0, 0, 0)",
    touchAction: "manipulation",
    userSelect: "none",
  });
  expect(interactionStyles.link).toEqual({
    tapHighlight: "rgba(0, 0, 0, 0)",
    touchAction: "manipulation",
    userSelect: "none",
  });
  expect(interactionStyles.readingText.userSelect).not.toBe("none");
  await page.locator("button").first().focus();
  const focusStyles = await page.locator("button").first().evaluate((element) => {
    const style = getComputedStyle(element);
    return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
  });
  expect(focusStyles.outlineStyle).not.toBe("none");
  expect(Number.parseFloat(focusStyles.outlineWidth)).toBeGreaterThan(0);
  await expectNoHorizontalOverflow(page);

  await page.goto("/practice/public-financial-management?batch=1");
  await expect(page.getByRole("heading", { name: "Public Financial Management" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Question Map" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark for review" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Next", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Mobile primary" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Chat with PromotionSure support on WhatsApp" })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test("oral practice start and answer controls fit a mobile viewport", async ({ page }) => {
  await page.goto("/oral-practice/e2e-oral-questions?batch=1");
  await expect(page.getByText("Oral Questions", { exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  if (await page.getByRole("button", { name: "Begin oral practice" }).isVisible()) {
    await expect(page.getByText("Answer each prompt in your own words. Once you continue, that answer is locked.")).toBeVisible();
    await page.getByRole("button", { name: "Begin oral practice" }).click();
  }
  await expect(page.getByLabel("Your answer")).toBeVisible();
  await expect(page.getByRole("button", { name: /continue|finish/i })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Mobile primary" })).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test("mobile refresh recovery can exit without reusing the stale timer", async ({ page }) => {
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
  await expectNoHorizontalOverflow(page);
  await page.getByRole("button", { name: "Exit practice" }).click();
  await page.waitForURL(/\/dashboard#modules$/);

  await page.goto("/practice/public-financial-management?batch=2");
  await expect(page.getByText(/Question 1 of 2/)).toBeVisible();
  await expect.poll(() => sessionPayloads.length).toBeGreaterThanOrEqual(2);
  const secondSession = sessionPayloads.at(-1);
  expect(secondSession.practice_session_id).not.toBe(firstSession.practice_session_id);
  await expect(page.locator(".practice-header-timer strong")).not.toHaveText("00:00");

  await page.getByRole("button", { name: "Exit" }).click();
  await page.getByRole("dialog", { name: "Exit this practice?" })
    .getByRole("button", { name: "Exit practice" })
    .click();
  await page.waitForURL(/\/dashboard#modules$/);
});
