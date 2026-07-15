import { expect } from "@playwright/test";

export async function expectNoHorizontalOverflow(page) {
  const dimensions = await page.evaluate(() => {
    const clientWidth = document.documentElement.clientWidth;
    const elements = Array.from(document.querySelectorAll("body, body *"));
    const offenders = elements
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          element: `${element.tagName.toLowerCase()}${element.className ? `.${String(element.className).trim().replace(/\s+/g, ".")}` : ""}`,
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        };
      })
      .filter((rect) => rect.left < -1 || rect.right > clientWidth + 1)
      .slice(0, 12);
    const internalOverflow = elements
      .filter((element) => element.scrollWidth > element.clientWidth + 1)
      .map((element) => ({
        element: `${element.tagName.toLowerCase()}${element.className ? `.${String(element.className).trim().replace(/\s+/g, ".")}` : ""}`,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        text: element.children.length === 0 ? element.textContent?.trim().slice(0, 120) : undefined,
        whiteSpace: getComputedStyle(element).whiteSpace,
        overflowWrap: getComputedStyle(element).overflowWrap,
      }))
      .slice(0, 12);

    return {
      clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      offenders,
      internalOverflow,
    };
  });
  expect(dimensions.scrollWidth, JSON.stringify({
    offenders: dimensions.offenders,
    internalOverflow: dimensions.internalOverflow,
  }, null, 2))
    .toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

export async function signIn(page, email, password, destination = /\/dashboard(?:#.*)?$/) {
  await page.goto("/auth?mode=sign-in");
  await page.getByLabel("Email address").fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator("form").getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(destination);
}
