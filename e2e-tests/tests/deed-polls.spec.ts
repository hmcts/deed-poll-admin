/**
 * The deed-poll journeys, end to end in a browser.
 *
 * A handful of tests, not twelve: accessibility, validation and the Welsh shape are checked at the points
 * the journey already passes through, per `.claude/rules/e2e-testing.md`. Each test creates its own case,
 * so they are independent under `fullyParallel`.
 *
 * **Where a rule differs by role, the test name says which role it signs in as.** The notes and witnesses
 * journeys run as `team-leader@example.com`, the only fixture holding `caseworker-deedpoll-team-leader`, and say so —
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
  CASEWORKER_STORAGE_STATE,
  DEPLOYED_STACK_SKIP_REASON,
  JUDGE_EMAIL,
  JUDGE_STORAGE_STATE,
  RUNS_AGAINST_DEPLOYED_STACK,
  signInAsTeamLeader,
  TEAM_LEADER_EMAIL,
  TEAM_LEADER_STORAGE_STATE
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
test.use({ storageState: TEAM_LEADER_STORAGE_STATE });

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
  await expect(caseHeader(page)).toContainText(TEAM_LEADER_EMAIL);
  await expectNoAccessibilityViolations(page);

  await expectWelshKeysResolve(browser, caseUrl);

  await expect(summaryRow(page, "Old forename")).toContainText("Jo");
  await expect(summaryRow(page, "Old surname")).toContainText("Bloggs");
  await page.getByRole("link", { name: "Change Names" }).click();
  await expect(page.getByLabel("Old forename", { exact: true })).toHaveValue("Jo");
  await expect(page.getByLabel("Old surname", { exact: true })).toHaveValue("Bloggs");
  await expect(page.getByLabel("New forename", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("New surname", { exact: true })).toHaveValue("");
  await page.getByLabel("New forename", { exact: true }).fill("Josephine");
  await page.getByLabel("New surname", { exact: true }).fill("Taylor");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page).toHaveURL(`${caseUrl}#application`);
  await expect(summaryRow(page, "Old surname")).toContainText("Bloggs");
  await expect(summaryRow(page, "New forename")).toContainText("Josephine");
  await expect(summaryRow(page, "New surname")).toContainText("Taylor");

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
// **Administrator, not caseworker** — this file signs in as `team-leader@example.com` throughout, and once api
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
 * api gates `DELETE .../witnesses/{witnessId}` on `caseworker-deedpoll-team-leader` in its domain. Adding and
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

  // `exact` because the retired "Referral to Master" tab that made it load-bearing is gone
  // (`referrals-admin-4` decision 2) and the substring would match it again the moment anything reinstated it.
  await page.getByRole("tab", { name: "Referrals", exact: true }).click();
  await expect(referrals).toContainText("None recorded.");
  await page.getByRole("button", { name: "Refer this case to a Master" }).click();
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
  // "Applicant is a minor" alone is refused: the Masters asked to be told what kind of minor's application it is
  // (Master Sullivan's feedback, Steve, 2026-10-27), as options revealed beneath it.
  await page.getByRole("button", { name: "Raise referral" }).click();
  await expect(page.getByRole("link", { name: "Select what applies to the minor's application" })).toHaveAttribute("href", "#minorDetails");
  await page.getByLabel("Transgender", { exact: true }).check();
  await page.getByLabel("Have parental consent", { exact: true }).check();
  await page.getByRole("button", { name: "Raise referral" }).click();

  await expect(page).toHaveURL(`${caseUrl}#referrals`);
  // The labels, not api's members — the wire values are api's and the words are this repo's — with the minor's
  // details read as part of "Applicant is a minor" rather than as reasons of their own.
  await expect(referrals).toContainText("Applicant is a minor: Transgender, Have parental consent");
  await expect(referrals).toContainText("Other");
  await expect(referrals).toContainText("Standard");
  // The caseworker's status label rather than api's member: the tag says where the referral is.
  await expect(referrals.locator(".govuk-tag")).toHaveText("Waiting for assignment");
  // The raise button is withheld while one is live, with the reason in its place rather than a button that
  // could only fail.
  await expect(page.getByRole("button", { name: "Refer this case to a Master" })).toHaveCount(0);
  await expect(referrals).toContainText("Withdraw the open referral before raising another.");
  await expectNoAccessibilityViolations(page);

  // The withheld button is not the rule — api's 409 is, and the form is reachable by URL. It renders as a
  // message with a link to the referral already open, not as an error page.
  await page.goto(`${caseUrl}/referrals/new`);
  await page.getByLabel("Applicant is a minor").check();
  await page.getByLabel("Court Order", { exact: true }).check();
  await page.getByLabel("Standard", { exact: true }).check();
  await page.getByRole("button", { name: "Raise referral" }).click();
  await expect(page.getByRole("alert")).toContainText("This case already has an open referral.");
  await expectNoAccessibilityViolations(page, UPSTREAM_RADIO_REVEAL);

  await page.getByRole("link", { name: "View the open referral" }).click();
  await expect(page).toHaveURL(/\/referrals\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Referral to a Master");
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
  await expect(page.getByRole("button", { name: "Refer this case to a Master" })).toBeVisible();

  // The withdraw control is gone from a referral that can no longer be withdrawn, absent from the markup
  // rather than disabled — the same shape as the note and witness deletes above.
  await page.getByRole("link", { name: /view this referral/ }).click();
  await expect(page.getByRole("button", { name: "Withdraw this referral" })).toHaveCount(0);
  // Scoped to the status row, because the status now carries a sentence as well as a label: a bare
  // `getByText("Withdrawn")` matches both, and a bare `.govuk-tag` also catches the phase banner and the
  // persona strip. The pair is the point — the label is scannable, the sentence says what it means for the case.
  const referralStatus = page.locator(".govuk-summary-list__row", { hasText: "Referral status" });
  await expect(referralStatus.locator(".govuk-tag")).toHaveText("Withdrawn");
  await expect(referralStatus).toContainText("Withdrawn before a direction");
  // And no closure control either: this referral never had a direction to action. `button` and not `link`,
  // because `govukButton` given an `href` renders `<a role="button">` — a locator reaching for `link` finds
  // nothing on any page and this absence assertion passed for the wrong reason until the journey below needed
  // the same control to be *present*.
  await expect(page.getByRole("button", { name: "Mark direction as actioned" })).toHaveCount(0);

  // And the other record of the same two events — the case's own timeline. api writes a note at each successful
  // transition (`referrals-admin-5`), so a caseworker reading the Notes tab sees the referral leave and come back
  // with nothing in between; no page composes either sentence, which is why this is the only place in the app
  // they can be checked.
  await page.getByRole("link", { name: "Back to case" }).click();
  await page.getByRole("tab", { name: "Notes" }).click();
  const notes = page.locator("#notes");
  await expect(notes).toContainText("2 notes");

  // Newest first, which is the **grid's** order and not the payload's: the case detail's `notes` arrive
  // oldest-first from api and `buildNotesView` sorts them. The withdrawn note names the referral it was, because
  // a case may carry several over its life and "referral withdrawn" in a grid of thirty notes does not say which.
  const noteRows = notes.locator("tbody tr");
  await expect(noteRows.nth(0)).toContainText("Referral to a Master withdrawn. It was raised on");
  await expect(noteRows.nth(0)).toContainText("reasons: Applicant is a minor: Transgender, Have parental consent; Other.");
  // The reasons are api's stored members here rather than the caseworker's labels — the prose is api's
  // (`ReferralNotes`), so "Minor" and not "Applicant is a minor". Reworded there, not here.
  await expect(noteRows.nth(1)).toContainText("Referred to a Master. Reasons: Applicant is a minor: Transgender, Have parental consent; Other.");
  await expect(noteRows.nth(1)).toContainText("Notes: The declarant is abroad until June.");
  // The value left inside the closed urgency reveal reached neither the referral nor its note: the same
  // assertion as "Not provided" above, one layer further on, and the note is where a discarded answer would
  // otherwise resurface with no page to correct it.
  await expect(notes).not.toContainText("Hearing listed on Friday.");
  await expectNoAccessibilityViolations(page);
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
 * **The number is asserted against api's total at the same moment, never against an arithmetic baseline.** It is
 * global by design (decision 5) and the mock's store outlives a run — `reuseExistingServer` — so `yarn mock:seed`
 * and every earlier run leave `Decided` cases that are legitimately part of it. This test used to add two to a
 * baseline it had read and assert the sum, which was only safe while nothing else in the suite produced a
 * `Decided` referral: `judicial.spec.ts` records a direction and the mark-as-actioned journey below drives one to
 * `Decided` and back, both in parallel workers, so the sum can be two short or two over by the time the banner
 * renders. Comparing the two sides at one moment — as `judicial.spec.ts` compares the pool's summary — pins the
 * claim that matters, that the banner states api's total for that condition, and the rows below pin that this
 * journey's cases are in it.
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
  await expect(banner).toContainText("applications have a returned direction needing action");
  await expectReturnedForActionCountMatchesApi(page, request);
  await expectNoAccessibilityViolations(page);

  // Decision 5, where a caseworker would notice it: the count is a fact about the service, so another tab —
  // whose own list holds none of these cases — does not narrow it. Against api's global total, which is exactly
  // the claim: a count narrowed by the tab would be below it.
  await page.getByRole("link", { name: "Enrolled" }).click();
  await expect(banner).toContainText("applications have a returned direction needing action");
  await expectReturnedForActionCountMatchesApi(page, request);

  await banner.getByRole("link", { name: "View these applications" }).click();

  // The same condition the count was read with, and no filter, term, order or page — so the worklist is not
  // narrowed by the tab it was clicked from.
  await expect(page).toHaveURL("/deed-polls?where=currentReferralState%3Ais%3ADecided");
  // api's total for the query, which is the number the banner had: the count and the worklist are one query.
  await expectWorklistTotalMatchesApi(page, request);

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
  await expectWorklistTotalMatchesApi(page, request);
  await expect(seededRow(seeded.claimed)).toHaveCount(0);
  for (const reference of seeded.decided) await expect(seededRow(reference)).toHaveCount(1);
});

/**
 * The other end of the same feature — `docs/plans/referrals-admin-4-caseworker-completion.md`.
 *
 * **One journey, because the caseworker's half of a referral is one story**: they raise it, a judge answers it,
 * they are told through the count, they read the direction, they carry it out, and they say so. The test above
 * stops at "the number is followable"; this one goes on to what the number is *for*, and finishes by watching the
 * number go down again.
 *
 * **What only a browser can show here, and why this earns its keep on top of the page tests:**
 *
 * - **The two writes are api's state machine, driven for real.** The claim and the direction go through the
 *   judicial routes with a judge's token (`claimAndDirect`), exactly as `scripts/seed-local-cases.mjs` drives
 *   them, so `Decided` is a state api produced rather than one a stub asserted. A `vi.fn()` returning
 *   `state: "Decided"` cannot show that the closure is refused for anything else, that `currentReferralState`
 *   recomputes, or that the count falls without anybody decrementing it (decision 7).
 * - **`decidedBy` outliving the closure is a claim about two round trips.** Closing changes the modifier to the
 *   caseworker who actioned it, and the direction must still be credited to the judge (decision 4). Both names
 *   are on screen after the close, from api's own record.
 * - **The caseworker is never offered the control api would refuse.** No withdrawal on a returned direction
 *   (api-4 gives that its own 409), no "mark as actioned" once it is actioned, and no confirmation page for a
 *   referral that has nothing to confirm — the last of those is a redirect, which is only a redirect in a browser.
 * - **The count reduces because api recomputed, not because a page removed a row.** Asserted on a query narrowed
 *   to this journey's own surname, for the reason the test above no longer asserts a sum: the global number moves
 *   under a parallel run, and `1 → 0` on this run's own cases is the "exactly one" that survives it.
 * - **The referral's history is on the Notes tab, and no page put it there** — `referrals-admin-5`. api writes a
 *   note at each successful transition; this app renders the grid it already had, so the only way to see the
 *   feature at all is to drive four transitions and read the page. Both personas' views of the same rows are
 *   asserted, and the judge's *before* the closure: api answers them 404 for a closed referral, so that is the
 *   only window it exists in.
 *
 * Either role, so this file's administrator serves: api gates neither raising nor closing on the admin role. The
 * judge's half restores `JUDGE_STORAGE_STATE` in a context of its own and only reads, so it does not disturb the
 * session `judicial.spec.ts` shares.
 */
