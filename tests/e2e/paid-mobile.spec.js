import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers.js";

test("mobile navigation and practice controls fit the viewport", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("navigation", { name: "Mobile primary" })).toBeVisible();
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
