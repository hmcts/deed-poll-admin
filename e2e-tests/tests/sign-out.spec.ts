import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { DEPLOYED_STACK_SKIP_REASON, RUNS_AGAINST_DEPLOYED_STACK, signInAsCaseworker } from "./idam-session.js";

test.skip(RUNS_AGAINST_DEPLOYED_STACK, DEPLOYED_STACK_SKIP_REASON);

test("a caseworker can find sign-out and cannot reopen a protected page afterwards", async ({ page }) => {
  // A private login: signing out a saved fixture would destroy every parallel test's shared session.
  await signInAsCaseworker(page);

  // The case list uses the full-width layout; the new-case form uses the standard layout.
  await expect(page.getByRole("link", { name: "Sign out", exact: true })).toBeVisible();
  await page.goto("/deed-polls/new?lng=cy");
  await expect(page.getByRole("link", { name: "Allgofnodi", exact: true })).toBeVisible();
  await page.goto("/deed-polls?lng=cy");
  await expect(page.getByRole("link", { name: "Allgofnodi", exact: true })).toBeVisible();
  await page.goto("/deed-polls?lng=en");

  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(accessibility.violations).toEqual([]);

  const signOut = page.getByRole("link", { name: "Sign out", exact: true });
  const serviceRoot = new URL("/", page.url()).href;
  await signOut.focus();
  await expect(signOut).toBeFocused();
  await signOut.press("Enter");

  // The simulator advertises endSession but has no handler for it. Verify the outbound redirect,
  // then return explicitly; this proves service logout, not real IDAM's single-sign-out behaviour.
  await expect(page).toHaveURL((url) => url.pathname === "/o/endSession" && url.searchParams.get("post_logout_redirect_uri") === serviceRoot);
  await page.goto(serviceRoot);
  await expect(page.locator("#username")).toBeVisible();
  const protectedPage = await page.request.get("/deed-polls", { maxRedirects: 0 });
  expect(protectedPage.status()).toBe(302);
  expect(protectedPage.headers().location).toBe("/login?returnTo=%2Fdeed-polls");
  await page.goto("/deed-polls");
  await expect(page.locator("#username")).toBeVisible();
});

test("the signed-out page offers sign-in only as a link, in English and Welsh", async ({ browser }) => {
  // Reached only when IDAM's end-session page is unavailable, which the simulator never is, so open it directly.
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();

  await page.goto("/signed-out");

  await expect(page).toHaveURL(/\/signed-out$/);
  await expect(page.getByRole("heading", { name: "You have signed out" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in again" })).toHaveAttribute("href", "/login");
  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(accessibility.violations).toEqual([]);
  await page.goto("/signed-out?lng=cy");
  await expect(page.getByRole("link", { name: "Mewngofnodi eto" })).toHaveAttribute("href", "/login");
  await context.close();
});
