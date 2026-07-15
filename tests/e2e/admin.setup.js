import { test as setup } from "@playwright/test";
import { signIn } from "./helpers.js";
import { AUTH_FILES, TEST_PASSWORD, TEST_USERS } from "./test-data.js";

setup("authenticate content admin", async ({ page }) => {
  await signIn(page, TEST_USERS.admin.email, TEST_PASSWORD, /\/admin$/);
  await page.context().storageState({ path: AUTH_FILES.admin });
});