test("caseworker actions a returned direction, and the returned-direction count falls by one", async ({ page, browser, request }) => {
  // Three times the default timeout, for the reason `emails.spec.ts` gives: this is one journey rather than a slow
  // one. Six axe scans, eleven steps, and two contexts of their own — the judge's read of the same timeline and
  // the Welsh session, the second of which pays for an IDAM sign-in — run past the 30-second default, and it was
  // reached inside the Welsh helper's `context.close()`, which reports as a closed browser and reads as a crash.
  // Splitting the journey to fit would cost what the journey is for: that the referral's history is one thread
  // from the raise to the closure.
  test.slow();

  // Arrange: one case, seeded through the mock's control route because what a create does is the first test's
  // subject and not this one's. Its surname carries this run's identity, which is what makes the count
  // assertions below immune to every other spec's `Decided` referrals — see `returnedForActionTotal`.
  const seeded = await seedCaseToAction(request);
  const caseUrl = `/deed-polls/${seeded.id}`;
  const referrals = page.locator("#referrals");
  const direction: JudicialDirection = {
    decision: "Approved",
    directionsText: "Approved. Enrol once the applicant has confirmed the spelling of the new surname.",
    changesToStandardPublication: false
  };
  // The part of the direction's own words that appears nowhere else, so "the lifecycle note summarised the
  // direction instead of copying it" can be asserted as an absence. Not the whole of `directionsText`: it opens
  // with "Approved", which the note carries as the decision, and a fragment that overlapped would let the
  // assertion pass on a note that had copied everything after it.
  const directionOnlyFragment = "Enrol once the applicant has confirmed the spelling";

  // Nothing of this run's is waiting for action yet, which is the number the closure at the end returns to.
  expect(await returnedForActionTotal(request, seeded.surname)).toBe(0);

  // 1. Raised by the caseworker, through the form — the reveals and the refusals on it are the journey above's.
  await page.goto(caseUrl);
  await page.getByRole("tab", { name: "Referrals", exact: true }).click();
  await expect(referrals).toContainText("None recorded.");
  await page.getByRole("button", { name: "Refer this case to a Master" }).click();
  await expect(page).toHaveURL(`${caseUrl}/referrals/new`);
  await page.getByLabel("Applicant is a minor").check();
  await page.getByLabel("Court Order", { exact: true }).check();
  await page.getByLabel("Standard", { exact: true }).check();
  await page.getByRole("button", { name: "Raise referral" }).click();

  await expect(page).toHaveURL(`${caseUrl}#referrals`);
  await expect(referrals.locator(".govuk-tag")).toHaveText("Waiting for assignment");

  // The referral's id, read off the row that links to it: it is the mock's, and this is the only place the page
  // states it.
  const referralUrl = await referrals.getByRole("link", { name: /view this referral/ }).getAttribute("href");
  expect(referralUrl).toMatch(new RegExp(`^${caseUrl}/referrals/[0-9a-f-]{36}$`));
  const referralId = (referralUrl as string).split("/").pop() as string;

  // 2. Claimed and directed through api's judicial contract, because that is what makes it the caseworker's turn
  // again. Not driven through the judicial UI: that persona's journey is `judicial.spec.ts`, and a second copy of
  // it here would double a three-step flow this test says nothing about.
  //
  // **As the judge fixture and not an invented subject**, which is what makes step 6a possible at all: api narrows
  // a `Decided` referral to the judge who decided it, so a claim attributed to anybody else would answer the
  // signed-in judge 404 — and this journey's two judicial notes would then be unreadable on the surface they were
  // written for.
  await claimAndDirect(request, referralId, direction);
  expect(await returnedForActionTotal(request, seeded.surname)).toBe(1);

  // 3. And the caseworker finds out from the dashboard, which is the whole of the alerting (decision 7).
  await page.goto("/deed-polls");
  const banner = page.getByRole("region", { name: "Important" });
  await expect(banner).toContainText("returned direction needing action");
  await expectReturnedForActionCountMatchesApi(page, request);

  await banner.getByRole("link", { name: "View these applications" }).click();
  await expect(page).toHaveURL("/deed-polls?where=currentReferralState%3Ais%3ADecided");
  // Matched on this run's surname as well as the reference, for the reason `seedReturnedForActionCases` records:
  // a five-digit reference is unique only by arithmetic, and the store outlives the run.
  const worklistRow = page.locator("tbody tr").filter({ hasText: seeded.surname }).filter({ hasText: seeded.reference });
  await expect(worklistRow).toHaveCount(1);

  // Followed into the case from the worklist rather than by URL: the row is the route the banner promises.
  await worklistRow.getByRole("link", { name: seeded.reference }).click();
  await expect(page).toHaveURL(caseUrl);

  // 4. The tab says what came back and what to do about it — and does **not** tell the caseworker to withdraw the
  // referral, which is the single message decision 5 split and a thing api now refuses outright.
  await page.getByRole("tab", { name: "Referrals", exact: true }).click();
  await expect(referrals.locator(".govuk-tag")).toHaveText("Direction received");
  await expect(referrals).toContainText("A Master has returned a direction on this case.");
  await expect(referrals).not.toContainText("Withdraw the open referral before raising another.");
  // Still no second referral while this one is live: `Decided` is not terminal, which is exactly the pair of
  // rules api-4 kept apart.
  await expect(page.getByRole("button", { name: "Refer this case to a Master" })).toHaveCount(0);
  await expectNoAccessibilityViolations(page);

  // 5. The direction in full, on the page that tells them to carry it out (decision 4).
  await referrals.getByRole("link", { name: /view this referral/ }).click();
  await expect(page).toHaveURL(`${caseUrl}/referrals/${referralId}`);
  await expect(summaryRow(page, "Referral status").locator(".govuk-tag")).toHaveText("Direction received");
  await expect(summaryRow(page, "Referral status")).toContainText("Direction received — action needed");
  await expect(page.getByRole("heading", { name: "Direction from the Master" })).toBeVisible();
  await expect(summaryRow(page, "Decision")).toContainText("Approved");
  await expect(summaryRow(page, "Directions")).toContainText(direction.directionsText);
  // No because the Master answered no — a standard publication. The third answer, "Not recorded", is the one a
  // page test pins.
  await expect(summaryRow(page, "Changes to the standard publications in the Gazette")).toContainText("No");
  await expect(summaryRow(page, "Decided by")).toContainText(JUDGE_EMAIL);
  await expect(summaryRow(page, "Claimed by a Master")).toContainText(JUDGE_EMAIL);
  // 6. And no withdrawal, absent from the markup rather than disabled: api answers 409 with a sentence of its own
  // for this state, so a button here could only collect a refusal.
  await expect(page.getByRole("button", { name: "Withdraw this referral" })).toHaveCount(0);
  await expectNoAccessibilityViolations(page);

  // 6a. **The Master's view of the same referral, read before the closure because that is the only window it
  // exists in**: api answers the judicial surface 404 for a `Closed` referral. The lifecycle notes above are the
  // office's alone since 2026-10-27 — the Master asked for case notes to leave their screen — so theirs carries the
  // direction and none of them.
  await expectMasterSeesDirectionWithoutNotes(browser, referralId, directionOnlyFragment);

  // 7. The confirmation, which is the one thing this journey adds that the withdrawal has no equivalent of: the
  // three assertions being made are on the page, above the direction they are about.
  await page.getByRole("button", { name: "Mark direction as actioned" }).click();
  await expect(page).toHaveURL(`${caseUrl}/referrals/${referralId}/close`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Confirm the direction has been actioned");
  await expect(page.locator(".govuk-caption-l")).toHaveText(seeded.reference);
  await expect(page.getByText("you have carried out the Master’s direction")).toBeVisible();
  await expect(page.getByText("you have made any updates the application needs, including any dates")).toBeVisible();
  await expect(page.getByText("this referral will leave the list of returned directions waiting for action")).toBeVisible();
  // The direction is on the page the attestation is made on, not one click behind it.
  await expect(summaryRow(page, "Directions")).toContainText(direction.directionsText);
  await expectNoAccessibilityViolations(page);

  // Checked here rather than at the end, and the position is load-bearing: both pages' judicial sections exist
  // only while the referral is `Decided`, and the confirmation page does not exist at all afterwards.
  await expectReferralWelshKeysResolve(browser, `${caseUrl}/referrals/${referralId}`);

  // Cancel is a link, so the only thing on that page that can act is its one submit: the referral comes back
  // unchanged.
  await page.getByRole("link", { name: "Cancel" }).click();
  await expect(page).toHaveURL(`${caseUrl}/referrals/${referralId}`);
  await expect(summaryRow(page, "Referral status").locator(".govuk-tag")).toHaveText("Direction received");

  // Back in, and then the submit. The URL is asserted between the two clicks because the link that opens the page
  // and the button that commits it carry the same words: without it, a second click landing before the navigation
  // would press the link again and the journey would sit on the confirmation page it thought it had submitted.
  await page.getByRole("button", { name: "Mark direction as actioned" }).click();
  await expect(page).toHaveURL(`${caseUrl}/referrals/${referralId}/close`);
  await page.getByRole("button", { name: "Mark direction as actioned" }).click();

  // 8. Post/redirect/get onto the referral, where the state it produced and the direction it preserved are. The
  // banner carries the `role="alert"` `govukNotificationBanner` gives a success type, so it is announced.
  await expect(page).toHaveURL(`${caseUrl}/referrals/${referralId}?close=actioned`);
  await expect(page.getByRole("alert")).toContainText("The direction has been marked as actioned.");
  await expect(summaryRow(page, "Referral status").locator(".govuk-tag")).toHaveText("Direction actioned");
  await expect(summaryRow(page, "Decision")).toContainText("Approved");
  await expect(summaryRow(page, "Directions")).toContainText(direction.directionsText);
  // **The assertion the whole of decision 4 rests on.** Closing changed the modifier to the caseworker who did
  // it; the direction is still the judge's. Reading the author off `modifiedBy` would have swapped these two.
  await expect(summaryRow(page, "Decided by")).toContainText(JUDGE_EMAIL);
  await expect(summaryRow(page, "Last updated")).toContainText(TEAM_LEADER_EMAIL);
  // Neither control applies to a referral that is over.
  await expect(page.getByRole("button", { name: "Mark direction as actioned" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Withdraw this referral" })).toHaveCount(0);
  await expectNoAccessibilityViolations(page);

  // The confirmation page refuses to present an action that no longer applies — a back button, a bookmark or a
  // second tab — and redirects to the referral, which shows the state that explains why.
  await page.goto(`${caseUrl}/referrals/${referralId}/close`);
  await expect(page).toHaveURL(`${caseUrl}/referrals/${referralId}`);

  // 9. Back on the tab: the history keeps the actioned referral, and the case may be referred again.
  await page.getByRole("link", { name: "Back to case" }).click();
  await expect(page).toHaveURL(`${caseUrl}#referrals`);
  await expect(referrals.locator(".govuk-tag")).toHaveText("Direction actioned");
  await expect(referrals).toContainText("Applicant is a minor");
  await expect(page.getByRole("button", { name: "Refer this case to a Master" })).toBeVisible();

  // 10. **The whole of the referral's history on the Notes tab, which is the only page this feature shows up on.**
  // Four transitions, four notes, each written by api at the transition (`referrals-admin-5` decision 1 adds no
  // page code and no lifecycle component) — so a caseworker who arrives months later reads what happened from the
  // grid this app already had.
  await page.getByRole("tab", { name: "Notes" }).click();
  const notes = page.locator("#notes");
  await expect(notes).toContainText("4 notes");

  // **The order asserted is `buildNotesView`'s and not api's.** The case detail's `notes` arrive *oldest* first —
  // api's `@OneToMany` is `@OrderBy("createdOn ASC")`, and the mock reproduces that deliberately — and the grid
  // sorts them newest first. So this pins what the page renders; a payload order would be the wrong claim to make
  // from here, and the mock's own test is where the two projections' opposite orders are pinned.
  const noteRows = notes.locator("tbody tr");
  await expect(noteRows).toHaveCount(4);
  await expect(noteRows.nth(0)).toContainText("marked as actioned.");
  // The caseworker who did the closing, not the judge who gave the direction — the attribution decision 4 turns
  // on, in the grid rather than on the referral this time.
  await expect(noteRows.nth(0)).toContainText(TEAM_LEADER_EMAIL);
  await expect(noteRows.nth(1)).toContainText("Master’s direction recorded for referral");
  await expect(noteRows.nth(1)).toContainText("Decision: Approved.");
  // Spelled out rather than abbreviated to the presence of a word: publication names the applicant in a public
  // notice, so "not published" and "nothing recorded" must not read alike.
  await expect(noteRows.nth(1)).toContainText("Changes to standard publication in the Gazette: No.");
  await expect(noteRows.nth(1)).toContainText(JUDGE_EMAIL);
  await expect(noteRows.nth(2)).toContainText("claimed by a Master.");
  await expect(noteRows.nth(2)).toContainText(JUDGE_EMAIL);
  await expect(noteRows.nth(3)).toContainText("Referred to a Master. Reasons: Applicant is a minor: Court Order.");
  await expect(noteRows.nth(3)).toContainText(TEAM_LEADER_EMAIL);

  // **The direction is summarised in the note and kept whole on the referral**, which is the pair that makes the
  // pointer honest: api allows a direction twice what a note may hold, so a copy would be truncated and read as
  // the whole of a judicial direction. The full text was asserted on the referral at step 8.
  await expect(noteRows.nth(1)).toContainText("See the referral for the full direction.");
  await expect(notes).not.toContainText(directionOnlyFragment);

  // Ordinary case notes, and deliberately not a tamper-proof audit log (decision 4): each row keeps the amend link
  // every other note has, and none of them says it was edited, because api stamps both audit columns at the write.
  await expect(notes.getByRole("link", { name: /amend this note/ })).toHaveCount(4);
  await expect(notes).toContainText("Not edited");
  await expectNoAccessibilityViolations(page);

  // The Welsh shape of the grid these notes arrive in, in a session of its own for the reason
  // `expectWelshKeysResolve` sets out: `?lng=cy` writes to `req.session.locale`. Last of the three page checks,
  // because it is the only one whose subject survives the closure.
  await expectNotesWelshKeysResolve(browser, caseUrl);

  // 11. And the count. **Nobody removed a row and nobody decremented a number** (decision 7): api recomputed
  // `currentReferralState` to null on the closure, so the next read of the same query is short by exactly this
  // case. Asserted on this run's own surname for the strict "by one", and against api's global total for the
  // banner the caseworker actually reads.
  expect(await returnedForActionTotal(request, seeded.surname)).toBe(0);

  await page.goto("/deed-polls");
  await expectReturnedForActionCountMatchesApi(page, request);
  await page.goto("/deed-polls?where=currentReferralState%3Ais%3ADecided");
  await expect(page.locator("tbody tr").filter({ hasText: seeded.surname })).toHaveCount(0);
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
  await fillDate(page.getByRole("group", { name: "Date enrolled" }), { day: "1", month: "4", year: "2026" });
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
  await fillDate(page.getByRole("group", { name: "Date enrolled" }), { day: "1", month: "4", year: "2026" });
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL(`${caseUrl}#enrolment`);
  await expect(caseHeader(page)).toContainText("Enrolled");
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
  await expect(page.getByText("Enter both values to use this condition", { exact: true })).toBeVisible();
  await expect(announcer).toHaveText("Condition 1 now asks for two values.");
  await expectNoAccessibilityViolations(page);

  // Numeric bounds use numeric inputs, retaining distinct lower/upper accessible labels.
  await field.selectOption("ageOfMinor");
  await expect(page.getByLabel("Lower value for condition 1", { exact: true })).toHaveAttribute("type", "number");
  await expect(page.getByLabel("Upper value for condition 1", { exact: true })).toHaveAttribute("type", "number");

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
  // a heading over nothing, so its presence is the assertion that the selection reached api. **"Your queries"
  // rather than "Query library" since plan 14**, because the checkbox was left alone and an unpublished query
  // is the caller's own.
  const savedQueries = savedQueryGroup(page);
  await expect(savedQueries.getByRole("heading", { level: 2 })).toHaveText("Your queries");
  await expect(savedQueries.getByText(queryName)).toHaveAttribute("aria-current", "page");
  await expectNoAccessibilityViolations(page);

  // Away to another tab, which carries the conditions and so is not the saved query: the entry stops being
  // current and becomes the link a caseworker actually travels by.
  await page.getByRole("link", { name: "Enrolled" }).click();
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
  await expect(row).toContainText(TEAM_LEADER_EMAIL);
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
 * Publishing is an Administrator's act — plan 14, and the half of it only a browser shows.
 *
 * **What the unit suite cannot reach.** The gate is `canPublish` in two render models and an `{% if %}` in two
 * templates, and a page test can only assert the flag it was handed. What is asserted here is that the flag
 * comes from **the roles IDAM issued for the session that actually signed in** — this file's fixture is
 * `team-leader@example.com` and the second context's is the roleless `caseworker@example.com`, so the control
 * appearing on one and absent from the other is the real derivation working, not a boolean a test passed in.
 *
 * **The caseworker's half only reads**, which is what makes restoring `CASEWORKER_STORAGE_STATE` safe here —
 * the hazard the persona-switcher spec documents is a *sign-in*, which regenerates the session id and would
 * sign every other spec sharing that state out mid-run. Navigating a restored session does not.
 *
 * **It deletes the query it publishes, and that is not tidiness.** The mock's saved queries are shared with
 * every spec and outlive the run, and a *published* one is visible to every caller rather than just its
 * owner — so leaving one behind would put a row in every later journey's library view and in the filter bar of
 * anybody who added it. The delete also exercises the published-query confirmation, which is the one
 * interstitial in this repo.
 */
test("administrator publishes a query to the library, where a caseworker finds it but cannot publish one", async ({ page, browser, request }) => {
  const forename = seedForename();
  await seedCasesToFilter(request, forename);
  const queryName = `Published by ${forename}`;
  const savePath = `/deed-polls/queries/new?where=newForename%3Ais%3A${forename}`;

  await page.goto(`/deed-polls?where=newForename%3Ais%3A${forename}`);
  await page.getByRole("link", { name: "Save this query" }).click();
  await expect(page).toHaveURL(savePath);

  // The control the rule is about, offered because this session holds `caseworker-deedpoll-team-leader`.
  const publish = page.getByLabel("Add this query to the library, so colleagues can find it");
  await expect(publish).toBeVisible();

  await page.getByLabel("Name").fill(queryName);
  await publish.check();
  await expectNoAccessibilityViolations(page);
  await page.getByRole("button", { name: "Save query" }).click();

  await expect(page).toHaveURL(`/deed-polls?where=newForename%3Ais%3A${forename}`);

  // Published and selected, so it is in the bar's **library** group and not the caller's own — decision 3,
  // and the one case where the two possible axes disagree: the Administrator owns this query and it still
  // belongs to the group that says who else can see it. Addressed by heading rather than by index, because
  // the bar may now carry three groups.
  await expect(savedQueryGroupNamed(page, "Query library").getByText(queryName)).toHaveAttribute("aria-current", "page");

  await page.getByRole("link", { name: "All saved queries" }).click();
  await expect(page).toHaveURL("/deed-polls/queries");

  // Under the library heading on the screen as well, tagged, and attributed to the administrator who saved it.
  await expect(librarySection(page, "Query library")).toContainText(queryName);
  await expect(libraryRow(page, queryName)).toContainText("Published");
  await expect(libraryRow(page, queryName)).toContainText(TEAM_LEADER_EMAIL);
  await expectNoAccessibilityViolations(page);

  // ── the caseworker, in a session of its own ───────────────────────────────────────────────────────────────
  const context = await browser.newContext({ storageState: CASEWORKER_STORAGE_STATE });
  const caseworker = await context.newPage();

  try {
    await caseworker.goto("/deed-polls/queries");

    // Somebody who does not own it can find it, which is the whole point of publishing.
    await expect(librarySection(caseworker, "Query library")).toContainText(queryName);
    await expect(libraryRow(caseworker, queryName)).toContainText("Published");

    // And the control that put it there is not theirs. **Absent from the markup rather than disabled** — a
    // `not.toBeVisible()` would also pass against a control merely styled away, which is not what the
    // `{% if canPublish %}` does. Checked as both the fieldset and the input name, because either surviving
    // alone would be a half-rendered control.
    await caseworker.goto(savePath);
    await expect(caseworker.getByRole("heading", { level: 1 })).toHaveText("Save this query");
    await expect(caseworker.getByLabel("Name")).toBeVisible();
    await expect(caseworker.getByRole("group", { name: "Publish this query" })).toHaveCount(0);
    await expect(caseworker.locator('[name="shared"]')).toHaveCount(0);
    await expectNoAccessibilityViolations(caseworker);
  } finally {
    await context.close();
  }

  // ── and away, so nothing published survives the run ───────────────────────────────────────────────────────
  await page.goto("/deed-polls/queries");
  await libraryRow(page, queryName).getByRole("link", { name: "Amend" }).click();

  // The amend form offers the share box to this persona, and it is ticked because the query is published —
  // the same flag on the way back in.
  await expect(page.getByLabel("Keep this query in the library, so colleagues can find it")).toBeChecked();

  await page.getByRole("button", { name: "Delete query" }).click();

  // The interstitial, because colleagues may hold a published query and this app cannot know whose.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Are you sure you want to delete this query?");
  await expectNoAccessibilityViolations(page);
  await page.getByRole("button", { name: "Delete query" }).click();

  await expect(page).toHaveURL("/deed-polls/queries");
  // Scoped to the row rather than to a `ul`, which also matches the persona strip's list and the footer's.
  await expect(libraryRow(page, queryName)).toHaveCount(0);
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
/**
 * The upload form's document type is a type-ahead, and the type submitted is the one on screen.
 *
 * The plain select underneath is still what is posted, so the journey ends where it always did: a document on the
 * case under the chosen type. The middle step is the one the enhancement adds a rule for. A type picked and then
 * typed over must not be sent, so the form is refused against the type field rather than filing the document under
 * a type the caseworker could no longer see. The file input is never repopulated, so it is chosen again.
 */
test("caseworker finds a document type by typing part of its name, and files the document under it", async ({ page, request }) => {
  const seeded = await seedCaseToAction(request);
  const file = { name: "passport.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF\n") };
  const documentType = page.getByRole("combobox", { name: "Document type" });

  await page.goto(`/deed-polls/${seeded.id}/documents/upload`);

  await documentType.fill("birth");
  await page.getByRole("option", { name: "Birth certificate" }).click();
  await expect(documentType).toHaveValue("Birth certificate");
  await documentType.fill("Not a type");
  await page.getByLabel("Choose a file").setInputFiles(file);
  await page.getByRole("button", { name: "Upload" }).click();

  await expect(page.locator(".govuk-error-summary")).toBeVisible();
  await expect(page.locator("#documentTypeId-error")).toBeVisible();
  await expectNoAccessibilityViolations(page);

  await documentType.fill("pass");
  await expect(page.getByRole("option")).toHaveText(["Passport"]);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(documentType).toHaveValue("Passport");
  await page.getByLabel("Choose a file").setInputFiles(file);
  await page.getByRole("button", { name: "Upload" }).click();

  await expect(page).toHaveURL(`/deed-polls/${seeded.id}#documents`);
  await expect(page.locator("#documents")).toContainText("passport.pdf");
  await expect(page.locator("#documents")).toContainText("Passport");
});

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
  await page.getByLabel("Old forename").fill(name.forename);
  await page.getByLabel("Old surname").fill(name.surname);
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
 * total this journey asserts would climb by two each time. The seed script's `Adultcase`/`Enroledcase` surnames
 * are no use here for the same reason: each is shared by a whole group of seeded cases.
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
 * **No total is returned, deliberately.** It used to answer the baseline plus two and the journey asserted that
 * number, which stopped being safe the moment a second spec produced a `Decided` referral — see the test's own
 * docblock. The banner is compared with api instead, and these references are what say the seeded cases are in it.
 */
async function seedReturnedForActionCases(request: APIRequestContext): Promise<{ surname: string; decided: string[]; claimed: string }> {
  const leads = ["9", "5", "4"];
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

  return { surname, decided: decided.map((one) => one.reference), claimed: claimed.reference };
}

/**
 * One case for the mark-as-actioned journey, with no referral on it: raising one is step 1 of that journey and is
 * driven through the form.
 *
 * **The surname carries the run's identity and the count assertions are narrowed by it.** The alternative — an
 * arithmetic baseline — is what the returned-for-action test above had to give up: the number is global, so a
 * parallel worker recording a direction moves it. `newSurname:is:<this run>` AND `currentReferralState:is:Decided`
 * is a count nothing else in the suite can touch, which is what makes "falls by exactly one" assertable at all.
 *
 * Received in August and led with `0`, so the date and the reference collide with no other seeder's — the leads in
 * use are `1`/`2`/`3` on fixed patterns and `4`–`9` on the clock. The reference matters less here than elsewhere
 * because the surname is what the queries key on, but the Reference cell is a link and one with no text is an
 * accessibility violation on every list page the rest of the run renders.
 */
async function seedCaseToAction(request: APIRequestContext): Promise<{ id: string; surname: string; reference: string }> {
  const surname = `Actionedby${Date.now().toString(36)}`;
  const reference = `KBDP2026-0${String(Math.floor(Date.now() / 1000)).slice(-4)}`;

  const response = await request.post(`${MOCK_API_URL}/__mock/cases`, {
    data: {
      type: "Adult",
      state: "Received",
      newForename: "Ada",
      newSurname: surname,
      displayReference: reference,
      dateReceived: "2026-08-03T00:00:00.000"
    }
  });
  // Asserted, because a rejected seed leaves the journey opening a case that does not exist and the failure
  // surfaces as a 404 on a page whose URL looks right.
  expect(response.status(), await response.text()).toBe(201);

  return { id: (await response.json()).id, surname, reference };
}

/**
 * How many cases api counts as needing action right now — the query the dashboard's banner reads.
 *
 * `size=1` for the reason the dashboard uses it: the total is api's across every page and the rows are not
 * wanted here.
 *
 * **`surname` narrows it to one run's own cases, and that is the only count worth asserting an exact number
 * for.** Unnarrowed it is global by design (decision 5) over a store that outlives the run — `yarn mock:seed`,
 * every earlier run, and any spec in a parallel worker that records a direction — so the global figure is only
 * ever compared against the page at the same moment. api ANDs `where` conditions, so the two together are "this
 * journey's cases that are waiting for action".
 */
async function returnedForActionTotal(request: APIRequestContext, surname?: string): Promise<number> {
  const scope = surname === undefined ? "" : `&where=newSurname:is:${surname}`;
  const response = await request.get(`${MOCK_API_URL}/caseworker/cases?where=currentReferralState:is:Decided${scope}&size=1`);
  expect(response.status(), await response.text()).toBe(200);

  return (await response.json()).total;
}

/**
 * The dashboard banner's number, against api's total for the same condition read at the same moment.
 *
 * **Re-read on each attempt rather than compared once**, as `judicial.spec.ts` compares the pool's summary: the
 * count is global, so another worker's direction or closure can move api's side between a render and an
 * assertion about it, and reloading inside the poll makes the two sides the same moment. Compared by
 * backreference so a failure prints both numbers and so nothing here pins a total this suite does not control.
 *
 * **An absent banner is the number zero**, not a missing element to wait for: the page renders no banner when
 * nothing needs action (`returnedForActionFor` is only set for a non-zero count), which is the state the
 * mark-as-actioned journey can leave a store in.
 */
async function expectReturnedForActionCountMatchesApi(page: Page, request: APIRequestContext): Promise<void> {
  await expect
    .poll(async () => {
      await page.reload();
      const banner = page.getByRole("region", { name: "Important" });
      const shown = (await banner.count()) === 0 ? "0" : ((await banner.textContent()) ?? "").match(/(\d+) applications? ha/)?.[1];

      return `${shown} / api total ${await returnedForActionTotal(request)}`;
    })
    .toMatch(/^(\d+) \/ api total \1$/);
}

/** The worklist's range caption's total, against api's for the same condition — same reasoning, same shape. */
async function expectWorklistTotalMatchesApi(page: Page, request: APIRequestContext): Promise<void> {
  await expect
    .poll(async () => {
      await page.reload();
      const shown = ((await page.getByText(/of \d+ applications/).textContent()) ?? "").match(/of (\d+) applications/)?.[1];

      return `${shown} / api total ${await returnedForActionTotal(request)}`;
    })
    .toMatch(/^(\d+) \/ api total \1$/);
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

  const claimed = await request.post(`${MOCK_API_URL}/judicial/referrals/${referralId}/claim`, { headers: bearer(SEED_JUDGE) });
  expect(claimed.status(), await claimed.text()).toBe(200);
  if (upTo === "Claimed") return;

  // The direction is what makes it the caseworker's turn again: `Claimed → Decided`, and the caseworker's
  // `close` has not happened, which is the whole of "returned — action needed".
  const directed = await request.post(`${MOCK_API_URL}/judicial/referrals/${referralId}/direction`, {
    headers: bearer(SEED_JUDGE),
    data: { decision: "Approved", changesToStandardPublication: false }
  });
  expect(directed.status(), await directed.text()).toBe(200);
}

/**
 * A judge claims the referral and records a direction on it — `Open → Claimed → Decided`.
 *
 * **Driven through api's judicial routes rather than through the judicial UI**, which `judicial.spec.ts` covers
 * end to end: what the caseworker's journey needs is a direction api itself produced, and a second traversal of a
 * three-step flow would double that spec's cost to assert nothing new. It must not be written onto the record
 * either — the mock recomputes `currentReferralState` on every transition, so a fixture that set the state
 * directly would teach the count a number api's own state machine cannot reach.
 *
 * Both steps are checked for the reason `referTo`'s are: a refusal part-way leaves the referral short of
 * `Decided`, and the journey then fails several pages later on a control that is correctly absent.
 *
 * **Attributed to `JUDGE_EMAIL` and not to `SEED_JUDGE`**, which `referTo` still uses: api's judicial surface
 * narrows a `Decided` referral to the judge who decided it, so the journey can only read the judge's side of the
 * timeline if the judge whose session it restores is the one these two writes are credited to.
 */
async function claimAndDirect(request: APIRequestContext, referralId: string, direction: JudicialDirection): Promise<void> {
  const claimed = await request.post(`${MOCK_API_URL}/judicial/referrals/${referralId}/claim`, { headers: bearer(JUDGE_EMAIL) });
  expect(claimed.status(), await claimed.text()).toBe(200);

  const directed = await request.post(`${MOCK_API_URL}/judicial/referrals/${referralId}/direction`, {
    headers: bearer(JUDGE_EMAIL),
    data: direction
  });
  expect(directed.status(), await directed.text()).toBe(200);
}

/**
 * A bearer token carrying a subject and nothing else.
 *
 * The mock reads the subject out of the middle segment and never verifies a signature — `auditName` — so this is
 * all a write needs to be attributed to a name. It proves nothing about authentication, which is the app's own
 * concern and is exercised by the real sign-in the `setup` project performs.
 */
function bearer(subject: string): Record<string, string> {
  const claims = Buffer.from(JSON.stringify({ sub: subject }), "utf8").toString("base64url");

  return { authorization: `Bearer x.${claims}.signature` };
}

/**
 * The filter bar's saved-query group, addressed by position because a group has no accessible name of its
 * own — the `<nav>` carries the label and each group carries an `<h2>`.
 *
 * **There can now be a third group**, since plan 14 split the saved queries into the caller's own and the
 * library's: the order is statuses, then "Your queries", then "Query library", each rendered only when it has
 * entries. So `nth(1)` is the caller's own group **whenever they have one selected that is not published**,
 * and is the library's when they do not. A caller of this helper that means one specifically should say which
 * by heading rather than trusting the index — {@link savedQueryGroupNamed} is that.
 */
function savedQueryGroup(page: Page): Locator {
  return page.locator(".app-filter-nav__group").nth(1);
}

/**
 * A named filter-bar group, which is index-independent and so survives a third group appearing.
 *
 * Filtered on the `<h2>` rather than on the group's whole text: a group's *entries* carry query names, and a
 * query called "Query library" would otherwise answer to the library's heading.
 */
function savedQueryGroupNamed(page: Page, heading: string): Locator {
  return page.locator(".app-filter-nav__group").filter({ has: page.locator(".app-filter-nav__group-label", { hasText: heading }) });
}

/**
 * The list under one of the library page's two headings — plan 14.
 *
 * Addressed through the sibling combinator because the sections are flat siblings rather than nested. **The two
 * selectors differ on purpose:** the library's heading is followed by its live-reference hint before its list,
 * where the caller's own heading is followed by its list directly, so one shared selector would be wrong for
 * one of them. `:text-is` rather than `:has-text`, since "Query library" contains neither heading as a
 * substring but a future third heading might.
 */
function librarySection(page: Page, heading: "Your queries" | "Query library"): Locator {
  return heading === "Query library" ? page.locator("h2:text-is('Query library') + p + ul") : page.locator("h2:text-is('Your queries') + ul");
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
 * session — and the session behind `TEAM_LEADER_STORAGE_STATE` is shared with every other test that restores
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
 * `locale` to the very session it was written to stop writing to, and `signInAsTeamLeader` then hung
 * forever because `/login` redirects an already-authenticated browser to `/deed-polls`, so the
 * simulator's `#username` never renders. The symptom was a bare test timeout with no failed
 * assertion, which reads as a slow app rather than a context that was never anonymous.
 */
async function expectWelshKeysResolve(browser: Browser, caseUrl: string): Promise<void> {
  const context = await browser.newContext({ storageState: undefined });

  try {
    const page = await context.newPage();
    await signInAsTeamLeader(page);
    await page.goto(`${caseUrl}?lng=cy`);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^\s*KBDP2026-\d{5}\s*$/);
    await expect(page.getByRole("link", { name: "Back to cases" })).toBeVisible();
  } finally {
    await context.close();
  }
}

/**
 * The Welsh shape of the referral and the closure confirmation, for the reasons `expectWelshKeysResolve` sets out
 * at length — `cy` holds English deliberately, so what this catches is a **missing** `cy` key, which renders blank
 * rather than erroring and would empty a heading or a whole direction without failing anything.
 *
 * **Its own context and session**, and `storageState: undefined` is load-bearing: `?lng=cy` is a write to
 * `req.session.locale`, and done on the session this file shares it switches another spec into Welsh mid-run.
 *
 * **Both pages in one signed-in context**, because they are only reachable together: the closure confirmation
 * exists solely while the referral is `Decided`, which is also the only state in which the referral page carries a
 * direction to render. One login covers the pair and neither can be checked afterwards.
 */
async function expectReferralWelshKeysResolve(browser: Browser, referralUrl: string): Promise<void> {
  const context = await browser.newContext({ storageState: undefined });

  try {
    const page = await context.newPage();
    await signInAsTeamLeader(page);

    await page.goto(`${referralUrl}?lng=cy`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Referral to a Master");
    await expect(page.getByRole("heading", { name: "Direction from the Master" })).toBeVisible();
    await expect(summaryRow(page, "Referral status")).toBeVisible();
    await expect(summaryRow(page, "Changes to the standard publications in the Gazette")).toBeVisible();
    await expect(page.getByRole("button", { name: "Mark direction as actioned" })).toBeVisible();

    await page.goto(`${referralUrl}/close?lng=cy`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Confirm the direction has been actioned");
    await expect(page.getByText("By marking this referral as actioned you are confirming that:")).toBeVisible();
    await expect(page.getByRole("button", { name: "Mark direction as actioned" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Cancel" })).toBeVisible();
    // The language toggle offers English, which is how the page says it rendered as Welsh at all — a `cy` that
    // failed to resolve would leave the copy blank rather than announcing itself.
    await expect(page.locator(".language")).toContainText("English");
  } finally {
    await context.close();
  }
}

/**
 * The Welsh shape of the Notes grid, for the reasons `expectWelshKeysResolve` sets out at length — and its own
 * context, because `?lng=cy` is a write to `req.session.locale` and this file's session is shared.
 *
 * Its own helper rather than a third navigation inside `expectReferralWelshKeysResolve`: these keys belong to the
 * case page and outlive the closure, where that helper's two pages exist only while the referral is `Decided`.
 *
 * **The panel has to be opened.** The detail page renders every tab's panel, and govuk-frontend's tabs hide all
 * but the selected one once its JavaScript runs — so a columnheader inside the Notes panel is present and
 * invisible until the tab is clicked, and `toBeVisible` is what makes a missing `cy` key fail rather than a
 * hidden one pass.
 */
async function expectNotesWelshKeysResolve(browser: Browser, caseUrl: string): Promise<void> {
  const context = await browser.newContext({ storageState: undefined });

  try {
    const page = await context.newPage();
    await signInAsTeamLeader(page);
    await page.goto(`${caseUrl}?lng=cy`);
    await page.getByRole("tab", { name: "Notes" }).click();

    const notes = page.locator("#notes");
    // `exact`, because "Note" is a substring of "NoteID" and an unscoped match would pass on either header.
    for (const column of ["NoteID", "Note", "Created", "Modified"]) {
      await expect(notes.getByRole("columnheader", { name: column, exact: true })).toBeVisible();
    }
    // The Modified column's own sentence, and the amend link's visually-hidden suffix — two more `cy` keys that
    // render blank rather than erroring, the second of which would leave every row's link unnamed.
    await expect(notes).toContainText("Not edited");
    await expect(notes.getByRole("link", { name: /amend this note/ })).toHaveCount(4);
    // The language toggle offers English, which is how the page says it rendered as Welsh at all.
    await expect(page.locator(".language")).toContainText("English");
  } finally {
    await context.close();
  }
}

/**
 * The Master's view of the referral they decided: the direction, and no case notes.
 *
 * **A context restoring `JUDGE_STORAGE_STATE` rather than a sign-in**, which is safe here and only here: this
 * reads and never asks for `?lng=cy`, so it writes nothing to the session `judicial.spec.ts` shares.
 *
 * api still writes a note at each transition — the caseworker's timeline above reads them — but the judicial
 * projection carries none since 2026-10-27, so neither the heading nor any note's wording reaches this page.
 * `directionOnlyFragment` is the direction's own text, which *is* here, in the direction section.
 */
async function expectMasterSeesDirectionWithoutNotes(browser: Browser, referralId: string, directionOnlyFragment: string): Promise<void> {
  const context = await browser.newContext({ storageState: JUDGE_STORAGE_STATE });

  try {
    const page = await context.newPage();
    await page.goto(`/judicial/referrals/${referralId}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Referral to a Master");
    await expect(summaryRow(page, "Directions/Reasons")).toContainText(directionOnlyFragment);

    await expect(page.getByRole("heading", { name: "Case notes" })).toHaveCount(0);
    const body = page.locator("body");
    await expect(body).not.toContainText("Master’s direction recorded for referral");
    await expect(body).not.toContainText("claimed by a Master.");
    await expect(body).not.toContainText("Referred to a Master. Reasons:");
    await expect(body).not.toContainText(TEAM_LEADER_EMAIL);
    await expectNoAccessibilityViolations(page);
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
 * A `govukSummaryList` row, addressed by its **key**. Located by class because such a row has no accessible name
 * to address it by — the same reason `caseHeader` and `declarantRow` are.
 *
 * **Anchored on the whole key rather than a substring of it**, which `judicial.spec.ts`'s equivalent can afford
 * not to be: the referral page carries both "Decision" and "Decision date", so a substring match on the first
 * resolves two rows and the assertion fails on strict mode instead of on the value it was about. Scoped to the key
 * cell rather than the row for that spec's reason too — `hasText` spans the whole row, so a row whose *value* is
 * the tag "Withdrawn" answers to a key of "Withdrawn".
 */
function summaryRow(page: Page, key: string): Locator {
  const keyCell = page.locator(".govuk-summary-list__key").filter({ hasText: new RegExp(`^\\s*${key}\\s*$`) });

  return page.locator(".govuk-summary-list__row").filter({ has: keyCell });
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

/**
 * The direction a judge records, in api's own field names — `JudicialDirectionRequest`.
 *
 * `directionsText` is optional on the wire and given here on purpose: a direction with no further directions is the
 * "not provided" placeholder the page tests pin, and this journey asserts the caseworker can read the words the
 * judge actually typed.
 */
interface JudicialDirection {
  decision: "Approved" | "Rejected";
  directionsText: string;
  changesToStandardPublication: boolean;
}
