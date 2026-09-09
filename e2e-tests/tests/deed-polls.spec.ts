/**
 * The two deed-poll caseworker journeys, end to end in a browser.
 *
 * Two tests, not twelve: accessibility, validation and the Welsh shape are checked at the points the
 * journey already passes through, per `.claude/rules/e2e-testing.md`. Each test creates its own case,
 * so they are independent under `fullyParallel`.
 *
 * These journeys need a signed-in caseworker — `requireAuth` is global — which the `setup` project
 * provides. See ./idam-session.ts for why the session is obtained from the real local IDAM rather
 * than fabricated.
 */
import { AxeBuilder } from "@axe-core/playwright";
import { type Browser, expect, type Locator, type Page, test } from "@playwright/test";
import { ADMIN_STORAGE_STATE, DEPLOYED_STACK_SKIP_REASON, RUNS_AGAINST_DEPLOYED_STACK, signInAsAdmin } from "./idam-session.js";

/** The reference number's year comes from Date Received, so a fixed date keeps the shape assertable. */
const DATE_RECEIVED = { day: "10", month: "3", year: "2026" };

const CASE_URL = /\/deed-polls\/[0-9a-f-]{36}$/;

test.skip(RUNS_AGAINST_DEPLOYED_STACK, DEPLOYED_STACK_SKIP_REASON);
test.use({ storageState: ADMIN_STORAGE_STATE });

