/**
 * Signs in once and saves the session, so the journeys do not each pay for the OIDC round trip.
 *
 * Its own Playwright project rather than a `beforeEach`: the login flow is three redirects across two
 * origins, and repeating it per test would make the journeys slower without testing anything they do
 * not already cover. The flow itself is verified in `src/auth/idam.test.ts` and against the
 * running simulator; here it is arrangement.
 *
 * See ./idam-session.ts for why this drives the real issuer rather than forging a cookie.
 */
import { test as setup } from "@playwright/test";
import { ADMIN_STORAGE_STATE, DEPLOYED_STACK_SKIP_REASON, RUNS_AGAINST_DEPLOYED_STACK, signInAsAdmin } from "./idam-session.js";

setup("sign in as a caseworker holding the admin role", async ({ page }) => {
  setup.skip(RUNS_AGAINST_DEPLOYED_STACK, DEPLOYED_STACK_SKIP_REASON);

  await signInAsAdmin(page);
  await page.context().storageState({ path: ADMIN_STORAGE_STATE });
});
