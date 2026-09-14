/**
 * The deed-poll journeys, end to end in a browser.
 *
 * A handful of tests, not twelve: accessibility, validation and the Welsh shape are checked at the points
 * the journey already passes through, per `.claude/rules/e2e-testing.md`. Each test creates its own case,
 * so they are independent under `fullyParallel`.
 *
 * **Where a rule differs by role, the test name says which role it signs in as.** The notes and witnesses
 * journeys run as `admin@example.com`, the only fixture holding `caseworker-deedpoll-admin`, and say so —
 * deleting either is an administrator's to do. The last two tests run as the roleless fixture, because a
 * rule that hides a control has no negative case without one. Adding and amending a witness is open to both
 * roles, and only the delete halves of those journeys need the split.
 *
 * These journeys need a signed-in user — `requireAuth` is global — which the `setup` project provides.
 * See ./idam-session.ts for why the session is obtained from the real local IDAM rather than fabricated.
 */
import { AxeBuilder } from "@axe-core/playwright";
import { type Browser, expect, type Locator, type Page, test } from "@playwright/test";
import {
  ADMIN_EMAIL,
  ADMIN_STORAGE_STATE,
  CASEWORKER_STORAGE_STATE,
  DEPLOYED_STACK_SKIP_REASON,
  RUNS_AGAINST_DEPLOYED_STACK,
  signInAsAdmin
} from "./idam-session.js";

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
  // The signed-in caseworker, not the service account. The new-case page hardcoded `userName: undefined`
  // until Phase 5 made identity real, and nothing but a real login could have caught it — the author is
  // api's now, derived from the token the page forwards, so a page that stopped forwarding it fails here.
  //
  // The subject rather than "An Admin" because the mock has no IDAM to resolve the display name from: it
  // stamps the token's `sub`, which `rse-idam-simulator` sets to the email. Against api this reads "An
  // Admin". See `auditName` in the mock.
  await expect(caseHeader(page)).toContainText(ADMIN_EMAIL);
  await expectNoAccessibilityViolations(page);

  await expectWelshKeysResolve(browser, caseUrl);

  // Two witnesses before any signature date, because api refuses a write that leaves a case carrying an
  // enrolment date with fewer than two — `DeedPollService.requireWitnessesForEnrolment`, and Signature
  // Received is one of the two dates that puts a case there. Arrangement for the save below, not the
  // subject: the refusal and the way out of it are the enrolment-gate journey further down.
  await addWitness(page, caseUrl, "Ada Lovelace");
  await addWitness(page, caseUrl, "Grace Hopper");

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
//
// **Administrator, not caseworker** — this file signs in as `admin@example.com` throughout, and once api
// gates deletion to Administrators (`../../deed-poll-api/docs/plans/gate-note-deletion.md`) the old name
// asserted a caseworker can do what a caseworker cannot. It kept passing either way, so the name was the
// only thing that would have carried the false claim. The caseworker's half of the rule is the test below.
test("administrator adds, amends and deletes a note", async ({ page }) => {
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
 * The witnesses journey — add, then amend, then delete.
 *
 * **Administrator, and the name says so**, because the last step is one only an Administrator is offered:
 * api gates `DELETE .../witnesses/{witnessId}` on `caseworker-deedpoll-admin` in its domain. Adding and
 * amending are open to both roles — "Add and edit witnesses" is ✓ for both in the business capability
 * matrix — so the caseworker's half of the rule is the second test in the `describe` below, exactly as the
 * note delete needs both halves.
 *
 * No Welsh check: the detail page's labels and both witness forms are inline English, as every label on
 * that page is. That gap is page-wide and pre-existing, not this journey's — see the open questions in
 * `docs/plans/05-witness-create-and-edit.md`.
 */
test("administrator adds a witness, amends it, and deletes it", async ({ page }) => {
  // Arrange: a case to hang a witness off. Driven, not asserted — the create journey is the first test.
  await page.goto("/deed-polls/new");
  await fillNewCaseForm(page, { forename: "Rae", surname: "Okonjo" });
  await page.getByRole("button", { name: "Create case" }).click();
  await expect(page).toHaveURL(CASE_URL);
  const caseUrl = page.url();
  const witnesses = page.locator("#witnesses");

  // The empty tab is the whole reason the Add button sits outside the `case.witnesses.length` check: a case
  // with no witnesses is exactly when one is needed, and before this journey existed the tab rendered
  // "None recorded." with no way out of it at all.
  await page.getByRole("tab", { name: "Witnesses" }).click();
  await expect(witnesses).toContainText("None recorded.");
  await page.getByRole("button", { name: "Add a witness" }).click();
  await expect(page).toHaveURL(`${caseUrl}/witnesses/new`);

  // Declarant left alone, which is the failure a checkbox could not have produced: an unchecked box posts
  // nothing and would have recorded "ordinary witness" silently. Two radios make the unanswered question
  // visible, so it has to be asserted here that it *is* refused rather than defaulted.
  await page.getByLabel("Name").fill("Ada Lovelace");
  await page.getByLabel("Address").fill("1 High Street, London");
  await page.getByLabel("Occupation").fill("Mathematician");
  await page.getByRole("button", { name: "Add witness" }).click();
  await expect(page.getByRole("alert")).toContainText("Select yes if this person is the declarant");
  await expect(page.getByLabel("Name")).toHaveValue("Ada Lovelace");
  await expectNoAccessibilityViolations(page);

  // Over the address limit: 250 characters is the longest thing this form asks for, so it is the field
  // where re-rendering rather than redirecting matters most. The message names the cap read off the schema.
  const tooLong = "x".repeat(251);
  await page.getByLabel("Address").fill(tooLong);
  await page.getByLabel("Yes").check();
  await page.getByRole("button", { name: "Add witness" }).click();
  await expect(page.getByRole("alert")).toContainText("Address must be 250 characters or fewer");
  await expect(page.getByLabel("Address")).toHaveValue(tooLong);
  // The radio survives the re-render too — a witness whose declarant answer was silently forgotten on the
  // way back would be answered again from scratch, and the second answer can differ from the first.
  await expect(page.getByLabel("Yes")).toBeChecked();

  await page.getByLabel("Address").fill("1 High Street, London");
  await page.getByRole("button", { name: "Add witness" }).click();

  await expect(page).toHaveURL(`${caseUrl}#witnesses`);
  await expect(witnesses).toContainText("Ada Lovelace");
  await expect(witnesses).toContainText("1 High Street, London");
  await expect(witnesses).toContainText("Mathematician");
  // The tag, which only renders for a declarant — so it is `toHaveCount(0)` after the amend below that
  // proves it is driven by the stored answer and not by a witness merely existing.
  await expect(witnesses.locator(".govuk-tag")).toHaveText("Declarant");
  await expect(declarantRow(witnesses)).toContainText("Yes");
  await expectNoAccessibilityViolations(page);

  // The name is the row's handle and carries the link, with the hint as visually hidden text so the link
  // reads meaningfully out of context. A nameless witness falls back to a placeholder, which the page tests
  // cover — this journey has a name.
  await page.getByRole("link", { name: /amend this witness/ }).click();
  await expect(page).toHaveURL(/\/witnesses\/[0-9a-f-]{36}\/edit$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Amend witness");
  await expect(page.getByLabel("Occupation")).toHaveValue("Mathematician");
  await expect(page.getByLabel("Yes")).toBeChecked();
  // Offered here because this session holds the admin role. The roleless half is the test below.
  await expect(page.getByRole("button", { name: "Delete witness" })).toBeVisible();
  await expectNoAccessibilityViolations(page);

  await page.getByLabel("Occupation").fill("Countess");
  await page.getByLabel("No").check();
  await page.getByRole("button", { name: "Save witness" }).click();

  await expect(page).toHaveURL(`${caseUrl}#witnesses`);
  await expect(witnesses).toContainText("Countess");
  await expect(witnesses).not.toContainText("Mathematician");
  // Declarant is a row as well as a tag precisely so this reads "No" rather than saying nothing: the tag's
  // absence alone could not distinguish an answer of no from an answer nobody gave.
  await expect(witnesses.locator(".govuk-tag")).toHaveCount(0);
  await expect(declarantRow(witnesses)).toContainText("No");

  // Delete, which is a second submit on the amend form rather than its own page — no confirmation
  // interstitial, so the redirect back to the tab is the whole of it. api removes the row, so the tab is
  // back to the empty state it started in: this is the case's only witness and there is no minimum.
  await page.getByRole("link", { name: /amend this witness/ }).click();
  await page.getByRole("button", { name: "Delete witness" }).click();

  await expect(page).toHaveURL(`${caseUrl}#witnesses`);
  await expect(witnesses).toContainText("None recorded.");
  await expect(witnesses).not.toContainText("Ada Lovelace");
});

/**
 * The two-witness gate on enrolment, from the caseworker's side — `docs/plans/07-witness-count-feedback.md`.
 *
 * The one journey that proves the proactive and the reactive halves are the same story: the count on the
 * subgrid, the banner on the enrolment tab, api's refusal when the date is saved anyway, and the same date
 * saving once the second witness is recorded. Neither half is worth much alone — a banner nothing enforces
 * is a suggestion, and a refusal with no count is a puzzle.
 *
 * Either role, so this file's administrator serves: the rule applies to every caseworker, and nothing here
 * deletes anything.
 */
test("caseworker is told a case is short of witnesses, and can enrol it once it is not", async ({ page }) => {
  // Arrange: a case with one witness — short by one. Driven, not asserted; the journeys above cover both.
  await page.goto("/deed-polls/new");
  await fillNewCaseForm(page, { forename: "Nia", surname: "Hughes" });
  await page.getByRole("button", { name: "Create case" }).click();
  await expect(page).toHaveURL(CASE_URL);
  const caseUrl = page.url();
  await addWitness(page, caseUrl, "Ada Lovelace");

  // The count on the subgrid, which answers "is this case complete?" while the caseworker is looking at
  // witnesses — and states the threshold rather than making them work it out.
  await page.getByRole("tab", { name: "Witnesses" }).click();
  await expect(page.locator("#witnesses")).toContainText("1 of 2 witnesses recorded");

  // The banner on the enrolment tab, before anything has been typed: the shortfall is the case's condition
  // on arrival, not something discovered at save time.
  await page.goto(`${caseUrl}/edit/enrolment`);
  const banner = page.getByRole("region", { name: "Important" });
  await expect(banner).toContainText("1 of 2 witnesses recorded");
  await expect(banner).toContainText("Add 1 more witness.");
  await expectNoAccessibilityViolations(page);

  // Saved anyway, because the banner explains and api enforces — a UI that refused to submit would diverge
  // the moment api's rule changed. The message is api's own, rendered against the date it names.
  await fillDate(page.getByRole("group", { name: "Date enroled" }), { day: "1", month: "4", year: "2026" });
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert")).toContainText("A Deed Poll cannot be sent for enrolment until two witnesses have been recorded.");
  await expect(page.getByRole("alert")).toContainText("This case has one; please add one more witness.");
  // The link resolves to the date input rather than dangling, which is the half that breaks silently.
  await expect(page.getByRole("alert").getByRole("link")).toHaveAttribute("href", "#dateEnroled");
  await expectNoAccessibilityViolations(page);

  // The way out, taken from the banner rather than by knowing the URL.
  await banner.getByRole("link", { name: "View the witnesses on this case" }).click();
  await expect(page).toHaveURL(`${caseUrl}#witnesses`);
  await addWitness(page, caseUrl, "Grace Hopper");
  await expect(page.locator("#witnesses")).toContainText("2 of 2 witnesses recorded");

  // Nothing left to say, so nothing is said — and the same date now saves.
  await page.goto(`${caseUrl}/edit/enrolment`);
  await expect(page.getByRole("region", { name: "Important" })).toHaveCount(0);
  await fillDate(page.getByRole("group", { name: "Date enroled" }), { day: "1", month: "4", year: "2026" });
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL(`${caseUrl}#enrolment`);
  await expect(caseHeader(page)).toContainText("Enroled");
});

/**
 * Its own session, so `storageState` can be the roleless fixture rather than this file's administrator.
 * A `describe` is the only place Playwright honours a second `test.use` in one file.
 */
test.describe("without the admin role", () => {
  test.use({ storageState: CASEWORKER_STORAGE_STATE });

  // The other half of `canDeleteNote`. Amending is deliberately still a caseworker's to do, so the
  // presence of **Save note** matters as much as the absence of **Delete note** — it is what stops a
  // later change gating the whole form, which is the tidy-minded mistake the rule invites.
  test("caseworker may amend a note but is not offered the delete button", async ({ page }) => {
    // Arrange: a case and a note of its own, both of which a caseworker may create. Driven, not asserted
    // — the journey through these pages is the administrator test above.
    await page.goto("/deed-polls/new");
    await fillNewCaseForm(page, { forename: "Alex", surname: "Morgan" });
    await page.getByRole("button", { name: "Create case" }).click();
    await expect(page).toHaveURL(CASE_URL);
    const caseUrl = page.url();

    await page.goto(`${caseUrl}/notes/new`);
    await page.getByLabel("Note").fill("Applicant asked when the Gazette entry appears.");
    await page.getByRole("button", { name: "Add note" }).click();
    await expect(page).toHaveURL(`${caseUrl}#notes`);

    await page.getByRole("link", { name: /amend this note/ }).click();
    await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}\/edit$/);

    // Absent from the markup rather than merely invisible: the template omits the button, and a
    // `not.toBeVisible()` would also pass against one hidden with CSS, which is not what was asked for.
    await expect(page.getByRole("button", { name: "Delete note" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save note" })).toBeVisible();
    await expect(page.getByLabel("Note")).toHaveValue("Applicant asked when the Gazette entry appears.");
    await expectNoAccessibilityViolations(page);
  });

  // The other half of `canDeleteWitness`, and the same shape as the note test above: adding and amending a
  // witness are ✓ for both roles in the capability matrix, so **Save witness** being there matters as much
  // as **Delete witness** not being — it is what stops a later change gating the whole form.
  test("caseworker may amend a witness but is not offered the delete button", async ({ page }) => {
    // Arrange: a case and a witness of its own, both of which a caseworker may create. Driven, not asserted
    // — the journey through these pages is the administrator test above.
    await page.goto("/deed-polls/new");
    await fillNewCaseForm(page, { forename: "Jo", surname: "Ferreira" });
    await page.getByRole("button", { name: "Create case" }).click();
    await expect(page).toHaveURL(CASE_URL);
    const caseUrl = page.url();

    await page.goto(`${caseUrl}/witnesses/new`);
    await page.getByLabel("Name").fill("Grace Hopper");
    await page.getByLabel("Address").fill("2 Low Street, London");
    await page.getByLabel("Occupation").fill("Engineer");
    await page.getByLabel("No").check();
    await page.getByRole("button", { name: "Add witness" }).click();
    await expect(page).toHaveURL(`${caseUrl}#witnesses`);

    await page.getByRole("link", { name: /amend this witness/ }).click();
    await expect(page).toHaveURL(/\/witnesses\/[0-9a-f-]{36}\/edit$/);

    // Absent from the markup rather than merely invisible: the template omits the button, and a
    // `not.toBeVisible()` would also pass against one hidden with CSS, which is not what was asked for.
    await expect(page.getByRole("button", { name: "Delete witness" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save witness" })).toBeVisible();
    await expect(page.getByLabel("Occupation")).toHaveValue("Engineer");
    await expectNoAccessibilityViolations(page);
  });
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
 * A witness recorded through its own form, driven rather than asserted.
 *
 * The witness journey above is what checks this form; here it is arrangement, because api's enrolment gate
 * counts witnesses and several journeys need a case that satisfies it.
 */
async function addWitness(page: Page, caseUrl: string, name: string): Promise<void> {
  await page.goto(`${caseUrl}/witnesses/new`);
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Address").fill("1 High Street, London");
  await page.getByLabel("Occupation").fill("Mathematician");
  await page.getByLabel("No").check();
  await page.getByRole("button", { name: "Add witness" }).click();
  await expect(page).toHaveURL(`${caseUrl}#witnesses`);
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
 * A witness's Declarant row, addressed by the row rather than by the value: "Yes" and "No" appear all over
 * a case page, so an unscoped text match would pass against any of them. Located by class because a
 * `govukSummaryList` row has no accessible name to address it by — the same reason `caseHeader` does.
 */
function declarantRow(witnesses: Locator): Locator {
  return witnesses.locator(".govuk-summary-list__row", { hasText: "Declarant" });
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
