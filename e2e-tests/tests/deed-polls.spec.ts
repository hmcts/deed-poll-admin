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
import { type APIRequestContext, type Browser, expect, type Locator, type Page, test } from "@playwright/test";
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

/**
 * The mock api itself, which `playwright.config.ts` starts on 3200 beside the app on 3000.
 *
 * Addressed directly only for seeding, and only by the query journey: `POST /__mock/cases` is outside the
 * contract and skips the refusals a real create applies, which is what makes 29 cases cheap. Every other
 * test drives the forms, because what a create does is the thing being tested there.
 */
const MOCK_API_URL = process.env.DEED_POLL_API_URL ?? "http://localhost:3200";

/** How many Adult cases the query journey seeds: one more than a page of 25, so there is a second page. */
const ADULT_CASES_TO_QUERY = 26;

/** And the Minor ones, which share the forename and are what the second condition has to exclude. */
const MINOR_CASES_TO_QUERY = 3;

/**
 * The judge a claim and a direction are attributed to in the returned-for-action seed.
 *
 * Not a signed-in session: there is no judicial UI yet (admin-3), so the two transitions that put a referral
 * in `Decided` are driven through the routes api publishes, as `scripts/seed-local-cases.mjs` drives them. The
 * mock reads a subject out of the bearer token and models no roles, so a hand-built token is all a claim needs.
 */
const SEED_JUDGE = "e2e.judge@example.com";

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
 * Referring a case to the judiciary, and taking it back — `docs/plans/referrals-admin-1-caseworker-referrals-tab.md`.
 *
 * One journey covering the four api-1 operations the caseworker UI offers, because they are one story: a
 * referral is raised, the tab lists it, the case will not take a second while it is live, and withdrawing it
 * puts the case back where it started.
 *
 * **The conditional reveals are why this journey earns its keep.** Everything else here is asserted in the
 * page and template tests; what only a browser shows is that ticking Other actually reveals the notes field
 * and choosing Standard actually hides the reason for urgency — and, with the reveal doing the hiding rather
 * than the server, that a value left inside a closed one is not stored against the referral.
 *
 * Either role, so this file's administrator serves: api gates neither raising nor withdrawing on the admin
 * role, and nothing here is deleted.
 */
