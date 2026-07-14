import { test as setup } from "@playwright/test";
import { signIn } from "./helpers.js";
import { AUTH_FILES, TEST_PASSWORD, TEST_USERS } from "./test-data.js";

setup("authenticate paid candidate", async ({ page }) => {
  await signIn(page, TEST_USERS.paid.email, TEST_PASSWORD);
  await page.context().storageState({ path: AUTH_FILES.paid });
});