test("caseworker creates a case and edits one of its tabs", async ({ page, browser }) => {
  await page.goto("/deed-polls");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Deed poll cases");
  await expectNoAccessibilityViolations(page);

  await page.getByRole("button", { name: "New case" }).click();
  await expect(page).toHaveURL("/deed-polls/new");

  // A create with no Date Received is the most obvious request anyone makes of this form, and it was
  // a 500 from the API until Phase 3 slice 1 — the reference number's year is derived from it, and
  // the refusal reached the error middleware as a bare Error. Checked here so the page keeps
  // rendering it as a field error attributed to the input rather than as a fault.
  await page.getByRole("button", { name: "Create case" }).click();
  await expect(page.getByRole("alert")).toContainText("There is a problem");
  await expect(page.getByRole("link", { name: "Enter the date the application was received" })).toBeVisible();
  await expectNoAccessibilityViolations(page);

  await fillNewCaseForm(page, { forename: "Jo", surname: "Bloggs" });
  await page.getByRole("button", { name: "Create case" }).click();

  await expect(page).toHaveURL(CASE_URL);
  const caseUrl = page.url();

  // The reference is the page's heading because it is what a caseworker quotes. KBDP for every type
  // but Deed of Relinquishment, then the year taken from Date Received and a five-digit serial.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^\s*KBDP2026-\d{5}\s*$/);
  // No date beyond Date Received, so the derived state is the default. Both this and the author come
  // from the header rather than the Application tab — see caseHeader().
  await expect(caseHeader(page)).toContainText("Received");
  // The IDAM name, not the service account. The new-case page hardcoded `userName: undefined` until
  // Phase 5 made identity real, and nothing but a real login could have caught it.
  await expect(caseHeader(page)).toContainText("An Admin");
  await expectNoAccessibilityViolations(page);

  await expectWelshKeysResolve(browser, caseUrl);

  await page.getByRole("tab", { name: "Signature" }).click();
  // "Change" plus the card's title as visually hidden text, so the link is meaningful out of context.
  await page.getByRole("link", { name: "Change Signature" }).click();
  await expect(page).toHaveURL(`${caseUrl}/edit/signature`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Signature");

  // A received date before the requested one. Not a port — the source accepts it — and it is the pair
  // that catches a mistyped year, so it is worth pinning that the form renders it against the field.
  await fillDate(signatureRequested(page), { day: "20", month: "3", year: "2026" });
  await fillDate(signatureReceived(page), { day: "1", month: "3", year: "2026" });
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert")).toContainText("Signature received date cannot be before the signature requested date.");
  // Still on the form with the submitted values, not a redirect that would discard them.
  await expect(signatureReceived(page).getByLabel("Day")).toHaveValue("1");
  await expectNoAccessibilityViolations(page);

  await fillDate(signatureReceived(page), { day: "25", month: "3", year: "2026" });
  await page.getByRole("button", { name: "Save" }).click();

  // Back to the read-only page, anchored at the tab just saved.
  await expect(page).toHaveURL(`${caseUrl}#signature`);
  // The state is derived from which dates are populated, never supplied — so this is the assertion
  // that the save reached the database and the cascade ran over it. Awaiting *Enrolment* rather than
  // Awaiting Signature because both dates are now set and the cascade tests received before
  // requested: that ordering is the source workflow's, preserved deliberately, so it is worth pinning
  // where a caseworker would see it.
  await expect(caseHeader(page)).toContainText("Awaiting Enrolment");
  await expect(page.locator("#signature")).toContainText("25 March 2026");
});

// `deed-poll-api` holds the notes now instead of Postgres; the journey is otherwise the one the
// prototype had, deletion included.
test("caseworker adds, amends and deletes a note", async ({ page }) => {
  // Arrange: a case to hang notes off. The create journey is asserted in the test above; here it is
  // only setup, so it is driven and not checked.
  await page.goto("/deed-polls/new");
  await fillNewCaseForm(page, { forename: "Sam", surname: "Taylor" });
  await page.getByRole("button", { name: "Create case" }).click();
  await expect(page).toHaveURL(CASE_URL);
  const caseUrl = page.url();

  await page.getByRole("tab", { name: "Notes" }).click();
  await expect(page.locator("#notes")).toContainText("None recorded.");
  await page.getByRole("button", { name: "Add a note" }).click();
  await expect(page).toHaveURL(`${caseUrl}/notes/new`);

  // The empty-note refusal, checked on the page rather than only in the schema's unit tests: both go
  // through `createNoteSchema`, which trims first, so a note of spaces is not a note.
  await page.getByLabel("Note").fill("   ");
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(page.getByRole("alert")).toContainText("Enter a note");
  await expectNoAccessibilityViolations(page);

  // Over the limit is the failure most likely to be hit, and the one where the caseworker has typed
  // the most — so the form must re-render with the text rather than redirect and discard it. The
  // prototype redirected to `?error=`; this asserts it no longer does.
  const tooLong = "x".repeat(2001);
  await page.getByLabel("Note").fill(tooLong);
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(page.getByRole("alert")).toContainText("Note must be 2000 characters or less");
  await expect(page.getByLabel("Note")).toHaveValue(tooLong);

  await page.getByLabel("Note").fill("Applicant called to chase the enrolment date.");
  await page.getByRole("button", { name: "Add note" }).click();

  await expect(page).toHaveURL(`${caseUrl}#notes`);
  await expect(page.locator("#notes")).toContainText("1 note");
  await expect(page.locator("#notes")).toContainText("Applicant called to chase the enrolment date.");
  // Never edited, so the Modified column says so rather than repeating the created pair.
  await expect(page.locator("#notes")).toContainText("Not edited");
  await expectNoAccessibilityViolations(page);

  // The note's short code is the row's handle, and the link carries the full uuid. The code is the
  // leading eight hex digits of that uuid in two groups of four, and is display-only — asserted here
  // so it cannot quietly become the thing that resolves a note.
  await page.getByRole("link", { name: /amend this note/ }).click();
  await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}\/edit$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^[0-9A-F]{4}-[0-9A-F]{4}$/);

  await page.getByLabel("Note").fill("Applicant called to chase the enrolment date. Advised of the Gazette step.");
  await page.getByRole("button", { name: "Save note" }).click();

  await expect(page).toHaveURL(`${caseUrl}#notes`);
  await expect(page.locator("#notes")).toContainText("Advised of the Gazette step.");
  await expect(page.locator("#notes")).not.toContainText("Not edited");

  // Delete, which is a second submit on the amend form rather than its own page — no confirmation
  // interstitial, so the redirect back to the tab is the whole of it. Asserted through the UI because
  // the button and the handler's `action` branch are only correct together.
  await page.getByRole("link", { name: /amend this note/ }).click();
  await page.getByRole("button", { name: "Delete note" }).click();

  await expect(page).toHaveURL(`${caseUrl}#notes`);
  await expect(page.locator("#notes")).toContainText("None recorded.");
  await expect(page.locator("#notes")).not.toContainText("Advised of the Gazette step.");
});