test("caseworker refers a case to the judiciary, is refused a second referral, and withdraws the first", async ({ page }) => {
  /**
   * The one waived axe finding in this file, and it is govuk-frontend's rather than this page's.
   *
   * `radios.mjs` promotes `data-aria-controls` to `aria-controls` and then sets `aria-expanded` on the radio
   * itself (`syncConditionalRevealWithInputState`, govuk-frontend 6.5.0). ARIA 1.2 does not list
   * `aria-expanded` as supported on `role="radio"` — it does on `role="checkbox"`, which is why the
   * Other → notes reveal on the same form passes and only the urgency radio is reported. Nothing in this
   * repo's markup produces it and nothing here can suppress it without dropping the conditional reveal the
   * plan chose, so it is waived by rule *and* element: `aria-allowed-attr` anywhere else on this page, or on
   * the other radio, still fails the journey.
   */
  const UPSTREAM_RADIO_REVEAL = ["aria-allowed-attr: #urgency-2"];

  // Arrange: a case with nothing else on it. Driven, not asserted — the create journey is the first test.
  await page.goto("/deed-polls/new");
  await fillNewCaseForm(page, { forename: "Ines", surname: "Kowalski" });
  await page.getByRole("button", { name: "Create case" }).click();
  await expect(page).toHaveURL(CASE_URL);
  const caseUrl = page.url();
  const referrals = page.locator("#referrals");

  // "Referrals" and not "Referral": the tab beside it holds the case's own Refer-to-Master fields, so the
  // exact name is load-bearing rather than tidiness.
  await page.getByRole("tab", { name: "Referrals", exact: true }).click();
  await expect(referrals).toContainText("None recorded.");
  await page.getByRole("button", { name: "Refer this case to the judiciary" }).click();
  await expect(page).toHaveURL(`${caseUrl}/referrals/new`);

  // Nothing chosen: two questions, two messages, both linked from the summary. The unanswered urgency is the
  // one worth pinning — the schema requires it where api leaves it optional, so a form that silently sent
  // nothing would be accepted by api and recorded as a referral nobody said was ordinary.
  await page.getByRole("button", { name: "Raise referral" }).click();
  await expect(page.getByRole("alert")).toContainText("There is a problem");
  await expect(page.getByRole("link", { name: "Select at least one reason for referring this case" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Select how urgent this referral is" })).toBeVisible();
  await expectNoAccessibilityViolations(page, UPSTREAM_RADIO_REVEAL);

  // The reveals, which is what a browser is here for. Both are hidden until their trigger is chosen, so the
  // conditional requirement below is one a caseworker can see the reason for.
  await expect(page.getByLabel("Give the other reason")).toBeHidden();
  await expect(page.getByLabel("Why is this referral urgent?")).toBeHidden();
  await page.getByLabel("Other", { exact: true }).check();
  await page.getByLabel("Urgent", { exact: true }).check();
  await expect(page.getByLabel("Give the other reason")).toBeVisible();
  await expect(page.getByLabel("Why is this referral urgent?")).toBeVisible();

  // Revealed and left empty: api requires both for these answers and so does the form, one round trip earlier.
  await page.getByRole("button", { name: "Raise referral" }).click();
  await expect(page.getByRole("link", { name: "Enter the other reason for referring this case" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Enter why this referral is urgent" })).toBeVisible();
  // The reveal holding the error is open when the page comes back, because the re-render puts the choices
  // back — an error message inside a closed reveal would be a summary link to a field nobody can see.
  await expect(page.getByLabel("Give the other reason")).toBeVisible();
  await expectNoAccessibilityViolations(page, UPSTREAM_RADIO_REVEAL);

  // Typed into the urgency reveal, then Standard chosen instead. The textarea is only hidden, so the browser
  // still posts it — and it must not reach api, or the referral would read "Standard" beside a reason for
  // being urgent with no edit page to correct it.
  await page.getByLabel("Give the other reason").fill("The declarant is abroad until June.");
  await page.getByLabel("Why is this referral urgent?").fill("Hearing listed on Friday.");
  await page.getByLabel("Standard", { exact: true }).check();
  await expect(page.getByLabel("Why is this referral urgent?")).toBeHidden();
  await page.getByLabel("Applicant is a minor").check();
  await page.getByRole("button", { name: "Raise referral" }).click();

  await expect(page).toHaveURL(`${caseUrl}#referrals`);
  // The labels, not api's members — the wire values are api's and the words are this repo's.
  await expect(referrals).toContainText("Applicant is a minor");
  await expect(referrals).toContainText("Other");
  await expect(referrals).toContainText("Standard");
  await expect(referrals.locator(".govuk-tag")).toHaveText("Open");
  // The raise button is withheld while one is live, with the reason in its place rather than a button that
  // could only fail.
  await expect(page.getByRole("button", { name: "Refer this case to the judiciary" })).toHaveCount(0);
  await expect(referrals).toContainText("Withdraw the open referral before raising another.");
  await expectNoAccessibilityViolations(page);

  // The withheld button is not the rule — api's 409 is, and the form is reachable by URL. It renders as a
  // message with a link to the referral already open, not as an error page.
  await page.goto(`${caseUrl}/referrals/new`);
  await page.getByLabel("Applicant is a minor").check();
  await page.getByLabel("Standard", { exact: true }).check();
  await page.getByRole("button", { name: "Raise referral" }).click();
  await expect(page.getByRole("alert")).toContainText("This case already has an open referral.");
  await expectNoAccessibilityViolations(page, UPSTREAM_RADIO_REVEAL);

  await page.getByRole("link", { name: "View the open referral" }).click();
  await expect(page).toHaveURL(/\/referrals\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Referral to the judiciary");
  await expect(page.getByText("The declarant is abroad until June.")).toBeVisible();
  // Nothing was stored for the urgency it no longer has: the value the closed reveal still held was not an
  // answer, and this is the assertion that says so from outside the handler.
  await expect(urgencyReasonRow(page)).toContainText("Not provided");
  await expectNoAccessibilityViolations(page);

  await page.getByRole("button", { name: "Withdraw this referral" }).click();
  await expect(page).toHaveURL(`${caseUrl}#referrals`);
  await expect(referrals.locator(".govuk-tag")).toHaveText("Withdrawn");
  // The history keeps the withdrawn one — a case can be referred again, and what the judiciary has already
  // been asked is the point of the list.
  await expect(referrals).toContainText("Applicant is a minor");
  await expect(page.getByRole("button", { name: "Refer this case to the judiciary" })).toBeVisible();

  // The withdraw control is gone from a terminal referral, absent from the markup rather than disabled — the
  // same shape as the note and witness deletes above.
  await page.getByRole("link", { name: /view this referral/ }).click();
  await expect(page.getByRole("button", { name: "Withdraw this referral" })).toHaveCount(0);
  await expect(page.getByText("Withdrawn")).toBeVisible();
});

/**
 * The "returned — action needed" count and the worklist behind it —
 * `docs/plans/completed/referrals-admin-2-returned-action-needed.md`.
 *
 * **The count IS the alert**, so what a browser has to show is that it is *seen and followable*: the number is
 * on the dashboard a caseworker lands on, and clicking it arrives at exactly the cases it counted. The page
 * tests pin the sentence, the singular, the absence at zero and the href against a stubbed domain; what only
 * this can pin is that the href is a query api answers with those rows — the count and the worklist being one
 * query (decision 3) is a claim about two round trips agreeing, and a stub cannot disagree with itself.
 *
 * **The count is read as a baseline plus this journey's cases, not as an absolute.** It is global by design
 * (decision 5) and the mock's store outlives a run — `reuseExistingServer` — so `yarn mock:seed` or an earlier
 * run leaves `Decided` cases that are legitimately part of the number. Nothing else in the suite drives a
 * referral past `Claimed`, so the baseline cannot move underneath this test while it runs.
 *
 * Either role, so this file's administrator serves: the dashboard is every caseworker's and nothing here is
 * deleted.
 */
test("caseworker sees how many applications have a returned direction, and follows the count to that worklist", async ({ page, request }) => {
  // Arrange: two cases whose referral a judge has decided, and one still with the judge — the third is what
  // makes the worklist a filter rather than a list of everything referred.
  const seeded = await seedReturnedForActionCases(request);

  await page.goto("/deed-polls");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Deed poll cases");

  // A notification banner and not a bespoke tile (decision 4), above the search box rather than immediately
  // above the table: a thing whose only job is to be seen is not seen below a 40-line query builder.
  const banner = page.getByRole("region", { name: "Important" });
  await expect(banner).toContainText(`${seeded.total} applications have a returned direction needing action`);
  await expectNoAccessibilityViolations(page);

  // Decision 5, where a caseworker would notice it: the count is a fact about the service, so another tab —
  // whose own list holds none of these cases — does not narrow it.
  await page.getByRole("link", { name: "Enroled" }).click();
  await expect(banner).toContainText(`${seeded.total} applications have a returned direction needing action`);

  await banner.getByRole("link", { name: "View these applications" }).click();

  // The same condition the count was read with, and no filter, term, order or page — so the worklist is not
  // narrowed by the tab it was clicked from.
  await expect(page).toHaveURL("/deed-polls?where=currentReferralState%3Ais%3ADecided");
  // api's total for the query, which is the number the banner had: the count and the worklist are one query.
  await expect(page.getByText(new RegExp(`of ${seeded.total} applications`))).toBeVisible();

  // The rows, newest first — the mock's default order is `createdOn` descending, so this journey's two are at
  // the top of the first page however many Decided cases were already in the store.
  //
  // **A row is matched on this run's surname as well as the reference.** The store outlives the run, and a
  // reference is five digits in a shape api also allocates, so a reference on its own is unique only by
  // arithmetic — an earlier run whose clock landed on the same serial left `Decided` rows carrying it, and
  // those rows would satisfy "the seeded cases are displayed" while the new ones were missing. The surname
  // carries milliseconds, which no earlier run shares, so the pair identifies the row this journey created.
  const rows = page.locator("tbody");
  const seededRow = (reference: string) => rows.locator("tr").filter({ hasText: seeded.surname }).filter({ hasText: reference });
  for (const reference of seeded.decided) await expect(seededRow(reference)).toHaveCount(1);
  // And the one a judge is still holding is absent: `Claimed` is not the caseworker's turn.
  await expect(seededRow(seeded.claimed)).toHaveCount(0);
  await expectNoAccessibilityViolations(page);

  // The builder above the table says what the rows were filtered by, and — the part only a browser can show —
  // **submitting it keeps the filter**. `currentReferralState` is on no form tab and so is not in the chooser
  // (decision 8), which is exactly the row that used to come back blank: Apply then answered the whole
  // caseload under a banner still claiming a filtered count. See `appliedOption` in `query-builder.ts`.
  await expect(page.getByLabel("Case field for condition 1")).toHaveValue("currentReferralState");
  await expect(page.getByLabel("Value for condition 1")).toHaveValue("Decided");

  await page.getByRole("button", { name: "Apply filters" }).click();

  await expect(page).toHaveURL("/deed-polls?where=currentReferralState%3Ais%3ADecided");
  await expect(page.getByText(new RegExp(`of ${seeded.total} applications`))).toBeVisible();
  await expect(seededRow(seeded.claimed)).toHaveCount(0);
  for (const reference of seeded.decided) await expect(seededRow(reference)).toHaveCount(1);
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
 * The query builder, end to end: choosing a field, then its comparison, then its value, each through a
 * submit, because each control's options depend on the one before it.
 *
 * **Written against the round trip and driven with a browser that has scripts on**, which is deliberate on
 * both counts: the three submits are what a caseworker does with no script running, and they go on working
 * with one because the enhancement only spares them the trip. The floor itself is asserted by the
 * scripts-off journey below — this one would still pass against a builder that had quietly come to need
 * JavaScript, which is why that one exists.
 *
 * The other half is the parameter preservation, which is the bug this class of UI always has: the two
 * conditions survive a sort, and both survive a page. Asserted on the URL as well as on the rows, because a
 * link that dropped a condition still renders a plausible-looking table.
 */
test("caseworker filters the case list on two fields, sorts it and pages through it", async ({ page, request }) => {
  // Arrange: 29 cases sharing one forename, 26 of them Adult — enough for two pages of 25, so paging is a
  // real second page rather than a component rendered with nothing behind it. Seeded through the mock's
  // control route rather than driven through the new-case form, which would be 29 form journeys.
  const forename = seedForename();
  await seedCasesToQuery(request, forename);

  await page.goto("/deed-polls");

  // Condition 1, one control per round trip: the operator chooser offers a text field's comparisons only
  // once a text field has been chosen, so the field is submitted before there is an operator to pick.
  await page.getByLabel("Case field for condition 1", { exact: true }).selectOption("newForename");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await page.getByLabel("Comparison for condition 1", { exact: true }).selectOption("is");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await page.getByLabel("Value for condition 1", { exact: true }).fill(forename);
  await page.getByRole("button", { name: "Apply filters" }).click();

  // The canonical URL, which is the whole state — bookmarkable, shareable, and reachable with the back
  // button, per decision 5.
  await expect(page).toHaveURL(`/deed-polls?where=newForename%3Ais%3A${forename}`);
  await expect(page.getByText("1 to 25 of 29 applications")).toBeVisible();

  // Condition 2, and the joining is the word "and" rather than a chooser offering one option — decision 4,
  // because api ANDs the conditions and supports no OR.
  await page.getByRole("button", { name: "Add condition" }).click();
  await expect(page.locator("form p", { hasText: /^and$/ })).toBeVisible();
  await page.getByLabel("Case field for condition 2", { exact: true }).selectOption("type");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await page.getByLabel("Comparison for condition 2", { exact: true }).selectOption("is");
  await page.getByRole("button", { name: "Apply filters" }).click();
  // An enum field asks for its value with a select, not a text box — decision 3, and the reason the value
  // control is rebuilt after the operator is known.
  await page.getByLabel("Value for condition 2", { exact: true }).selectOption({ label: "Adult" });
  await page.getByRole("button", { name: "Apply filters" }).click();

  // Both conditions met, so the three Minor cases are gone. The total is api's count across every page.
  await expect(page.getByText("1 to 25 of 26 applications")).toBeVisible();
  await expectNoAccessibilityViolations(page);

  // Sorted on a column the table shows — decision 8 — and the header is a plain link, so ordering needs no
  // JavaScript either. `aria-sort` says which way it points, which the link text alone does not.
  await page.getByRole("link", { name: "Sort by Received" }).click();
  expect(conditionsOf(page)).toEqual([`newForename:is:${forename}`, "type:is:Adult"]);
  expect(new URL(page.url()).searchParams.get("sort")).toBe("dateReceived:asc");
  await expect(page.locator("th", { hasText: "Received" })).toHaveAttribute("aria-sort", "ascending");
  await expect(page.locator("tbody tr").first()).toContainText("1 January 2026");

  // Paged, and the page link carries the tab, both conditions and the order: page 2 of another order holds
  // other rows, so a pagination that dropped the sort would silently answer a different question.
  await page.getByRole("link", { name: /Next/ }).click();
  expect(conditionsOf(page)).toEqual([`newForename:is:${forename}`, "type:is:Adult"]);
  expect(new URL(page.url()).searchParams.get("sort")).toBe("dateReceived:asc");
  expect(new URL(page.url()).searchParams.get("page")).toBe("2");

  // The last row of 26, so the range is stated from api's counts rather than from the one row on screen.
  await expect(page.getByText("26 to 26 of 26 applications")).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody tr").first()).toContainText("26 January 2026");
});

/**
 * The same builder with a script running, which is the enhancement of the plan's decision 4: choosing a
 * field or a comparison swaps in the control its value is typed into, with no submit at all.
 *
 * Driven in a browser because there is nowhere else it can be — the swap is a DOM operation, and the page
 * tests can only show that the metadata it reads is on the page. Three of the assertions here are the
 * accessibility requirements rather than the feature: the change is announced through the live region, the
 * hint stays true to the control now on screen, and **focus is not moved onto what appeared** — a select
 * fires `change` as the arrow keys walk it, so stealing focus would throw a keyboard user out of a list they
 * are still reading.
 *
 * **The axe checks run on markup the script built, not on markup the server rendered.** That is the point of
 * having them here as well as in the journey above: a control assembled in the browser has no template to
 * carry its label, its `aria-describedby` or its fieldset legend, so a JS-built control is exactly where the
 * accessible name goes missing. Checked twice — once on the single value control, and once on the two
 * `govukDateInput` fieldsets of a `between`, which is the most structured thing the script builds.
 *
 * It finishes on rows rather than on the URL, because that is the regression guard the plan asks for: the
 * fault this plan fixes was reaching a value control at all, and a journey that stops at the query string
 * would still pass if the query it built matched nothing.
 */
test("caseworker builds a condition without a round trip, and is told when the value control appears", async ({ page, request }) => {
  // Arrange: two cases sharing a forename, so the condition this journey builds by hand has rows to find.
  const forename = seedForename();
  await seedCasesToFilter(request, forename);

  await page.goto("/deed-polls");

  const field = page.getByLabel("Case field for condition 1", { exact: true });
  const operator = page.getByLabel("Comparison for condition 1", { exact: true });
  const announcer = page.locator("[data-query-announcer]");

  // The comparisons are the field's kind's, so choosing a field rebuilds them: an enum admits `is one of`
  // and none of a text field's comparisons.
  await field.selectOption("type");
  await expect(operator.locator("option")).toHaveText(["Choose a comparison", "is", "is one of", "is empty", "is not empty"]);
  await expect(page.getByLabel("Value for condition 1", { exact: true })).toHaveCount(0);

  // And choosing the comparison reveals the control its value goes in — the fault the whole plan is about.
  await operator.selectOption("is");
  const value = page.getByLabel("Value for condition 1", { exact: true });
  await expect(value).toHaveAttribute("name", "value-0-0");
  await expect(value.locator("option")).toContainText(["Choose a value", "Adult"]);
  await expect(page.getByText("Enter a value to use this condition")).toBeVisible();
  await expect(announcer).toHaveText("Condition 1 now asks for a value.");
  await expect(value).not.toBeFocused();
  await expectNoAccessibilityViolations(page);

  // A comparison that takes no value takes the control away with it, and the hint asking for one with that:
  // a row that needs no value must not be left being asked for one.
  await operator.selectOption("isEmpty");
  await expect(page.getByLabel("Value for condition 1", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Enter a value to use this condition")).toHaveCount(0);
  await expect(announcer).toHaveText("Condition 1 needs no value.");

  // A set of values is a checkbox set sharing one name, which is how a set arrives in the URL.
  await operator.selectOption("isOneOf");
  await expect(page.getByRole("checkbox", { name: "Adult", exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Minor", exact: true })).toHaveAttribute("name", "value-0-0");

  // Both bounds of a between, each labelled as its own bound rather than twice as "Value".
  await field.selectOption("dateReceived");
  await operator.selectOption("between");
  await expect(page.getByRole("group", { name: "Lower value for condition 1" }).getByLabel("Day")).toBeVisible();
  await expect(page.getByRole("group", { name: "Upper value for condition 1" }).getByLabel("Year")).toBeVisible();
  await expect(announcer).toHaveText("Condition 1 now asks for two values.");
  await expectNoAccessibilityViolations(page);

  // A comparison of the same shape keeps a value already typed: `contains` and `is` both ask a text field
  // for one string, and rebuilding the box would empty it under the caseworker.
  await field.selectOption("newForename");
  await operator.selectOption("contains");
  await page.getByLabel("Value for condition 1", { exact: true }).fill(forename);
  await operator.selectOption("is");
  await expect(page.getByLabel("Value for condition 1", { exact: true })).toHaveValue(forename);

  // One submit for the whole condition, and it lands on the same canonical URL three submits would have —
  // holding the rows the finished condition matches, and no statement about a condition left out, because
  // nothing was left out.
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page).toHaveURL(`/deed-polls?where=newForename%3Ais%3A${forename}`);
  await expect(page.getByText("1 to 2 of 2 applications")).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(2);
  await expect(page.locator(".govuk-inset-text")).toHaveCount(0);
});

/**
 * Saving the query just built, and finding it again — plan 11's journey.
 *
 * What only a browser can show here is that three things are one object: the URL the builder produced, the
 * row api stores, and the entry in the filter bar. Each half is unit-tested against a stub, and a stub cannot
 * catch a `conditions` array that survives a save and comes back as something the builder cannot read.
 *
 * **The saved query is followed from somewhere else, deliberately.** The entry for the query a caseworker is
 * already looking at renders as a span carrying `aria-current`, not a link, so the journey leaves for another
 * tab and comes back through the filter bar — otherwise the link half of that branch is never exercised at
 * all, and it is the half that navigates.
 *
 * **The `Amend` link's presence is not evidence the permission rule works.** The mock sets `editable: true`
 * on everything and can produce no 403 — `libs/deed-poll-api-client/src/mock/server.ts` says so at the code —
 * so both branches of that flag are covered in the page tests instead. What is asserted here is only that the
 * control the flag gates is wired to a URL that resolves.
 */
test("caseworker saves the query they built, follows it from the filter bar, and takes it out again", async ({ page, request }) => {
  // Arrange: two cases sharing a forename, so the query being saved finds rows of its own. The query's name
  // is unique for the same reason the forename is — the mock's saved queries outlive a run and are shared
  // with every spec beside this one, so a fixed name would find the previous run's query too.
  const forename = seedForename();
  await seedCasesToFilter(request, forename);
  const queryName = `Applications from ${forename}`;

  await page.goto("/deed-polls");

  // One condition, built with a script running: three controls and a single submit. Driven rather than
  // asserted — the builder itself is the two journeys above.
  await page.getByLabel("Case field for condition 1", { exact: true }).selectOption("newForename");
  await page.getByLabel("Comparison for condition 1", { exact: true }).selectOption("is");
  await page.getByLabel("Value for condition 1", { exact: true }).fill(forename);
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page).toHaveURL(`/deed-polls?where=newForename%3Ais%3A${forename}`);

  // A link out of the list rather than a control inside the builder's form — decision 9 — and it carries the
  // query *as applied*, which is what the save page's own first sentence promises.
  await page.getByRole("link", { name: "Save this query" }).click();
  await expect(page).toHaveURL(`/deed-polls/queries/new?where=newForename%3Ais%3A${forename}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Save this query");
  await expectNoAccessibilityViolations(page);

  // A query with no name is the mistake this form invites, and the name is the only thing it requires. The
  // summary's anchor is checked because a link that resolves to nothing is the half that breaks in silence.
  await page.getByRole("button", { name: "Save query" }).click();
  await expect(page.getByRole("alert")).toContainText("Enter a name for this query");
  await expect(page.getByRole("alert").getByRole("link", { name: "Enter a name for this query" })).toHaveAttribute("href", "#name");
  await expectNoAccessibilityViolations(page);

  await page.getByLabel("Name").fill(queryName);
  await page.getByLabel("Description (optional)").fill("Everything this applicant has applied for.");
  await page.getByRole("button", { name: "Save query" }).click();

  // Back to the results just named, so the query string the form was opened with survived the round trip
  // through api's columns and out again.
  await expect(page).toHaveURL(`/deed-polls?where=newForename%3Ais%3A${forename}`);

  // The filter bar's second group, which exists only because something is in it — an empty labelled group is
  // a heading over nothing, so its presence is the assertion that the selection reached api.
  const savedQueries = savedQueryGroup(page);
  await expect(savedQueries.getByRole("heading", { level: 2 })).toHaveText("Saved queries");
  await expect(savedQueries.getByText(queryName)).toHaveAttribute("aria-current", "page");
  await expectNoAccessibilityViolations(page);

  // Away to another tab, which carries the conditions and so is not the saved query: the entry stops being
  // current and becomes the link a caseworker actually travels by.
  await page.getByRole("link", { name: "Enroled" }).click();
  await savedQueries.getByRole("link", { name: queryName }).click();

  // And the conditions are in the builder, not merely in the URL — decision 7, which is the whole reason a
  // saved query is a list URL rather than a mode: it opens ready to amend.
  await expect(page).toHaveURL(`/deed-polls?where=newForename%3Ais%3A${forename}`);
  await expect(page.getByLabel("Case field for condition 1", { exact: true })).toHaveValue("newForename");
  await expect(page.getByLabel("Comparison for condition 1", { exact: true })).toHaveValue("is");
  await expect(page.getByLabel("Value for condition 1", { exact: true })).toHaveValue(forename);
  await expect(page.getByText("1 to 2 of 2 applications")).toBeVisible();

  await page.getByRole("link", { name: "All saved queries" }).click();
  await expect(page).toHaveURL("/deed-polls/queries");

  // Scoped to its own row, because the library holds every query the mock has been asked to keep and each
  // row carries a button of the same name.
  const row = libraryRow(page, queryName);
  await expect(row.getByRole("link", { name: queryName })).toHaveAttribute("href", `/deed-polls?where=newForename%3Ais%3A${forename}`);
  await expect(row).toContainText("In your filter bar");
  // Not published, so no tag says it is: the checkbox was left alone, which is the state a query stays in
  // until somebody asks for it.
  await expect(row).not.toContainText("Published");
  // Owned by the signed-in caseworker, and the subject rather than "An Admin" for the reason the case header
  // is — the mock stamps the token's `sub`, having no IDAM to resolve a display name from.
  await expect(row).toContainText(ADMIN_EMAIL);
  await expect(row.getByRole("link", { name: "Amend" })).toBeVisible();
  await expectNoAccessibilityViolations(page);

  // Out of the filter bar, which is the caller's own row and not the query: it is still in the library
  // afterwards, offering to be added back.
  await row.getByRole("button", { name: "Remove from my filter bar" }).click();
  await expect(page).toHaveURL("/deed-polls/queries");
  await expect(libraryRow(page, queryName).getByRole("button", { name: "Add to my filter bar" })).toBeVisible();

  await page.getByRole("link", { name: "Back to the case list" }).click();
  await expect(page.getByRole("navigation", { name: "Filter cases" })).not.toContainText(queryName);
});

/**
 * The search box — plan 12's journey, and the two things a term can be.
 *
 * A name narrows the list; a whole reference does not, it *goes to the case*. Both halves are api's decision
 * and neither is inferrable from the rows: `referenceMatch` is a field on the response, so a page that
 * redirected on `total === 1` instead would look right against a one-row name search and wrong against a
 * reference whose case shares a name with others. Only a browser shows that the redirect is a redirect.
 *
 * The middle of the journey is decision 1, which is the correctness rule of the whole plan: a sort header
 * carries the term. Asserted on the URL *and* on the rows, because a header that dropped `q` renders a
 * plausible table of the wrong query under the same heading.
 */
test("caseworker searches the list by name, and is taken to the case when the term is a whole reference", async ({ page, request }) => {
  // Arrange: two cases sharing a surname no other case has, and a third with a different one — so the
  // search has something to exclude, which a search that returned everything would also pass against.
  const seeded = await seedCasesToSearch(request);

  await page.goto("/deed-polls");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Deed poll cases");

  await page.getByLabel("Search cases").fill(seeded.surname);
  await page.getByRole("button", { name: "Search", exact: true }).click();

  // The term is in the URL beside the tab, so a set of results is shareable — decision 7, and the reason
  // there is no JavaScript here. `page` is deliberately absent: a new search starts at its first page.
  await expect(page).toHaveURL(`/deed-polls?filter=all&q=${seeded.surname}`);
  await expect(page.getByText("1 to 2 of 2 applications")).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(2);
  // The surname is on screen, which is why decision 6 added the column: a search that matched on surname and
  // showed only forenames would be a table of results with the reason for each of them off screen.
  await expect(page.locator("tbody tr").first()).toContainText(seeded.surname);
  await expect(page.locator("tbody")).not.toContainText(seeded.otherSurname);
  // Still in the box, so refining a search starts from the term that was searched.
  await expect(page.getByLabel("Search cases")).toHaveValue(seeded.surname);
  await expectNoAccessibilityViolations(page);

  // Decision 1: the order changes and the search does not. The header exists at all because `newSurname` is
  // one of api's sortable fields — a column offering an order api would answer 400 for is decision 6's own
  // failure mode.
  //
  // **Activated from the keyboard rather than clicked**, and not as a preference: the seventh header is the
  // narrowest, so its link — "Sort by" as visually hidden text plus the label — wraps onto two lines, and the
  // centre of a wrapped anchor's bounding box is the gutter between its line boxes, where the `<th>` is what
  // paints. A synthetic centre click is intercepted by the cell; a real user clicks the words, and a keyboard
  // user does this. Nothing about the markup is wrong, so nothing about the markup is worked around.
  const surnameHeader = page.getByRole("link", { name: "Sort by New surname" });
  await surnameHeader.focus();
  await page.keyboard.press("Enter");

  // Waited for rather than read straight off `page.url()`: pressing a key does not await the navigation it
  // starts, and the URL a moment after the press is still the one that was searched.
  await expect(page).toHaveURL(/[?&]sort=newSurname%3Aasc/);
  expect(new URL(page.url()).searchParams.get("q")).toBe(seeded.surname);
  await expect(page.locator("th", { hasText: "New surname" })).toHaveAttribute("aria-sort", "ascending");
  await expect(page.locator("tbody tr")).toHaveCount(2);

  // And the other half: a whole reference is not a query, it is a case. The redirect is api's `referenceMatch`
  // acted on — never `total === 1`, which this list of two would not have satisfied anyway.
  await page.getByLabel("Search cases").fill(seeded.reference);
  await page.getByRole("button", { name: "Search", exact: true }).click();

  await expect(page).toHaveURL(CASE_URL);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(new RegExp(`^\\s*${seeded.reference}\\s*$`));
  await expectNoAccessibilityViolations(page);

  // The back button returns to the results, which is what makes the redirect safe to do without asking —
  // decision 2, and the answer to "what if they wanted the list".
  await page.goBack();
  await expect(page.getByText("1 to 2 of 2 applications")).toBeVisible();
});

/**
 * The builder with **the browser's scripts switched off**, which is the floor everything above it stands on.
 *
 * Verified rather than reasoned about, per the plan's decision 4: the enhancement that reveals a value
 * control is enhancement, so a caseworker whose scripts are blocked — by a CSP change, an extension, a
 * managed-device policy — still has to be able to build a condition. What that costs them is one submit per
 * control, and what it must not cost them is an error for a condition they are part-way through.
 *
 * No axe check here: `AxeBuilder` injects a script to run, so there is nothing for it to run in. The
 * accessibility of this same markup is checked by the journey above, which renders it from the server too.
 */
test.describe("with JavaScript disabled", () => {
  test.use({ javaScriptEnabled: false });

  test("caseworker reaches the value control by applying an unfinished condition, and is not told off for it", async ({ page, request }) => {
    // Arrange: two cases sharing a forename, which is all a journey that only has to filter needs — the
    // paging and ordering are the journey above's.
    const forename = seedForename();
    await seedCasesToFilter(request, forename);

    await page.goto("/deed-polls");

    // Two submits to get as far as a value control, and the second of them is the one that used to be a
    // dead end: it runs an incomplete condition, which is decision 1.
    await page.getByLabel("Case field for condition 1", { exact: true }).selectOption("newForename");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await page.getByLabel("Comparison for condition 1", { exact: true }).selectOption("is");
    await page.getByRole("button", { name: "Apply filters" }).click();

    // The control is on screen and the row asks for its value with a hint — not an error, not an error
    // summary, and not a 400. Decision 2: a caseworker halfway through building a filter has made no mistake.
    await expect(page.getByLabel("Value for condition 1", { exact: true })).toBeVisible();
    await expect(page.getByText("Enter a value to use this condition")).toBeVisible();
    await expect(page.locator(".govuk-error-summary")).toHaveCount(0);
    expect((await page.reload())?.status()).toBe(200);

    // And the page says what the query ran without, above the results — decision 3, because filtering by
    // less than was asked without saying so is the worse failure.
    await expect(page.getByText("Condition 1 was not used, because it is not complete.")).toBeVisible();

    // Finished, and now the condition runs: the same rows a caseworker with scripts would have got.
    await page.getByLabel("Value for condition 1", { exact: true }).fill(forename);
    await page.getByRole("button", { name: "Apply filters" }).click();

    await expect(page).toHaveURL(`/deed-polls?where=newForename%3Ais%3A${forename}`);
    await expect(page.getByText("1 to 2 of 2 applications")).toBeVisible();
    await expect(page.locator(".govuk-inset-text")).toHaveCount(0);
  });
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
 * A forename no other run and no other test shares.
 *
 * Unique per run because the mock is a process that outlives one — `reuseExistingServer` keeps it between
 * local runs — so a fixed forename would find the previous run's cases too and the totals this journey
 * asserts would climb by 29 each time. Unique per test because the mock's case store is shared with every
 * other spec running in parallel, and `POST /__mock/reset` would delete their cases mid-journey.
 */
function seedForename(): string {
  return `Filterby${Date.now().toString(36)}`;
}

/**
 * The cases the query journey filters: `ADULT_CASES_TO_QUERY` Adult and `MINOR_CASES_TO_QUERY` Minor, all
 * sharing one forename, each Adult one received on a day of its own so an order by Received is assertable.
 *
 * Dates in January so they cannot collide with `DATE_RECEIVED`, which every case the other journeys create
 * carries — those cases are in the list too, and only the forename condition keeps them out of this one.
 */
async function seedCasesToQuery(request: APIRequestContext, newForename: string): Promise<void> {
  const seed = async (body: Record<string, unknown>): Promise<void> => {
    const response = await request.post(`${MOCK_API_URL}/__mock/cases`, { data: { newForename, ...body } });
    // Asserted, because a rejected seed leaves the journey filtering an emptier list than it means to and
    // the failure would surface as a wrong total several steps later.
    expect(response.status(), await response.text()).toBe(201);
  };

  for (let day = 1; day <= ADULT_CASES_TO_QUERY; day++) {
    const dd = String(day).padStart(2, "0");
    // A display reference of its own: the Reference cell is a link, and one with no text is both useless to
    // a caseworker and an accessibility violation on every list page the rest of the run renders.
    await seed({ type: "Adult", dateReceived: `2026-01-${dd}T00:00:00.000`, displayReference: `KBDP2026-1${dd}00` });
  }

  for (let day = 1; day <= MINOR_CASES_TO_QUERY; day++) {
    const dd = String(day).padStart(2, "0");
    await seed({ type: "Minor", dateReceived: `2026-02-${dd}T00:00:00.000`, displayReference: `KBDP2026-2${dd}00` });
  }
}

/**
 * Two cases sharing one forename, for the two builder journeys, which have to filter and nothing else — the
 * paging and the ordering are `seedCasesToQuery`'s. Each journey calls this with a forename of its own, so
 * the four cases never meet.
 *
 * Received in April so they cannot collide with either `DATE_RECEIVED` or `seedCasesToQuery`'s January and
 * February, and given a display reference each because the Reference cell is a link and one with no text is
 * an accessibility violation on every list page the rest of the run renders.
 */
async function seedCasesToFilter(request: APIRequestContext, newForename: string): Promise<void> {
  for (const day of ["05", "06"]) {
    const response = await request.post(`${MOCK_API_URL}/__mock/cases`, {
      data: { newForename, type: "Adult", dateReceived: `2026-04-${day}T00:00:00.000`, displayReference: `KBDP2026-3${day}00` }
    });
    expect(response.status(), await response.text()).toBe(201);
  }
}

/**
 * The three cases the search journey needs: two sharing a surname, one not, each with a reference of its own.
 *
 * **The surname is unique per test for the reason the forename is** — the mock's store is shared with every
 * spec in the run and outlives the run itself, so a fixed "Smith" would find the previous run's cases and the
 * total this journey asserts would climb by two each time. The seed script's `Adultcase`/`Minorcase` surnames
 * are no use here for the same reason: every case it seeds shares one, so a search for it matches 26 rows.
 *
 * **The references are unique per test too, and that is load-bearing rather than tidy**: the redirect goes to
 * the *first* case whose reference matches, so a second case carrying the same reference would send the
 * journey to somebody else's case and the heading assertion would still pass. Four digits off the clock in
 * seconds, so two runs collide only if they start an exact multiple of ~2.8 hours apart, and the leading digit
 * keeps them clear of the other seeds' `1`/`2`/`3` and of the `0000n` serials the mock allocates on a create.
 */
async function seedCasesToSearch(request: APIRequestContext): Promise<{ surname: string; otherSurname: string; reference: string }> {
  const token = Date.now().toString(36);
  const serial = String(Math.floor(Date.now() / 1000)).slice(-4);
  const surname = `Searchby${token}`;
  const otherSurname = `Ignoreby${token}`;
  const reference = `KBDP2026-8${serial}`;

  // Received in May, so they cannot collide with `DATE_RECEIVED` or with either builder journey's seeds —
  // those cases are in the list too, and only the surname keeps them out of this one.
  const cases = [
    { newForename: "Ada", newSurname: surname, displayReference: reference, dateReceived: "2026-05-01T00:00:00.000" },
    { newForename: "Grace", newSurname: surname, displayReference: `KBDP2026-7${serial}`, dateReceived: "2026-05-02T00:00:00.000" },
    { newForename: "Nia", newSurname: otherSurname, displayReference: `KBDP2026-6${serial}`, dateReceived: "2026-05-03T00:00:00.000" }
  ];

  for (const body of cases) {
    const response = await request.post(`${MOCK_API_URL}/__mock/cases`, { data: { type: "Adult", ...body } });
    // Asserted, because a rejected seed leaves the journey searching an emptier list than it means to and the
    // failure would surface as a wrong total several steps later.
    expect(response.status(), await response.text()).toBe(201);
  }

  return { surname, otherSurname, reference };
}

/**
 * The cases the returned-for-action journey counts: two driven to `Decided`, one left `Claimed`.
 *
 * **The referrals are driven through the contract routes, never written onto the seed body.** api derives
 * `currentReferralState` from the case's live referral and the mock recomputes it on every transition, so a
 * fixture that set the column directly would teach the dashboard a number api's own state machine cannot
 * produce — the failure would then be wrong in one direction here and another deployed. Same reasoning as
 * `scripts/seed-local-cases.mjs`, which this mirrors.
 *
 * The case bodies go through `POST /__mock/cases` because what a create does is not what is being tested here,
 * and each carries a display reference of its own: the Reference cell is a link, and one with no text is both
 * useless to a caseworker and an accessibility violation on every list page the rest of the run renders.
 * Received in June so the dates collide with no other seed's.
 *
 * **Each reference is `KBDPYYYY-` and five digits, because that is the only shape api allocates** — the same
 * shape this file asserts a created case's heading holds (`expectWelshKeysResolve`), and the only one the mock
 * re-prefixes when a case's type changes. A fixture carrying digits-and-letters would have the journey pass
 * against case data no environment can produce.
 *
 * **Five digits is only 10,000 serials, so the reference cannot carry this run's identity — the surname
 * does.** Four digits off the clock in seconds cycle every 10,000s, so a run starting an exact multiple of
 * ~2.8 hours after an earlier one reuses its references, and the store holds every earlier run's `Decided`
 * cases. Were the worklist rows matched on reference alone, that stale row would satisfy "the seeded cases are
 * displayed" with the new ones absent, so the caller matches on `surname` *and* reference; the surname carries
 * base-36 milliseconds, which no earlier run shares. Within the run the three references still have to differ
 * from each other and from the rest of the suite's, which is what the leading digit is for: `9`, `5` and `4`
 * are what the other seeders' `1`/`2`/`3`/`6`/`7`/`8` and the `0000n` serials the mock allocates on a real
 * create leave free.
 *
 * `total` is what the banner should say — the baseline the store already held plus the two this adds.
 */
async function seedReturnedForActionCases(request: APIRequestContext): Promise<{ total: number; surname: string; decided: string[]; claimed: string }> {
  const leads = ["9", "5", "4"];
  const baseline = await returnedForActionTotal(request);
  const surname = `Returnedby${Date.now().toString(36)}`;
  const serial = String(Math.floor(Date.now() / 1000)).slice(-4);

  const seed = async (n: number): Promise<{ id: string; reference: string }> => {
    const reference = `KBDP2026-${leads[n - 1]}${serial}`;
    const response = await request.post(`${MOCK_API_URL}/__mock/cases`, {
      data: {
        type: "Adult",
        state: "Received",
        newForename: "Ada",
        newSurname: surname,
        displayReference: reference,
        dateReceived: `2026-06-0${n}T00:00:00.000`
      }
    });
    // Asserted, because a rejected seed leaves the journey counting fewer cases than it means to and the
    // failure surfaces later as a banner one short, which reads as a bug in the count.
    expect(response.status(), await response.text()).toBe(201);

    return { id: (await response.json()).id, reference };
  };

  const decided = [await seed(1), await seed(2)];
  for (const { id } of decided) await referTo(request, id, "Decided");

  const claimed = await seed(3);
  await referTo(request, claimed.id, "Claimed");

  return { total: baseline + decided.length, surname, decided: decided.map((one) => one.reference), claimed: claimed.reference };
}

/**
 * How many cases api counts as needing action right now — the query the dashboard's banner reads.
 *
 * Read before seeding because the count is global (decision 5) and the mock's store outlives the run, so an
 * earlier run's or `yarn mock:seed`'s `Decided` cases belong in the number the banner shows. `size=1` for the
 * reason the dashboard uses it: the total is api's across every page and the rows are not wanted here.
 */
async function returnedForActionTotal(request: APIRequestContext): Promise<number> {
  const response = await request.get(`${MOCK_API_URL}/caseworker/cases?where=currentReferralState:is:Decided&size=1`);
  expect(response.status(), await response.text()).toBe(200);

  return (await response.json()).total;
}

/**
 * Raise a referral on a case and transition it as far as `upTo`.
 *
 * Every step is checked: a refusal part-way leaves the referral in whatever state it reached, and the only
 * symptom is a count that is quietly short — which is indistinguishable from the condition being dropped on
 * the way to the wire, the failure this whole feature's tests exist to tell apart.
 */
async function referTo(request: APIRequestContext, caseId: string, upTo: "Claimed" | "Decided"): Promise<void> {
  const raised = await request.post(`${MOCK_API_URL}/caseworker/cases/${caseId}/referrals`, { data: { reasons: ["Minor"] } });
  expect(raised.status(), await raised.text()).toBe(201);
  const referralId = (await raised.json()).id;

  const judge = { authorization: `Bearer x.${Buffer.from(JSON.stringify({ sub: SEED_JUDGE }), "utf8").toString("base64url")}.signature` };
  const claimed = await request.post(`${MOCK_API_URL}/judicial/referrals/${referralId}/claim`, { headers: judge });
  expect(claimed.status(), await claimed.text()).toBe(200);
  if (upTo === "Claimed") return;

  // The direction is what makes it the caseworker's turn again: `Claimed → Decided`, and the caseworker's
  // `close` has not happened, which is the whole of "returned — action needed".
  const directed = await request.post(`${MOCK_API_URL}/judicial/referrals/${referralId}/direction`, {
    headers: judge,
    data: { decision: "Approved", publishToGazette: true }
  });
  expect(directed.status(), await directed.text()).toBe(200);
}

/**
 * The filter bar's saved-query group, addressed by position because a group has no accessible name of its
 * own — the `<nav>` carries the label and each group carries an `<h2>`. It is the second group because the
 * statuses are the first, and there is no third.
 */
function savedQueryGroup(page: Page): Locator {
  return page.locator(".app-filter-nav__group").nth(1);
}

/**
 * One query's row in the library, found by its name.
 *
 * The mock's saved queries are shared with every spec in the run and outlive the run itself, so the library
 * holds rows this journey did not put there — and every row carries an Add-or-Remove button of the same name.
 * Scoping by the name each journey generates is what keeps the control that gets pressed the right one.
 */
function libraryRow(page: Page, queryName: string): Locator {
  return page.locator("li", { hasText: queryName });
}

/** The conditions the URL on screen holds, which is what a sort or a page link must not have dropped. */
function conditionsOf(page: Page): string[] {
  return new URL(page.url()).searchParams.getAll("where");
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
 * A referral's Reason for urgency row, for the same reason `declarantRow` is scoped: "Not provided" appears
 * against every field a referral does not carry, so the assertion has to name the row it is about.
 */
function urgencyReasonRow(page: Page): Locator {
  return page.locator(".govuk-summary-list__row", { hasText: "Reason for urgency" });
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
 * hide any that appear later. Reinstate one only with evidence, as `allowed` below requires: a waiver names
 * the rule **and** the element, so the same rule anywhere else on the page still fails.
 *
 * Reported as `id: selector` strings rather than raw violation objects so a failure names the rule and
 * the element instead of printing an unreadable object graph.
 */
async function expectNoAccessibilityViolations(page: Page, allowed: string[] = []): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const findings = results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target).join(", ")}`);

  expect(findings.filter((finding) => !allowed.includes(finding))).toEqual([]);
}
