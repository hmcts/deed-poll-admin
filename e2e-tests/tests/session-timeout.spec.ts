/**
 * The session timeout warning and the timed-out exit, in a real browser against a real clock (OWASP plan 03,
 * Task 7). Run with `yarn test:session`; see `playwright.session.config.ts` for the 330-second idle limit.
 *
 * The unit tests pin the server's decisions. What only a browser shows is the warning itself: that it opens in
 * time, takes focus, is accessible, and that "Stay signed in" really extends the session. And that without
 * JavaScript, where no warning can appear, the server still ends the session.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { signInAsAdmin, signInAsCaseworker } from "./idam-session.js";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
/**
 * The warning opens 120 s before the 330 s idle limit, so 210 s after the last activity. Ninety seconds of slack, for
 * page load, timers and a loaded machine. The run waits this long only if the warning is late.
 */
const UNTIL_WARNING_MS = 300_000;
/** From the warning to the end of the session, plus the status check and the IDAM end-session hop. */
const UNTIL_TIMED_OUT_MS = 200_000;

test.describe.configure({ mode: "parallel" });

/**
 * The timeout ends the session at IDAM, then IDAM returns to the timed-out page. The simulator advertises
 * end-session but has no handler for it (see `sign-out.spec.ts`), so this checks the outbound redirect, then
 * follows the return leg itself, as IDAM would.
 */
async function expectSignedOutThroughIdam(page: Page, appOrigin: string, timeout: number): Promise<void> {
  const timedOut = `${appOrigin}/session-timed-out`;
  await page.waitForURL(
    (url) => url.pathname === "/o/endSession" && url.searchParams.has("id_token_hint") && url.searchParams.get("post_logout_redirect_uri") === timedOut,
    { timeout }
  );
  await page.goto(timedOut);
  await expect(page.getByRole("heading", { name: "You have been signed out" })).toBeVisible();
  // Resumes where the timed-out request was going, which the fresh anonymous session kept.
  await expect(page.getByRole("link", { name: "Sign in again" })).toHaveAttribute("href", "/login?returnTo=%2Fdeed-polls");
}

test("should warn before the idle limit, extend the session on request, and sign out when it runs out", async ({ page }) => {
  test.setTimeout(15 * 60_000);
  await signInAsCaseworker(page);
  const warning = page.locator("#session-timeout-idle");
  const stay = page.getByRole("button", { name: "Stay signed in" });

  await expect(warning).toBeVisible({ timeout: UNTIL_WARNING_MS });
  await expect(stay).toBeFocused();
  expect((await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations).toEqual([]);

  await stay.click();
  await expect(warning).toBeHidden();
  await expect(page).toHaveURL(/\/deed-polls$/);

  // Extended: the warning comes back a full idle period later, not straight away.
  await expect(warning).toBeHidden({ timeout: 60_000 });
  await expect(warning).toBeVisible({ timeout: UNTIL_WARNING_MS });
  await expectSignedOutThroughIdam(page, new URL(page.url()).origin, UNTIL_TIMED_OUT_MS);
  expect((await new AxeBuilder({ page }).withTags(WCAG).analyze()).violations).toEqual([]);
});

test("should still end an idle session without JavaScript, where no warning can appear", async ({ browser }) => {
  test.setTimeout(10 * 60_000);
  const context = await browser.newContext({ javaScriptEnabled: false, storageState: undefined });
  const page = await context.newPage();
  // A different user from the journey above, which runs at the same time: the simulator keeps one pending
  // authorization code per user, so two simultaneous logins as one user make the first code exchange fail.
  await signInAsAdmin(page);

  await page.waitForTimeout(335_000);
  // Taken before the navigation, which is redirected away to IDAM.
  const appOrigin = new URL(page.url()).origin;
  await page.goto("/deed-polls");

  await expectSignedOutThroughIdam(page, appOrigin, 30_000);
  await context.close();
});