/**
 * The four fields the new-case form offers. Type and the two names are free; Date Received is fixed,
 * because the reference number's year is taken from it.
 */
async function fillNewCaseForm(page: Page, name: { forename: string; surname: string }): Promise<void> {
  await page.getByLabel("Application type").selectOption({ label: "Adult" });
  await page.getByLabel("New forename").fill(name.forename);
  await page.getByLabel("New surname").fill(name.surname);
  await fillDate(page.getByRole("group", { name: "Date received" }), DATE_RECEIVED);
}

/**
 * The Welsh *shape*, not Welsh content: every page carries `en` and `cy` with matching keys, but `cy`
 * deliberately holds English until there is a translation to put in it. What this catches is a missing
 * `cy` key, which renders blank rather than erroring.
 *
 * **In a context and session of its own, which is the whole point of the function.** `localeMiddleware`
 * persists the chosen language to `req.session.locale`, so requesting `?lng=cy` is a *write* to the
 * session — and the session behind `ADMIN_STORAGE_STATE` is shared with every other test that restores
 * it. Done on the shared session, this line switched another spec into Welsh mid-run and its English
 * locators stopped matching. The symptom was a 30-second timeout waiting for a button whose name had
 * changed, in a different file, which reads as anything but a language leak.
 *
 * So: any authenticated check that writes to the session needs its own session, exactly as
 * `idam-session.ts` says. One extra login is cheaper than an interference bug.
 *
 * **`storageState: undefined` is load-bearing, and its absence made all of the above untrue.**
 * `browser.newContext()` inherits this file's `test.use({ storageState })` — verified by inspecting a
 * context created without it, which arrives holding four cookies (`connect.sid`, `locale`,
 * `Idam.Session`, `idam_ui_locales`). So the "own session" was the shared one: this check was writing
 * `locale` to the very session it was written to stop writing to, and `signInAsAdmin` then hung
 * forever because `/login` redirects an already-authenticated browser to `/deed-polls`, so the
 * simulator's `#username` never renders. The symptom was a bare test timeout with no failed
 * assertion, which reads as a slow app rather than a context that was never anonymous.
 */
async function expectWelshKeysResolve(browser: Browser, caseUrl: string): Promise<void> {
  const context = await browser.newContext({ storageState: undefined });

  try {
    const page = await context.newPage();
    await signInAsAdmin(page);
    await page.goto(`${caseUrl}?lng=cy`);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^\s*KBDP2026-\d{5}\s*$/);
    await expect(page.getByRole("link", { name: "Back to cases" })).toBeVisible();
  } finally {
    await context.close();
  }
}

function signatureRequested(page: Page): Locator {
  return page.getByRole("group", { name: "Signature requested date" });
}

function signatureReceived(page: Page): Locator {
  return page.getByRole("group", { name: "Signature received date" });
}

/** A `govukDateInput`'s three boxes, scoped to its fieldset so Day/Month/Year stay unambiguous. */
async function fillDate(group: Locator, date: { day: string; month: string; year: string }): Promise<void> {
  await group.getByLabel("Day").fill(date.day);
  await group.getByLabel("Month").fill(date.month);
  await group.getByLabel("Year").fill(date.year);
}

/**
 * The case header above the tabs — the summary list `case-header.ts` builds.
 *
 * Scoped, and by position rather than by role: Type and State also appear as rows inside the
 * Application tab, so an unscoped text match finds two, and the header has no accessible name to
 * address it by. It is the first summary list on the page because it renders before the tabs.
 */
function caseHeader(page: Page): Locator {
  return page.locator(".govuk-summary-list").first();
}

/**
 * Checked inline at each point of a journey rather than in a test of its own, per
 * `.claude/rules/e2e-testing.md`.
 *
 * **No exclusions, deliberately.** The template's own specs excluded `.govuk-footer__link` and
 * `.language` as known issues, and both are in the shared layout these pages also render — but every
 * deed-poll page passes without them, so adding them here would suppress findings that do not exist and
 * hide any that appear later. Reinstate one only with evidence.
 *
 * Reported as `id: selector` strings rather than raw violation objects so a failure names the rule and
 * the element instead of printing an unreadable object graph.
 */
async function expectNoAccessibilityViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();

  expect(results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target).join(", ")}`)).toEqual([]);
}
