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
import {
  ADMIN_STORAGE_STATE,
  CASEWORKER_STORAGE_STATE,
  DEPLOYED_STACK_SKIP_REASON,
  JUDGE_STORAGE_STATE,
  RUNS_AGAINST_DEPLOYED_STACK,
  signInAsAdmin,
  signInAsCaseworker,
  signInAsJudge
} from "./idam-session.js";

setup("sign in as a caseworker holding the admin role", async ({ page }) => {
  setup.skip(RUNS_AGAINST_DEPLOYED_STACK, DEPLOYED_STACK_SKIP_REASON);

  await signInAsAdmin(page);
  await page.context().storageState({ path: ADMIN_STORAGE_STATE });
});

// A second session rather than a second login inside the test that needs it, for the same reason as the
// first — and it is what the role rules are asserted against, so it is not optional arrangement.
setup("sign in as a caseworker holding no roles", async ({ page }) => {
  setup.skip(RUNS_AGAINST_DEPLOYED_STACK, DEPLOYED_STACK_SKIP_REASON);

  await signInAsCaseworker(page);
  await page.context().storageState({ path: CASEWORKER_STORAGE_STATE });
});

// The judge, and a third session rather than a login inside the judicial journey — same reasoning again. The
// **landing path is asserted inside `signInAsJudge`** rather than in the journey, because it is the login
// flow's behaviour: `/login`'s fallback is `/`, and `/` resolves the persona. A journey that restored this
// session and then visited the pool directly could not tell the two apart.
setup("sign in as a judge", async ({ page }) => {
  setup.skip(RUNS_AGAINST_DEPLOYED_STACK, DEPLOYED_STACK_SKIP_REASON);

  await signInAsJudge(page);
  await page.context().storageState({ path: JUDGE_STORAGE_STATE });
});
